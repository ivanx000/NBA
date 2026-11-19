"""Training, the one-time test and registration for the player projections (experiment
``tipoff-player``). See ``models/players.py`` for the models themselves.

- ``select_player``: train on 2015-16..2023-24, pick sizes and two-stage vs direct per stat on
  2024-25, learn the range correction there, write ``ml/config/player_model.json``.
- ``final_test_player``: refit through 2024-25 and score 2025-26, once (marker file).
- ``train_player_champion``: fit on everything and register ``tipoff-player@champion``.
"""

from __future__ import annotations

import json
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
import mlflow
import mlflow.pyfunc
import pandas as pd

from tipoff.config import FIRST_SEASON, REPORTS_DIR, TEST_SEASON, VALID_SEASON
from tipoff.models.data import seasons_through
from tipoff.models.players import (
    PLAYER_MODEL_CONFIG_PATH,
    PlayerModel,
    from_config,
    load_config,
    load_player_features,
    player_split,
    player_train_valid,
    save_config,
    score,
    score_table,
    select,
)
from tipoff.models.train_baselines import setup_mlflow
from tipoff.seasons import season_start_year

EXPERIMENT = "tipoff-player"
REGISTERED_MODEL = "tipoff-player"


class TestAlreadyRunError(RuntimeError):
    pass


def _md(table: pd.DataFrame) -> str:
    """A metrics table as GitHub markdown (percentages for the relative columns)."""
    pattern = {"vs baseline": "{:+.1%}", "80% range coverage": "{:.1%}"}
    head = ["target", *table.columns]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for target, row in table.iterrows():
        cells = ["" if pd.isna(v) else pattern.get(c, "{:.3f}").format(v) for c, v in row.items()]
        lines.append("| " + " | ".join([str(target), *cells]) + " |")
    return "\n".join(lines)


class TipoffPlayerModel(mlflow.pyfunc.PythonModel):
    """MLflow wrapper: ``predict`` returns projections; ``player_model`` is the PlayerModel."""

    def load_context(self, context) -> None:
        self.player_model: PlayerModel = joblib.load(context.artifacts["player_model"])

    def predict(self, context, model_input: pd.DataFrame, params=None) -> pd.DataFrame:
        return self.player_model.predict(model_input)


def _log_model(model: PlayerModel, X_example: pd.DataFrame) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "player_model.joblib"
        joblib.dump(model, path)
        mlflow.pyfunc.log_model(
            name="model",
            python_model=TipoffPlayerModel(),
            artifacts={"player_model": str(path)},
            input_example=X_example.head(3),
        )


def select_player(log_to_mlflow: bool = True) -> dict[str, Any]:
    df, feat_meta = load_player_features()
    train, valid = player_train_valid(df)
    cfg = select(train, valid)

    model = from_config(cfg).fit(train.X, train.y)
    raw = score(model.predict(valid.X), valid.y, valid.X)
    widen = model.calibrate(valid.X, valid.y)
    metrics = score(model.predict(valid.X), valid.y, valid.X)
    table = score_table(metrics)
    cfg.update({
        "widen": widen, "selected_on": VALID_SEASON, "features_hash": feat_meta["features_hash"],
        "raw_coverage": {s: round(raw[f"{s}_coverage"], 4) for s in ("pts", "reb", "ast")},
    })  # fmt: skip
    save_config(cfg)

    report = (
        f"# Player projections: validation {VALID_SEASON}\n\n"
        f"Trained on 2015-16..2023-24 ({len(train.y):,} player-games in scope), evaluated on "
        f"{VALID_SEASON} ({len(valid.y):,}). Point projection per stat: "
        + ", ".join(f"{s} {k.replace('_', '-')}" for s, k in cfg["point"].items())
        + ".\n\n"
        + _md(table)
        + "\n\nRange coverage before the conformal correction: "
        + ", ".join(f"{s} {v:.1%}" for s, v in cfg["raw_coverage"].items())
        + ". The correction is fit on this season, so coverage here is about 80% by construction;"
        " the test season is the honest check.\n"
    )
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "player_validation.md").write_text(report)

    if log_to_mlflow:
        setup_mlflow(EXPERIMENT)
        with mlflow.start_run(run_name=f"player selection on {VALID_SEASON}"):
            mlflow.set_tags({"kind": "selection", "phase": "9"})
            mlflow.log_params({"point": json.dumps(cfg["point"]), "n_train": len(train.y),
                               "n_valid": len(valid.y),
                               "features_hash": feat_meta["features_hash"]})  # fmt: skip
            mlflow.log_metrics({f"valid_{k}": v for k, v in metrics.items()})
            mlflow.log_metrics({f"valid_raw_{k}": v for k, v in raw.items() if "coverage" in k})
            mlflow.log_artifact(str(PLAYER_MODEL_CONFIG_PATH))
            mlflow.log_artifact(str(REPORTS_DIR / "player_validation.md"))
            _log_model(model, valid.X)
    return {"config": cfg, "table": table, "metrics": metrics}


