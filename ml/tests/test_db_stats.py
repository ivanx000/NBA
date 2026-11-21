"""Box scores for the advanced stats in Postgres (publish/stats.py), against the real migrations.

Uses the same local test database as tests/test_db.py (`docker compose up -d db`); skipped
without one.
"""

import pandas as pd
from sqlalchemy import text

from test_db import BOS, NYK, engine  # noqa: F401  (the fixture)
from tipoff.publish.stats import BOX, publish_stats, stats_seasons

DAY = pd.Timestamp("2026-11-10")


def _game(eng, game_id, season="2026-27"):
    with eng.begin() as conn:
        conn.execute(text(
            "insert into games (game_id, season, game_date, home_team_id, away_team_id, status) "
            "values (:g, :s, :d, :h, :a, 'final')"),
            {"g": game_id, "s": season, "d": DAY.date(), "h": BOS, "a": NYK})  # fmt: skip


def _box(**extra):
    return {**{c: 10 for c in BOX}, "minutes": 240, **extra}


def _tables(game_id, season="2026-27", season_type="regular", pts=110):
    base = {"game_id": game_id, "season": season, "season_type": season_type, "game_date": DAY}
    tg = pd.DataFrame([
        {**base, **_box(pts=pts), "team_id": BOS, "opp_team_id": NYK, "is_home": True,
         "opp_pts": 100, "poss": 98.5},
        {**base, **_box(pts=100), "team_id": NYK, "opp_team_id": BOS, "is_home": False,
         "opp_pts": pts, "poss": 98.0},
    ])  # fmt: skip
    pg = pd.DataFrame([
        {**base, **_box(minutes=34, pts=25), "player_id": 7, "player_name": "P7", "team_id": BOS},
        {**base, **_box(minutes=30, pts=18), "player_id": 8, "player_name": "P8", "team_id": NYK},
    ])  # fmt: skip
    return tg, pg


def _count(eng, table):
    with eng.connect() as conn:
        return conn.execute(text(f"select count(*) from {table}")).scalar()


def test_publishes_new_games_once(engine):  # noqa: F811
    _game(engine, "0022600001")
    tg, pg = _tables("0022600001")
    res = publish_stats(engine, tg, pg)
    assert (res.games, res.team_rows, res.player_rows) == (1, 2, 2)
    again = publish_stats(engine, tg, pg)  # only_new: already there
    assert again.games == 0
    assert _count(engine, "team_game_stats") == 2 and _count(engine, "player_game_stats") == 2


def test_rewrite_replaces_a_corrected_box_score(engine):  # noqa: F811
    _game(engine, "0022600002")
    tg, pg = _tables("0022600002", pts=110)
    publish_stats(engine, tg, pg)
    tg2, pg2 = _tables("0022600002", pts=112)
    publish_stats(engine, tg2, pg2, only_new=False)
    with engine.connect() as conn:
        pts = conn.execute(text("select pts from team_game_stats where game_id = '0022600002' "
                                "and team_id = :t"), {"t": BOS}).scalar()  # fmt: skip
    assert pts == 112


def test_skips_unsynced_playoff_and_old_games(engine):  # noqa: F811
    _game(engine, "0022600003")
    synced = _tables("0022600003")
    unsynced = _tables("0022600004")  # not in games yet: next run
    playoff = _tables("0042600001", season_type="playoffs")
    old = _tables("0022300001", season="2023-24")
    tg = pd.concat([x[0] for x in (synced, unsynced, playoff, old)])
    pg = pd.concat([x[1] for x in (synced, unsynced, playoff, old)])
    res = publish_stats(engine, tg, pg)
    assert res.games == 1 and res.skipped_unsynced == 1
    assert stats_seasons("2026-27") == ("2025-26", "2026-27")
