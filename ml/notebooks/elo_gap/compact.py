import sys

import numpy as np
import pandas as pd

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from rolling import FEATURE_COLUMNS, Anchored, ll, rolling

F = [c for c in FEATURE_COLUMNS if c not in ("elo_diff", "elo_prob_home", "elo_hfa")]
sched = [
    c
    for c in F
    if any(
        k in c
        for k in ("rest_days", "b2b", "three_in_four", "travel_km", "tz_crossed", "games_last7")
    )
]
avail = [c for c in F if "out_min_share" in c or "star_out" in c]
l10 = [c for c in F if c.endswith("_l10")]
venue = [c for c in F if "venue" in c]
short = [c for c in F if c.endswith("_l5") or c.endswith("_ewm")]
sets = {
    "sched+avail": sched + avail,
    "sched+avail+l10": sched + avail + l10,
    "sched+avail+l10+venue": sched + avail + l10 + venue,
    "sched+avail+short+venue": sched + avail + short + venue,
    "all_but_std": [c for c in F if not c.endswith("_std")],
}
res = []
for name, cols in sets.items():
    for lam in (30, 100, 300, 1000):
        res.append(rolling(lambda cols=cols, lam=lam: Anchored(cols, lam), f"{name} lam{lam}"))
R = pd.concat(res)
R["ll"] = ll(R["y"], R["p"])
R["acc"] = ((R["p"] > 0.5) == R["y"]).astype(float)
base = pd.read_parquet(sys.argv[1])
base["ll"] = ll(base["y"], base["p"])
base["acc"] = ((base["p"] > 0.5) == base["y"]).astype(float)
elo = base[base.model == "elo"].set_index("game_id")["ll"]
cur = base[base.model == "current_logreg_c0.1"]
print(
    f"{'current_logreg_c0.1':32s} vs elo {(cur.set_index('game_id')['ll'] - elo).mean():+.4f}  acc {cur.acc.mean():.4f}  elo acc {base[base.model == 'elo'].acc.mean():.4f}"
)
rows = []
for m in R.model.unique():
    x = R[R.model == m]
    d = x.set_index("game_id")["ll"] - elo
    per = (
        x.groupby("season")["ll"].mean() - base[base.model == "elo"].groupby("season")["ll"].mean()
    )
    rows.append(
        (m, d.mean(), 1.96 * d.std() / np.sqrt(len(d)), (per < 0).sum(), x.acc.mean(), per.max())
    )
for m, mu, se, w, acc, worst in sorted(rows, key=lambda r: r[1])[:12]:
    print(
        f"{m:32s} vs elo {mu:+.4f} ± {se:.4f}  better {w}/6  worst season {worst:+.4f}  acc {acc:.4f}"
    )
