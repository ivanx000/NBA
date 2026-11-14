import json

import pandas as pd

from tipoff.ingest.nba_cdn import parse_schedule, parse_scoreboard


def test_parse_schedule(fixtures):
    df = parse_schedule(json.loads((fixtures / "cdn_schedule.json").read_text()))
    assert len(df) == 3
    assert set(df["season"]) == {"2026-27"}
    final = df[df["status"] == "final"]
    scheduled = df[df["status"] == "scheduled"]
    assert final["home_score"].notna().all()
    assert scheduled["home_score"].isna().all()  # cdn says 0-0 before tip-off
    assert df.loc[df["game_id"] == "0022600189", "is_neutral"].item()
    assert df["tipoff_utc"].dt.tz is not None


def test_parse_scoreboard(fixtures):
    df = parse_scoreboard(json.loads((fixtures / "cdn_scoreboard.json").read_text()))
    assert len(df) == 2
    assert df["game_id"].str.match(r"^\d{10}$").all()
    assert isinstance(df["game_date"].iloc[0], type(pd.Timestamp("2026-11-14").date()))
