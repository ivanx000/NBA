import json

import numpy as np
import pandas as pd
import pytest

from synthetic import TRADE_TO, TRADED_PLAYER, make_league
from tipoff.features.availability import availability_features
from tipoff.features.build import build_features
from tipoff.features.columns import FEATURE_COLUMNS
from tipoff.features.elo import EloParams, expected_home, rate_to_elo_points, run_elo
from tipoff.features.lineup import lineup_features
from tipoff.features.schedule import haversine_km, schedule_features
from tipoff.features.team_form import K_SEASON, team_form
from tipoff.features.timeline import prepare_games, team_timeline

BOS, LAL, ATL = 1610612738, 1610612747, 1610612737


def _games(rows):
    df = pd.DataFrame(rows, columns=["game_id", "season", "game_date", "home_team_id",
                                     "away_team_id", "home_pts", "away_pts"])  # fmt: skip
    df["game_date"] = pd.to_datetime(df["game_date"])
    return df.assign(season_type="regular", is_neutral=False, played=True,
                     home_win=df["home_pts"] > df["away_pts"])  # fmt: skip


def test_elo_basics():
    assert expected_home(1500, 1500, 0) == pytest.approx(0.5)
    assert expected_home(1500, 1500, 70) > 0.5
    assert rate_to_elo_points(0.5) == 0
    g = _games([("1", "2015-16", "2015-11-01", BOS, LAL, 110, 100),
                ("2", "2015-16", "2015-11-03", LAL, BOS, 100, 90)])  # fmt: skip
    out = run_elo(g, EloParams(k=20, home_adv=50, mov=False)).set_index("game_id")
    assert out.loc["1", "elo_home"] == out.loc["1", "elo_away"] == 1505
    assert out.loc["2", "elo_away"] > 1505 > out.loc["2", "elo_home"]  # BOS gained after game 1
    assert out.loc["2", "elo_home"] + out.loc["2", "elo_away"] == pytest.approx(3010)


def test_elo_neutral_and_carryover():
    g = _games([("1", "2014-15", "2015-03-01", BOS, LAL, 130, 90),
                ("2", "2015-16", "2015-11-01", BOS, LAL, 100, 99)])  # fmt: skip
    g.loc[g["game_id"] == "2", "is_neutral"] = True
    out = run_elo(g, EloParams(k=20, carryover=0.5)).set_index("game_id")
    assert out.loc["1", "elo_home"] == 1505  # pre-game ratings: nothing played yet
    assert out.loc["2", "elo_hfa"] == 0
    assert 1505 < out.loc["2", "elo_home"] < 1505 + 20  # regressed halfway toward the mean


def test_elo_params_roundtrip(tmp_path):
    p = EloParams(k=12, home_adv=0, hfa_mode="rolling", carryover=0.45, mov=False)
    p.save(tmp_path / "elo.json", train_log_loss=0.6)
    assert EloParams.load(tmp_path / "elo.json") == p
    assert json.loads((tmp_path / "elo.json").read_text())["train_log_loss"] == 0.6


def test_schedule_rest_density_travel():
    g = _games([("1", "2015-16", "2015-11-01", BOS, ATL, 100, 90),
                ("2", "2015-16", "2015-11-02", LAL, BOS, 100, 90),
                ("3", "2015-16", "2015-11-04", ATL, BOS, 100, 90)])  # fmt: skip
    home = g.assign(team_id=g["home_team_id"], venue_team_id=g["home_team_id"])
    away = g.assign(team_id=g["away_team_id"], venue_team_id=g["home_team_id"])
    tl = pd.concat([home, away]).sort_values(["team_id", "game_date"]).reset_index(drop=True)
    sf = pd.concat([tl, schedule_features(tl)], axis=1)
    bos = sf[sf["team_id"] == BOS].set_index("game_id")
    assert bos.loc["1", "rest_days"] == 4 and bos.loc["1", "travel_km"] == 0
    assert bos.loc["2", "b2b"] == 1 and bos.loc["2", "travel_km"] > 4000  # Boston -> Los Angeles
    assert bos.loc["2", "tz_crossed"] == 3
    assert bos.loc["3", "three_in_four"] == 1 and bos.loc["3", "games_last7"] == 2
    assert haversine_km(0, 0, 0, 1) == pytest.approx(111.2, abs=0.1)


