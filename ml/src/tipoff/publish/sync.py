"""Keep the ``games`` table current from cdn.nba.com (safe to run in GitHub Actions).

The season schedule JSON already carries final scores, so one upsert of the whole current season
covers both schedule-sync and results-sync; today's scoreboard adds live status and scores.
Preseason and All-Star games, and games against non-NBA teams, are skipped.
"""

from __future__ import annotations

import pandas as pd
from sqlalchemy import Engine, func

from tipoff.config import CURRENT_SEASON, RAW_CDN_DIR
from tipoff.db import tables, upsert
from tipoff.ingest.nba_cdn import ingest_schedule, ingest_scoreboard
from tipoff.teams import load_teams

SEASON_TYPE_BY_PREFIX = {"002": "regular", "004": "playoffs", "005": "playin", "006": "cup_final"}
GAME_FIELDS = ["season", "season_type", "game_date", "tipoff_utc", "home_team_id", "away_team_id",
               "status", "home_score", "away_score", "is_neutral", "game_label"]  # fmt: skip


def game_rows(schedule: pd.DataFrame, scoreboard: pd.DataFrame | None = None) -> list[dict]:
    team_ids = {t["team_id"] for t in load_teams()}
    df = schedule.copy()
    df["season_type"] = df["game_id"].str[:3].map(SEASON_TYPE_BY_PREFIX)
    df = df[df["season_type"].notna() & df["home_team_id"].isin(team_ids)
            & df["away_team_id"].isin(team_ids)]  # fmt: skip
    live: dict[str, dict] = {}
    if scoreboard is not None and not scoreboard.empty:
        live = scoreboard.set_index("game_id")[["status", "home_score", "away_score"]].to_dict(
            orient="index"
        )
    rows = []
    for r in df.itertuples(index=False):
        rows.append({
            "game_id": r.game_id,
            "season": r.season,
            "season_type": r.season_type,
            "game_date": r.game_date,
            "tipoff_utc": None if pd.isna(r.tipoff_utc) else r.tipoff_utc.to_pydatetime(),
            "home_team_id": int(r.home_team_id),
            "away_team_id": int(r.away_team_id),
            "status": r.status,
            "home_score": None if pd.isna(r.home_score) else int(r.home_score),
            "away_score": None if pd.isna(r.away_score) else int(r.away_score),
            "is_neutral": bool(r.is_neutral),
            "game_label": r.game_label or None,
        })  # fmt: skip
        if r.game_id in live:  # today's scoreboard is fresher than the schedule
            board = live[r.game_id]
            rows[-1]["status"] = board["status"]
            for side in ("home_score", "away_score"):
                v = board[side]
                rows[-1][side] = None if v is None or pd.isna(v) else int(v)
    return rows


def sync_games(engine: Engine, fetch: bool = True) -> int:
    """Upsert the current season's games (fetching fresh cdn data unless ``fetch=False``)."""
    if fetch:
        schedule, scoreboard = ingest_schedule(), ingest_scoreboard()
    else:
        schedule = pd.read_parquet(RAW_CDN_DIR / "schedule" / f"{CURRENT_SEASON}.parquet")
        scoreboard = None
    t = tables(engine)["games"]
    rows = [{**r, "updated_at": func.now()} for r in game_rows(schedule, scoreboard)]
    return upsert(engine, t, rows, ["game_id"], update=[*GAME_FIELDS, "updated_at"])
