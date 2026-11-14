import numpy as np
import pandas as pd
import pytest

from tipoff.config import TEST_SEASON, VALID_SEASON
from tipoff.evaluate.metrics import compute_metrics, expected_calibration_error, to_markdown
from tipoff.features.columns import FEATURE_COLUMNS
from tipoff.models.baselines import choose_c
from tipoff.models.data import train_valid


def test_metrics_known_values():
    y = np.array([1, 0, 1, 0])
    m = compute_metrics(y, np.array([0.9, 0.1, 0.8, 0.3]))
    assert m["accuracy"] == 1.0 and m["auc"] == 1.0
    assert m["brier"] == pytest.approx((0.01 + 0.01 + 0.04 + 0.09) / 4)
    coin = compute_metrics(y, np.full(4, 0.5))
    assert coin["log_loss"] == pytest.approx(np.log(2))
    assert coin["auc"] == 0.5


def test_ece_is_zero_when_calibrated():
    p = np.repeat([0.25, 0.75], 4)
    y = np.array([1, 0, 0, 0, 1, 1, 1, 0])
    assert expected_calibration_error(y, p) == pytest.approx(0.0)
    assert expected_calibration_error(np.ones(4), np.full(4, 0.6)) == pytest.approx(0.4)


def test_choose_c_prefers_more_regularization_on_ties():
    assert choose_c({0.01: 0.60, 0.1: 0.59591, 1.0: 0.59590}) == 0.1
    assert choose_c({0.01: 0.62, 0.1: 0.60, 1.0: 0.59}) == 1.0


def test_split_never_includes_test_season():
    seasons = ["2016-17", VALID_SEASON, TEST_SEASON]
    df = pd.DataFrame({c: 0.0 for c in FEATURE_COLUMNS}, index=range(3)).assign(
        season=seasons, played=True, home_win=[True, False, True]
    )
    train, valid = train_valid(df)
    assert set(train.meta["season"]) == {"2016-17"}
    assert set(valid.meta["season"]) == {VALID_SEASON}


def test_markdown_table():
    table = pd.DataFrame({"log_loss": [0.6], "brier": [0.2], "accuracy": [0.66], "auc": [0.7],
                          "ece": [0.02]}, index=["Elo"])  # fmt: skip
    assert "| Elo | 0.6000 | 0.2000 | 66.0% |" in to_markdown(table)
