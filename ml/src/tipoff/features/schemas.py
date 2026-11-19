"""pandera schema for the game feature table."""

from __future__ import annotations

import pandas as pd
import pandera.pandas as pa

from tipoff.features.columns import FEATURE_COLUMNS, TARGET


class GameFeatures(pa.DataFrameModel):
    game_id: str = pa.Field(unique=True, str_matches=r"^002\d{7}$")
    season: str
    season_type: str = pa.Field(isin=["regular"])
    game_date: pd.Timestamp
    played: bool

    class Config:
        strict = False

    @pa.dataframe_check
    def features_complete(cls, df: pd.DataFrame) -> bool:
        return bool(df[FEATURE_COLUMNS].notna().all().all())

    @pa.dataframe_check
    def target_only_for_played(cls, df: pd.DataFrame) -> bool:
        return bool((df[TARGET].notna() == df["played"]).all())

    @pa.dataframe_check
    def probabilities_in_range(cls, df: pd.DataFrame) -> bool:
        return bool(df["elo_prob_home"].between(0, 1).all())


class PlayerFeatures(pa.DataFrameModel):
    """The player feature table (features/players.py)."""

    game_id: str = pa.Field(str_matches=r"^002\d{7}$")
    player_id: int
    season: str
    game_date: pd.Timestamp
    played: bool
    in_scope: bool

    class Config:
        strict = False
        unique = ["game_id", "player_id"]

    @pa.dataframe_check
    def features_complete_in_scope(cls, df: pd.DataFrame) -> bool:
        from tipoff.features.players import FEATURE_COLUMNS

        return bool(df.loc[df["in_scope"], FEATURE_COLUMNS].notna().all().all())

    @pa.dataframe_check
    def targets_only_for_played(cls, df: pd.DataFrame) -> bool:
        from tipoff.features.players import TARGETS

        return bool((df[TARGETS].notna().all(axis=1) == df["played"]).all())

    @pa.dataframe_check
    def sane_minutes(cls, df: pd.DataFrame) -> bool:
        return bool(df["minutes"].dropna().between(0, 70).all())
