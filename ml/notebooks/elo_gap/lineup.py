"""Lineup strength. Player rating: decayed per-minute Game Score from games BEFORE this one,
shrunk to the league average. Team strength = sum over players of minutes x rating.
  expected (legal, pre-game): minutes = player's average over the team's previous 5 games
  actual   (ORACLE, diagnostic only): minutes actually played tonight"""

import numpy as np
import pandas as pd

from tipoff.config import STAGED_DIR


def build(half_games=25.0, prior_min=300.0):
    p = pd.read_parquet(STAGED_DIR / "player_games.parquet")
    p = p.sort_values(["player_id", "game_date", "game_id"]).reset_index(drop=True)
    gs = (
        p.pts
        + 0.4 * p.fgm
        - 0.7 * p.fga
        - 0.4 * (p.fta - p.ftm)
        + 0.7 * p.oreb
        + 0.3 * p.dreb
        + p.stl
        + 0.7 * p.ast
        + 0.7 * p.blk
        - 0.4 * p.pf
        - p.tov
    ).astype(float)
    league = (
        gs.sum() / p.minutes.sum()
    )  # per-minute league average (constant; small leak of scale only)
    d = 0.5 ** (1 / half_games)
    S = np.zeros(len(p))
    M = np.zeros(len(p))
    pid = p.player_id.to_numpy()
    g = gs.to_numpy()
    m = p.minutes.to_numpy().astype(float)
    s = mm = 0.0
    for i in range(len(p)):
        if i == 0 or pid[i] != pid[i - 1]:
            s = mm = 0.0
        S[i], M[i] = s, mm  # state BEFORE this game
        s = d * s + g[i]
        mm = d * mm + m[i]
    p["rating"] = (S + prior_min * league) / (M + prior_min)  # per-minute, pre-game
    # actual (oracle) strength per team-game
    p["act"] = p.minutes * p.rating
    act = p.groupby(["game_id", "team_id"]).act.sum()
    # expected: team's previous 5 games' minutes, current pre-game rating
    tg = (
        p[["game_id", "team_id", "game_date"]]
        .drop_duplicates()
        .sort_values(["team_id", "game_date", "game_id"])
    )
    tg["k"] = tg.groupby("team_id").cumcount()
    p = p.merge(tg[["game_id", "team_id", "k"]], on=["game_id", "team_id"])
    rows = []
    # A player's rating for game k: his latest known pre-game rating from before game k (it lags
    # one game: the previous game's own result isn't folded in yet).
    by_team = {t: x for t, x in p.groupby("team_id")}
    for t, x in by_team.items():
        x = x.sort_values("k")
        K = x.k.max()
        mins = (
            x.pivot_table(index="k", columns="player_id", values="minutes", aggfunc="sum")
            .reindex(range(K + 1))
            .fillna(0)
        )
        rat = (
            x.pivot_table(index="k", columns="player_id", values="rating", aggfunc="last")
            .reindex(range(K + 1))
            .ffill()
        )
        avg5 = mins.rolling(5, min_periods=1).mean().shift(1)  # previous 5 team games
        lastr = rat.shift(1).combine_first(rat)
        exp = (avg5 * lastr).sum(axis=1)
        keys = x.drop_duplicates("k").set_index("k").game_id
        rows.append(
            pd.DataFrame(
                {"game_id": keys.reindex(exp.index).to_numpy(), "team_id": t, "exp": exp.to_numpy()}
            )
        )
    exp = pd.concat(rows).set_index(["game_id", "team_id"]).exp
    return act, exp
