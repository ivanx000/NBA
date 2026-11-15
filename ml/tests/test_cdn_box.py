import json
import shutil

import pandas as pd
import pytest

from tipoff.ingest.cdn_box import (
    ingest_boxscores,
    iso_minutes,
    missing_final_games,
    parse_boxscore,
    round_half_up,
)
from tipoff.ingest.nba_stats import Endpoint
from tipoff.ingest.stage import load_raw, stage_all, stage_incremental


@pytest.fixture
def box(fixtures):
    return json.loads((fixtures / "cdn_boxscore.json").read_text())


def test_minutes_parsing_and_rounding():
    assert iso_minutes("PT32M31.00S") == pytest.approx(32 + 31 / 60)
    assert iso_minutes("PT240M00.00S") == 240
    assert iso_minutes("") == 0
    assert round_half_up(23.5) == 24 and round_half_up(22.5) == 23 and round_half_up(22.49) == 22
    with pytest.raises(ValueError):
        iso_minutes("32:31")


def test_parse_boxscore_matches_stats_conventions(box):
    teams, players = parse_boxscore(box, "2026-11-13", "2026-27")
    g = box["game"]
    home = teams.set_index("TEAM_ID").loc[g["homeTeam"]["teamId"]]
    stats = g["homeTeam"]["statistics"]
    assert home["TOV"] == stats["turnoversTotal"]  # includes team turnovers
    assert home["REB"] == stats["reboundsOffensive"] + stats["reboundsDefensive"]
    assert home["MATCHUP"] == f"{g['homeTeam']['teamTricode']} vs. {g['awayTeam']['teamTricode']}"
    assert set(teams["WL"]) == {"W", "L"} and teams["PLUS_MINUS"].sum() == 0
    assert teams["MIN"].iloc[0] >= 240
    played = sum(p["played"] == "1" for s in ("homeTeam", "awayTeam") for p in g[s]["players"])
    assert len(players) == played
    assert players["MIN"].dtype.kind == "i"
    assert (
        players.groupby("TEAM_ID")["PTS"].sum().to_dict()
        == teams.set_index("TEAM_ID")["PTS"].to_dict()
    )


def test_neutral_site_lists_both_teams_as_away(box):
    teams, _ = parse_boxscore(box, "2026-11-13", "2026-27", is_neutral=True)
    assert teams["MATCHUP"].str.contains(" @ ").all()


def test_missing_final_games():
    schedule = pd.DataFrame({
        "game_id": ["0022600001", "0022600002", "0022600003", "0012600009"],
        "status": ["final", "final", "scheduled", "final"],
        "game_date": pd.to_datetime(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-03"]).date,
    })  # fmt: skip
    staged = pd.DataFrame({"game_id": ["0022600001"]})
    assert missing_final_games(schedule, staged)["game_id"].tolist() == ["0022600002"]


def test_ingest_boxscores_writes_raw_files(box, tmp_path):
    calls = []

    def fake_fetch(url):
        calls.append(url)
        return box

    games = pd.DataFrame({"game_id": [box["game"]["gameId"]], "game_date": ["2026-11-13"],
                          "season": ["2026-27"], "is_neutral": [False]})  # fmt: skip
    _teams, players = ingest_boxscores(games, root=tmp_path, fetch=fake_fetch)
    assert len(calls) == 1 and "boxscore_" in calls[0]
    assert len(pd.read_parquet(tmp_path / "team_logs" / "2026-27.parquet")) == 2
    assert len(pd.read_parquet(tmp_path / "player_logs" / "2026-27.parquet")) == len(players)


def test_incremental_staging_equals_full_staging(tmp_path, fixtures):
    raw = tmp_path / "raw"
    shutil.copytree(fixtures / "raw" / "stats", raw)
    full_dir, inc_dir = tmp_path / "full", tmp_path / "inc"
    stage_all(raw_root=raw, cdn_root=tmp_path / "no-cdn", out_dir=full_dir,
              check_season_lengths=False)  # fmt: skip
    team_logs = load_raw(Endpoint.TEAM_LOGS, raw)
    player_logs = load_raw(Endpoint.PLAYER_LOGS, raw)
    last = team_logs["GAME_ID"].max()
    inc_dir.mkdir()
    for name in ("games", "team_games", "player_games"):
        df = pd.read_parquet(full_dir / f"{name}.parquet")
        df[df["game_id"] != last].to_parquet(inc_dir / f"{name}.parquet", index=False)
    new_t = team_logs[team_logs["GAME_ID"] == last].drop(columns=["season", "requested_type"])
    new_p = player_logs[player_logs["GAME_ID"] == last].drop(columns=["season", "requested_type"])
    stage_incremental(new_t.assign(SEASON="2024-25"), new_p.assign(SEASON="2024-25"),
                      staged_dir=inc_dir, cdn_root=tmp_path / "no-cdn",
                      check_season_lengths=False)  # fmt: skip
    for name, keys in (("team_games", ["game_id", "team_id"]), ("games", ["game_id"]),
                       ("player_games", ["game_id", "player_id"])):  # fmt: skip
        a = pd.read_parquet(full_dir / f"{name}.parquet").sort_values(keys).reset_index(drop=True)
        b = pd.read_parquet(inc_dir / f"{name}.parquet").sort_values(keys).reset_index(drop=True)
        pd.testing.assert_frame_equal(a, b, check_like=True)
