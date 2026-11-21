"""Phase 3 final evaluation and the production champion.

- ``final_test``: refit everything on 2015-16..2024-25 and predict all of 2025-26 ONCE. A marker
  file (ml/reports/test_2025-26.json) makes later runs refuse unless forced.
- ``walk_forward``: for each month of 2025-26, train on every game before that month and predict
  the month (how the model is used live). Predictions are saved for Phase 4's backfill.
- ``train_champion``: fit the chosen configuration on every completed game to date, log it to
  MLflow as a pyfunc and register it as ``tipoff-game`` with the alias ``champion``.

Calibration always follows the out-of-time recipe: the calibrator is fit on one season's
predictions from a model trained only on earlier seasons.
"""

from __future__ import annotations

import json
import tempfile
import warnings
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
import mlflow
import mlflow.pyfunc
import pandas as pd

from tipoff.config import (
    FIGURES_DIR,
    FIRST_SEASON,
    GAME_MODEL_CONFIG_PATH,
    PREDICTIONS_DIR,
    REPORTS_DIR,
    TEST_SEASON,
    VALID_SEASON,
)
from tipoff.evaluate.metrics import compute_metrics, metrics_table, reliability_plot, to_markdown
from tipoff.features.columns import FEATURE_COLUMNS, TARGET
from tipoff.models import baselines
from tipoff.models.data import Split, load_features, make_split, seasons_through
from tipoff.models.game_outcome import GameModel
from tipoff.models.train_baselines import setup_mlflow
from tipoff.models.train_game import out_of_time_calibrator
from tipoff.seasons import season_start_year

warnings.filterwarnings("ignore", message=".*Inferred schema contains integer column.*")
REGISTERED_MODEL = "tipoff-game"
LABELS = {"logreg": "LogReg", "lgbm": "LightGBM", "ensemble": "Ensemble", "anchored": "Anchored"}


class TestAlreadyRunError(RuntimeError):
    pass


def load_config() -> dict[str, Any]:
    if not GAME_MODEL_CONFIG_PATH.exists():
        raise FileNotFoundError("Run `tipoff train --only game` first.")
    return json.loads(GAME_MODEL_CONFIG_PATH.read_text())


def template(cfg: dict[str, Any], kind: str | None = None) -> GameModel:
    return GameModel(kind or cfg["kind"], dict(cfg["lgbm_params"]), cfg["logreg_c"],
                     cfg["ensemble_weight_logreg"],
                     anchor_lambda=cfg.get("anchor_lambda") or 1000.0)  # fmt: skip


def fit_calibrated(cfg, df, kind: str, fit: Split, cal_season: str) -> GameModel:
    method = cfg["candidates"][kind]["calibration"]
    model = template(cfg, kind).fit(fit.X, fit.y)
    model.calibrator = out_of_time_calibrator(template(cfg, kind), df, cal_season, method)
    return model


def marker_path() -> Path:
    return REPORTS_DIR / f"test_{TEST_SEASON}.json"


def final_test(force: bool = False, log_to_mlflow: bool = True) -> dict[str, Any]:
    if marker_path().exists() and not force:
        raise TestAlreadyRunError(
            f"The {TEST_SEASON} test already ran ({marker_path().name}). Re-running it turns the "
            "test season into a tuning set. Pass --force-retest only for a new major version."
        )
    cfg = load_config()
    df, feat_meta = load_features()
    fit = make_split(df, "fit", seasons_through(VALID_SEASON))
    test = make_split(df, "test", (TEST_SEASON,))

    probs = {
        "Home team": baselines.home_team().fit(fit.X, fit.y).predict_proba(test.X)[:, 1],
        "Elo": baselines.elo_logistic().fit(fit.X, fit.y).predict_proba(test.X)[:, 1],
    }
    for kind, label in LABELS.items():
        probs[label] = fit_calibrated(cfg, df, kind, fit, VALID_SEASON).predict_proba(test.X)
    table = metrics_table({k: compute_metrics(test.y, p) for k, p in probs.items()})
    champion = LABELS[cfg["kind"]]
    reliability_plot(test.y, {k: probs[k] for k in ("Elo", champion)},
                     FIGURES_DIR / "calibration_test.png",
                     f"{champion} vs Elo: {TEST_SEASON} test")  # fmt: skip

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / f"test_{TEST_SEASON}.md").write_text(
        f"# Final test: {TEST_SEASON}\n\n"
        f"All models refit on {FIRST_SEASON}..{VALID_SEASON} ({len(fit.y):,} games) and evaluated "
        f"once on every {TEST_SEASON} regular-season game ({len(test.y):,}). Configuration chosen "
        f"on {VALID_SEASON} before this run; champion = **{champion}**. Calibrators fit out of "
        f"time on {VALID_SEASON}.\n\n{to_markdown(table)}\n"
    )
    result = {
        "ran_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "test_season": TEST_SEASON,
        "n_games": len(test.y),
        "champion": champion,
        "features_hash": feat_meta["features_hash"],
        "config": {
            k: cfg[k] for k in ("kind", "calibration", "logreg_c", "ensemble_weight_logreg")
        },
        "metrics": table.to_dict(orient="index"),
    }
    marker_path().write_text(json.dumps(result, indent=2) + "\n")
    if log_to_mlflow:
        setup_mlflow()
        with mlflow.start_run(run_name=f"phase3: final test {TEST_SEASON}"):
            mlflow.set_tags({"kind": "test", "phase": "3", "champion_kind": cfg["kind"]})
            mlflow.log_params({"test_season": TEST_SEASON, "n_test": len(test.y),
                               "features_hash": feat_meta["features_hash"]})  # fmt: skip
            for name, row in table.iterrows():
                key = name.lower().replace(" ", "_")
                mlflow.log_metrics({f"test_{key}_{m}": float(v) for m, v in row.items()})
            mlflow.log_artifact(str(marker_path()))
            mlflow.log_artifact(str(FIGURES_DIR / "calibration_test.png"))
    return {"table": table, "result": result}


