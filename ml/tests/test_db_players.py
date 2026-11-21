"""Player projections in Postgres (publish/players.py), against the real migrations.

Uses the same local test database as tests/test_db.py (`docker compose up -d db`); skipped
without one.
"""

from datetime import timedelta

import pandas as pd
from sqlalchemy import text

from test_db import BOS, NOW, NYK, engine  # noqa: F401  (the fixture)
from tipoff.publish.players import publish_projections, record_results


def _proj(game_id, tipoff, players, source="live", version="player-v1", minutes=30.0, **extra):
    rows = []
    for i, pid in enumerate(players):
        row = {
            "game_id": game_id, "season": "2026-27", "game_date": tipoff.date(),
            "tipoff_utc": tipoff, "home_team_id": BOS, "away_team_id": NYK, "is_neutral": False,
            "player_id": pid, "team_id": BOS if i % 2 == 0 else NYK, "player_name": f"P{pid}",
            "proj_minutes": minutes - i, "proj_pts": 20.0, "proj_reb": 6.0, "proj_ast": 4.0,
            "proj_pts_lo": 12.0, "proj_pts_hi": 28.0, "proj_reb_lo": 2.0, "proj_reb_hi": 10.0,
            "proj_ast_lo": 1.0, "proj_ast_hi": 7.0, "features_hash": "abc",
            "model_version": version, "mlflow_run_id": None, "trained_at": NOW,
            "train_window": "test", "generated_at": NOW, "source": source,
        }  # fmt: skip
        row.update(extra)
        rows.append(row)
    return pd.DataFrame(rows)


def _rows(eng, sql, **params):
    with eng.connect() as conn:
        return conn.execute(text(sql), params).all()


def test_live_publish_replaces_a_games_set(engine):  # noqa: F811
    later = NOW + timedelta(hours=6)
    res = publish_projections(engine, _proj("0022600900", later, [1, 2, 3]))
    assert (res.written, res.games) == (3, 1)
    # The second run no longer projects player 3: he must not linger.
    publish_projections(engine, _proj("0022600900", later, [1, 2, 4]))
    ids = {r[0] for r in _rows(engine, "select player_id from player_projections")}
    assert ids == {1, 2, 4}
    kind = _rows(engine, "select kind from model_versions where model_version = 'player-v1'")
    assert kind == [("player",)]


def test_started_games_are_never_written(engine):  # noqa: F811
    earlier = NOW - timedelta(hours=1)
    res = publish_projections(engine, _proj("0022600901", earlier, [1, 2]))
    assert res.written == 0 and res.skipped_started == ["0022600901"]


def test_backfill_never_touches_live_and_the_view_prefers_live(engine):  # noqa: F811
    later = NOW + timedelta(hours=6)
    publish_projections(engine, _proj("0022600902", later, [1, 2]))
    day = later.date()
    backfill = _proj("0022600902", later, [1, 2, 3], source="backfill", version="player-v1-wf",
                     data_cutoff=day - timedelta(days=1), actual_minutes=31.0, actual_pts=18,
                     actual_reb=5, actual_ast=3)  # fmt: skip
    publish_projections(engine, backfill)
    live = _rows(engine, "select count(*) from player_projections where source = 'live'")
    assert live == [(2,)]
    shown = _rows(engine, "select distinct source, model_version from current_player_projections")
    assert shown == [("live", "player-v1")]
    # A game with only a backfill set shows that set, whole.
    publish_projections(engine, _proj("0022600903", later, [5, 6, 7], source="backfill",
                                      version="player-v1-wf", data_cutoff=day - timedelta(days=1),
                                      actual_minutes=20.0, actual_pts=10, actual_reb=2,
                                      actual_ast=1))  # fmt: skip
    n = _rows(
        engine, "select count(*) from current_player_projections where game_id = '0022600903'"
    )
    assert n == [(3,)]


def test_results_fill_actual_lines_and_mark_did_not_play(engine):  # noqa: F811
    later = NOW + timedelta(hours=6)
    publish_projections(engine, _proj("0022600904", later, [1, 2]))
    box = pd.DataFrame({"game_id": ["0022600904"], "player_id": [1], "minutes": [33],
                        "pts": [27], "reb": [8], "ast": [5]})  # fmt: skip
    staged = pd.DataFrame({"game_id": ["0022600904"]})
    assert record_results(engine, box, staged) == 2
    sql = "select player_id, actual_minutes, actual_pts from player_projections"
    got = {pid: (m, p) for pid, m, p in _rows(engine, sql)}
    assert got == {1: (33.0, 27), 2: (0.0, None)}
    assert record_results(engine, box, staged) == 0  # nothing left to fill


def test_injury_status_reaches_the_view(engine):  # noqa: F811
    later = NOW + timedelta(hours=6)
    proj = _proj("0022600905", later, [1, 2])
    proj["injury_status"] = ["Questionable", None]
    publish_projections(engine, proj)
    rows = _rows(engine, "select player_id, injury_status from current_player_projections "
                         "where game_id = '0022600905' order by player_id")  # fmt: skip
    assert rows == [(1, "Questionable"), (2, None)]
    # Older frames without the column still publish.
    publish_projections(engine, _proj("0022600906", later, [3]))
