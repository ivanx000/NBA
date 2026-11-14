"""Turn cached raw stats.nba.com responses into tidy, validated tables in ``data/staged/``.

- ``team_games``   one row per team-game: base box score + advanced ratings, opponent, home flag
- ``games``        one row per game: home/away teams, scores, overtimes
- ``player_games`` one row per player-game

Neutral-site games (international games, NBA Cup semifinals) show "@" on both teams' rows, so
neither team is home. They get ``is_neutral = True`` and a designated home team: the one the cdn
schedule lists as home when we have that season's schedule, otherwise the lower team id. That rule
never looks at the result, so it can't leak the outcome. Features should use ``is_neutral`` to
drop home-court advantage.

Only games whose id prefix matches a known season type are kept (002 regular season, 004 playoffs,
005 play-in). The NBA Cup final (006) doesn't count in standings and is excluded.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from tipoff.config import CURRENT_SEASON, RAW_CDN_DIR, RAW_STATS_DIR, STAGED_DIR
from tipoff.ingest.nba_stats import Endpoint
from tipoff.ingest.schemas import (
    Games,
    PlayerGames,
    TeamGames,
    check_players_in_game_teams,
    check_regular_season_lengths,
)
from tipoff.seasons import GAME_ID_PREFIX_TO_TYPE

log = logging.getLogger(__name__)

BOX_COLS = [
    "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb",
    "ast", "stl", "blk", "tov", "pf", "pts", "plus_minus",
]  # fmt: skip
ADV_COLS = [
    "off_rating", "def_rating", "net_rating", "pace", "poss",
    "efg_pct", "ts_pct", "oreb_pct", "dreb_pct", "tm_tov_pct", "ast_pct", "ast_to", "pie",
]  # fmt: skip


class StagingError(Exception):
    pass


def load_raw(endpoint: Endpoint, root: Path = RAW_STATS_DIR) -> pd.DataFrame:
    """Concatenate every cached file for an endpoint, tagging season from the path."""
    frames = []
    for path in sorted((root / endpoint).glob("*/*.parquet")):
        df = pd.read_parquet(path)
        if df.empty:
            continue
        df["season"] = path.parent.name
        df["requested_type"] = path.stem
        frames.append(df)
    if not frames:
        raise StagingError(f"No raw data for {endpoint} under {root}. Run `tipoff ingest` first.")
    return pd.concat(frames, ignore_index=True)


def _with_season_type(df: pd.DataFrame) -> pd.DataFrame:
    prefix = df["GAME_ID"].str[:3]
    df = df.assign(
        season_type=prefix.map({p: st.value for p, st in GAME_ID_PREFIX_TO_TYPE.items()})
    )
    dropped = df["season_type"].isna()
    if dropped.any():
        log.info("dropping %d rows with other game types: %s", dropped.sum(),
                 sorted(prefix[dropped].unique()))  # fmt: skip
    df = df[~dropped]
    mismatch = df["season_type"] != df["requested_type"]
    if mismatch.any():
        raise StagingError(
            f"{mismatch.sum()} rows have a game id that contradicts their season type"
        )
    return df


def load_cdn_home_teams(root: Path = RAW_CDN_DIR) -> dict[str, int]:
    """game_id -> designated home team id, from any cached cdn schedules."""
    homes: dict[str, int] = {}
    for path in sorted((root / "schedule").glob("*.parquet")):
        sched = pd.read_parquet(path, columns=["game_id", "home_team_id"]).dropna()
        homes.update(zip(sched["game_id"], sched["home_team_id"].astype(int), strict=True))
    return homes


def _assign_home(base: pd.DataFrame, cdn_homes: dict[str, int]) -> pd.DataFrame:
    """Set is_home / is_neutral. Neutral games have no " vs. " row; pick a designated home."""
    listed_home = base["matchup"].str.contains(" vs. ", regex=False)
    homes_per_game = listed_home.groupby(base["game_id"]).transform("sum")
    neutral = homes_per_game == 0
    min_team = base.groupby("game_id")["team_id"].transform("min")
    designated = base["game_id"].map(cdn_homes).fillna(min_team).astype(int)
    base["is_neutral"] = neutral
    base["is_home"] = listed_home.where(~neutral, base["team_id"] == designated)
    return base


def build_team_games(
    team_logs: pd.DataFrame, adv_logs: pd.DataFrame, cdn_homes: dict[str, int] | None = None
) -> pd.DataFrame:
    base = _with_season_type(team_logs)
    base = base.rename(columns=str.lower).rename(columns={"min": "minutes"})
    base["game_date"] = pd.to_datetime(base["game_date"])
    base = _assign_home(base, cdn_homes or {})
    base["win"] = base["wl"] == "W"
    # Team minutes are 240 + 25 per overtime (stored as e.g. 240 or 265).
    base["minutes"] = base["minutes"].round().astype(int)

    opp = base[["game_id", "team_id", "pts"]].rename(
        columns={"team_id": "opp_team_id", "pts": "opp_pts"}
    )
    tg = base.merge(opp, on="game_id")
    tg = tg[tg["team_id"] != tg["opp_team_id"]]

    adv = adv_logs.rename(columns=str.lower)[["game_id", "team_id", *ADV_COLS]]
    adv = adv.drop_duplicates(subset=["game_id", "team_id"], keep="last")
    tg = tg.merge(adv, on=["game_id", "team_id"], how="left")

    cols = [
        "game_id", "season", "season_type", "game_date", "team_id", "team_abbreviation",
        "opp_team_id", "is_home", "is_neutral", "win", "minutes", *BOX_COLS, "opp_pts", *ADV_COLS,
    ]  # fmt: skip
    tg = tg[cols].rename(columns={"team_abbreviation": "team_abbr"})
    for c in [*BOX_COLS, "opp_pts", "team_id", "opp_team_id"]:
        tg[c] = tg[c].astype(int)
    for c in ADV_COLS:
        tg[c] = tg[c].astype(float)
    return tg.sort_values(["game_date", "game_id", "is_home"]).reset_index(drop=True)


def build_games(team_games: pd.DataFrame) -> pd.DataFrame:
    home = team_games[team_games["is_home"]]
    away = team_games[~team_games["is_home"]][["game_id", "team_id", "pts"]]
    games = home.merge(away, on="game_id", suffixes=("_home", "_away"))
    return (
        pd.DataFrame(
            {
                "game_id": games["game_id"],
                "season": games["season"],
                "season_type": games["season_type"],
                "game_date": games["game_date"],
                "home_team_id": games["team_id_home"],
                "away_team_id": games["team_id_away"],
                "home_pts": games["pts_home"],
                "away_pts": games["pts_away"],
                "home_win": games["pts_home"] > games["pts_away"],
                "is_neutral": games["is_neutral"],
                "overtimes": ((games["minutes"] - 240) // 25).clip(lower=0).astype(int),
            }
        )
        .sort_values(["game_date", "game_id"])
        .reset_index(drop=True)
    )


def build_player_games(player_logs: pd.DataFrame, team_games: pd.DataFrame) -> pd.DataFrame:
    """Player rows; home flag comes from team_games so neutral games stay consistent."""
    pg = _with_season_type(player_logs)
    pg = pg.rename(columns=str.lower).rename(columns={"min": "minutes"})
    pg["game_date"] = pd.to_datetime(pg["game_date"])
    pg = pg.merge(
        team_games[["game_id", "team_id", "is_home"]], on=["game_id", "team_id"], how="left"
    )
    pg["is_home"] = pg["is_home"].astype("boolean").fillna(False).astype(bool)
    pg["minutes"] = pg["minutes"].fillna(0).round().astype(int)
    cols = [
        "game_id", "season", "season_type", "game_date", "player_id", "player_name",
        "team_id", "is_home", "minutes", *BOX_COLS,
    ]  # fmt: skip
    pg = pg[cols]
    for c in BOX_COLS:
        pg[c] = pg[c].fillna(0).astype(int)
    pg["player_id"] = pg["player_id"].astype(int)
    pg["team_id"] = pg["team_id"].astype(int)
    return pg.sort_values(["game_date", "game_id", "team_id", "player_id"]).reset_index(drop=True)


def stage_all(
    raw_root: Path = RAW_STATS_DIR,
    cdn_root: Path = RAW_CDN_DIR,
    out_dir: Path = STAGED_DIR,
    current_season: str = CURRENT_SEASON,
    check_season_lengths: bool = True,
) -> dict[str, int]:
    """Build, validate and write all staged tables. Returns row counts."""
    team_games = build_team_games(
        load_raw(Endpoint.TEAM_LOGS, raw_root),
        load_raw(Endpoint.TEAM_ADV_LOGS, raw_root),
        load_cdn_home_teams(cdn_root),
    )
    team_games = TeamGames.validate(team_games, lazy=True)
    games = Games.validate(build_games(team_games), lazy=True)
    player_games = PlayerGames.validate(
        build_player_games(load_raw(Endpoint.PLAYER_LOGS, raw_root), team_games), lazy=True
    )

    problems = (
        check_regular_season_lengths(team_games, current_season) if check_season_lengths else []
    )
    orphans = check_players_in_game_teams(player_games, team_games)
    if orphans:
        problems.append(f"{orphans} player rows belong to a team that didn't play that game")
    missing_adv = int(team_games["off_rating"].isna().sum())
    if missing_adv:
        problems.append(f"{missing_adv} team-games have no advanced stats")
    if problems:
        raise StagingError("Staged data failed checks:\n- " + "\n- ".join(problems))

    out_dir.mkdir(parents=True, exist_ok=True)
    tables = {"team_games": team_games, "games": games, "player_games": player_games}
    for name, df in tables.items():
        df.to_parquet(out_dir / f"{name}.parquet", index=False)
    return {name: len(df) for name, df in tables.items()}