def walk_forward(
    season: str = TEST_SEASON,
    log_to_mlflow: bool = True,
    df: pd.DataFrame | None = None,
    cfg: dict[str, Any] | None = None,
    write: bool = True,
) -> dict[str, Any]:
    cfg = cfg or load_config()
    if df is None:
        df, feat_meta = load_features()
    else:
        feat_meta = {"features_hash": "in-memory"}
    in_window = df["season"].map(season_start_year) >= season_start_year(FIRST_SEASON)
    played = df[df["played"] & in_window]
    target = played[played["season"] == season]
    months = target["game_date"].dt.to_period("M").sort_values().unique()
    # Calibrator: fit out of time on the previous season (same as the final test).
    method = cfg["candidates"][cfg["kind"]]["calibration"]
    calibrator = out_of_time_calibrator(template(cfg), df, _prev(season), method)

    rows = []
    for month in months:
        start = month.start_time
        past = played[played["game_date"] < start]
        now = target[target["game_date"].dt.to_period("M") == month]
        X_past, y_past = past[FEATURE_COLUMNS], past[TARGET].astype(int)
        model = template(cfg).fit(X_past, y_past)
        model.calibrator = calibrator
        elo = baselines.elo_logistic().fit(X_past, y_past)
        home_rate = float(y_past.mean())
        rows.append(pd.DataFrame({
            "game_id": now["game_id"], "game_date": now["game_date"],
            "home_win": now[TARGET].astype(int), "month": str(month),
            "trained_through": str((start - pd.Timedelta(days=1)).date()),
            "p_model": model.predict_proba(now[FEATURE_COLUMNS]),
            "p_elo": elo.predict_proba(now[FEATURE_COLUMNS])[:, 1],
            "p_home": home_rate,
        }))  # fmt: skip
    preds = pd.concat(rows, ignore_index=True)
    champion = LABELS[cfg["kind"]]
    cols = {"Home team": "p_home", "Elo": "p_elo", champion: "p_model"}
    table = metrics_table(
        {k: compute_metrics(preds["home_win"], preds[c]) for k, c in cols.items()}
    )
    by_month = preds.groupby("month").apply(
        lambda g: pd.Series({"games": len(g),
                             "accuracy": float(((g["p_model"] >= 0.5) == g["home_win"]).mean()),
                             "log_loss": compute_metrics(g["home_win"], g["p_model"])["log_loss"]}),
        include_groups=False,
    )  # fmt: skip

    out_path = PREDICTIONS_DIR / f"backtest_{season}.parquet"
    if not write:
        return {"table": table, "by_month": by_month, "predictions": preds}
    PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    preds.assign(model_kind=cfg["kind"], features_hash=feat_meta["features_hash"]).to_parquet(
        out_path, index=False
    )
    month_md = "\n".join(
        f"| {m} | {int(r.games)} | {r.accuracy:.1%} | {r.log_loss:.4f} |"
        for m, r in by_month.iterrows()
    )
    (REPORTS_DIR / f"backtest_{season}.md").write_text(
        f"# Walk-forward backtest: {season}\n\n"
        f"Each month is predicted by models trained on every game before that month "
        f"({FIRST_SEASON} onward); {len(preds):,} games. Champion = **{champion}**.\n\n"
        f"{to_markdown(table)}\n\n## {champion} by month\n\n"
        f"| Month | Games | Accuracy | Log loss |\n|---|---|---|---|\n{month_md}\n"
    )
    if log_to_mlflow:
        setup_mlflow()
        with mlflow.start_run(run_name=f"phase3: walk-forward {season}"):
            mlflow.set_tags({"kind": "backtest", "phase": "3", "champion_kind": cfg["kind"]})
            mlflow.log_params({"season": season, "months": len(months), "n_games": len(preds)})
            for name, row in table.iterrows():
                key = name.lower().replace(" ", "_")
                mlflow.log_metrics({f"wf_{key}_{m}": float(v) for m, v in row.items()})
            mlflow.log_artifact(str(REPORTS_DIR / f"backtest_{season}.md"))
    return {"table": table, "by_month": by_month, "path": out_path, "predictions": preds}


