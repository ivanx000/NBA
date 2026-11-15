"""cdn.nba.com box scores -> the same game-log format as stats.nba.com (safe to run in CI).

Used by the cloud daily job for games that have finished since the last staging. Field choices
verified against stats.nba.com: turnovers = ``turnoversTotal`` (includes team turnovers), rebounds
= offensive + defensive *player* rebounds (``reboundsTotal`` adds team rebounds).
"""

from __future__ import annotations

import logging
import math
import re
from pathlib import Path
from typing import Any

import pandas as pd

from tipoff.config import RAW_CDN_DIR
from tipoff.ingest.http import get_cdn_json

log = logging.getLogger(__name__)

BOX_URL = "https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{game_id}.json"
BOX_DIR = RAW_CDN_DIR / "box"
STAGED_PREFIXES = ("002", "004", "005")
_ISO_MIN = re.compile(r"PT(?:(\d+)M)?(?:([\d.]+)S)?")


def iso_minutes(value: str | None) -> float:
    """'PT32M31.00S' -> 32.52 minutes."""
    if not value:
        return 0.0
    m = _ISO_MIN.fullmatch(value)
    if not m:
        raise ValueError(f"Unexpected minutes format: {value!r}")
    return int(m.group(1) or 0) + float(m.group(2) or 0) / 60


def round_half_up(x: float) -> int:
    """stats.nba.com rounds minutes half up (Python's round() is half-to-even)."""
    return math.floor(x + 0.5)


def _box(stats: dict[str, Any], team: bool) -> dict[str, int]:
    oreb, dreb = int(stats["reboundsOffensive"]), int(stats["reboundsDefensive"])
    return {
        "FGM": int(stats["fieldGoalsMade"]), "FGA": int(stats["fieldGoalsAttempted"]),
        "FG3M": int(stats["threePointersMade"]), "FG3A": int(stats["threePointersAttempted"]),
        "FTM": int(stats["freeThrowsMade"]), "FTA": int(stats["freeThrowsAttempted"]),
        "OREB": oreb, "DREB": dreb, "REB": oreb + dreb,
        "AST": int(stats["assists"]), "STL": int(stats["steals"]), "BLK": int(stats["blocks"]),
        "TOV": int(stats["turnoversTotal"] if team else stats["turnovers"]),
        "PF": int(stats["foulsPersonal"]), "PTS": int(stats["points"]),
    }  # fmt: skip


def parse_boxscore(
    doc: dict[str, Any], game_date: str, season: str, is_neutral: bool = False
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Team rows and player rows in LeagueGameLog column format."""
    g = doc["game"]
    home, away = g["homeTeam"], g["awayTeam"]
    teams, players = [], []
    for team, opp, is_home in ((home, away, True), (away, home, False)):
        # stats.nba.com lists neutral-site games as "@" for both teams; mirror that.
        matchup = (f"{team['teamTricode']} vs. {opp['teamTricode']}" if is_home and not is_neutral
                   else f"{team['teamTricode']} @ {opp['teamTricode']}")  # fmt: skip
        pts, opp_pts = int(team["statistics"]["points"]), int(opp["statistics"]["points"])
        common = {"SEASON": season, "GAME_ID": g["gameId"], "GAME_DATE": game_date,
                  "TEAM_ID": int(team["teamId"]), "TEAM_ABBREVIATION": team["teamTricode"],
                  "MATCHUP": matchup, "WL": "W" if pts > opp_pts else "L"}  # fmt: skip
        team_min = round_half_up(iso_minutes(team["statistics"]["minutes"]))
        teams.append({**common, "MIN": team_min, **_box(team["statistics"], team=True),
                      "PLUS_MINUS": pts - opp_pts})  # fmt: skip
        for p in team["players"]:
            if str(p.get("played")) != "1":
                continue
            s = p["statistics"]
            minutes = round_half_up(iso_minutes(s.get("minutes")))
            players.append({**common, "PLAYER_ID": int(p["personId"]), "PLAYER_NAME": p["name"],
                            "MIN": minutes, **_box(s, team=False),
                            "PLUS_MINUS": round(float(s.get("plusMinusPoints", 0)))})  # fmt: skip
    return pd.DataFrame(teams), pd.DataFrame(players)


def missing_final_games(schedule: pd.DataFrame, staged_games: pd.DataFrame) -> pd.DataFrame:
    """Finished regular/play-in/playoff games in the schedule that aren't staged yet."""
    final = schedule[(schedule["status"] == "final")
                     & schedule["game_id"].str[:3].isin(STAGED_PREFIXES)]  # fmt: skip
    return final[~final["game_id"].isin(staged_games["game_id"])].sort_values("game_date")


def _append(df: pd.DataFrame, path: Path, keys: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        df = pd.concat([pd.read_parquet(path), df], ignore_index=True)
    df.drop_duplicates(subset=keys, keep="last").to_parquet(path, index=False)


def ingest_boxscores(games: pd.DataFrame, root: Path = BOX_DIR, fetch=get_cdn_json):
    """Fetch and convert box scores for ``games`` (schedule rows). Returns (team, player) logs."""
    team_frames, player_frames = [], []
    for g in games.itertuples(index=False):
        doc = fetch(BOX_URL.format(game_id=g.game_id))
        t, p = parse_boxscore(doc, str(pd.Timestamp(g.game_date).date()), g.season,
                              bool(g.is_neutral))  # fmt: skip
        team_frames.append(t)
        player_frames.append(p)
    if not team_frames:
        return pd.DataFrame(), pd.DataFrame()
    teams = pd.concat(team_frames, ignore_index=True)
    players = pd.concat(player_frames, ignore_index=True)
    for season in teams["SEASON"].unique():
        _append(teams[teams["SEASON"] == season], root / "team_logs" / f"{season}.parquet",
                ["GAME_ID", "TEAM_ID"])  # fmt: skip
        _append(players[players["SEASON"] == season], root / "player_logs" / f"{season}.parquet",
                ["GAME_ID", "PLAYER_ID"])  # fmt: skip
    log.info("cdn box scores: %d games", len(team_frames))
    return teams, players
