"""Loading the feature table and splitting it by season (time-based splits only)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from tipoff.config import FEATURES_DIR, TEST_SEASON, TRAIN_SEASONS, VALID_SEASON
from tipoff.features.columns import FEATURE_COLUMNS, TARGET
from tipoff.seasons import season_start_year


@dataclass
class Split:
    name: str
    X: pd.DataFrame
    y: pd.Series
    meta: pd.DataFrame


def load_features(features_dir: Path = FEATURES_DIR) -> tuple[pd.DataFrame, dict]:
    path = features_dir / "game_features.parquet"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run `tipoff features` first.")
    meta = json.loads((features_dir / "game_features.meta.json").read_text())
    return pd.read_parquet(path), meta


def make_split(df: pd.DataFrame, name: str, seasons: tuple[str, ...]) -> Split:
    rows = df[df["season"].isin(seasons) & df["played"]]
    return Split(name, rows[FEATURE_COLUMNS], rows[TARGET].astype(int), rows)


def train_valid(df: pd.DataFrame) -> tuple[Split, Split]:
    """Training and validation splits. The test season is deliberately not reachable here."""
    assert TEST_SEASON not in TRAIN_SEASONS and TEST_SEASON != VALID_SEASON
    return make_split(df, "train", TRAIN_SEASONS), make_split(df, "valid", (VALID_SEASON,))


def seasons_through(last: str, first: str = TRAIN_SEASONS[0]) -> tuple[str, ...]:
    """Seasons from ``first`` to ``last`` inclusive, e.g. seasons_through("2023-24")."""
    start, end = season_start_year(first), season_start_year(last)
    return tuple(f"{y}-{(y + 1) % 100:02d}" for y in range(start, end + 1))
