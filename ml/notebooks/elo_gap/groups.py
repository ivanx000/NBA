import sys

import numpy as np
import pandas as pd

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from rolling import FEATURE_COLUMNS, Anchored, ll, rolling

F = [c for c in FEATURE_COLUMNS if c not in ("elo_diff", "elo_prob_home", "elo_hfa")]
G = {
    "std": [c for c in F if c.endswith("_std")],
    "l10": [c for c in F if c.endswith("_l10")],
    "short": [c for c in F if c.endswith("_l5") or c.endswith("_ewm")],
    "sched": [
        c
        for c in F
        if any(
            k in c
            for k in ("rest_days", "b2b", "three_in_four", "travel_km", "tz_crossed", "games_last7")
        )
    ],
    "avail": [c for c in F if "out_min_share" in c or "star_out" in c],
    "venue": [c for c in F if "venue" in c],
    "misc": ["is_neutral_f", "season_progress"],
}
assert sorted(sum(G.values(), [])) == sorted(F), set(F) - set(sum(G.values(), []))
res = [rolling(lambda: Anchored([], 0), "elo_only_anchor")]
for g, cols in G.items():
    res.append(rolling(lambda cols=cols: Anchored(cols, 300), f"only_{g}"))
    res.append(
        rolling(lambda cols=cols: Anchored([c for c in F if c not in cols], 300), f"drop_{g}")
    )
R = pd.concat(res)
R["ll"] = ll(R["y"], R["p"])
base = pd.read_parquet(sys.argv[1])
base["ll"] = ll(base["y"], base["p"])
elo = base[base.model == "elo"].set_index("game_id")["ll"]
rows = []
for m in R.model.unique():
    d = R[R.model == m].set_index("game_id")["ll"] - elo
    per = (
        R[R.model == m].groupby("season")["ll"].mean()
        - base[base.model == "elo"].groupby("season")["ll"].mean()
    )
    rows.append((m, d.mean(), 1.96 * d.std() / np.sqrt(len(d)), (per < 0).sum()))
for m, mu, se, wins in sorted(rows, key=lambda r: r[1]):
    print(f"{m:22s} vs elo {mu:+.4f} ± {se:.4f}   seasons better than elo: {wins}/6")