def factor_importance(season: str = TEST_SEASON) -> pd.DataFrame:
    """Mean absolute effect (probability points) of each factor over ``season``, from the
    configured model trained on every earlier season. Reporting only; selects nothing."""
    from tipoff.predict.explain import factor_groups, top_factors

    cfg = load_config()
    df, _ = load_features()
    fit = make_split(df, "fit", seasons_through(_prev(season)))
    target = make_split(df, "target", (season,))
    model = fit_calibrated(cfg, df, cfg["kind"], fit, _prev(season))
    contrib, base = model.contributions(target.X)
    n_groups = len(factor_groups())
    factors = top_factors(contrib, base, top_k=n_groups, min_pp=0.0)
    rows = [(f["label"], abs(f["pp"])) for game in factors for f in game]
    out = (
        pd.DataFrame(rows, columns=["factor", "abs_pp"])
        .groupby("factor")["abs_pp"].mean().sort_values(ascending=False).to_frame("mean_abs_pp")
    )  # fmt: skip
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(7, 4), facecolor="#0A0A0C")
    ax.set_facecolor("#0A0A0C")
    ax.barh(out.index[::-1], out["mean_abs_pp"][::-1] * 100, color="#FF6B1A")
    ax.set_xlabel("Average effect on win probability (percentage points)", color="#F5F5F7")
    ax.set_title(f"What moves the model's predictions ({season})", color="#F5F5F7",
                 fontweight="bold")  # fmt: skip
    ax.tick_params(colors="#A1A1AA")
    for spine in ax.spines.values():
        spine.set_color("#3F3F46")
    fig.tight_layout()
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIGURES_DIR / "factor_importance.png", dpi=160, facecolor="#0A0A0C")
    plt.close(fig)
    return out


def _prev(season: str) -> str:
    y = season_start_year(season) - 1
    return f"{y}-{(y + 1) % 100:02d}"


class TipoffGameModel(mlflow.pyfunc.PythonModel):
    """MLflow wrapper: ``predict`` returns P(home win); ``game_model`` exposes ``contributions``."""

    def load_context(self, context) -> None:
        self.game_model: GameModel = joblib.load(context.artifacts["game_model"])

    def predict(self, context, model_input: pd.DataFrame, params=None) -> pd.DataFrame:
        return pd.DataFrame({"p_home_win": self.game_model.predict_proba(model_input)})


def train_champion() -> dict[str, Any]:
    """Fit on every completed game to date and register it as tipoff-game@champion."""
    cfg = load_config()
    df, feat_meta = load_features()
    in_window = df["season"].map(season_start_year) >= season_start_year(FIRST_SEASON)
    played = df[df["played"] & in_window]
    fit = Split("all", played[FEATURE_COLUMNS], played[TARGET].astype(int), played)
    # Calibrator: out of time on the latest completed season.
    model = fit_calibrated(cfg, df, cfg["kind"], fit, TEST_SEASON)
    through = str(played["game_date"].max().date())

    setup_mlflow()
    client = mlflow.MlflowClient()
    with mlflow.start_run(run_name=f"champion: {LABELS[cfg['kind']]} through {through}") as run:
        mlflow.set_tags({"kind": "champion", "phase": "3", "model_kind": cfg["kind"]})
        mlflow.log_params({"model_kind": cfg["kind"], "calibration": model.calibrator.method,
                           "trained_through": through, "n_train": len(fit.y),
                           "features_hash": feat_meta["features_hash"],
                           "logreg_c": cfg["logreg_c"],
                           "ensemble_weight_logreg": cfg["ensemble_weight_logreg"]})  # fmt: skip
        train_metrics = compute_metrics(fit.y, model.predict_proba(fit.X))
        mlflow.log_metrics({f"train_{k}": v for k, v in train_metrics.items()})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "game_model.joblib"
            joblib.dump(model, path)
            mlflow.pyfunc.log_model(
                name="model",
                python_model=TipoffGameModel(),
                artifacts={"game_model": str(path)},
                input_example=fit.X.head(3),
            )
        mlflow.log_artifact(str(GAME_MODEL_CONFIG_PATH))
    version = mlflow.register_model(f"runs:/{run.info.run_id}/model", REGISTERED_MODEL)
    for key, value in {"features_hash": feat_meta["features_hash"], "trained_through": through,
                       "model_kind": cfg["kind"]}.items():  # fmt: skip
        client.set_model_version_tag(REGISTERED_MODEL, version.version, key, value)
    client.set_registered_model_alias(REGISTERED_MODEL, "champion", version.version)
    return {"version": version.version, "run_id": run.info.run_id, "through": through,
            "kind": cfg["kind"], "n_train": len(fit.y)}  # fmt: skip


def load_champion() -> GameModel:
    """The registered champion's GameModel (for predict + explain in Phase 4)."""
    setup_mlflow()
    pyfunc = mlflow.pyfunc.load_model(f"models:/{REGISTERED_MODEL}@champion")
    return pyfunc.unwrap_python_model().game_model


__all__ = ["final_test", "load_champion", "train_champion", "walk_forward"]
