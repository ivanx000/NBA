"""The injury report features (features/injury.py) on the synthetic league: listed players move
lineup strength the right way, only on their own game date, and only for teams that filed."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from synthetic import make_league
from tipoff.features.build import build_features, build_tables
from tipoff.features.elo import EloParams
from tipoff.features.injury import injury_features, player_injury_features
from tipoff.features.lineup import lineup_pairs
from tipoff.features.players import build_player_features, projection_candidates
from tipoff.features.timeline import prepare_games, team_timeline
from tipoff.teams import load_teams

PARAMS = EloParams(k=15, home_adv=0, hfa_mode="rolling", carryover=0.6, mov=True)
PROBS = {"Out": 0.0, "Doubtful": 0.1, "Questionable": 0.6, "Probable": 0.95, "Available": 1.0}
ABBR = {t["team_id"]: t["abbr"] for t in load_teams()}


@pytest.fixture(scope="module")
def league():
    return make_league()


@pytest.fixture(scope="module")
def tl(league):
    return team_timeline(prepare_games(league["games"]), league["team_games"]).reset_index(
        drop=True
    )


def _game_on(league, n=40):
    g = league["games"][league["games"]["season"] == "2015-16"].sort_values("game_date")
    return g.iloc[n]


def _star(league, team, day):
    """The team's best-rated player among those with 15+ recent minutes before ``day``."""
    tl = team_timeline(prepare_games(league["games"]), league["team_games"]).reset_index(drop=True)
    pairs = lineup_pairs(tl, league["player_games"])
    row = np.flatnonzero(((tl["team_id"] == team) & (tl["game_date"] == day)).to_numpy())[0]
    mine = pairs[(pairs["row"] == row) & (pairs["avg_min"] >= 15)]
    return int(mine.loc[mine["rating"].idxmax(), "player_id"])


def _report(game, rows, nys=()):
    """Staged-format rows for one game: [(team_id, player_id, status), ...]."""
    matchup = f"{ABBR[game.away_team_id]}@{ABBR[game.home_team_id]}"
    out = [
        {"game_date": game.game_date, "matchup": matchup, "team_id": t, "player_id": p,
         "player_name": f"P{p}", "status": s}
        for t, p, s in rows
    ] + [
        {"game_date": game.game_date, "matchup": matchup, "team_id": t, "player_id": pd.NA,
         "player_name": None, "status": "Not Submitted"}
        for t in nys
    ]  # fmt: skip
    df = pd.DataFrame(out)
    df["player_id"] = df["player_id"].astype("Int64")
    df["team_id"] = df["team_id"].astype("Int64")
    return df


def _row(tl, game, team):
    m = (tl["game_id"] == game.game_id) & (tl["team_id"] == team)
    return int(np.flatnonzero(m.to_numpy())[0])


def test_star_listed_out_lowers_strength_only_that_night(league, tl):
    game = _game_on(league)
    home, away = int(game.home_team_id), int(game.away_team_id)
    star = _star(league, home, game.game_date)
    pairs = lineup_pairs(tl, league["player_games"])
    feats = injury_features(tl, league["player_games"], pairs, _report(game, [(home, star, "Out")]),
                            PROBS)  # fmt: skip
    h, a = _row(tl, game, home), _row(tl, game, away)
    assert feats.loc[h, "injury_adj"] < 0
    assert feats.loc[h, "listed_out_min"] > 20  # his recent minutes per game
    assert feats.loc[h, "ir_filed"] == 1 and feats.loc[a, "ir_filed"] == 1
    assert feats.loc[a, "injury_adj"] == 0 and feats.loc[a, "listed_out_min"] == 0
    others = np.setdiff1d(np.arange(len(tl)), [h, a])
    assert (feats.loc[others, COLS] == 0).all().all()


COLS = ["injury_adj", "listed_out_min", "ir_filed"]


def test_questionable_counts_less_than_out(league, tl):
    game = _game_on(league)
    home = int(game.home_team_id)
    star = _star(league, home, game.game_date)
    pairs = lineup_pairs(tl, league["player_games"])
    h = _row(tl, game, home)
    out = injury_features(
        tl, league["player_games"], pairs, _report(game, [(home, star, "Out")]), PROBS
    )
    q = injury_features(tl, league["player_games"], pairs,
                        _report(game, [(home, star, "Questionable")]), PROBS)  # fmt: skip
    assert out.loc[h, "injury_adj"] < q.loc[h, "injury_adj"] < 0


def test_unfiled_team_and_no_report_mean_no_adjustment(league, tl):
    game = _game_on(league)
    home = int(game.home_team_id)
    star = _star(league, home, game.game_date)
    pairs = lineup_pairs(tl, league["player_games"])
    feats = injury_features(tl, league["player_games"], pairs,
                            _report(game, [(home, star, "Out")], nys=[home]), PROBS)  # fmt: skip
    h = _row(tl, game, home)
    assert feats.loc[h, "ir_filed"] == 0 and feats.loc[h, "injury_adj"] == 0
    none = injury_features(tl, league["player_games"], pairs, None, PROBS)
    assert (none[COLS] == 0).all().all()


