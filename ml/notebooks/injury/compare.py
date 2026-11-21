"""Injury report study: does the official report improve the game model? (rolling validation)

Each season 2019-20..2024-25 is predicted by a model trained only on the seasons before it, exactly
like v3's selection (models/train_game.rolling_validation). The 2025-26 test season is never
touched. Variants of the Elo-anchored model (Platt calibration isn't part of rolling validation):

- v3: v3's adjustment inputs
- +adj: + diff_injury_adj (lineup strength recomputed from the morning report)
- +adj+lost: + diff_listed_out_min
- +adj+lost+filed: + home/away_ir_filed

Each is trained on the morning snapshot and scored on the morning (09:00 ET) and evening (17:45 ET)
snapshots. Results are logged to MLflow (experiment "injury-report-study") and written to
ml/reports/injury_report_study.json.

Usage: uv run python notebooks/injury/compare.py AM_FEATURES.parquet PM_FEATURES.parquet
"""

import json
import sys

import mlflow
import numpy as np
import pandas as pd
from scipy.special import expit

from tipoff.config import REPORTS_DIR
from tipoff.features.columns import ANCHOR_FEATURES, FEATURE_COLUMNS, TARGET
from tipoff.models import baselines
from tipoff.models.data import make_split, seasons_through
from tipoff.models.game_outcome import GameModel
from tipoff.models.train_baselines import setup_mlflow
from tipoff.models.train_game import _prev, rolling_seasons

V3 = list(ANCHOR_FEATURES)
VARIANTS = {
    "v3": V3,
    "+adj": [*V3, "diff_injury_adj"],
    "+adj+lost": [*V3, "diff_injury_adj", "diff_listed_out_min"],
    "+adj+lost+filed": [*V3, "diff_injury_adj", "diff_listed_out_min", "home_ir_filed",
                        "away_ir_filed"],
}  # fmt: skip
LAMBDAS = (100.0, 300.0)


def ll(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def rolling(am: pd.DataFrame, pm: pd.DataFrame, make) -> pd.DataFrame:
    out = []
    for season in rolling_seasons():
        fit = make_split(am, "fit", seasons_through(_prev(season)))
        m = make().fit(fit.X, fit.y)
        for snap, df in (("am", am), ("pm", pm)):
            t = make_split(df, "target", (season,))
            p = expit(m.raw(t.X)) if isinstance(m, GameModel) else m.predict_proba(t.X)[:, 1]
            out.append(pd.DataFrame({"game_id": t.meta["game_id"].to_numpy(), "season": season,
                                     "snapshot": snap, "y": t.y.to_numpy(), "p": p}))  # fmt: skip
    return pd.concat(out, ignore_index=True)


class EloOnly:
    def fit(self, X, y):
        self.m = baselines.elo_logistic().fit(X, y)
        return self

    def predict_proba(self, X):
        return self.m.predict_proba(X)


def main(am_path: str, pm_path: str) -> None:
    am, pm = pd.read_parquet(am_path), pd.read_parquet(pm_path)
    assert (am["game_id"] == pm["game_id"]).all()
    results = {"elo": rolling(am, pm, EloOnly)}
    home = am[am["played"]][["game_id", TARGET]]
    for name, feats in VARIANTS.items():
        for lam in LAMBDAS:
            results[f"{name} λ{lam:g}"] = rolling(
                am, pm, lambda f=feats, lam=lam: GameModel("anchored", anchor_lambda=lam,
                                                           anchor_features=f))  # fmt: skip

    summary = {}
    for snap in ("am", "pm"):
        elo = results["elo"].query("snapshot == @snap").set_index("game_id")
        elo_ll = ll(elo["y"], elo["p"])
        v3 = results["v3 λ100"].query("snapshot == @snap").set_index("game_id")
        v3_ll = ll(v3["y"], v3["p"])
        rows = {}
        for name, r in results.items():
            x = r.query("snapshot == @snap").set_index("game_id")
            x_ll = ll(x["y"], x["p"])
            d_elo, d_v3 = (x_ll - elo_ll), (x_ll - v3_ll)
            per = x.assign(d=d_elo).groupby("season")["d"].mean()
            per_v3 = x.assign(d=d_v3).groupby("season")["d"].mean()
            rows[name] = {
                "log_loss": float(x_ll.mean()),
                "accuracy": float(((x["p"] >= 0.5) == x["y"]).mean()),
                "vs_elo": float(d_elo.mean()),
                "vs_elo_ci95": float(1.96 * d_elo.std() / np.sqrt(len(d_elo))),
                "seasons_better_than_elo": int((per < 0).sum()),
                "vs_v3": float(d_v3.mean()),
                "vs_v3_ci95": float(1.96 * d_v3.std() / np.sqrt(len(d_v3))),
                "seasons_better_than_v3": int((per_v3 < 0).sum()),
                "vs_v3_by_season": {k: round(float(v), 5) for k, v in per_v3.items()},
            }
        hw = home.set_index("game_id").loc[elo.index, TARGET].astype(int)
        rows["home team"] = {"log_loss": None, "accuracy": float(hw.mean())}
        summary[snap] = rows

    setup_mlflow("injury-report-study")
    for snap, rows in summary.items():
        for name, r in rows.items():
            if r.get("log_loss") is None:
                continue
            with mlflow.start_run(run_name=f"{name} [{snap}]"):
                mlflow.log_params({"variant": name, "snapshot": snap,
                                   "seasons": f"{rolling_seasons()[0]}..{rolling_seasons()[-1]}"})  # fmt: skip
                mlflow.log_metrics({k: v for k, v in r.items() if isinstance(v, float)})
    out = REPORTS_DIR / "injury_report_study.json"
    out.write_text(json.dumps(summary, indent=2))
    for snap, rows in summary.items():
        print(f"\n== {snap} snapshot ==")
        for name, r in rows.items():
            if r.get("log_loss") is None:
                print(f"{name:24s} acc {r['accuracy']:.4f}")
                continue
            print(
                f"{name:24s} ll {r['log_loss']:.5f}  vs Elo {r['vs_elo']:+.5f} ±{r['vs_elo_ci95']:.4f} "
                f"({r['seasons_better_than_elo']}/6)  vs v3 {r['vs_v3']:+.5f} ±{r['vs_v3_ci95']:.4f} "
                f"({r['seasons_better_than_v3']}/6)  acc {r['accuracy']:.4f}"
            )
    print(f"\nwrote {out}; checked columns: {len(FEATURE_COLUMNS)} features")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
