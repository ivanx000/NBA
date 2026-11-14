"""Walk-forward backfill so /performance has history before live predictions began.

For each week of a season, the configured champion recipe is retrained on every game before that
week (the cadence of the weekly retrain) and predicts that week's played games. Calibrators follow
the out-of-time recipe (fit on the previous season's predictions from a model trained on earlier
seasons). Rows are published with ``source='backfill'`` and model version ``<champion>-wf``.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pandas as pd

from tipoff.config import FIRST_SEASON, PREDICTIONS_DIR, STAGED_DIR
from tipoff.features.columns import FEATURE_COLUMNS, TARGET
from tipoff.models.data import load_features
from tipoff.models.final import load_config, template
from tipoff.models.train_game import out_of_time_calibrator
from tipoff.predict.explain import top_factors
from tipoff.seasons import season_start_year


def _prev(season: str) -> str:
    y = season_start_year(season) - 1
    return f"{y}-{(y + 1) % 100:02d}"


def backfill_predictions(seasons: list[str], model_version: str,
                         df: pd.DataFrame | None = None, cfg: dict | None = None,
                         features_hash: str | None = None,
                         staged_scores: pd.DataFrame | None = None) -> pd.DataFrame:  # fmt: skip
    cfg = cfg or load_config()
    if df is None:
        df, meta = load_features()
        features_hash = meta["features_hash"]
    in_window = df["season"].map(season_start_year) >= season_start_year(FIRST_SEASON)
    played = df[df["played"] & in_window]
    method = cfg["candidates"][cfg["kind"]]["calibration"]
    generated_at = datetime.now(UTC)

    out = []
    for season in seasons:
        target = played[played["season"] == season]
        if target.empty:
            continue
        calibrator = out_of_time_calibrator(template(cfg), df, _prev(season), method)
        week_start = target["game_date"].min().normalize()
        week_start -= pd.Timedelta(days=week_start.weekday())  # Monday
        while week_start <= target["game_date"].max():
            week_end = week_start + pd.Timedelta(days=7)
            now = target[(target["game_date"] >= week_start) & (target["game_date"] < week_end)]
            if not now.empty:
                past = played[played["game_date"] < week_start]
                model = template(cfg).fit(past[FEATURE_COLUMNS], past[TARGET].astype(int))
                model.calibrator = calibrator
                X = now[FEATURE_COLUMNS]
                contrib, base = model.contributions(X)
                out.append(pd.DataFrame({
                    "game_id": now["game_id"].to_numpy(),
                    "season": season,
                    "game_date": now["game_date"].to_numpy(),
                    "tipoff_utc": pd.NaT,
                    "home_team_id": now["home_team_id"].to_numpy(),
                    "away_team_id": now["away_team_id"].to_numpy(),
                    "is_neutral": now["is_neutral"].to_numpy(),
                    "home_win_prob": model.predict_proba(X),
                    "elo_home_win_prob": now["elo_prob_home"].to_numpy(),
                    "factors": [json.dumps(f) for f in top_factors(contrib, base)],
                    "features_hash": features_hash or "unknown",
                    "model_version": model_version,
                    "mlflow_run_id": None,
                    "trained_at": generated_at,
                    "train_window": "weekly walk-forward from 2015-16",
                    "generated_at": generated_at,
                    "data_cutoff": week_start - pd.Timedelta(days=1),
                    "source": "backfill",
                    "home_win": now[TARGET].astype(int).to_numpy(),
                }))  # fmt: skip
            week_start = week_end
    preds = pd.concat(out, ignore_index=True) if out else pd.DataFrame()
    if preds.empty:
        return preds
    # Backfilled games are historical: store them as final with their scores.
    scores = staged_scores if staged_scores is not None else _load_scores()
    preds = preds.merge(scores, on="game_id", how="left")
    preds["status"] = "final"
    return preds


def _load_scores() -> pd.DataFrame:
    g = pd.read_parquet(STAGED_DIR / "games.parquet", columns=["game_id", "home_pts", "away_pts"])
    return g.rename(columns={"home_pts": "home_score", "away_pts": "away_score"})


def save(preds: pd.DataFrame, name: str) -> None:
    PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    preds.to_parquet(PREDICTIONS_DIR / f"{name}.parquet", index=False)
