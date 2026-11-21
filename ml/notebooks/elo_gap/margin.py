"""Margin rating: ridge regression of point margins on team indicators (+ home edge), with
exponentially decaying weights on older games. Pre-game only: each date uses games before it."""

from pathlib import Path

import numpy as np
import pandas as pd

from tipoff.config import STAGED_DIR
from tipoff.features.timeline import prepare_games


def load_games():
    g = prepare_games(pd.read_parquet(Path(STAGED_DIR) / "games.parquet"))
    return g


def margin_rating(g, half_life=40.0, lam=4.0, cap=30.0):
    g = g.sort_values(["game_date", "game_id"]).reset_index(drop=True)
    teams = sorted(set(g.home_team_id) | set(g.away_team_id))
    ix = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    H = n  # last column = home edge
    A = np.zeros((n + 1, n + 1))
    b = np.zeros(n + 1)
    reg = np.eye(n + 1) * lam
    reg[H, H] = 1e-3
    pred = np.full(len(g), np.nan)
    last = None
    for d, day in g.groupby("game_date", sort=True):
        if last is not None:
            f = 0.5 ** ((pd.Timestamp(d) - pd.Timestamp(last)).days / half_life)
            A *= f
            b *= f
        # sum-to-zero handled by ridge toward 0
        r = np.linalg.solve(A + reg, b)
        for i, row in day.iterrows():
            h, a = ix[row.home_team_id], ix[row.away_team_id]
            pred[i] = r[h] - r[a] + (0.0 if row.is_neutral else r[H])
        for _, row in day[day.played].iterrows():
            x = np.zeros(n + 1)
            x[ix[row.home_team_id]] = 1
            x[ix[row.away_team_id]] = -1
            if not row.is_neutral:
                x[H] = 1
            m = float(np.clip(row.home_pts - row.away_pts, -cap, cap))
            A += np.outer(x, x)
            b += x * m
        last = d
    return pd.DataFrame({"game_id": g.game_id, "mr_margin": pred})


if __name__ == "__main__":
    from sklearn.linear_model import LogisticRegression

    g = load_games()
    tune = ["2016-17", "2017-18", "2018-19"]  # before every evaluated season
    for hl in (20, 40, 80, 160):
        for lam in (1, 4, 16):
            m = margin_rating(g, hl, lam).merge(
                g[["game_id", "season", "season_type", "home_win", "played"]], on="game_id"
            )
            m = m[m.season.isin(tune) & (m.season_type == "regular") & m.played].dropna()
            lr = LogisticRegression().fit(m[["mr_margin"]], m.home_win.astype(int))
            p = lr.predict_proba(m[["mr_margin"]])[:, 1]
            y = m.home_win.astype(int).to_numpy()
            print(hl, lam, round(float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))), 4))
