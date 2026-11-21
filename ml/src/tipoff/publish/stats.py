"""Write box scores to Postgres for the website's advanced stats.

``team_game_stats`` and ``player_game_stats`` (schema: web/lib/db/schema.ts) get one row per team
and per player for every regular-season game of ``STATS_SEASONS`` in the staged box scores. Box
scores are facts: rows are upserted, so re-running is harmless and a corrected box score
replaces the old one. Games missing from the ``games`` table (not synced yet) are skipped; the
next run picks them up.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from sqlalchemy import Engine, select

from tipoff.config import CURRENT_SEASON
from tipoff.db import tables, upsert
from tipoff.seasons import season_start_year

BOX = ["minutes", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast",
       "stl", "blk", "tov", "pf"]  # fmt: skip
CHUNK = 2000


def stats_seasons(current: str = CURRENT_SEASON) -> tuple[str, ...]:
    """This season and last (last season's game pages show its stats too)."""
    y = season_start_year(current) - 1
    return (f"{y}-{(y + 1) % 100:02d}", current)


@dataclass
class StatsResult:
    team_rows: int = 0
    player_rows: int = 0
    games: int = 0
    skipped_unsynced: int = 0


def _scope(df: pd.DataFrame, seasons: tuple[str, ...]) -> pd.DataFrame:
    return df[df["season"].isin(seasons) & (df["season_type"] == "regular")]


def team_rows(team_games: pd.DataFrame) -> list[dict]:
    out = []
    for r in team_games.itertuples(index=False):
        row = {
            "game_id": r.game_id,
            "team_id": int(r.team_id),
            "opp_team_id": int(r.opp_team_id),
            "season": r.season,
            "game_date": pd.Timestamp(r.game_date).date(),
            "is_home": bool(r.is_home),
            "opp_pts": int(r.opp_pts),
            "poss": float(r.poss),
        }
        row.update({c: int(getattr(r, c)) for c in BOX})
        out.append(row)
    return out


def player_rows(player_games: pd.DataFrame) -> list[dict]:
    out = []
    for r in player_games.itertuples(index=False):
        row = {
            "game_id": r.game_id,
            "player_id": int(r.player_id),
            "team_id": int(r.team_id),
            "season": r.season,
            "game_date": pd.Timestamp(r.game_date).date(),
            "player_name": r.player_name,
        }
        row.update({c: int(getattr(r, c)) for c in BOX})
        out.append(row)
    return out


def publish_stats(
    engine: Engine,
    team_games: pd.DataFrame,
    player_games: pd.DataFrame,
    seasons: tuple[str, ...] | None = None,
    only_new: bool = True,
) -> StatsResult:
    """Upsert box scores for ``seasons``. With ``only_new``, games already in the team table are
    skipped (the daily job's case); pass False to rewrite everything in scope."""
    seasons = seasons or stats_seasons()
    t = tables(engine)
    tgs, pgs, games = t["team_game_stats"], t["player_game_stats"], t["games"]
    tg, pg = _scope(team_games, seasons), _scope(player_games, seasons)
    with engine.connect() as conn:
        synced = {r[0] for r in conn.execute(select(games.c.game_id).where(
            games.c.season.in_(seasons))).all()}  # fmt: skip
        have = set()
        if only_new:
            have = {r[0] for r in conn.execute(select(tgs.c.game_id).where(
                tgs.c.season.in_(seasons))).all()}  # fmt: skip
    ids = set(tg["game_id"])
    res = StatsResult(skipped_unsynced=len(ids - synced))
    todo = (ids & synced) - have
    if not todo:
        return res
    tg, pg = tg[tg["game_id"].isin(todo)], pg[pg["game_id"].isin(todo)]
    keys_t, keys_p = ["game_id", "team_id"], ["game_id", "player_id"]
    rows_t, rows_p = team_rows(tg), player_rows(pg)
    update_t = [c for c in rows_t[0] if c not in keys_t] if rows_t else []
    update_p = [c for c in rows_p[0] if c not in keys_p] if rows_p else []
    for i in range(0, len(rows_t), CHUNK):
        res.team_rows += upsert(engine, tgs, rows_t[i : i + CHUNK], keys_t, update_t)
    for i in range(0, len(rows_p), CHUNK):
        res.player_rows += upsert(engine, pgs, rows_p[i : i + CHUNK], keys_p, update_p)
    res.games = len(todo)
    return res
