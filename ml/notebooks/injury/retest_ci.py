"""Paired bootstrap for the 2025-26 re-test (run once, after `tipoff evaluate --test --force-retest`).

Refits exactly what the test refit (2015-16..2024-25, calibrators out of time on 2024-25) for v4
(the current config), v3 (v3's config and adjustment inputs) and Elo, and reports the per-game log
loss gaps with 95% intervals (10,000 paired resamples of games). Nothing here is used to choose or
tune anything. Usage: uv run python notebooks/injury/retest_ci.py V3_CONFIG.json, where
V3_CONFIG.json is v3's settings (`git show b1a0e39:ml/config/game_model.json`).
"""

import json
import sys
from pathlib import Path

import numpy as np

from tipoff.config import REPORTS_DIR, TEST_SEASON, VALID_SEASON
from tipoff.features.columns import ANCHOR_FEATURES
from tipoff.models import baselines
from tipoff.models.data import load_features, make_split, seasons_through
from tipoff.models.final import fit_calibrated, load_config

V3_ANCHOR = [c for c in ANCHOR_FEATURES if c not in ("diff_injury_adj", "diff_listed_out_min")]


def ll(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def main(v3_cfg_path: str) -> None:
    df, _ = load_features()
    fit = make_split(df, "fit", seasons_through(VALID_SEASON))
    test = make_split(df, "test", (TEST_SEASON,))
    y = test.y.to_numpy()

    import tipoff.models.game_outcome as go

    p = {
        "v4": fit_calibrated(load_config(), df, "anchored", fit, VALID_SEASON).predict_proba(test.X)
    }
    v3_cfg = json.loads(Path(v3_cfg_path).read_text())
    orig = go.ANCHOR_FEATURES
    go.ANCHOR_FEATURES = V3_ANCHOR  # v3's adjustment inputs
    try:
        p["v3"] = fit_calibrated(v3_cfg, df, "anchored", fit, VALID_SEASON).predict_proba(test.X)
    finally:
        go.ANCHOR_FEATURES = orig
    p["Elo"] = baselines.elo_logistic().fit(fit.X, fit.y).predict_proba(test.X)[:, 1]

    rng = np.random.default_rng(26)
    idx = rng.integers(0, len(y), size=(10_000, len(y)))
    out = {"n_games": len(y)}
    for a, b in (("v4", "Elo"), ("v4", "v3"), ("v3", "Elo")):
        d = ll(y, p[a]) - ll(y, p[b])
        boots = d[idx].mean(axis=1)
        out[f"{a} - {b}"] = {
            "log_loss_gap": round(float(d.mean()), 4),
            "ci95": [round(float(np.quantile(boots, 0.025)), 4),
                     round(float(np.quantile(boots, 0.975)), 4)],
            "share_of_resamples_better": round(float((boots < 0).mean()), 3),
        }  # fmt: skip
    for k, v in p.items():
        out[f"{k} log loss / accuracy"] = [round(float(ll(y, v).mean()), 4),
                                           round(float(((v >= 0.5) == y).mean()), 4)]  # fmt: skip
    out["correlation v4 vs Elo"] = round(float(np.corrcoef(p["v4"], p["Elo"])[0, 1]), 3)
    path = REPORTS_DIR / "test_2025-26_bootstrap.json"
    path.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
