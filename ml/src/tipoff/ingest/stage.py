"""Turn cached raw box scores into tidy, validated tables in ``data/staged/``.

Sources: stats.nba.com game logs (local ingest) and cdn.nba.com box scores (cloud ingest, for games
stats.nba.com hasn't been asked about). When both have a game, stats.nba.com wins; their counting
stats are identical.

- ``team_games``   one row per team-game: box score, possessions and ratings, opponent, home flag
- ``games``        one row per game: home/away teams, scores, overtimes
- ``player_games`` one row per player-game

Neutral-site games (international games, NBA Cup semifinals) show "@" on both teams' rows, so
neither team is home. They get ``is_neutral = True`` and a designated home team: the one the cdn
schedule lists as home when we have that season's schedule, otherwise the lower team id. That rule
never looks at the result, so it can't leak the outcome. Features should use ``is_neutral`` to
drop home-court advantage.

Possessions, pace and ratings are computed from the box score with the Basketball-Reference
formula averaged over both teams, so every source gives identical numbers. Against stats.nba.com's
own possession counts (2014-15..2026-27) this correlates at 0.97 for possessions, 0.991 for
offensive rating and 0.997 for net rating.

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
RATING_COLS = ["poss", "pace", "off_rating", "def_rating", "net_rating"]
CDN_BOX_DIR = RAW_CDN_DIR / "box"


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


def load_cdn_box(kind: str, root: Path = CDN_BOX_DIR) -> pd.DataFrame:
    """cdn box-score rows in game-log format (kind: "team_logs" or "player_logs")."""
    frames = [pd.read_parquet(p) for p in sorted((root / kind).glob("*.parquet"))]
    frames = [f for f in frames if not f.empty]
    if not frames:
        return pd.DataFrame()
    return prepare_cdn_logs(pd.concat(frames, ignore_index=True))


def prepare_cdn_logs(df: pd.DataFrame) -> pd.DataFrame:
    """Give cdn game-log rows the same bookkeeping columns ``load_raw`` adds."""
    if df.empty:
        return df
    df = df.rename(columns={"SEASON": "season"})
    prefix_type = {p: st.value for p, st in GAME_ID_PREFIX_TO_TYPE.items()}
    return df.assign(requested_type=df["GAME_ID"].str[:3].map(prefix_type).fillna("other"))


def combine_sources(stats: pd.DataFrame, cdn: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """stats.nba.com rows first; cdn rows only for games stats.nba.com doesn't have."""
    if cdn.empty:
        return stats
    if stats.empty:
        return cdn
    cdn = cdn[~cdn.set_index(keys).index.isin(stats.set_index(keys).index)]
    return pd.concat([stats, cdn[stats.columns.intersection(cdn.columns)]], ignore_index=True)


def possessions(tg: pd.DataFrame) -> pd.Series:
    """Basketball-Reference possession estimate, averaged over both teams of each game.

    Needs the team's box score and the opponent's (columns suffixed ``_o``)."""

    def side(fga, fta, oreb, opp_dreb, fgm, tov):
        oreb_share = (oreb / (oreb + opp_dreb)).fillna(0)
        return fga + 0.4 * fta - 1.07 * oreb_share * (fga - fgm) + tov

    own = side(tg["fga"], tg["fta"], tg["oreb"], tg["dreb_o"], tg["fgm"], tg["tov"])
    opp = side(tg["fga_o"], tg["fta_o"], tg["oreb_o"], tg["dreb"], tg["fgm_o"], tg["tov_o"])
    return 0.5 * (own + opp)


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
    team_logs: pd.DataFrame, cdn_homes: dict[str, int] | None = None
) -> pd.DataFrame:
    base = _with_season_type(team_logs)
    base = base.rename(columns=str.lower).rename(columns={"min": "minutes"})
    base["game_date"] = pd.to_datetime(base["game_date"])
    base = _assign_home(base, cdn_homes or {})
    base["win"] = base["wl"] == "W"
    # Team minutes are 240 + 25 per overtime (stored as e.g. 240 or 265).
    base["minutes"] = base["minutes"].round().astype(int)
    for c in BOX_COLS:
        base[c] = base[c].astype(int)

    opp_cols = ["fgm", "fga", "fta", "oreb", "dreb", "tov"]
    opp = base[["game_id", "team_id", "pts", *opp_cols]].rename(
        columns={"team_id": "opp_team_id", "pts": "opp_pts", **{c: f"{c}_o" for c in opp_cols}}
    )
    tg = base.merge(opp, on="game_id")
    tg = tg[tg["team_id"] != tg["opp_team_id"]].copy()

    tg["poss"] = possessions(tg)
    tg["pace"] = 240.0 * tg["poss"] / tg["minutes"]
    tg["off_rating"] = 100.0 * tg["pts"] / tg["poss"]
    tg["def_rating"] = 100.0 * tg["opp_pts"] / tg["poss"]
    tg["net_rating"] = tg["off_rating"] - tg["def_rating"]

    cols = [
        "game_id", "season", "season_type", "game_date", "team_id", "team_abbreviation",
        "opp_team_id", "is_home", "is_neutral", "win", "minutes", *BOX_COLS, "opp_pts",
        *RATING_COLS,
    ]  # fmt: skip
    tg = tg[cols].rename(columns={"team_abbreviation": "team_abbr"})
    for c in ["opp_pts", "team_id", "opp_team_id"]:
        tg[c] = tg[c].astype(int)
    for c in RATING_COLS:
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


