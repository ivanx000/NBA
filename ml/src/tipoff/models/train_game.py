"""Phase 3 model selection on the 2024-25 validation season (the test season is never used here).

1. Tune LightGBM with Optuna: train 2015-16..2023-24, objective = 2024-25 log loss.
2. LogReg C: same rule as the Phase 2 baseline.
3. Calibration per candidate (none / Platt / isotonic), chosen out of time: a calibrator is fit on
   2023-24 predictions from a model trained on 2015-16..2022-23, then judged on 2024-25 predictions
   from a model trained on 2015-16..2023-24.
4. Ensemble = log-odds average of LogReg and LightGBM, weight chosen on 2024-25.
5. Anchored (Elo plus penalized adjustments): penalty chosen on rolling validation (below).
6. Champion kind = lowest pooled log loss on rolling validation: each season 2019-20..2024-25 is
   predicted by the candidate trained only on the seasons before it. One season (1,230 games) is
   too few to pick between models this close (ml/reports/elo_gap_study.md).

The chosen configuration is written to ml/config/game_model.json for the test, backtest and
champion steps, which never re-tune.
"""

from __future__ import annotations

import json
import tempfile
import warnings
from pathlib import Path
from typing import Any

import mlflow
import numpy as np
import optuna
import pandas as pd
from scipy.special import expit

from tipoff.config import FIGURES_DIR, GAME_MODEL_CONFIG_PATH, REPORTS_DIR, VALID_SEASON
from tipoff.evaluate.metrics import compute_metrics, metrics_table, reliability_plot, to_markdown
from tipoff.models import baselines
from tipoff.models.baselines import SEED
from tipoff.models.data import load_features, make_split, seasons_through
from tipoff.models.game_outcome import CALIBRATIONS, Calibrator, GameModel
from tipoff.models.train_baselines import setup_mlflow

warnings.filterwarnings("ignore", message=".*Inferred schema contains integer column.*")
ENSEMBLE_WEIGHTS = tuple(np.round(np.arange(0.1, 1.0, 0.1), 1))
ROLLING_FIRST = "2019-20"  # rolling validation: 2019-20..VALID_SEASON, never the test season
ANCHOR_LAMBDAS = (100.0, 300.0, 1000.0, 3000.0)
LAMBDA_TOLERANCE = 1e-4  # pick the strongest penalty within this of the best pooled log loss


def rolling_seasons() -> tuple[str, ...]:
    return seasons_through(VALID_SEASON, first=ROLLING_FIRST)


def rolling_validation(df: pd.DataFrame, make) -> dict[str, Any]:
    """Each rolling season predicted by ``make()`` trained on every earlier season (uncalibrated
    log-odds). Returns per-season and pooled log loss, plus the predictions."""
    per, preds = {}, []
    for season in rolling_seasons():
        fit = make_split(df, "fit", seasons_through(_prev(season)))
        target = make_split(df, "target", (season,))
        model = make().fit(fit.X, fit.y)
        if isinstance(model, GameModel):
            p = expit(model.raw(target.X))
        else:
            p = model.predict_proba(target.X)
        per[season] = compute_metrics(target.y, p)["log_loss"]
        preds.append(pd.DataFrame({"season": season, "y": target.y.to_numpy(), "p": p}))
    allp = pd.concat(preds, ignore_index=True)
    return {"per_season": per, "pooled": compute_metrics(allp["y"], allp["p"])["log_loss"],
            "accuracy": float(((allp["p"] >= 0.5) == allp["y"]).mean()), "preds": allp}  # fmt: skip


class _EloOnly:
    """The Elo baseline in the shape rolling_validation expects."""

    def fit(self, X, y):
        self.m = baselines.elo_logistic().fit(X, y)
        return self

    def predict_proba(self, X):
        return self.m.predict_proba(X)[:, 1]


def suggest_lgbm(trial: optuna.Trial) -> dict[str, Any]:
    return {
        "n_estimators": trial.suggest_int("n_estimators", 100, 1500, step=50),
        "learning_rate": trial.suggest_float("learning_rate", 0.005, 0.1, log=True),
        "num_leaves": trial.suggest_int("num_leaves", 4, 63),
        "min_child_samples": trial.suggest_int("min_child_samples", 20, 400, log=True),
        "subsample": trial.suggest_float("subsample", 0.5, 1.0),
        "subsample_freq": 1,
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.4, 1.0),
        "reg_alpha": trial.suggest_float("reg_alpha", 1e-3, 10.0, log=True),
        "reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 30.0, log=True),
    }


def tune_lgbm(train, valid, n_trials: int) -> tuple[dict[str, Any], optuna.Study]:
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    def objective(trial: optuna.Trial) -> float:
        model = GameModel("lgbm", lgbm_params=suggest_lgbm(trial)).fit(train.X, train.y)
        return compute_metrics(valid.y, model.predict_proba(valid.X))["log_loss"]

    study = optuna.create_study(direction="minimize",
                                sampler=optuna.samplers.TPESampler(seed=SEED))  # fmt: skip
    study.optimize(objective, n_trials=n_trials)
    params = {**study.best_params, "subsample_freq": 1}
    return params, study


