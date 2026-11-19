"""Player features (ML_PLAN sections 2 and 6): leakage tests and a few definitions.

The same three leakage checks as the game features (tests/test_no_leakage.py), for player rows:
perturbing a day's box scores never changes that day's rows; deleting the future and predicting
the day as scheduled gives identical rows; and the scheduled path picks sensible candidates.
"""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from synthetic import TRADE_TO, TRADED_PLAYER, make_league
from tipoff.config import STAGED_DIR
from tipoff.features.build import build_tables
from tipoff.features.elo import EloParams
from tipoff.features.players import (
    FEATURE_COLUMNS,
    build_player_features,
    projection_candidates,
)

PARAMS = EloParams(k=15, home_adv=0, hfa_mode="rolling", carryover=0.6, mov=True)
UPCOMING_COLS = ["game_id", "season", "season_type", "game_date", "home_team_id", "away_team_id",
                 "is_neutral"]  # fmt: skip


def _build(league, upcoming=None, candidates=None):
    t = build_tables(league["games"], league["team_games"], league["player_games"],
                     upcoming=upcoming, elo_params=PARAMS)  # fmt: skip
    df = build_player_features(t, league["team_games"], league["player_games"], candidates)
    return df.set_index(["game_id", "player_id"])


def _days(league, n=4):
    dates = sorted(
        league["games"].loc[league["games"]["season"] == "2015-16", "game_date"].unique()
    )
    return [dates[i] for i in np.linspace(5, len(dates) - 4, n).astype(int)]


@pytest.fixture(scope="module")
def league():
    return make_league()


@pytest.fixture(scope="module")
def full(league):
    return _build(league)


def _perturb_players(league, day):
    out = {k: v.copy() for k, v in league.items()}
    pg = out["player_games"]
    on = pg["game_date"] == day
    for c in ["minutes", "pts", "reb", "ast", "oreb", "dreb", "fga", "fta", "fg3a", "tov"]:
        pg.loc[on, c] = pg.loc[on, c] * 2 + 3
    tg = out["team_games"]
    t_on = tg["game_date"] == day
    for c in ["fga", "fta", "tov", "pts"]:
        tg.loc[t_on, c] = tg.loc[t_on, c] + 5
    return out


def test_perturbing_a_days_box_scores_never_changes_that_days_rows(league, full):
    for day in _days(league):
        perturbed = _build(_perturb_players(league, day))
        ids = full.index[full["game_date"] == day]
        pd.testing.assert_frame_equal(full.loc[ids, FEATURE_COLUMNS],
                                      perturbed.loc[ids, FEATURE_COLUMNS])  # fmt: skip
        later = full.index[full["game_date"] > day]
        before, after = full.loc[later, FEATURE_COLUMNS], perturbed.loc[later, FEATURE_COLUMNS]
        assert not np.allclose(before.fillna(0), after.fillna(0))


def _truncated(league, day):
    before = {k: v[v["game_date"] < day] for k, v in league.items()}
    day_games = league["games"].loc[league["games"]["game_date"] == day, UPCOMING_COLS]
    cand = projection_candidates(day_games, before["player_games"])
    built = _build(before, upcoming=day_games, candidates=cand)
    return built[built["game_date"] == day], cand


def test_truncating_the_future_gives_identical_rows(league, full):
    compared = 0
    for day in _days(league):
        truncated, _ = _truncated(league, day)
        assert not truncated["played"].any()
        assert truncated[["minutes", "pts"]].isna().all().all()
        both = truncated.index.intersection(full.index[full["game_date"] == day])
        compared += len(both)
        pd.testing.assert_frame_equal(full.loc[both, FEATURE_COLUMNS],
                                      truncated.loc[both, FEATURE_COLUMNS])  # fmt: skip
    assert compared > 20


def test_candidates_played_the_teams_previous_game(league):
    day = _days(league)[2]
    before = league["player_games"][league["player_games"]["game_date"] < day]
    day_games = league["games"][league["games"]["game_date"] == day]
    cand = projection_candidates(day_games, before)
    assert len(cand) > 0
    for (team,), rows in cand.groupby(["team_id"]):
        prev = before[before["team_id"] == team]["game_date"].max()
        played_prev = set(before[(before["team_id"] == team) & (before["game_date"] == prev)]
                          ["player_id"])  # fmt: skip
        assert set(rows["player_id"]) <= played_prev


def test_traded_player_counts_for_his_new_team(league, full):
    rows = full.xs(TRADED_PLAYER, level="player_id")
    new = rows[rows["team_id"] == TRADE_TO]
    assert len(new) > 0
    first = new.sort_values("game_date").iloc[0]
    assert first["games_with_team"] == 0 and first["missed_prev"] == 1
    # His per-minute history carries over to the new team.
    assert first["pts36_l10"] > 0


def test_usage_and_rates_match_the_box_score():
    pg = pd.DataFrame({
        "game_id": ["0021500001", "0021500002"], "season_type": ["regular"] * 2,
        "game_date": pd.to_datetime(["2015-11-01", "2015-11-03"]), "player_id": [1, 1],
        "player_name": ["A", "A"], "team_id": [10, 10], "minutes": [30, 20], "pts": [21, 9],
        "reb": [6, 4], "ast": [3, 1], "oreb": [1, 1], "dreb": [5, 3], "fga": [15, 8], "fta": [5, 2],
        "fg3a": [4, 2], "tov": [2, 1],
    })  # fmt: skip
    tg = pd.DataFrame({
        "game_id": ["0021500001", "0021500002"], "team_id": [10, 10], "minutes": [240, 240],
        "fga": [85, 85], "fta": [20, 20], "tov": [14, 14],
    })  # fmt: skip
    from tipoff.features.players import _box_rows

    box = _box_rows(pg, tg)
    team_rate = (85 + 0.44 * 20 + 14) / 48
    assert box["poss_used"].iloc[0] == pytest.approx(15 + 0.44 * 5 + 2)
    assert box["poss_avail"].iloc[0] == pytest.approx(30 * team_rate)


REAL = Path(STAGED_DIR / "games.parquet")


@pytest.mark.skipif(not REAL.exists(), reason="needs staged data from `tipoff ingest` (local only)")
def test_truncation_on_real_data():
    league = {n: pd.read_parquet(STAGED_DIR / f"{n}.parquet")
              for n in ("games", "team_games", "player_games")}  # fmt: skip
    full = _build(league)
    day = pd.Timestamp("2025-03-14")
    truncated, _ = _truncated(league, day)
    both = truncated.index.intersection(full.index[full["game_date"] == day])
    assert len(both) > 50
    pd.testing.assert_frame_equal(full.loc[both, FEATURE_COLUMNS],
                                  truncated.loc[both, FEATURE_COLUMNS])  # fmt: skip
