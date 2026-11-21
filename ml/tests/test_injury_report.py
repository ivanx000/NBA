"""The official injury report: filenames, the as-of rule (publish time, not filename), parsing
all four PDF layouts, and matching names to players. No network: requests are faked."""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from email.utils import format_datetime
from pathlib import Path

import pandas as pd
import pytest

from tipoff.ingest import injury_report as ir
from tipoff.ingest.http import RateLimiter, static_headers

FIX = Path(__file__).parent / "fixtures" / "injury"


def test_filenames_follow_the_three_eras():
    assert ir.filename(datetime(2019, 12, 1, 20)) == "Injury-Report_2019-12-01_08PM.pdf"
    assert ir.filename(datetime(2024, 1, 10, 9)) == "Injury-Report_2024-01-10_09AM.pdf"
    assert ir.filename(datetime(2026, 1, 10, 8, 45)) == "Injury-Report_2026-01-10_08_45AM.pdf"


def test_candidates_are_on_the_grid_newest_first():
    c = ir.candidates(datetime(2019, 12, 2, 9, 0))
    assert c[0] == datetime(2019, 12, 1, 20)  # three a day: last night's 8 PM report
    assert all(t.time() in ir.THREE_A_DAY for t in c)
    c = ir.candidates(datetime(2023, 3, 1, 9, 0))
    assert c[:2] == [datetime(2023, 3, 1, 9), datetime(2023, 3, 1, 8)]
    c = ir.candidates(datetime(2026, 1, 10, 9, 0))
    assert c[:2] == [datetime(2026, 1, 10, 9, 0), datetime(2026, 1, 10, 8, 45)]
    assert ir.candidates(datetime(2018, 12, 1, 9)) == []  # no reports before 2019-20


def test_static_headers_never_name_cdn_as_host():
    # ak-static.cms.nba.com answers 403 to a request whose Host header says cdn.nba.com.
    assert "host" not in {k.lower() for k in static_headers()}
    assert "User-Agent" in static_headers()


class FakeResponse:
    def __init__(self, status: int, content: bytes = b"", published: datetime | None = None):
        self.status_code = status
        self.content = content
        self.headers = (
            {"Last-Modified": format_datetime(published, usegmt=True)} if published else {}
        )


class FakeSession:
    """Serves {filename: publish time (UTC)}; everything else is a 403, as on the real host."""

    def __init__(self, files: dict[str, datetime]):
        self.files = files
        self.calls: list[str] = []

    def get(self, url, headers=None, timeout=None):
        assert "host" not in {k.lower() for k in headers}
        name = url.rsplit("/", 1)[1]
        self.calls.append(name)
        if name in self.files:
            return FakeResponse(200, b"%PDF-1.4 " + name.encode(), self.files[name])
        return FakeResponse(403)


def _store(tmp_path, files):
    return ir.ReportStore(tmp_path, limiter=RateLimiter(0), session=FakeSession(files))


def test_as_of_uses_the_publish_time_not_the_filename(tmp_path):
    # The hourly "09AM" file went up at 9:30 ET, after a 9:00 cutoff, so the 08AM one is used.
    files = {
        "Injury-Report_2023-03-01_09AM.pdf": datetime(2023, 3, 1, 14, 30, 2, tzinfo=UTC),
        "Injury-Report_2023-03-01_08AM.pdf": datetime(2023, 3, 1, 13, 30, 2, tzinfo=UTC),
    }
    store = _store(tmp_path, files)
    rep = store.as_of(datetime(2023, 3, 1, 9, 0), now=datetime(2023, 3, 5, tzinfo=UTC))
    assert rep is not None and rep.filename == "Injury-Report_2023-03-01_08AM.pdf"
    assert rep.published <= datetime(2023, 3, 1, 14, 0, tzinfo=UTC)  # 9:00 ET
    rep = store.as_of(datetime(2023, 3, 1, 9, 45), now=datetime(2023, 3, 5, tzinfo=UTC))
    assert rep.filename == "Injury-Report_2023-03-01_09AM.pdf"


