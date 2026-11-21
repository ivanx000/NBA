"""pandera schemas for the staged tables. Any violation fails `tipoff ingest`."""

from __future__ import annotations

import pandas as pd
import pandera.pandas as pa
from pandera.typing import Series

from tipoff.seasons import SeasonType
from tipoff.teams import load_teams

TEAM_IDS = [t["team_id"] for t in load_teams()]
SEASON_TYPES = [st.value for st in SeasonType]
GAME_ID = r"^00[245]\d{7}$"  # 002 regular, 004 playoffs, 005 play-in
SEASON = r"^\d{4}-\d{2}$"

# Regular-season games per team, where it isn't 82.
SHORT_SEASONS: dict[str, tuple[int, int]] = {
    "2019-20": (64, 75),  # suspended in March; 22 teams finished in the bubble
    "2020-21": (72, 72),  # 72-game COVID schedule
}


class TeamGames(pa.DataFrameModel):
    """One row per team per game."""

    game_id: Series[str] = pa.Field(str_matches=GAME_ID)
    season: Series[str] = pa.Field(str_matches=SEASON)
    season_type: Series[str] = pa.Field(isin=SEASON_TYPES)
    game_date: Series[pd.Timestamp]
    team_id: Series[int] = pa.Field(isin=TEAM_IDS)
    opp_team_id: Series[int] = pa.Field(isin=TEAM_IDS)
    is_home: Series[bool]
    is_neutral: Series[bool]
    win: Series[bool]
    minutes: Series[int] = pa.Field(ge=240, le=400)
    pts: Series[int] = pa.Field(ge=50, le=200)
    opp_pts: Series[int] = pa.Field(ge=50, le=200)
    fgm: Series[int] = pa.Field(ge=0)
    fga: Series[int] = pa.Field(ge=0)
    fg3m: Series[int] = pa.Field(ge=0)
    fg3a: Series[int] = pa.Field(ge=0)
    ftm: Series[int] = pa.Field(ge=0)
    fta: Series[int] = pa.Field(ge=0)
    oreb: Series[int] = pa.Field(ge=0)
    dreb: Series[int] = pa.Field(ge=0)
    reb: Series[int] = pa.Field(ge=0)
    ast: Series[int] = pa.Field(ge=0)
    stl: Series[int] = pa.Field(ge=0)
    blk: Series[int] = pa.Field(ge=0)
    tov: Series[int] = pa.Field(ge=0)
    pf: Series[int] = pa.Field(ge=0)
    plus_minus: Series[int]
    poss: Series[float] = pa.Field(ge=60, le=160)
    pace: Series[float] = pa.Field(ge=60, le=140)
    off_rating: Series[float] = pa.Field(ge=40, le=200)
    def_rating: Series[float] = pa.Field(ge=40, le=200)
    net_rating: Series[float] = pa.Field(ge=-100, le=100)

    class Config:
        strict = False
        unique = ["game_id", "team_id"]

    @pa.dataframe_check
    def two_teams_one_home(cls, df: pd.DataFrame) -> bool:
        per_game = df.groupby("game_id").agg(n=("team_id", "size"), homes=("is_home", "sum"))
        return bool(((per_game["n"] == 2) & (per_game["homes"] == 1)).all())

    @pa.dataframe_check
    def one_winner_per_game(cls, df: pd.DataFrame) -> bool:
        return bool((df.groupby("game_id")["win"].sum() == 1).all())

    @pa.dataframe_check
    def scores_consistent(cls, df: pd.DataFrame) -> pd.Series:
        return (df["plus_minus"] == df["pts"] - df["opp_pts"]) & (
            df["win"] == (df["pts"] > df["opp_pts"])
        )

    @pa.dataframe_check
    def no_self_games(cls, df: pd.DataFrame) -> pd.Series:
        return df["team_id"] != df["opp_team_id"]


