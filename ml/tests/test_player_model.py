"""Player projection models (models/players.py) on a small synthetic table."""

import numpy as np
import pandas as pd
import pytest

from tipoff.config import TEST_SEASON, VALID_SEASON
from tipoff.features.players import FEATURE_COLUMNS
from tipoff.models.players import (
    GRID,
    STATS,
    PlayerModel,
    player_split,
    player_train_valid,
    score,
    score_table,
)


def _table(n=3000, seed=3):
    rng = np.random.default_rng(seed)
    X = pd.DataFrame(rng.normal(size=(n, len(FEATURE_COLUMNS))), columns=FEATURE_COLUMNS)
    X["min_l10"] = rng.uniform(10, 38, n)
    X["pts36_l10"] = rng.uniform(5, 30, n)
    X["reb36_l10"] = rng.uniform(2, 14, n)
    X["ast36_l10"] = rng.uniform(1, 10, n)
    for s in STATS:
        X[f"{s}_l10"] = X[f"{s}36_l10"] * X["min_l10"] / 36
    minutes = np.clip(X["min_l10"] + rng.normal(0, 4, n), 1, 48)
    y = pd.DataFrame({"minutes": minutes})
    for s in STATS:
        y[s] = rng.poisson(X[f"{s}36_l10"] * minutes / 36).astype(float)
    return X, y


def _model(point="two_stage"):
    small = {**GRID[0], "n_estimators": 60}
    params = {"minutes": small, **{f"{s}_rate": small for s in STATS},
              **{f"{s}_direct": small for s in STATS}}  # fmt: skip
    return PlayerModel(point=dict.fromkeys(STATS, point), params=params)


@pytest.fixture(scope="module")
def fitted():
    X, y = _table()
    return _model().fit(X.iloc[:2000], y.iloc[:2000]), X.iloc[2000:], y.iloc[2000:]


def test_projection_is_minutes_times_rate(fitted):
    model, X, _ = fitted
    pred = model.predict(X)
    rate = model.models["pts_rate"].predict(X[FEATURE_COLUMNS]).clip(0)
    np.testing.assert_allclose(pred["pts"], pred["minutes"] * rate)
    assert (pred["minutes"].between(0, 48)).all()


def test_ranges_hold_the_projection_and_are_never_negative(fitted):
    model, X, _ = fitted
    pred = model.predict(X)
    for s in STATS:
        assert (pred[f"{s}_lo"] <= pred[s]).all() and (pred[s] <= pred[f"{s}_hi"]).all()
        assert (pred[f"{s}_lo"] >= 0).all()


def test_conformal_correction_reaches_80_percent(fitted):
    model, X, y = fitted
    model.calibrate(X, y)
    m = score(model.predict(X), y, X)
    for s in STATS:
        assert m[f"{s}_coverage"] >= 0.79
    model.widen = {}


def test_beats_the_last_10_baseline_on_a_learnable_table(fitted):
    model, X, y = fitted
    m = score(model.predict(X), y, X)
    table = score_table(m)
    assert table.loc["minutes", "model MAE"] <= table.loc["minutes", "last-10 MAE"] * 1.05
    assert set(table.index) == {"minutes", *STATS}


def test_direct_mode_skips_the_rate_models():
    X, y = _table(800)
    model = _model("direct").fit(X, y)
    assert "pts_direct" in model.models and "pts_rate" not in model.models
    assert (model.predict(X)["pts"] >= 0).all()


def test_splits_never_reach_the_test_season():
    rows = pd.DataFrame({"season": ["2015-16", VALID_SEASON, TEST_SEASON], "played": True,
                         "in_scope": True, **{c: 0.0 for c in FEATURE_COLUMNS},
                         "minutes": 20.0, "pts": 10.0, "reb": 4.0, "ast": 2.0})  # fmt: skip
    train, valid = player_train_valid(rows)
    assert TEST_SEASON not in set(train.meta["season"]) | set(valid.meta["season"])
    out_of_scope = rows.assign(in_scope=False)
    assert player_split(out_of_scope, "x", ("2015-16",)).X.empty


def test_top_players_keeps_each_teams_biggest_minutes():
    from tipoff.predict.players import PROJ_COLS, top_players

    rows = pd.DataFrame({"game_id": ["g"] * 12, "team_id": [1] * 10 + [2] * 2,
                         "player_id": range(12)})  # fmt: skip
    pred = pd.DataFrame({c: 0.0 for c in PROJ_COLS}, index=range(12))
    pred["minutes"] = [float(m) for m in range(12)]
    top = top_players(rows, pred, n=8)
    assert len(top[top["team_id"] == 1]) == 8 and len(top[top["team_id"] == 2]) == 2
    assert set(top[top["team_id"] == 1]["player_id"]) == set(range(2, 10))
