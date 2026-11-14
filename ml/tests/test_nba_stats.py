from datetime import UTC, date, datetime, timedelta

import pandas as pd

from tipoff.config import CURRENT_SEASON
from tipoff.ingest.nba_stats import Endpoint, FetchTask, Manifest, ingest_stats, plan_tasks
from tipoff.seasons import SeasonType

NOW = datetime(2026, 11, 14, 15, 0, tzinfo=UTC)


class FakeFetcher:
    """Returns one or two rows per call and records what was requested."""

    def __init__(self):
        self.calls = []

    def __call__(self, endpoint, season, season_type, date_from):
        self.calls.append((endpoint, season, season_type, date_from))
        entity = "PLAYER_ID" if endpoint is Endpoint.PLAYER_LOGS else "TEAM_ID"
        if date_from is None:
            rows = [("0022600001", 1, "2026-10-21", 100)]
        else:  # the last cached game again (with a corrected score) plus a newer one
            rows = [("0022600001", 1, "2026-10-21", 101), ("0022600002", 1, "2026-10-22", 99)]
        return pd.DataFrame(rows, columns=["GAME_ID", entity, "GAME_DATE", "PTS"])


def _tasks(season):
    return [FetchTask(ep, season, SeasonType.REGULAR) for ep in Endpoint]


def test_completed_seasons_are_fetched_once(tmp_path):
    fetcher = FakeFetcher()
    first = ingest_stats(_tasks("2024-25"), fetcher=fetcher, root=tmp_path, now=NOW)
    assert [r.action for r in first] == ["fetched"] * 3
    assert len(fetcher.calls) == 3

    later = NOW + timedelta(days=30)
    second = ingest_stats(_tasks("2024-25"), fetcher=fetcher, root=tmp_path, now=later)
    assert [r.action for r in second] == ["skipped"] * 3
    assert len(fetcher.calls) == 3  # no new requests

    forced = ingest_stats(_tasks("2024-25"), fetcher=fetcher, root=tmp_path, now=later, force=True)
    assert [r.action for r in forced] == ["fetched"] * 3


def test_current_season_refreshes_incrementally(tmp_path):
    fetcher = FakeFetcher()
    tasks = _tasks(CURRENT_SEASON)
    ingest_stats(tasks, fetcher=fetcher, root=tmp_path, now=NOW)

    soon = ingest_stats(tasks, fetcher=fetcher, root=tmp_path, now=NOW + timedelta(hours=1))
    assert {r.reason for r in soon} == {"fetched recently"}

    later = ingest_stats(tasks, fetcher=fetcher, root=tmp_path, now=NOW + timedelta(hours=12))
    assert [r.action for r in later] == ["refreshed"] * 3
    assert all(call[3] == date(2026, 10, 21) for call in fetcher.calls[3:])

    df = pd.read_parquet(tasks[0].path(tmp_path))
    assert df["GAME_ID"].tolist() == ["0022600001", "0022600002"]
    assert df.loc[df["GAME_ID"] == "0022600001", "PTS"].item() == 101  # newer row wins
    entry = Manifest(tmp_path).get(tasks[0].key)
    assert entry["max_game_date"] == "2026-10-22"
    assert entry["complete"] is False


def test_dry_run_makes_no_requests(tmp_path):
    fetcher = FakeFetcher()
    results = ingest_stats(_tasks("2024-25"), fetcher=fetcher, root=tmp_path, dry_run=True)
    assert [r.action for r in results] == ["planned"] * 3
    assert fetcher.calls == []
    assert not (tmp_path / "_manifest.json").exists()


def test_plan_skips_postseason_before_april():
    tasks = plan_tasks(["2025-26", "2026-27"], today=date(2026, 11, 14))
    types = {(t.season, t.season_type) for t in tasks}
    assert ("2025-26", SeasonType.PLAYOFFS) in types
    assert ("2026-27", SeasonType.PLAYOFFS) not in types
    assert len(tasks) == 3 * 3 + 3
