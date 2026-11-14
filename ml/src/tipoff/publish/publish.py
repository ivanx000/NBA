"""Write predictions to Postgres.

Integrity rules (ARCHITECTURE section 4):
- Live predictions are only written before tip-off. Python skips started games, and the upsert
  itself carries ``WHERE games.tipoff_utc > now()``, so a started game's stored prediction can
  never be replaced, even with a wrong local clock.
- Backfilled rows (walk-forward backtests) are marked ``source='backfill'``. They're pregame in
  the information sense (their data cutoff is before the game) and never replace live rows,
  because they use their own model version.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pandas as pd
from sqlalchemy import Engine, exists, func, select

from tipoff.db import tables, upsert

log = logging.getLogger(__name__)


@dataclass
class PublishResult:
    written: int = 0
    skipped_started: list[str] = field(default_factory=list)


def _model_version_row(preds: pd.DataFrame, kind: str = "game", metrics: dict | None = None):
    first = preds.iloc[0]
    trained_at = first.get("trained_at")
    return {
        "model_version": first["model_version"],
        "kind": kind,
        "trained_at": pd.Timestamp(trained_at).to_pydatetime() if trained_at is not None
        else datetime.now(UTC),
        "train_window": first.get("train_window"),
        "metrics": metrics,
        "mlflow_run_id": first.get("mlflow_run_id"),
    }  # fmt: skip


def _game_stub(r) -> dict:
    """Minimal games row so predictions have their foreign key (sync fills the rest)."""
    return {
        "game_id": r.game_id,
        "season": r.season,
        "season_type": "regular",
        "game_date": pd.Timestamp(r.game_date).date(),
        "tipoff_utc": None if pd.isna(r.tipoff_utc) else pd.Timestamp(r.tipoff_utc).to_pydatetime(),
        "home_team_id": int(r.home_team_id),
        "away_team_id": int(r.away_team_id),
        "status": getattr(r, "status", None) or "scheduled",
        "home_score": None if pd.isna(getattr(r, "home_score", None)) else int(r.home_score),
        "away_score": None if pd.isna(getattr(r, "away_score", None)) else int(r.away_score),
        "is_neutral": bool(r.is_neutral),
    }


def publish(engine: Engine, preds: pd.DataFrame, now: datetime | None = None,
            metrics: dict | None = None) -> PublishResult:  # fmt: skip
    """Upsert model version, games and predictions. ``preds`` comes from ``predict_date`` or
    the backfill (``source`` column)."""
    result = PublishResult()
    if preds.empty:
        return result
    now = now or datetime.now(UTC)
    t = tables(engine)
    source = preds["source"].iloc[0]
    assert set(preds["source"]) == {source} and source in {"live", "backfill"}

    mv_update = ["trained_at", "train_window", "metrics", "mlflow_run_id"]
    mv_row = _model_version_row(preds, metrics=metrics)
    upsert(engine, t["model_versions"], [mv_row], ["model_version"], update=mv_update)
    stubs = [_game_stub(r) for r in preds.itertuples(index=False)]
    if source == "backfill":  # historical results are facts: record them
        upsert(engine, t["games"], stubs, ["game_id"],
               update=["status", "home_score", "away_score"])  # fmt: skip
    else:  # live: sync owns existing game rows
        upsert(engine, t["games"], stubs, ["game_id"])

    if source == "live":
        # Use the tip-off times stored in the DB (kept current by sync), falling back to ours.
        games = t["games"]
        with engine.connect() as conn:
            stored = dict(conn.execute(
                select(games.c.game_id, games.c.tipoff_utc)
                .where(games.c.game_id.in_(preds["game_id"].tolist()))
            ).all())  # fmt: skip
        keep = []
        for r in preds.itertuples(index=False):
            tip = stored.get(r.game_id) or (None if pd.isna(r.tipoff_utc) else r.tipoff_utc)
            if tip is None or pd.Timestamp(tip) <= pd.Timestamp(now):
                result.skipped_started.append(r.game_id)
            else:
                keep.append(r)
        if result.skipped_started:
            log.warning("not publishing started/unknown-tip-off games: %s", result.skipped_started)
        preds = pd.DataFrame(keep, columns=preds.columns)
    else:
        assert (pd.to_datetime(preds["data_cutoff"]) < pd.to_datetime(preds["game_date"])).all()

    rows = [
        {
            "game_id": r.game_id,
            "model_version": r.model_version,
            "generated_at": pd.Timestamp(r.generated_at).to_pydatetime(),
            "home_win_prob": float(r.home_win_prob),
            "factors": json.loads(r.factors) if isinstance(r.factors, str) else r.factors,
            "features_hash": r.features_hash,
            "is_pregame": True,
            "source": source,
            "elo_home_win_prob": float(r.elo_home_win_prob),
        }
        for r in preds.itertuples(index=False)
    ]
    gp, games = t["game_predictions"], t["games"]
    update_cols = ["generated_at", "home_win_prob", "factors", "features_hash", "is_pregame",
                   "source", "elo_home_win_prob"]  # fmt: skip

    def still_pregame(stmt):
        if source == "backfill":
            return gp.c.source == "backfill"  # never touch a live row
        return exists().where((games.c.game_id == stmt.excluded.game_id)
                              & (games.c.tipoff_utc > func.now()))  # fmt: skip

    result.written = upsert(engine, gp, rows, ["game_id", "model_version"], update=update_cols,
                            where=still_pregame)  # fmt: skip
    return result
