"""Weekly retrain decisions (models/retrain.py): the window, the promotion rules, the report."""

import numpy as np
import pandas as pd
import pytest

from tipoff.models.retrain import (
    GAME_TOLERANCE,
    MIN_GAMES,
    PLAYER_TOLERANCE,
    _version,
    decide_game,
    decide_player,
    evaluate_game,
    evaluate_player,
    log_loss,
    report,
    window_weeks,
)


def test_window_is_the_last_complete_weeks():
    # Saturday 2026-11-21: the week of Monday 11-16 isn't over yet.
    weeks = window_weeks(pd.Timestamp("2026-11-21"), 4)
    assert [str(w.date()) for w in weeks] == [
        "2026-10-19",
        "2026-10-26",
        "2026-11-02",
        "2026-11-09",
    ]
    # Sunday 2026-11-22 completes it.
    assert str(window_weeks(pd.Timestamp("2026-11-22"), 4)[-1].date()) == "2026-11-16"
    assert all(w.weekday() == 0 for w in weeks)


def test_game_rule_allows_noise_but_not_a_regression():
    assert decide_game(0.62, 0.62 - GAME_TOLERANCE / 2, 100).promote
    assert not decide_game(0.62, 0.62 - 2 * GAME_TOLERANCE, 100).promote
    small = decide_game(0.50, 0.70, MIN_GAMES - 1)
    assert not small.promote and "graded games" in small.reason


def test_player_rule_uses_the_average_error_ratio():
    pub = {"pts": 5.0, "reb": 2.0, "ast": 1.5}
    same = decide_player(dict(pub), pub, 1000)
    assert same.promote and same.metrics["mae_ratio"] == pytest.approx(1.0)
    worse = {k: v * (1 + 3 * PLAYER_TOLERANCE) for k, v in pub.items()}
    assert not decide_player(worse, pub, 1000).promote
    assert not decide_player(dict(pub), pub, 10).promote


def test_game_evaluation_compares_the_same_games():
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, 200)
    preds = pd.DataFrame({"game_id": [f"g{i}" for i in range(200)], "p": np.where(y, 0.7, 0.3),
                          "home_win": y})  # fmt: skip
    published = pd.DataFrame({"game_id": [f"g{i}" for i in range(150)],  # 50 games never published
                              "home_win_prob": 0.5, "elo_home_win_prob": 0.55,
                              "source": "live", "home_win": y[:150]})  # fmt: skip
    d = evaluate_game(preds, published)
    assert d.metrics["n"] == 150 and d.promote
    assert d.metrics["published_log_loss"] == pytest.approx(np.log(2))
    assert d.metrics["challenger_log_loss"] == pytest.approx(
        log_loss(np.where(y[:150], 0.7, 0.3), y[:150])
    )
    assert d.metrics["live_games"] == 150 and "elo_log_loss" in d.metrics


def test_player_evaluation_and_report():
    n = 400
    ids = pd.DataFrame({"game_id": [f"g{i // 8}" for i in range(n)], "player_id": range(n)})
    preds = ids.assign(minutes=30.0, pts=15.0, reb=5.0, ast=3.0)
    published = ids.assign(proj_minutes=30.0, pts=15.0, reb=5.0, ast=3.0, actual_minutes=32.0,
                           actual_pts=17, actual_reb=4, actual_ast=3)  # fmt: skip
    d = evaluate_player(preds, published)
    assert d.promote and d.metrics["n"] == n
    assert d.metrics["challenger_pts_mae"] == pytest.approx(2.0)
    g = decide_game(0.6, 0.61, 100)
    g.metrics.update(challenger_accuracy=0.7, published_accuracy=0.69, elo_log_loss=0.62,
                     elo_accuracy=0.68, live_games=40)  # fmt: skip
    md = report([pd.Timestamp("2026-10-26"), pd.Timestamp("2026-11-02")], g, d,
                {"game": "game-v2-r20261115", "player": "player-v1"})  # fmt: skip
    assert "## Game model: promoted" in md and "## Player model: promoted" in md
    assert "2026-10-26 to 2026-11-08" in md and "| Elo (baseline) | 0.6200 | 68.0% |" in md


def test_versions_keep_their_lineage():
    assert _version("game-v2", pd.Timestamp("2026-11-22")) == "game-v2-r20261122"
    assert _version("game-v2-r20261115", pd.Timestamp("2026-11-22")) == "game-v2-r20261122"
