import json

import numpy as np
import pandas as pd
import pytest
from scipy.special import logit

from synthetic import make_league
from tipoff.features.build import build_features
from tipoff.features.columns import FEATURE_COLUMNS
from tipoff.features.elo import EloParams
from tipoff.models import final, train_game
from tipoff.models.data import make_split
from tipoff.models.game_outcome import Calibrator, GameModel
from tipoff.predict.explain import FACTORS_JSON, factor_groups, top_factors

SEASONS = {"2014-15": "2014-10-28", "2015-16": "2015-10-27", "2016-17": "2016-10-25",
           "2017-18": "2017-10-17"}  # fmt: skip
SMALL_GBM = {"n_estimators": 30, "num_leaves": 4, "min_child_samples": 10, "learning_rate": 0.1}


@pytest.fixture(scope="module")
def features():
    lg = make_league(seed=3, dates_per_season=40, seasons=SEASONS)
    return build_features(lg["games"], lg["team_games"], lg["player_games"],
                          elo_params=EloParams(), first_season="2015-16")  # fmt: skip


def _cfg(kind="logreg", calibration="none"):
    candidates = {k: {"calibration": calibration} for k in ("logreg", "lgbm", "ensemble")}
    return {"kind": kind, "lgbm_params": SMALL_GBM, "logreg_c": 0.1,
            "ensemble_weight_logreg": 0.5, "candidates": candidates}  # fmt: skip


def test_factor_groups_cover_every_feature_once():
    features = [f for g in factor_groups() for f in g["features"]]
    assert sorted(features) == sorted(FEATURE_COLUMNS)
    doc = json.loads(FACTORS_JSON.read_text())
    assert all("{team}" in g["template"] or "{opponent}" in g["template"] for g in doc["groups"])


@pytest.mark.parametrize("kind", ["logreg", "lgbm", "ensemble"])
@pytest.mark.parametrize("method", ["none", "platt"])
def test_contributions_sum_to_log_odds(features, kind, method):
    train = make_split(features, "t", ("2015-16", "2016-17"))
    test = make_split(features, "v", ("2017-18",))
    m = GameModel(kind, lgbm_params=SMALL_GBM).fit(train.X, train.y)
    m.calibrator = Calibrator.fit(method, m.raw(train.X), train.y.to_numpy())
    contrib, base = m.contributions(test.X)
    np.testing.assert_allclose(contrib.sum(axis=1) + base, logit(m.predict_proba(test.X)),
                               atol=1e-9)  # fmt: skip


def test_top_factors_signs_and_totals(features):
    train = make_split(features, "t", ("2015-16", "2016-17"))
    m = GameModel("logreg").fit(train.X, train.y)
    contrib, base = m.contributions(train.X.head(20))
    all_factors = top_factors(contrib, base, top_k=99, min_pp=0.0)
    p = m.predict_proba(train.X.head(20))
    p0 = 1 / (1 + np.exp(-base))
    for game, pi, p0i in zip(all_factors, p, p0, strict=True):
        assert sum(f["pp"] for f in game) == pytest.approx(pi - p0i, abs=1e-3)
        assert all((f["pp"] > 0) == (f["favors"] == "home") for f in game)
        assert all((f["pp"] > 0) == (f["logit"] > 0) for f in game)


def test_calibrator_is_fit_out_of_time(features, monkeypatch):
    requested = []
    original = train_game.make_split

    def spy(df, name, seasons):
        requested.append((name, tuple(seasons)))
        return original(df, name, seasons)

    monkeypatch.setattr(train_game, "make_split", spy)
    train_game.out_of_time_calibrator(GameModel("logreg"), features, "2017-18", "platt")
    seasons = dict(requested)
    assert seasons["cal"] == ("2017-18",)
    assert "2017-18" not in seasons["pre"] and seasons["pre"][-1] == "2016-17"


def test_final_test_runs_only_once(tmp_path, monkeypatch):
    marker = tmp_path / "test_marker.json"
    marker.write_text("{}")
    monkeypatch.setattr(final, "marker_path", lambda: marker)
    with pytest.raises(final.TestAlreadyRunError):
        final.final_test()


def test_walk_forward_never_trains_on_its_own_month(features, monkeypatch):
    seen = []
    original_fit = GameModel.fit

    def spy_fit(self, X, y):
        seen.append(X.index)
        return original_fit(self, X, y)

    monkeypatch.setattr(GameModel, "fit", spy_fit)
    out = final.walk_forward(season="2017-18", log_to_mlflow=False, df=features, cfg=_cfg(),
                             write=False)  # fmt: skip
    preds = out["predictions"]
    months = sorted(preds["month"].unique())
    month_fits = seen[-len(months) :]  # the last fits are the monthly models, in order
    for month, idx in zip(months, month_fits, strict=True):
        start = pd.Period(month).start_time
        assert features.loc[idx, "game_date"].max() < start
    assert len(preds) == (features["season"] == "2017-18").sum()