def validate_and_write(
    team_games: pd.DataFrame,
    player_games: pd.DataFrame,
    out_dir: Path,
    current_season: str,
    check_season_lengths: bool = True,
) -> dict[str, int]:
    """Validate the three staged tables together and write them. Returns row counts."""
    team_games = TeamGames.validate(team_games, lazy=True)
    games = Games.validate(build_games(team_games), lazy=True)
    player_games = player_games.sort_values(["game_date", "game_id", "team_id", "player_id"])
    player_games = PlayerGames.validate(player_games.reset_index(drop=True), lazy=True)
    problems = (
        check_regular_season_lengths(team_games, current_season) if check_season_lengths else []
    )
    orphans = check_players_in_game_teams(player_games, team_games)
    if orphans:
        problems.append(f"{orphans} player rows belong to a team that didn't play that game")
    if problems:
        raise StagingError("Staged data failed checks:\n- " + "\n- ".join(problems))

    out_dir.mkdir(parents=True, exist_ok=True)
    tables = {"team_games": team_games, "games": games, "player_games": player_games}
    for name, df in tables.items():
        df.to_parquet(out_dir / f"{name}.parquet", index=False)
    return {name: len(df) for name, df in tables.items()}


def stage_all(
    raw_root: Path = RAW_STATS_DIR,
    cdn_root: Path = RAW_CDN_DIR,
    out_dir: Path = STAGED_DIR,
    current_season: str = CURRENT_SEASON,
    check_season_lengths: bool = True,
) -> dict[str, int]:
    """Build, validate and write all staged tables from every raw source. Returns row counts."""
    team_logs = combine_sources(load_raw(Endpoint.TEAM_LOGS, raw_root),
                                load_cdn_box("team_logs", cdn_root / "box"),
                                ["GAME_ID", "TEAM_ID"])  # fmt: skip
    player_logs = combine_sources(load_raw(Endpoint.PLAYER_LOGS, raw_root),
                                  load_cdn_box("player_logs", cdn_root / "box"),
                                  ["GAME_ID", "PLAYER_ID"])  # fmt: skip
    team_games = build_team_games(team_logs, load_cdn_home_teams(cdn_root))
    player_games = build_player_games(player_logs, team_games)
    return validate_and_write(team_games, player_games, out_dir, current_season,
                              check_season_lengths)  # fmt: skip


def stage_incremental(
    team_logs: pd.DataFrame,
    player_logs: pd.DataFrame,
    staged_dir: Path = STAGED_DIR,
    cdn_root: Path = RAW_CDN_DIR,
    current_season: str = CURRENT_SEASON,
    check_season_lengths: bool = True,
) -> dict[str, int]:
    """Append new games (game-log format, e.g. from cdn box scores) to the existing staged tables.

    Used where the raw stats.nba.com cache isn't available (GitHub Actions). Re-validates
    everything before writing."""
    if team_logs.empty:
        return {}
    team_logs, player_logs = prepare_cdn_logs(team_logs), prepare_cdn_logs(player_logs)
    old_tg = pd.read_parquet(staged_dir / "team_games.parquet")
    old_pg = pd.read_parquet(staged_dir / "player_games.parquet")
    new_ids = set(team_logs["GAME_ID"])
    new_tg = build_team_games(team_logs, load_cdn_home_teams(cdn_root))
    team_games = pd.concat([old_tg[~old_tg["game_id"].isin(new_ids)], new_tg], ignore_index=True)
    team_games = team_games.sort_values(["game_date", "game_id", "is_home"]).reset_index(drop=True)

    new_pg = build_player_games(player_logs, team_games)
    player_games = pd.concat([old_pg[~old_pg["game_id"].isin(new_ids)], new_pg], ignore_index=True)
    return validate_and_write(team_games, player_games, staged_dir, current_season,
                              check_season_lengths)  # fmt: skip