def player_test_marker() -> Path:
    return REPORTS_DIR / f"test_player_{TEST_SEASON}.json"


def _fit_through(df: pd.DataFrame, last: str, cfg: dict[str, Any]) -> PlayerModel:
    split = player_split(df, f"through {last}", seasons_through(last))
    return from_config(cfg).fit(split.X, split.y)


def final_test_player(force: bool = False, log_to_mlflow: bool = True) -> dict[str, Any]:
    """Refit through 2024-25 with the selected config and score 2025-26. Runs once."""
    marker = player_test_marker()
    if marker.exists() and not force:
        raise TestAlreadyRunError(
            f"The player test already ran ({marker.name}). Re-running it is only for a new major "
            "model version: pass --force-retest."
        )
    cfg = load_config()
    df, feat_meta = load_player_features()
    model = _fit_through(df, VALID_SEASON, cfg)
    model.widen = dict(cfg["widen"])  # learned one season ahead, on 2024-25
    test = player_split(df, "test", (TEST_SEASON,))
    metrics = score(model.predict(test.X), test.y, test.X)
    table = score_table(metrics)
    result = {
        "ran_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "test_season": TEST_SEASON, "n_player_games": len(test.y),
        "features_hash": feat_meta["features_hash"], "config": cfg, "metrics": metrics,
    }  # fmt: skip
    marker.write_text(json.dumps(result, indent=2) + "\n")
    (REPORTS_DIR / f"test_player_{TEST_SEASON}.md").write_text(
        f"# Player projections: test {TEST_SEASON} (run once)\n\n"
        f"Refit on 2015-16..{VALID_SEASON} with the configuration chosen on {VALID_SEASON}; "
        f"{len(test.y):,} in-scope player-games.\n\n" + _md(table) + "\n"
    )
    if log_to_mlflow:
        setup_mlflow(EXPERIMENT)
        with mlflow.start_run(run_name=f"player test on {TEST_SEASON}"):
            mlflow.set_tags({"kind": "test", "phase": "9"})
            mlflow.log_metrics({f"test_{k}": v for k, v in metrics.items()})
            mlflow.log_artifact(str(marker))
    return {"table": table, "metrics": metrics}


def train_player_champion() -> dict[str, Any]:
    """Fit on every completed in-scope player-game and register tipoff-player@champion.

    The range correction is learned out of time: a model fit through 2024-25, scored on 2025-26.
    """
    cfg = load_config()
    df, feat_meta = load_player_features()
    probe = _fit_through(df, VALID_SEASON, cfg)
    latest = player_split(df, "calibration", (TEST_SEASON,))
    widen = probe.calibrate(latest.X, latest.y)

    in_window = df["season"].map(season_start_year) >= season_start_year(FIRST_SEASON)
    everything = player_split(df[in_window], "all", tuple(df["season"].unique()))
    model = from_config(cfg).fit(everything.X, everything.y)
    model.widen = widen
    through = str(everything.meta["game_date"].max().date())

    setup_mlflow(EXPERIMENT)
    client = mlflow.MlflowClient()
    with mlflow.start_run(run_name=f"player champion through {through}") as run:
        mlflow.set_tags({"kind": "champion", "phase": "9"})
        mlflow.log_params({"point": json.dumps(cfg["point"]), "trained_through": through,
                           "n_train": len(everything.y), "widen": json.dumps(widen),
                           "features_hash": feat_meta["features_hash"]})  # fmt: skip
        _log_model(model, everything.X)
        mlflow.log_artifact(str(PLAYER_MODEL_CONFIG_PATH))
    version = mlflow.register_model(f"runs:/{run.info.run_id}/model", REGISTERED_MODEL)
    for key, value in {"features_hash": feat_meta["features_hash"], "trained_through": through,
                       "point": json.dumps(cfg["point"])}.items():  # fmt: skip
        client.set_model_version_tag(REGISTERED_MODEL, version.version, key, value)
    client.set_registered_model_alias(REGISTERED_MODEL, "champion", version.version)
    return {"version": version.version, "run_id": run.info.run_id, "through": through,
            "n_train": len(everything.y), "widen": widen}  # fmt: skip


def load_player_champion() -> tuple[PlayerModel, dict[str, Any]]:
    """The registered champion PlayerModel and its provenance."""
    setup_mlflow(EXPERIMENT)
    client = mlflow.MlflowClient()
    mv = client.get_model_version_by_alias(REGISTERED_MODEL, "champion")
    pyfunc = mlflow.pyfunc.load_model(f"models:/{REGISTERED_MODEL}@champion")
    model = pyfunc.unwrap_python_model().player_model
    run = client.get_run(mv.run_id)
    info = {
        "model_version": f"player-v{mv.version}",
        "run_id": mv.run_id,
        "trained_at": datetime.fromtimestamp(run.info.start_time / 1000, tz=UTC),
        "trained_through": mv.tags.get("trained_through"),
        "features_hash": mv.tags.get("features_hash"),
    }
    return model, info