class Games(pa.DataFrameModel):
    """One row per game, home/away pivoted."""

    game_id: Series[str] = pa.Field(str_matches=GAME_ID, unique=True)
    season: Series[str] = pa.Field(str_matches=SEASON)
    season_type: Series[str] = pa.Field(isin=SEASON_TYPES)
    game_date: Series[pd.Timestamp]
    home_team_id: Series[int] = pa.Field(isin=TEAM_IDS)
    away_team_id: Series[int] = pa.Field(isin=TEAM_IDS)
    home_pts: Series[int] = pa.Field(ge=50, le=200)
    away_pts: Series[int] = pa.Field(ge=50, le=200)
    home_win: Series[bool]
    is_neutral: Series[bool]
    overtimes: Series[int] = pa.Field(ge=0, le=6)

    class Config:
        strict = True

    @pa.dataframe_check
    def winner_matches_score(cls, df: pd.DataFrame) -> pd.Series:
        return (df["home_win"] == (df["home_pts"] > df["away_pts"])) & (
            df["home_pts"] != df["away_pts"]
        )


class PlayerGames(pa.DataFrameModel):
    """One row per player per game (players who appeared in the box score)."""

    game_id: Series[str] = pa.Field(str_matches=GAME_ID)
    season: Series[str] = pa.Field(str_matches=SEASON)
    season_type: Series[str] = pa.Field(isin=SEASON_TYPES)
    game_date: Series[pd.Timestamp]
    player_id: Series[int] = pa.Field(gt=0)
    player_name: Series[str]
    team_id: Series[int] = pa.Field(isin=TEAM_IDS)
    is_home: Series[bool]
    minutes: Series[int] = pa.Field(ge=0, le=70)
    pts: Series[int] = pa.Field(ge=0, le=100)
    reb: Series[int] = pa.Field(ge=0, le=40)
    ast: Series[int] = pa.Field(ge=0, le=35)
    # The rest of the box score, used by lineup strength's Game Score (features/lineup.py).
    fgm: Series[int] = pa.Field(ge=0)
    fga: Series[int] = pa.Field(ge=0)
    ftm: Series[int] = pa.Field(ge=0)
    fta: Series[int] = pa.Field(ge=0)
    oreb: Series[int] = pa.Field(ge=0)
    dreb: Series[int] = pa.Field(ge=0)
    stl: Series[int] = pa.Field(ge=0)
    blk: Series[int] = pa.Field(ge=0)
    pf: Series[int] = pa.Field(ge=0)
    tov: Series[int] = pa.Field(ge=0)

    class Config:
        strict = False
        unique = ["game_id", "player_id"]


def check_regular_season_lengths(team_games: pd.DataFrame, current_season: str) -> list[str]:
    """Problems with games-per-team in completed regular seasons (empty list = OK)."""
    reg = team_games[team_games["season_type"] == SeasonType.REGULAR.value]
    counts = reg.groupby(["season", "team_id"]).size()
    problems = []
    for season, per_team in counts.groupby(level="season"):
        if season == current_season:
            if per_team.max() > 82:
                problems.append(f"{season}: a team has more than 82 games")
            continue
        lo, hi = SHORT_SEASONS.get(str(season), (82, 82))
        if len(per_team) != 30:
            problems.append(f"{season}: {len(per_team)} teams, expected 30")
        bad = per_team[(per_team < lo) | (per_team > hi)]
        if not bad.empty:
            problems.append(f"{season}: games per team outside [{lo}, {hi}]: {bad.to_dict()}")
    return problems


def check_players_in_game_teams(player_games: pd.DataFrame, team_games: pd.DataFrame) -> int:
    """Number of player rows whose team didn't play in that game (should be 0)."""
    keys = team_games[["game_id", "team_id"]].drop_duplicates()
    merged = player_games[["game_id", "team_id"]].merge(keys, how="left", indicator=True)
    return int((merged["_merge"] == "left_only").sum())
