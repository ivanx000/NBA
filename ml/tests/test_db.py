"""Database tests against real Postgres with the real Drizzle migrations (web/drizzle/*.sql).

Locally: `docker compose up -d db` (uses the tipoff_test database on port 5433).
CI: a postgres service with TEST_DATABASE_URL. Skipped when no database is reachable.
"""

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pandas as pd
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from tipoff.db import tables, to_sqlalchemy_url
from tipoff.ingest.nba_cdn import parse_schedule
from tipoff.publish.freshness import missing_predictions
from tipoff.publish.publish import publish
from tipoff.publish.sync import game_rows
from tipoff.teams import load_teams

MIGRATIONS = Path(__file__).resolve().parents[2] / "web" / "drizzle"
URL = os.environ.get("TEST_DATABASE_URL", "postgresql://tipoff:tipoff@localhost:5433/tipoff_test")
# Real time: the DB-level guard compares against the database's now().
NOW = datetime.now(UTC).replace(microsecond=0)
BOS, NYK = 1610612738, 1610612752


@pytest.fixture
def engine(monkeypatch):
    monkeypatch.undo()  # the network guard blocks sockets; this suite needs the local DB
    eng = create_engine(to_sqlalchemy_url(URL))
    try:
        with eng.connect():
            pass
    except OperationalError:
        pytest.skip(f"no test database at {URL}")
    with eng.begin() as conn:
        conn.execute(text("drop schema public cascade; create schema public"))
        for sql_file in sorted(MIGRATIONS.glob("*.sql")):
            for stmt in sql_file.read_text().split("--> statement-breakpoint"):
                if stmt.strip():
                    conn.execute(text(stmt))
        cols = ("team_id", "abbr", "city", "name", "conference", "division")
        conn.execute(
            text(f"insert into teams values ({', '.join(':' + c for c in cols)})"),
            [{c: t[c] for c in cols} for t in load_teams()],
        )
    yield eng
    eng.dispose()


def _pred(game_id, tipoff, prob=0.6, source="live", version="game-v1", **extra):
    row = {
        "game_id": game_id, "season": "2026-27", "game_date": tipoff.date(),
        "tipoff_utc": tipoff, "home_team_id": BOS, "away_team_id": NYK, "is_neutral": False,
        "home_win_prob": prob, "elo_home_win_prob": 0.55,
        "factors": json.dumps([{"factor": "elo", "label": "Team rating", "favors": "home",
                                "pp": 0.05, "logit": 0.2}]),
        "features_hash": "abc", "model_version": version, "mlflow_run_id": None,
        "trained_at": NOW, "train_window": "test", "generated_at": NOW, "source": source,
    }  # fmt: skip
    row.update(extra)
    return row


def _prob(engine, game_id, version="game-v1"):
    sql = "select home_win_prob from game_predictions where game_id = :g and model_version = :v"
    with engine.connect() as conn:
        return conn.execute(text(sql), {"g": game_id, "v": version}).scalar()


def test_migrations_create_schema_used_by_publish(engine):
    t = tables(engine)
    cols = set(t["game_predictions"].c.keys())
    assert {"source", "elo_home_win_prob", "factors", "is_pregame", "features_hash"} <= cols
    assert {"season_type", "is_neutral", "game_label"} <= set(t["games"].c.keys())
    with engine.connect() as conn:
        assert conn.execute(text("select count(*) from teams")).scalar() == 30
        conn.execute(text("select * from current_game_predictions"))


def test_sync_rows_from_schedule(engine, fixtures):
    from tipoff.db import upsert

    sched = parse_schedule(json.loads((fixtures / "cdn_schedule.json").read_text()))
    rows = game_rows(sched)
    assert {r["season_type"] for r in rows} == {"regular"}
    upsert(engine, tables(engine)["games"], rows, ["game_id"], update=["status"])
    with engine.connect() as conn:
        got = dict(conn.execute(text("select status, count(*) from games group by status")).all())
        neutral = conn.execute(text("select is_neutral from games where game_id='0022600189'"))
        assert neutral.scalar() is True
        sql = "select count(home_score) from games where status = 'scheduled'"
        scheduled_scores = conn.execute(text(sql)).scalar()
    assert got.get("final", 0) >= 1 and got.get("scheduled", 0) >= 1
    assert scheduled_scores == 0


