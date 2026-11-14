import shutil

import pandas as pd
import pandera.errors
import pytest

from tipoff.ingest.nba_stats import Endpoint
from tipoff.ingest.schemas import TeamGames
from tipoff.ingest.stage import (
    StagingError,
    build_team_games,
    load_raw,
    stage_all,
)

NEUTRAL_GAME = "0022400621"  # SAS vs IND in Paris: both rows say "@"


@pytest.fixture
def raw(tmp_path, fixtures):
    root = tmp_path / "raw"
    shutil.copytree(fixtures / "raw" / "stats", root)
    return root


def _stage(raw, tmp_path, **kw):
    return stage_all(
        raw_root=raw, cdn_root=tmp_path / "no-cdn", out_dir=tmp_path / "out",
        check_season_lengths=False, **kw,
    )  # fmt: skip


def test_stage_fixture_tables(raw, tmp_path):
    counts = _stage(raw, tmp_path)
    assert counts == {"team_games": 10, "games": 5, "player_games": 40}
    games = pd.read_parquet(tmp_path / "out" / "games.parquet")
    neutral = games.set_index("game_id").loc[NEUTRAL_GAME]
    assert neutral["is_neutral"]
    # No cdn schedule for 2024-25, so the lower team id is the designated home team.
    assert neutral["home_team_id"] == min(neutral["home_team_id"], neutral["away_team_id"])
    assert games["is_neutral"].sum() == 1
    players = pd.read_parquet(tmp_path / "out" / "player_games.parquet")
    teams = pd.read_parquet(tmp_path / "out" / "team_games.parquet")
    merged = players.merge(teams[["game_id", "team_id", "is_home"]], on=["game_id", "team_id"])
    assert (merged["is_home_x"] == merged["is_home_y"]).all()


def test_cdn_schedule_sets_neutral_home(raw):
    team_logs = load_raw(Endpoint.TEAM_LOGS, raw)
    adv = load_raw(Endpoint.TEAM_ADV_LOGS, raw)
    ids = team_logs.loc[team_logs["GAME_ID"] == NEUTRAL_GAME, "TEAM_ID"]
    chosen = int(ids.max())  # the higher id, to prove the cdn value wins over the fallback
    tg = build_team_games(team_logs, adv, cdn_homes={NEUTRAL_GAME: chosen})
    home = tg[(tg["game_id"] == NEUTRAL_GAME) & tg["is_home"]]
    assert home["team_id"].tolist() == [chosen]


def test_other_game_types_are_dropped(raw, tmp_path):
    path = raw / "team_logs" / "2024-25" / "regular.parquet"
    df = pd.read_parquet(path)
    cup_final = df.head(2).assign(GAME_ID="0062400001")
    pd.concat([df, cup_final]).to_parquet(path, index=False)
    assert _stage(raw, tmp_path)["games"] == 5


def test_game_id_contradicting_season_type_fails(raw, tmp_path):
    src = raw / "team_logs" / "2024-25" / "regular.parquet"
    dst = raw / "team_logs" / "2024-25" / "playoffs.parquet"
    shutil.copy(src, dst)  # regular-season game ids filed under playoffs
    with pytest.raises(StagingError, match="contradicts"):
        _stage(raw, tmp_path)


def test_schema_rejects_inconsistent_scores(raw):
    tg = build_team_games(load_raw(Endpoint.TEAM_LOGS, raw), load_raw(Endpoint.TEAM_ADV_LOGS, raw))
    TeamGames.validate(tg)
    broken = tg.copy()
    broken.loc[0, "win"] = not broken.loc[0, "win"]
    with pytest.raises(pandera.errors.SchemaErrors):
        TeamGames.validate(broken, lazy=True)


def test_missing_raw_data_is_clear(tmp_path):
    with pytest.raises(StagingError, match="tipoff ingest"):
        load_raw(Endpoint.TEAM_LOGS, tmp_path)