def test_store_caches_pdfs_and_old_misses_only(tmp_path):
    files = {"Injury-Report_2023-03-01_08AM.pdf": datetime(2023, 3, 1, 13, 30, tzinfo=UTC)}
    store = _store(tmp_path, files)
    later = datetime(2023, 3, 5, tzinfo=UTC)
    assert store.load("Injury-Report_2023-03-01_08AM.pdf", now=later) is not None
    assert store.load("Injury-Report_2023-03-01_07AM.pdf", now=later) is None
    # A slot from a few minutes ago may still be published: don't remember the miss.
    assert store.load("Injury-Report_2023-03-04_11PM.pdf", now=later) is None
    store.save_index()
    again = _store(tmp_path, {})
    assert again.load("Injury-Report_2023-03-01_08AM.pdf", now=later) is not None
    assert again.load("Injury-Report_2023-03-01_07AM.pdf", now=later) is None
    assert again.session.calls == []  # both answered from the cache
    assert again.load("Injury-Report_2023-03-04_11PM.pdf", now=later) is None
    assert again.session.calls == ["Injury-Report_2023-03-04_11PM.pdf"]


def _parse(name):
    return ir.parse_report((FIX / name).read_bytes())


def test_parse_2019_category_layout():
    df = _parse("2019-10-22_05PM.pdf")
    assert ir.report_time((FIX / "2019-10-22_05PM.pdf").read_bytes()) == datetime(
        2019, 10, 22, 17, 30
    )
    row = df[df["player_name"] == "Williamson, Zion"].iloc[0]
    assert (row["team_name"], row["status"], row["matchup"]) == (
        "New Orleans Pelicans",
        "Out",
        "NOP@TOR",
    )
    assert row["game_date"] == pd.Timestamp("2019-10-22")
    assert set(df["status"]) <= {*ir.STATUSES, ir.NOT_SUBMITTED}


def test_parse_2019_previous_status_layout():
    df = _parse("2019-12-01_08PM.pdf")
    claxton = df[df["player_name"] == "Claxton, Nicolas"].iloc[0]
    assert claxton["status"] == "Available"  # 'Probable' is the previous status, not the current
    jones = df[df["player_name"] == "Jones Jr., Derrick"].iloc[0]
    assert jones["team_name"] == "Miami Heat" and jones["status"] == "Available"


def test_parse_hourly_layout_with_unfiled_teams():
    df = _parse("2024-01-10_10AM.pdf")
    unfiled = df[df["status"] == ir.NOT_SUBMITTED]
    assert "Minnesota Timberwolves" in set(unfiled["team_name"])
    assert unfiled["player_name"].isna().all()
    assert df.loc[df["player_name"] == "Davison, JD", "status"].iloc[0] == "Out"


def test_parse_quarter_hourly_layout_and_pages_without_a_header():
    df = _parse("2026-11-20_10_00AM.pdf")
    assert ir.report_time((FIX / "2026-11-20_10_00AM.pdf").read_bytes()) == datetime(
        2026, 11, 20, 10
    )
    first = df.iloc[0]
    assert (first["player_name"], first["team_name"], first["status"]) == (
        "Ajayi, Michael",
        "Charlotte Hornets",
        "Out",
    )
    # The second page repeats no header: its rows are still read with the first page's columns.
    assert (df["matchup"] == "BOS@SAC").any()
    assert not df["team_name"].isin(["Team", "Matchup"]).any()


def test_name_keys():
    assert ir.name_key("Jones Jr., Derrick") == ir.name_key("Derrick Jones Jr.") == "derrickjones"
    assert ir.name_key("Schröder, Dennis") == ir.name_key("Dennis Schroder")
    assert ir.name_parts("Claxton, Nicolas") == ("nicolas", "claxton")
    assert ir.name_parts("Nic Claxton") == ("nic", "claxton")


def _pg(rows):
    return pd.DataFrame(rows, columns=["player_id", "player_name", "team_id", "game_date"]).assign(
        game_date=lambda d: pd.to_datetime(d["game_date"])
    )


