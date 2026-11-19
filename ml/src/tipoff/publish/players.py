"""Write player projections to Postgres, and fill in the actual lines once games are final.

Same integrity rules as the game predictions (publish.py):
- Live projections are only written for games that haven't started (``games.tipoff_utc > now()``
  in the database, checked in the same transaction as the write).
- A game's projection set is replaced whole for its model version, so a player who drops out of
  the candidates between runs doesn't linger.
- Backfilled sets (``source='backfill'``) use their own model version and never touch live rows.

``record_results`` copies each projected player's real line from the staged box scores. A
projected player missing from a final box score didn't play: minutes 0, stats left empty.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import pandas as pd
from sqlalchemy import Engine, and_, delete, func, insert, select, update

from tipoff.db import tables, upsert
from tipoff.publish.publish import _game_stub, _model_version_row

log = logging.getLogger(__name__)

STATS = ("pts", "reb", "ast")


@dataclass
class PlayerPublishResult:
    written: int = 0
    games: int = 0
    skipped_started: list[str] = field(default_factory=list)


def _f(v) -> float | None:
    return None if pd.isna(v) else float(v)


def _i(v) -> int | None:
    return None if pd.isna(v) else int(v)


def _row(r, source: str) -> dict:
    row = {
        "game_id": r.game_id,
        "player_id": int(r.player_id),
        "team_id": int(r.team_id),
        "player_name": r.player_name,
        "jersey_number": None,
        "model_version": r.model_version,
        "proj_minutes": _f(r.proj_minutes),
        "generated_at": pd.Timestamp(r.generated_at).to_pydatetime(),
        "features_hash": r.features_hash,
        "source": source,
    }
    for s in STATS:
        row[s] = _f(getattr(r, f"proj_{s}"))
        row[f"{s}_lo"] = _f(getattr(r, f"proj_{s}_lo"))
        row[f"{s}_hi"] = _f(getattr(r, f"proj_{s}_hi"))
    if source == "backfill":
        row["actual_minutes"] = _f(r.actual_minutes)
        for s in STATS:
            row[f"actual_{s}"] = _i(getattr(r, f"actual_{s}"))
    return row


def publish_projections(engine: Engine, proj: pd.DataFrame) -> PlayerPublishResult:
    """Upsert the model version and replace each game's projection set (see module docstring)."""
    result = PlayerPublishResult()
    if proj.empty:
        return result
    t = tables(engine)
    pp, games = t["player_projections"], t["games"]
    source = proj["source"].iloc[0]
    assert set(proj["source"]) == {source} and source in {"live", "backfill"}
    if source == "backfill":
        assert (pd.to_datetime(proj["data_cutoff"]) < pd.to_datetime(proj["game_date"])).all()

    upsert(engine, t["model_versions"], [_model_version_row(proj, kind="player")],
           ["model_version"],
           update=["trained_at", "train_window", "metrics", "mlflow_run_id"])  # fmt: skip
    stubs = {r.game_id: _game_stub(r) for r in proj.itertuples(index=False)}
    upsert(engine, games, list(stubs.values()), ["game_id"])  # sync owns existing rows

    by_game = {g: rows for g, rows in proj.groupby("game_id", sort=False)}
    with engine.begin() as conn:
        if source == "live":
            # Lock the games' rows and keep only those that haven't tipped off (database clock).
            open_games = set(conn.execute(
                select(games.c.game_id)
                .where(games.c.game_id.in_(list(by_game)) & (games.c.tipoff_utc > func.now()))
                .with_for_update()
            ).scalars())  # fmt: skip
            result.skipped_started = sorted(set(by_game) - open_games)
            if result.skipped_started:
                log.warning("not publishing projections for started games: %s",
                            result.skipped_started)  # fmt: skip
            by_game = {g: rows for g, rows in by_game.items() if g in open_games}
        for game_id, rows in by_game.items():
            version = rows["model_version"].iloc[0]
            conn.execute(delete(pp).where(and_(
                pp.c.game_id == game_id, pp.c.model_version == version, pp.c.source == source,
            )))  # fmt: skip
            values = [_row(r, source) for r in rows.itertuples(index=False)]
            conn.execute(insert(pp), values)
            result.written += len(values)
            result.games += 1
    return result


def record_results(engine: Engine, player_games: pd.DataFrame,
                   staged_games: pd.DataFrame) -> int:  # fmt: skip
    """Fill ``actual_*`` for projected players in games that are in the staged box scores.

    Only rows still missing their actual line are touched. Returns the number of rows updated."""
    t = tables(engine)
    pp = t["player_projections"]
    final = set(staged_games["game_id"])
    with engine.connect() as conn:
        todo = pd.DataFrame(
            conn.execute(
                select(pp.c.game_id, pp.c.player_id, pp.c.model_version).where(
                    pp.c.actual_minutes.is_(None)
                )
            ).all(),
            columns=["game_id", "player_id", "model_version"],
        )
    todo = todo[todo["game_id"].isin(final)]
    if todo.empty:
        return 0
    lines = player_games[player_games["game_id"].isin(set(todo["game_id"]))]
    lines = lines.set_index(["game_id", "player_id"])
    n = 0
    with engine.begin() as conn:
        for r in todo.itertuples(index=False):
            key = (r.game_id, r.player_id)
            if key in lines.index:
                line = lines.loc[key]
                values = {"actual_minutes": float(line["minutes"]),
                          **{f"actual_{s}": int(line[s]) for s in STATS}}  # fmt: skip
            else:
                values = {"actual_minutes": 0.0}  # in a final box score without him: didn't play
            conn.execute(
                update(pp)
                .where((pp.c.game_id == r.game_id) & (pp.c.player_id == int(r.player_id))
                       & (pp.c.model_version == r.model_version))
                .values(**values)
            )  # fmt: skip
            n += 1
    return n