def out_of_time_calibrator(
    template: GameModel, df: pd.DataFrame, cal_season: str, method: str
) -> Calibrator:
    """Fit ``method`` on ``cal_season`` predictions from a model trained only on earlier seasons."""
    prev = seasons_through(_prev(cal_season))
    pre = make_split(df, "pre", prev)
    cal = make_split(df, "cal", (cal_season,))
    model = _clone(template).fit(pre.X, pre.y)
    return Calibrator.fit(method, model.raw(cal.X), cal.y.to_numpy())


def _prev(season: str) -> str:
    y = int(season[:4]) - 1
    return f"{y}-{(y + 1) % 100:02d}"


def _clone(m: GameModel) -> GameModel:
    return GameModel(m.kind, dict(m.lgbm_params), m.logreg_c, m.weight,
                     anchor_lambda=m.anchor_lambda,
                     anchor_features=m.anchor_features)  # fmt: skip


def select(n_trials: int = 100, log_to_mlflow: bool = True) -> dict[str, Any]:
    df, feat_meta = load_features()
    train = make_split(df, "train", seasons_through(_prev(VALID_SEASON)))
    valid = make_split(df, "valid", (VALID_SEASON,))

    lgbm_params, study = tune_lgbm(train, valid, n_trials)
    c_scores = {}
    for c in baselines.LOGREG_C_GRID:
        m = GameModel("logreg", logreg_c=c).fit(train.X, train.y)
        c_scores[c] = compute_metrics(valid.y, m.predict_proba(valid.X))["log_loss"]
    logreg_c = baselines.choose_c(c_scores)

    fitted = {
        "logreg": GameModel("logreg", logreg_c=logreg_c).fit(train.X, train.y),
        "lgbm": GameModel("lgbm", lgbm_params=lgbm_params).fit(train.X, train.y),
    }
    # Ensemble weight on uncalibrated log-odds.
    raw_lr, raw_gb = fitted["logreg"].raw(valid.X), fitted["lgbm"].raw(valid.X)
    w_scores = {float(w): compute_metrics(valid.y, expit(w * raw_lr + (1 - w) * raw_gb))["log_loss"]
                for w in ENSEMBLE_WEIGHTS}  # fmt: skip
    weight = min(w_scores, key=w_scores.get)
    ens = GameModel("ensemble", lgbm_params, logreg_c, weight)
    ens.lr, ens.gbm = fitted["logreg"].lr, fitted["lgbm"].gbm
    fitted["ensemble"] = ens

    # Anchored: the penalty on the adjustments, chosen on rolling validation.
    lam_scores = {
        lam: rolling_validation(df, lambda lam=lam: GameModel("anchored", anchor_lambda=lam))
        for lam in ANCHOR_LAMBDAS
    }
    best_lam = min(v["pooled"] for v in lam_scores.values())
    anchor_lambda = max(lam for lam, v in lam_scores.items()
                        if v["pooled"] <= best_lam + LAMBDA_TOLERANCE)  # fmt: skip
    fitted["anchored"] = GameModel("anchored", anchor_lambda=anchor_lambda).fit(train.X, train.y)
    rolling = {
        "elo": rolling_validation(df, _EloOnly),
        "logreg": rolling_validation(df, lambda: GameModel("logreg", logreg_c=logreg_c)),
        "lgbm": rolling_validation(df, lambda: GameModel("lgbm", lgbm_params=lgbm_params)),
        "ensemble": rolling_validation(
            df, lambda: GameModel("ensemble", lgbm_params, logreg_c, weight)
        ),
        "anchored": lam_scores[anchor_lambda],
    }

    candidates: dict[str, dict[str, Any]] = {}
    for kind, model in fitted.items():
        scores = {}
        for method in CALIBRATIONS:
            model.calibrator = out_of_time_calibrator(model, df, _prev(VALID_SEASON), method)
            scores[method] = compute_metrics(valid.y, model.predict_proba(valid.X))
        best = min(scores, key=lambda k: scores[k]["log_loss"])
        model.calibrator = out_of_time_calibrator(model, df, _prev(VALID_SEASON), best)
        candidates[kind] = {
            "model": model,
            "calibration": best,
            "metrics": scores[best],
            "calibration_scores": {k: v["log_loss"] for k, v in scores.items()},
        }

    champion_kind = min(candidates, key=lambda k: rolling[k]["pooled"])
    champion = candidates[champion_kind]["model"]
    config = {
        **champion.describe(),
        "logreg_c": logreg_c,
        "lgbm_params": lgbm_params,
        "ensemble_weight_logreg": weight,
        "anchor_lambda": anchor_lambda,
        "selected_on": f"rolling {rolling_seasons()[0]}..{rolling_seasons()[-1]}",
        "rolling_log_loss": {k: round(v["pooled"], 5) for k, v in rolling.items()},
        "valid_log_loss": round(candidates[champion_kind]["metrics"]["log_loss"], 5),
        "features_hash": feat_meta["features_hash"],
        "candidates": {k: {"calibration": v["calibration"],
                           "valid_log_loss": round(v["metrics"]["log_loss"], 5),
                           "calibration_log_loss": {m: round(s, 5)
                                                    for m, s in v["calibration_scores"].items()}}
                       for k, v in candidates.items()},
    }  # fmt: skip
    GAME_MODEL_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    GAME_MODEL_CONFIG_PATH.write_text(json.dumps(config, indent=2) + "\n")

    # Validation table, baselines included (same split as Phase 2).
    home = baselines.home_team().fit(train.X, train.y)
    elo = baselines.elo_logistic().fit(train.X, train.y)
    probs = {
        "Home team": home.predict_proba(valid.X)[:, 1],
        "Elo": elo.predict_proba(valid.X)[:, 1],
        "LogReg": candidates["logreg"]["model"].predict_proba(valid.X),
        "LightGBM": candidates["lgbm"]["model"].predict_proba(valid.X),
        "Ensemble": candidates["ensemble"]["model"].predict_proba(valid.X),
        "Anchored": candidates["anchored"]["model"].predict_proba(valid.X),
    }
    labels = {"logreg": "LogReg", "lgbm": "LightGBM", "ensemble": "Ensemble",
              "anchored": "Anchored"}  # fmt: skip
    table = metrics_table({k: compute_metrics(valid.y, p) for k, p in probs.items()})
    reliability_plot(valid.y, {k: probs[k] for k in ("Elo", "LogReg", "Ensemble", "Anchored")},
                     FIGURES_DIR / "calibration_validation.png",
                     f"Game models: {VALID_SEASON} validation")  # fmt: skip
    trials = study.trials_dataframe()
    calibration_summary = "; ".join(
        f"{labels[k]}: " + ", ".join(f"{m} {s:.4f}" for m, s in v["calibration_scores"].items())
        for k, v in candidates.items()
    )
    seasons = rolling_seasons()
    elo_r = rolling["elo"]
    roll_rows = "\n".join(
        f"| {name} | "
        + " | ".join(f"{r['per_season'][s]:.4f}" for s in seasons)
        + f" | {r['pooled']:.4f} | {r['pooled'] - elo_r['pooled']:+.4f} | "
        + f"{sum(r['per_season'][s] < elo_r['per_season'][s] for s in seasons)}/{len(seasons)} | "
        + f"{r['accuracy']:.1%} |"
        for name, r in [("Elo", elo_r), *((labels[k], rolling[k]) for k in labels)]
    )
    lam_line = ", ".join(f"{lam:g}: {v['pooled']:.4f}" for lam, v in lam_scores.items())
    rolling_md = (
        f"## Rolling validation (picks the champion)\n\nEach season predicted by the candidate "
        f"trained only on the seasons before it (uncalibrated). Anchored penalty by pooled log "
        f"loss: {lam_line}; chosen {anchor_lambda:g}.\n\n"
        f"| Model | {' | '.join(seasons)} | Pooled | vs Elo | Seasons better | Accuracy |\n"
        f"|---|{'---|' * len(seasons)}---|---|---|---|\n{roll_rows}\n"
    )
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "model_selection_validation.md").write_text(
        f"# Model selection: {VALID_SEASON} validation\n\n"
        f"Trained on {train.meta['season'].min()}..{train.meta['season'].max()} "
        f"({len(train.y):,} games), evaluated on {VALID_SEASON} ({len(valid.y):,} games). "
        f"LightGBM tuned with Optuna ({n_trials} trials). Calibration chosen out of time "
        f"(fit on {_prev(VALID_SEASON)}, judged on {VALID_SEASON}). "
        f"Ensemble = {weight:.1f} x LogReg + {1 - weight:.1f} x LightGBM in log-odds.\n\n"
        f"Champion (lowest pooled rolling log loss, below): **{labels[champion_kind]}** with "
        f"{candidates[champion_kind]['calibration']} calibration.\n\n{to_markdown(table)}\n\n"
        f"Calibration log loss by method: {calibration_summary}\n\n{rolling_md}"
    )

    if log_to_mlflow:
        setup_mlflow()
        with mlflow.start_run(run_name="phase3: model selection"):
            mlflow.set_tags({"kind": "selection", "phase": "3", "champion_kind": champion_kind})
            mlflow.log_params({"n_trials": n_trials, "valid_season": VALID_SEASON,
                               "features_hash": feat_meta["features_hash"],
                               "logreg_c": logreg_c, "ensemble_weight_logreg": weight,
                               "anchor_lambda": anchor_lambda,
                               **{f"lgbm_{k}": v for k, v in lgbm_params.items()}})  # fmt: skip
            for name, row in table.iterrows():
                key = name.lower().replace(" ", "_")
                mlflow.log_metrics({f"val_{key}_{m}": float(v) for m, v in row.items()})
            with tempfile.TemporaryDirectory() as tmp:
                trials.to_csv(Path(tmp) / "optuna_trials.csv", index=False)
                mlflow.log_artifact(str(Path(tmp) / "optuna_trials.csv"))
            mlflow.log_artifact(str(GAME_MODEL_CONFIG_PATH))
            mlflow.log_artifact(str(FIGURES_DIR / "calibration_validation.png"))
    return {"table": table, "config": config}