def test_live_publish_is_pregame_only(engine):
    future, past = NOW + timedelta(hours=5), NOW - timedelta(hours=1)
    preds = pd.DataFrame([_pred("0022600901", future), _pred("0022600902", past)])
    res = publish(engine, preds, now=NOW)
    assert res.written == 1 and res.skipped_started == ["0022600902"]
    assert _prob(engine, "0022600902") is None

    # Before tip-off a re-publish replaces the morning prediction.
    publish(engine, pd.DataFrame([_pred("0022600901", future, prob=0.7)]), now=NOW)
    assert _prob(engine, "0022600901") == pytest.approx(0.7)


def test_started_games_are_immutable_even_with_a_wrong_clock(engine):
    tip = NOW + timedelta(hours=2)
    publish(engine, pd.DataFrame([_pred("0022600903", tip, prob=0.6)]), now=NOW)
    with engine.begin() as conn:  # the game has now started
        conn.execute(text("update games set tipoff_utc = now() - interval '5 minutes' "
                          "where game_id = '0022600903'"))  # fmt: skip
    # A caller whose clock says it's still before tip-off tries to overwrite.
    late = _pred("0022600903", tip, prob=0.99)
    publish(engine, pd.DataFrame([late]), now=NOW - timedelta(hours=1))
    assert _prob(engine, "0022600903") == pytest.approx(0.6)


def test_backfill_rows_are_labelled_and_live_wins_in_view(engine):
    day = NOW + timedelta(hours=6)
    publish(engine, pd.DataFrame([_pred("0022600904", day, prob=0.61)]), now=NOW)
    bf = _pred("0022600904", day, prob=0.4, source="backfill", version="game-v1-wf",
               data_cutoff=pd.Timestamp(day.date()) - pd.Timedelta(days=1),
               status="final", home_score=101, away_score=99)  # fmt: skip
    publish(engine, pd.DataFrame([bf]), now=NOW)
    with engine.connect() as conn:
        view = conn.execute(text("select source, home_win_prob from current_game_predictions "
                                 "where game_id = '0022600904'")).one()  # fmt: skip
        status = conn.execute(text("select status, home_score from games "
                                   "where game_id = '0022600904'")).one()  # fmt: skip
    assert view.source == "live" and view.home_win_prob == pytest.approx(0.61)
    assert status.status == "final" and status.home_score == 101


def test_backfill_requires_data_cutoff_before_game(engine):
    day = NOW + timedelta(days=1)
    bad = _pred("0022600905", day, source="backfill", version="game-v1-wf",
                data_cutoff=pd.Timestamp(day.date()))  # fmt: skip
    with pytest.raises(AssertionError):
        publish(engine, pd.DataFrame([bad]), now=NOW)


def test_freshness_flags_missing_but_not_postponed(engine):
    from tipoff.db import upsert

    day = NOW.date() + timedelta(days=1)
    base = {"season": "2026-27", "season_type": "regular", "game_date": day,
            "home_team_id": BOS, "away_team_id": NYK, "is_neutral": False}  # fmt: skip
    upsert(engine, tables(engine)["games"], [
        {**base, "game_id": "0022600911", "status": "scheduled",
         "tipoff_utc": NOW + timedelta(days=1)},
        {**base, "game_id": "0022600912", "status": "postponed", "tipoff_utc": None},
        {**base, "game_id": "0022600913", "status": "scheduled",
         "tipoff_utc": NOW + timedelta(days=1)},
    ], ["game_id"])  # fmt: skip
    publish(engine, pd.DataFrame([_pred("0022600911", NOW + timedelta(days=1))]), now=NOW)
    assert missing_predictions(engine, day) == ["0022600913"]