def test_build_features_carries_the_report_through(league):
    game = _game_on(league)
    home = int(game.home_team_id)
    star = _star(league, home, game.game_date)
    rep = _report(game, [(home, star, "Out")])
    from tipoff.features import injury

    orig = injury.load_play_probs
    injury.load_play_probs = lambda: PROBS
    try:
        with_r = build_features(league["games"], league["team_games"], league["player_games"],
                                elo_params=PARAMS, injuries=rep).set_index("game_id")  # fmt: skip
    finally:
        injury.load_play_probs = orig
    without = build_features(league["games"], league["team_games"], league["player_games"],
                             elo_params=PARAMS).set_index("game_id")  # fmt: skip
    assert with_r.loc[game.game_id, "diff_injury_adj"] < 0
    assert with_r.loc[game.game_id, "home_ir_filed"] == 1
    assert without["diff_injury_adj"].eq(0).all()
    other = with_r.index != game.game_id
    pd.testing.assert_frame_equal(with_r[other], without[other])


def test_player_features_and_candidates(league, monkeypatch):
    from tipoff.features import injury

    monkeypatch.setattr(injury, "load_play_probs", lambda: PROBS)
    game = _game_on(league)
    home = int(game.home_team_id)
    day = game.game_date
    star = _star(league, home, day)
    rep = _report(game, [(home, star, "Out")])
    pg = league["player_games"]
    tables = build_tables(league["games"], league["team_games"], pg, elo_params=PARAMS,
                          injuries=rep)  # fmt: skip
    rows = pg[(pg["game_id"] == game.game_id)][["game_id", "game_date", "team_id", "player_id"]]
    feats = player_injury_features(rows, rep, tables.ir_players, PROBS)
    # (In the synthetic box score the star played anyway: his own row sees his listing.)
    me = rows["player_id"] == star
    assert (feats.loc[me, "own_play_prob"] == 0).all() and (
        feats.loc[me, "team_ir_out_min"] == 0
    ).all()
    mates = (rows["team_id"] == home) & ~me
    assert (feats.loc[mates, "own_play_prob"] == 1).all()  # nobody else listed
    assert (feats.loc[mates, "team_ir_out_min"] > 20).all()  # the star's minutes freed up
    assert (feats.loc[mates, "team_ir_out_max"] == feats.loc[mates, "team_ir_out_min"]).all()
    assert (feats.loc[~mates, "team_ir_out_min"] == 0).all()  # the other team filed, nobody out

    # Before the game: the star isn't a candidate any more.
    sched = pd.DataFrame([game])
    before = pg[pg["game_date"] < day]
    cand = projection_candidates(sched, before, rep)
    base = projection_candidates(sched, before)
    assert star in set(base["player_id"]) and star not in set(cand["player_id"])
    assert set(cand["player_id"]) == set(base["player_id"]) - {star}


def test_player_feature_table_has_missing_injury_inputs_without_reports(league):
    tables = build_tables(league["games"], league["team_games"], league["player_games"],
                          elo_params=PARAMS)  # fmt: skip
    df = build_player_features(tables, league["team_games"], league["player_games"])
    cols = ["own_play_prob", "team_ir_out_min", "team_ir_out_max", "team_ir_back_min"]
    assert df[cols].isna().all().all()


def test_a_player_out_for_weeks_frees_no_minutes(league, monkeypatch):
    """Listed Out again after missing the team's last 5 games: his minutes are already gone from
    the rotation, so nothing new is freed up and lineup strength doesn't move."""
    from tipoff.features import injury

    monkeypatch.setattr(injury, "load_play_probs", lambda: PROBS)
    games = league["games"][league["games"]["season"] == "2015-16"].sort_values("game_date")
    game = games.iloc[60]
    home = int(game.home_team_id)
    pg = league["player_games"]
    team_pg = pg[(pg["team_id"] == home) & (pg["game_date"] < game.game_date)]
    last6 = team_pg.drop_duplicates("game_id").nlargest(6, "game_date")["game_id"]
    hurt = int(team_pg["player_id"].iloc[0])
    # He's missed the team's last 6 games.
    pg = pg[~(pg["game_id"].isin(last6) & (pg["player_id"] == hurt))]
    gone = [hurt]
    rep = _report(game, [(home, gone[0], "Out")])
    tables = build_tables(league["games"], league["team_games"], pg, elo_params=PARAMS,
                          injuries=rep)  # fmt: skip
    team = tables.team.loc[(game.game_id, home)]
    assert team["listed_out_min"] == 0 and team["injury_adj"] == 0 and team["ir_filed"] == 1