def test_resolve_matches_team_roster_nicknames_and_trades():
    nets, heat = 1610612751, 1610612748
    games = pd.DataFrame(
        {
            "game_id": ["g1"],
            "game_date": [pd.Timestamp("2019-12-01")],
            "home_team_id": [nets],
            "away_team_id": [heat],
        }
    )
    pg = _pg(
        [
            (1, "Nic Claxton", nets, "2019-11-20"),
            (2, "Derrick Jones Jr.", heat, "2019-11-25"),
            (3, "Kyrie Irving", nets, "2019-11-14"),
            (4, "Kyrie Irving", 99, "2017-01-01"),  # an older namesake, outside the 400-day window
            (5, "Some One", heat, "2019-12-01"),  # played that night: must not be used
        ]
    )
    report = pd.DataFrame(
        {
            "game_date": pd.to_datetime(["2019-12-01"] * 5),
            "matchup": ["MIA@BKN"] * 5,
            "team_name": [
                "Brooklyn Nets",
                "Miami Heat",
                "Brooklyn Nets",
                "Miami Heat",
                "Miami Heat",
            ],
            "player_name": [
                "Claxton, Nicolas",
                "Jones Jr., Derrick",
                "Irving, Kyrie",
                "One, Some",
                None,
            ],
            "status": ["Available", "Available", "Out", "Out", ir.NOT_SUBMITTED],
            "reason": [None] * 5,
        }
    )
    out = ir.resolve(report, games, pg)
    assert out["player_id"].tolist()[:4] == [1, 2, 3, pd.NA]
    assert out["team_id"].tolist() == [nets, heat, nets, heat, heat]
    assert (out["game_id"] == "g1").all()


def test_ingest_refuses_when_nothing_is_ever_found(tmp_path):
    days = [date(2023, 1, d) for d in range(2, 12)]
    games = pd.DataFrame({"game_id": [], "game_date": [], "home_team_id": [], "away_team_id": []})
    with pytest.raises(RuntimeError, match="no injury report"):
        ir.ingest_history(
            days,
            games,
            _pg([]),
            tmp_path,
            store=_store(tmp_path, {}),
            which=("am",),
            now=datetime(2023, 2, 1, tzinfo=UTC),
        )


def test_ingest_skips_future_cutoffs(tmp_path):
    # 08:00 ET on game day: the morning cutoff (09:00) hasn't happened yet.
    now = datetime.combine(date(2023, 1, 2), time(13, 0), tzinfo=UTC)
    res = ir.ingest_history(
        [date(2023, 1, 2)],
        pd.DataFrame(),
        _pg([]),
        tmp_path,
        store=_store(tmp_path, {}),
        which=("am",),
        now=now,
    )
    assert res["snapshots"] == 0


def test_state_archive_carries_the_injury_tables_when_present(tmp_path):
    import io
    import tarfile

    from tipoff import state

    src = tmp_path / "src"
    src.mkdir()
    for name in state.STAGED_FILES:
        pd.DataFrame({"x": [1]}).to_parquet(src / name)
    old = state.pack_staged(src)  # an archive from before the injury tables existed
    state.unpack_staged(old, tmp_path / "a")
    assert not (tmp_path / "a" / "injury_reports.parquet").exists()
    for name in state.OPTIONAL_FILES:
        pd.DataFrame({"y": [2]}).to_parquet(src / name)
    state.unpack_staged(state.pack_staged(src), tmp_path / "b")
    for name in (*state.STAGED_FILES, *state.OPTIONAL_FILES):
        assert (tmp_path / "b" / name).read_bytes() == (src / name).read_bytes()

    extra = io.BytesIO()
    with tarfile.open(fileobj=extra, mode="w:gz") as tar:
        for name in (*state.STAGED_FILES, "other.parquet"):
            info = tarfile.TarInfo(name)
            info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
    with pytest.raises(state.StateError, match="Unexpected"):
        state.unpack_staged(extra.getvalue(), tmp_path / "c")
