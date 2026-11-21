"""Assemble the game-level feature table: one row per regular-season game.

Columns:
- keys: game_id, season, season_type, game_date, home_team_id, away_team_id, is_neutral, played
- target: home_win (missing for games not yet played)
- features (FEATURE_COLUMNS): home-minus-away differences plus a few raw values

The same code builds rows for scheduled games (pass ``upcoming``), so training and prediction
features can't drift apart. All inputs to a row come from earlier dates
(see tests/test_no_leakage.py).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from tipoff.config import FEATURES_DIR, FIRST_SEASON, STAGED_DIR
from tipoff.features.availability import availability_features
from tipoff.features.columns import (
    DIFF_SOURCES,
    FEATURE_COLUMNS,
    KEY_COLUMNS,
    RAW_SOURCES,
    TARGET,
)
from tipoff.features.elo import EloParams, run_elo
from tipoff.features.lineup import lineup_features
from tipoff.features.schedule import schedule_features
from tipoff.features.schemas import GameFeatures
from tipoff.features.team_form import team_form
from tipoff.features.timeline import prepare_games, team_timeline
from tipoff.seasons import season_start_year


def team_level_features(tl: pd.DataFrame, player_games: pd.DataFrame) -> pd.DataFrame:
    """All pre-game team features, one row per team-game (aligned with ``tl``)."""
    tl = tl.reset_index(drop=True)
    parts = [team_form(tl), schedule_features(tl), availability_features(tl, player_games),
             lineup_features(tl, player_games)]  # fmt: skip
    feats = pd.concat(parts, axis=1)
    return pd.concat([tl[["game_id", "team_id", "game_date"]], feats], axis=1)


@dataclass
class Tables:
    """Intermediate tables shared by the game and player feature builders."""

    games: pd.DataFrame  # played + scheduled games
    tl: pd.DataFrame  # one row per team-game (team_timeline)
    team: pd.DataFrame  # pre-game team features, indexed by (game_id, team_id)
    elo: pd.DataFrame  # pre-game Elo, indexed by game_id


def build_tables(
    staged_games: pd.DataFrame,
    team_games: pd.DataFrame,
    player_games: pd.DataFrame,
    upcoming: pd.DataFrame | None = None,
    elo_params: EloParams | None = None,
) -> Tables:
    games = prepare_games(staged_games, upcoming)
    tl = team_timeline(games, team_games)
    team = team_level_features(tl, player_games).set_index(["game_id", "team_id"])
    elo = run_elo(games, elo_params or EloParams.load()).set_index("game_id")
    return Tables(games=games, tl=tl, team=team, elo=elo)


def build_features(
    staged_games: pd.DataFrame,
    team_games: pd.DataFrame,
    player_games: pd.DataFrame,
    upcoming: pd.DataFrame | None = None,
    elo_params: EloParams | None = None,
    first_season: str = FIRST_SEASON,
    tables: Tables | None = None,
) -> pd.DataFrame:
    t = tables or build_tables(staged_games, team_games, player_games, upcoming, elo_params)
    games, team, elo = t.games, t.team, t.elo

    in_window = games["season"].map(season_start_year) >= season_start_year(first_season)
    rows = games[(games["season_type"] == "regular") & in_window]
    rows = rows.set_index("game_id")
    home = team.reindex(pd.MultiIndex.from_arrays([rows.index, rows["home_team_id"]]))
    away = team.reindex(pd.MultiIndex.from_arrays([rows.index, rows["away_team_id"]]))
    home.index = away.index = rows.index

    out = rows[[c for c in KEY_COLUMNS if c != "game_id"]].copy()
    out[TARGET] = rows["home_win"].astype("boolean")
    e = elo.reindex(rows.index)
    out["elo_diff"] = e["elo_home"] + e["elo_hfa"] - e["elo_away"]
    out["elo_prob_home"] = e["elo_prob_home"]
    out["elo_hfa"] = e["elo_hfa"]
    out["is_neutral_f"] = rows["is_neutral"].astype(float)
    out["season_progress"] = (home["games_played"] + away["games_played"]) / 2 / 82
    out["home_venue_win_pct"] = home["venue_win_pct"]
    out["away_venue_win_pct"] = away["venue_win_pct"]
    for c in DIFF_SOURCES:
        out[f"diff_{c}"] = home[c] - away[c]
    for c in RAW_SOURCES:
        out[f"home_{c}"] = home[c]
        out[f"away_{c}"] = away[c]
    out = out.reset_index()
    out[FEATURE_COLUMNS] = out[FEATURE_COLUMNS].astype(float)
    return (
        out[[*KEY_COLUMNS, TARGET, *FEATURE_COLUMNS]]
        .sort_values(["game_date", "game_id"])
        .reset_index(drop=True)
    )


# Bump whenever a feature's definition changes (the hash must change with it).
# v1: stats.nba.com advanced ratings. v2: box-score possession formula for pace and ratings.
# v3: lineup strength (features/lineup.py).
FEATURES_VERSION = 3


def features_hash(df: pd.DataFrame, elo_params: EloParams) -> str:
    """Hash of the feature schema, Elo parameters and data window (stored with predictions)."""
    played = df[df["played"]]
    payload = {
        "version": FEATURES_VERSION,
        "columns": [[c, str(df[c].dtype)] for c in df.columns],
        "elo": elo_params.__dict__,
        "window": [str(played["game_date"].min().date()), str(played["game_date"].max().date())],
        "rows": len(played),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def build_and_save(
    staged_dir: Path = STAGED_DIR,
    out_dir: Path = FEATURES_DIR,
    upcoming: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, str]:
    params = EloParams.load()
    df = build_features(
        pd.read_parquet(staged_dir / "games.parquet"),
        pd.read_parquet(staged_dir / "team_games.parquet"),
        pd.read_parquet(staged_dir / "player_games.parquet"),
        upcoming=upcoming,
        elo_params=params,
    )
    df = GameFeatures.validate(df, lazy=True)
    digest = features_hash(df, params)
    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_dir / "game_features.parquet", index=False)
    (out_dir / "game_features.meta.json").write_text(
        json.dumps(
            {
                "features_hash": digest,
                "feature_columns": FEATURE_COLUMNS,
                "elo_params": params.__dict__,
                "rows": len(df),
            },
            indent=2,
        )
    )
    return df, digest
