import sys

import numpy as np
import pandas as pd

D = str(__import__("pathlib").Path(__file__).parent)
sys.path.insert(0, D)
import rolling as R0
from margin import load_games, margin_rating

g = load_games()
tune = ["2016-17", "2017-18", "2018-19"]
mrs = {hl: margin_rating(g, hl, 4.0).set_index("game_id")["mr_margin"] for hl in (80, 120, 160)}
for hl, s in mrs.items():
    R0.df[f"mr{hl}"] = R0.df["game_id"].map(s)
e = R0.df[R0.df.season.isin(tune)]

y = e.home_win.astype(int).to_numpy()
p = e.elo_prob_home.to_numpy()
print(
    "elo raw ll on tune seasons", round(float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))), 4)
)
F = [c for c in R0.FEATURE_COLUMNS if c not in ("elo_diff", "elo_prob_home", "elo_hfa")]
sel = [
    c
    for c in F
    if any(
        k in c
        for k in (
            "rest_days",
            "b2b",
            "three_in_four",
            "travel_km",
            "tz_crossed",
            "games_last7",
            "out_min_share",
            "star_out",
            "venue",
        )
    )
] + [c for c in F if c.endswith("_l10")]
res = []
for hl in (80, 120, 160):
    res.append(R0.rolling(lambda hl=hl: R0.Anchored([f"mr{hl}"], 1e-6), f"elo+mr{hl}"))
    res.append(
        R0.rolling(lambda hl=hl: R0.Anchored(sel + [f"mr{hl}"], 1000), f"compact+mr{hl} lam1000")
    )
    res.append(
        R0.rolling(lambda hl=hl: R0.Anchored(sel + [f"mr{hl}"], 300), f"compact+mr{hl} lam300")
    )
res.append(R0.rolling(lambda: R0.Anchored(sel, 1000), "compact lam1000"))
R = pd.concat(res)
R["ll"] = R0.ll(R["y"], R["p"])
R["acc"] = ((R["p"] > 0.5) == R["y"]).astype(float)
base = pd.read_parquet(sys.argv[1])
base["ll"] = R0.ll(base["y"], base["p"])
elo = base[base.model == "elo"].set_index("game_id")["ll"]
eps = base[base.model == "elo"].groupby("season")["ll"].mean()
for m in R.model.unique():
    x = R[R.model == m]
    d = x.set_index("game_id")["ll"] - elo
    per = x.groupby("season")["ll"].mean() - eps
    print(
        f"{m:26s} vs elo {d.mean():+.4f} ± {1.96 * d.std() / np.sqrt(len(d)):.4f}  better {(per < 0).sum()}/6 worst {per.max():+.4f} acc {x.acc.mean():.4f}"
    )
R.to_parquet(D + "/r2.parquet")
