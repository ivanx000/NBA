"""Predict one schedule date with the registered champion.

Scheduled games for the date come from the cached cdn schedule and go through the same feature
code as training (``build_features(..., upcoming=...)``). Output: one row per game with the
home win probability, Elo's own probability (the challenger), the top factors and provenance.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pandas as pd

from tipoff.config import CURRENT_SEASON, PREDICTIONS_DIR, RAW_CDN_DIR, STAGED_DIR
from tipoff.features.build import build_features, features_hash
from tipoff.features.columns import FEATURE_COLUMNS
from tipoff.features.elo import EloParams
from tipoff.features.schemas import GameFeatures
from tipoff.models.final import REGISTERED_MODEL, load_champion
from tipoff.predict.explain import top_factors

UPCOMING_COLS = ["game_id", "season", "season_type", "game_date", "home_team_id",
                 "away_team_id", "is_neutral"]  # fmt: skip


def champion_info() -> dict:
    import mlflow

    from tipoff.models.train_baselines import setup_mlflow

    setup_mlflow()
    client = mlflow.MlflowClient()
    mv = client.get_model_version_by_alias(REGISTERED_MODEL, "champion")
    run = client.get_run(mv.run_id)
    return {
        "model_version": f"game-v{mv.version}",
        "run_id": mv.run_id,
        "trained_at": datetime.fromtimestamp(run.info.start_time / 1000, tz=UTC),
        "trained_through": mv.tags.get("trained_through"),
        "model_kind": mv.tags.get("model_kind"),
    }


def scheduled_games(day: date) -> pd.DataFrame:
    sched = pd.read_parquet(RAW_CDN_DIR / "schedule" / f"{CURRENT_SEASON}.parquet")
    sched = sched[(sched["game_date"] == day) & sched["game_id"].str.startswith("002")]
    sched = sched.assign(season_type="regular", game_date=pd.to_datetime(sched["game_date"]))
    return sched


def load_model(model_source: str = "mlflow", engine=None):
    """The champion GameModel and its provenance, from MLflow (local) or pipeline_state (cloud)."""
    if model_source == "db":
        from tipoff.state import pull_champion

        model, info = pull_champion(engine)
        info["trained_at"] = pd.Timestamp(info["trained_at"]).to_pydatetime()
        return model, info
    return load_champion(), champion_info()


def predict_date(day: date, model_source: str = "mlflow", engine=None) -> pd.DataFrame:
    """Predictions for the regular-season games scheduled on ``day`` that haven't been played."""
    sched = scheduled_games(day)
    if sched.empty:
        return pd.DataFrame()
    params = EloParams.load()
    feats = build_features(
        pd.read_parquet(STAGED_DIR / "games.parquet"),
        pd.read_parquet(STAGED_DIR / "team_games.parquet"),
        pd.read_parquet(STAGED_DIR / "player_games.parquet"),
        upcoming=sched[UPCOMING_COLS],
        elo_params=params,
    )
    feats = GameFeatures.validate(feats, lazy=True)
    digest = features_hash(feats, params)
    rows = feats[(feats["game_date"] == pd.Timestamp(day)) & ~feats["played"]].set_index("game_id")
    if rows.empty:
        return pd.DataFrame()

    model, info = load_model(model_source, engine)
    X = rows[FEATURE_COLUMNS]
    contrib, base = model.contributions(X)
    meta = sched.set_index("game_id").loc[rows.index]
    out = pd.DataFrame({
        "game_id": rows.index,
        "season": meta["season"].to_numpy(),
        "game_date": day,
        "tipoff_utc": meta["tipoff_utc"].to_numpy(),
        "home_team_id": rows["home_team_id"].to_numpy(),
        "away_team_id": rows["away_team_id"].to_numpy(),
        "is_neutral": rows["is_neutral"].to_numpy(),
        "home_win_prob": model.predict_proba(X),
        "elo_home_win_prob": rows["elo_prob_home"].to_numpy(),
        "factors": [json.dumps(f) for f in top_factors(contrib, base)],
        "features_hash": digest,
        "model_version": info["model_version"],
        "mlflow_run_id": info["run_id"],
        "trained_at": info["trained_at"],
        "train_window": f"2015-16..{info['trained_through']}",
        "generated_at": datetime.now(UTC),
        "source": "live",
    })  # fmt: skip
    PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    (PREDICTIONS_DIR / "live").mkdir(exist_ok=True)
    out.to_parquet(PREDICTIONS_DIR / "live" / f"{day.isoformat()}.parquet", index=False)
    return out
