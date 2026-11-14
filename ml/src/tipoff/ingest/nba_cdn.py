"""cdn.nba.com ingestion: the current season's schedule and a day's scoreboard.

These endpoints are the only NBA sources that may be called from CI (GitHub Actions).
They need nba_api's browser-like headers (see ``tipoff.ingest.http.cdn_headers``).
"""

from __future__ import annotations

import gzip
import json
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd

from tipoff.config import RAW_CDN_DIR
from tipoff.ingest.http import get_cdn_json

SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json"
SCOREBOARD_URL = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json"

# cdn gameStatus: 1 = scheduled, 2 = live, 3 = final.
STATUS = {1: "scheduled", 2: "live", 3: "final"}


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _score(team: dict[str, Any], status: str) -> int | None:
    """cdn reports 0-0 before tip-off; store that as unknown."""
    return _int_or_none(team.get("score")) if status in {"live", "final"} else None


def _game_status(game: dict[str, Any]) -> str:
    postponed = str(game.get("postponedStatus") or "").upper()
    if postponed and postponed not in {"N", "A"}:
        return "postponed"
    return STATUS.get(game.get("gameStatus"), "scheduled")


def parse_schedule(doc: dict[str, Any]) -> pd.DataFrame:
    """Flatten scheduleLeagueV2.json into one row per game."""
    schedule = doc["leagueSchedule"]
    season = schedule["seasonYear"]
    rows = []
    for day in schedule["gameDates"]:
        for g in day["games"]:
            home, away = g["homeTeam"], g["awayTeam"]
            status = _game_status(g)
            rows.append(
                {
                    "game_id": g["gameId"],
                    "season": season,
                    "game_date": pd.to_datetime(g["gameDateEst"]).date(),
                    "tipoff_utc": pd.to_datetime(g.get("gameDateTimeUTC"), utc=True),
                    "home_team_id": _int_or_none(home.get("teamId")),
                    "away_team_id": _int_or_none(away.get("teamId")),
                    "home_abbr": home.get("teamTricode"),
                    "away_abbr": away.get("teamTricode"),
                    "status": status,
                    "status_text": (g.get("gameStatusText") or "").strip(),
                    "home_score": _score(home, status),
                    "away_score": _score(away, status),
                    "is_neutral": bool(g.get("isNeutral")),
                    "game_label": g.get("gameLabel") or "",
                    "game_subtype": g.get("gameSubtype") or "",
                    "arena_city": g.get("arenaCity") or "",
                }
            )
    return pd.DataFrame(rows)


def parse_scoreboard(doc: dict[str, Any]) -> pd.DataFrame:
    """Flatten todaysScoreboard_00.json into one row per game."""
    board = doc["scoreboard"]
    rows = []
    for g in board["games"]:
        home, away = g["homeTeam"], g["awayTeam"]
        status = STATUS.get(g.get("gameStatus"), "scheduled")
        rows.append(
            {
                "game_id": g["gameId"],
                "game_date": pd.to_datetime(board["gameDate"]).date(),
                "tipoff_utc": pd.to_datetime(g.get("gameTimeUTC"), utc=True),
                "home_team_id": _int_or_none(home.get("teamId")),
                "away_team_id": _int_or_none(away.get("teamId")),
                "status": status,
                "status_text": (g.get("gameStatusText") or "").strip(),
                "period": _int_or_none(g.get("period")),
                "home_score": _score(home, status),
                "away_score": _score(away, status),
            }
        )
    return pd.DataFrame(rows)


def _save(doc: dict[str, Any], df: pd.DataFrame, stem: Path) -> None:
    stem.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(stem.with_suffix(".json.gz"), "wt", encoding="utf-8") as f:
        json.dump(doc, f)
    df.to_parquet(stem.with_suffix(".parquet"), index=False)


def ingest_schedule(root: Path = RAW_CDN_DIR) -> pd.DataFrame:
    doc = get_cdn_json(SCHEDULE_URL)
    df = parse_schedule(doc)
    _save(doc, df, root / "schedule" / df["season"].iloc[0])
    return df


def ingest_scoreboard(root: Path = RAW_CDN_DIR) -> pd.DataFrame:
    doc = get_cdn_json(SCOREBOARD_URL)
    df = parse_scoreboard(doc)
    day = df["game_date"].iloc[0] if not df.empty else date.today()
    _save(doc, df, root / "scoreboard" / day.isoformat())
    return df