@pytest.fixture(scope="module")
def league():
    return make_league()


def test_first_game_form_equals_prior(league):
    games = prepare_games(league["games"])
    tl = team_timeline(games, league["team_games"])
    form = pd.concat([tl, team_form(tl)], axis=1)
    first = form[(form["season"] == "2015-16") & (form["games_played"] == 0)]
    prev = form[(form["season"] == "2014-15") & form["played"]]
    row = first.iloc[0]
    team = row["team_id"]
    prev_mean = prev.loc[prev["team_id"] == team, "net_rating"].mean()
    league_mean = prev["net_rating"].mean()
    assert row["net_rating_std"] == pytest.approx(prev_mean * 2 / 3 + league_mean / 3)
    # Blend weight grows with games played.
    later = form[(form["season"] == "2015-16") & (form["games_played"] == K_SEASON)].iloc[0]
    assert later["games_played"] == K_SEASON


def test_traded_player_is_not_counted_as_out(league):
    games = prepare_games(league["games"])
    tl = team_timeline(games, league["team_games"])
    av = pd.concat([tl, availability_features(tl, league["player_games"])], axis=1)
    pg = league["player_games"]
    trade_date = pg.loc[(pg["player_id"] == TRADED_PLAYER) & (pg["team_id"] == TRADE_TO),
                        "game_date"].min()  # fmt: skip
    bos_after = av[(av["team_id"] == BOS) & (av["game_date"] > trade_date)]
    assert (bos_after["out_min_share"] < 0.5).all()
    assert av["out_min_share"].between(0, 1).all()
    assert av["star_out"].isin([0, 1]).all()
    assert (av["out_min_share"] > 0).any()  # some rotation players do miss games


def test_build_shapes_and_upcoming(league):
    last_day = league["games"]["game_date"].max()
    upcoming = (
        league["games"].tail(2)
        .assign(game_id=["0021599998", "0021599999"], game_date=last_day + pd.Timedelta(days=2))
    )  # fmt: skip
    df = build_features(league["games"], league["team_games"], league["player_games"],
                        upcoming=upcoming[["game_id", "season", "season_type", "game_date",
                                           "home_team_id", "away_team_id", "is_neutral"]],
                        elo_params=EloParams(), first_season="2015-16")  # fmt: skip
    assert set(df["season"]) == {"2015-16"}
    assert df[FEATURE_COLUMNS].notna().all().all()
    assert df["home_win"].isna().sum() == (~df["played"]).sum() == 2
    assert np.isfinite(df[FEATURE_COLUMNS].to_numpy()).all()


def test_lineup_strength_drops_when_players_sit(league):
    """A team whose rotation sat out its last games looks weaker; the game's own box is unused."""
    games = prepare_games(league["games"])
    tl = team_timeline(games, league["team_games"])
    pg = league["player_games"]
    base = pd.concat([tl, lineup_features(tl, pg)], axis=1)
    team = tl["team_id"].iloc[0]
    rows = base[(base["team_id"] == team) & base["played"]].reset_index(drop=True)
    target = rows.iloc[60]
    recent = rows.iloc[55:60]["game_id"]
    stars = pg[pg["game_id"].isin(recent) & (pg["team_id"] == team)].nlargest(10, "minutes")
    benched = pg.drop(stars.index)
    after = pd.concat([tl, lineup_features(tl, benched)], axis=1)
    row = after[(after["game_id"] == target["game_id"]) & (after["team_id"] == team)].iloc[0]
    assert row["lineup_strength"] < target["lineup_strength"]
    # Tonight's own box score never counts.
    tonight = pg[(pg["game_id"] == target["game_id"]) & (pg["team_id"] == team)]
    same = pd.concat([tl, lineup_features(tl, pg.drop(tonight.index))], axis=1)
    row2 = same[(same["game_id"] == target["game_id"]) & (same["team_id"] == team)].iloc[0]
    assert row2["lineup_strength"] == pytest.approx(target["lineup_strength"])
