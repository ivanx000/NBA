"""Leakage tests (ML_PLAN section 2). A game's feature row may only use information from
strictly earlier dates. Keep these passing.

1. Perturbation: change every result on date D; rows for D's games must not change, while later
   rows do (so the test can't pass vacuously).
2. Truncation: delete everything after D and blank D's results (as on game day); rows for D's
   games must equal the full build exactly. This also proves the "upcoming game" path matches.
3. Provenance: every row's latest source game is strictly before its game date.
"""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from synthetic import make_league
from tipoff.config import STAGED_DIR
from tipoff.features.build import build_features
from tipoff.features.columns import FEATURE_COLUMNS
from tipoff.features.elo import EloParams
from tipoff.features.timeline import prepare_games, team_timeline

PARAMS = EloParams(k=15, home_adv=0, hfa_mode="rolling", carryover=0.6, mov=True)


def _build(league, upcoming=None, first_season="2015-16"):
    return build_features(league["games"], league["team_games"], league["player_games"],
                          upcoming=upcoming, elo_params=PARAMS,
                          first_season=first_season).set_index("game_id")  # fmt: skip


def _perturb(league, day):
    out = {k: v.copy() for k, v in league.items()}
    g, tg, pg = out["games"], out["team_games"], out["player_games"]
    on_day = g["game_date"] == day
    g.loc[on_day, ["home_pts", "away_pts"]] = g.loc[on_day, ["away_pts", "home_pts"]].to_numpy() + 7
    g.loc[on_day, "home_win"] = g.loc[on_day, "home_pts"] > g.loc[on_day, "away_pts"]
    t_day = tg["game_date"] == day
    new_pts = tg.loc[t_day, "opp_pts"] + 7
    tg.loc[t_day, "opp_pts"] = tg.loc[t_day, "pts"] + 7
    tg.loc[t_day, "pts"] = new_pts
    tg.loc[t_day, "win"] = tg.loc[t_day, "pts"] > tg.loc[t_day, "opp_pts"]
    tg.loc[t_day, "plus_minus"] = tg.loc[t_day, "pts"] - tg.loc[t_day, "opp_pts"]
    for c in ["fgm", "fga", "fg3m", "ftm", "fta", "oreb", "dreb", "tov"]:
        tg.loc[t_day, c] = tg.loc[t_day, c] + 3
    for c in ["off_rating", "def_rating", "pace"]:
        tg.loc[t_day, c] = tg.loc[t_day, c] * 1.2
    p_day = pg["game_date"] == day
    pg = pg[~(p_day & (pg.index % 3 == 0))].copy()  # different players "appear"
    pg.loc[pg["game_date"] == day, ["minutes", "pts"]] += 5
    out["player_games"] = pg
    return out


def _check_dates(league, n=4):
    dates = sorted(
        league["games"].loc[league["games"]["season"] == "2015-16", "game_date"].unique()
    )
    return [dates[i] for i in np.linspace(3, len(dates) - 4, n).astype(int)]


@pytest.fixture(scope="module")
def league():
    return make_league()


@pytest.fixture(scope="module")
def full(league):
    return _build(league)


def test_perturbing_a_days_results_never_changes_that_days_rows(league, full):
    for day in _check_dates(league):
        perturbed = _build(_perturb(league, day))
        ids = full.index[full["game_date"] == day]
        pd.testing.assert_frame_equal(full.loc[ids, FEATURE_COLUMNS],
                                      perturbed.loc[ids, FEATURE_COLUMNS])  # fmt: skip
        later = full.index[full["game_date"] > day]
        assert not np.allclose(
            full.loc[later, FEATURE_COLUMNS], perturbed.loc[later, FEATURE_COLUMNS]
        )


def _truncation_check(league, full, day, first_season="2015-16"):
    before = {k: v[v["game_date"] < day] for k, v in league.items()}
    upcoming = league["games"].loc[league["games"]["game_date"] == day,
                                   ["game_id", "season", "season_type", "game_date",
                                    "home_team_id", "away_team_id", "is_neutral"]]  # fmt: skip
    truncated = _build(before, upcoming=upcoming, first_season=first_season)
    ids = upcoming["game_id"]
    assert not truncated.loc[ids, "played"].any()
    pd.testing.assert_frame_equal(full.loc[ids, FEATURE_COLUMNS],
                                  truncated.loc[ids, FEATURE_COLUMNS])  # fmt: skip


def test_truncating_the_future_gives_identical_rows(league, full):
    for day in _check_dates(league):
        _truncation_check(league, full, day)


def test_latest_source_is_before_game_date(league, full):
    games = prepare_games(league["games"])
    tl = team_timeline(games, league["team_games"])
    tl["prev_date"] = tl.groupby("team_id")["game_date"].shift(1)
    latest = tl.groupby("game_id")["prev_date"].max().reindex(full.index)
    has_history = latest.notna()
    assert (latest[has_history] < full.loc[has_history, "game_date"]).all()
    # Player-derived inputs come from the same earlier games.
    pg = league["player_games"].merge(full[["game_date"]].rename(columns={"game_date": "row_date"}),
                                      left_on="game_id", right_index=True)  # fmt: skip
    assert (pg["game_date"] == pg["row_date"]).all()


REAL = Path(STAGED_DIR / "games.parquet")


@pytest.mark.skipif(not REAL.exists(), reason="needs staged data from `tipoff ingest` (local only)")
def test_truncation_on_real_data():
    league = {n: pd.read_parquet(STAGED_DIR / f"{n}.parquet")
              for n in ("games", "team_games", "player_games")}  # fmt: skip
    full = _build(league)
    for day in ["2024-12-25", "2025-03-14"]:
        _truncation_check(league, full, pd.Timestamp(day))
