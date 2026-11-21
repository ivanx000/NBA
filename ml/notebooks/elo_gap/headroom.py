import sys

import numpy as np
import pandas as pd

D = str(__import__("pathlib").Path(__file__).parent)
sys.path.insert(0, D)
import rolling as R0
from lineup import build

act, exp = build()
df = R0.df


def pair(s, side):
    return pd.MultiIndex.from_arrays([df.game_id, df[f"{side}_team_id"]])


df["lineup_exp_diff"] = (
    exp.reindex(pair(exp, "home")).to_numpy() - exp.reindex(pair(exp, "away")).to_numpy()
)
df["lineup_act_diff"] = (
    act.reindex(pair(act, "home")).to_numpy() - act.reindex(pair(act, "away")).to_numpy()
)
df["lineup_surprise"] = df.lineup_act_diff - df.lineup_exp_diff
print(df[["lineup_exp_diff", "lineup_act_diff"]].describe().round(2).to_string())
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
res = [
    R0.rolling(lambda: R0.Anchored(sel, 1000), "compact"),
    R0.rolling(lambda: R0.Anchored(sel + ["lineup_exp_diff"], 1000), "compact + lineup (legal)"),
    R0.rolling(
        lambda: R0.Anchored(sel + ["lineup_exp_diff", "lineup_surprise"], 1000),
        "ORACLE: + tonight's real minutes",
    ),
]
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
        f"{m:34s} vs elo {d.mean():+.4f} ± {1.96 * d.std() / np.sqrt(len(d)):.4f}  better {(per < 0).sum()}/6  acc {x.acc.mean():.4f}"
    )
