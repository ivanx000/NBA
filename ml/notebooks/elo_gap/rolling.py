"""Rolling out-of-time comparison: each season predicted by models trained on all earlier seasons.
Never touches the test season (2025-26) or later."""

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit, logit
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler

from tipoff.features.columns import FEATURE_COLUMNS, TARGET
from tipoff.models.baselines import elo_logistic, logreg
from tipoff.models.data import load_features

df, _ = load_features()
df = df[df["played"]].copy()
SEASONS = [
    "2015-16",
    "2016-17",
    "2017-18",
    "2018-19",
    "2019-20",
    "2020-21",
    "2021-22",
    "2022-23",
    "2023-24",
    "2024-25",
]
EVAL = SEASONS[4:]


def ll(y, p):
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


class Anchored:
    """logit p = a * logit(elo) + b + w . z ; L2 penalty lam on w only."""

    def __init__(self, feats, lam):
        self.feats, self.lam = feats, lam

    def fit(self, X, y):
        self.imp = SimpleImputer(strategy="median").fit(X[self.feats]) if self.feats else None
        Z = self.scale_fit(X)
        e = logit(np.clip(X["elo_prob_home"].to_numpy(), 1e-6, 1 - 1e-6))
        y = y.to_numpy()
        k = Z.shape[1]

        def f(t):
            a, b, w = t[0], t[1], t[2:]
            s = a * e + b + Z @ w
            p = expit(s)
            loss = np.sum(np.logaddexp(0, s) - y * s) + 0.5 * self.lam * np.sum(w * w)
            g = p - y
            return loss, np.r_[g @ e, g.sum(), Z.T @ g + self.lam * w]

        self.t = minimize(f, np.r_[1.0, 0.0, np.zeros(k)], jac=True, method="L-BFGS-B").x
        return self

    def scale_fit(self, X):
        if not self.feats:
            self.sc = None
            return np.zeros((len(X), 0))
        A = self.imp.transform(X[self.feats])
        self.sc = StandardScaler().fit(A)
        return self.sc.transform(A)

    def Z(self, X):
        if not self.feats:
            return np.zeros((len(X), 0))
        return self.sc.transform(self.imp.transform(X[self.feats]))

    def predict(self, X):
        e = logit(np.clip(X["elo_prob_home"].to_numpy(), 1e-6, 1 - 1e-6))
        return expit(self.t[0] * e + self.t[1] + self.Z(X) @ self.t[2:])


def rolling(make, label):
    rows = []
    for s in EVAL:
        tr = df[df["season"].isin(SEASONS[: SEASONS.index(s)])]
        te = df[df["season"] == s]
        m = make().fit(tr, tr[TARGET].astype(int))
        p = (
            m.predict(te)
            if hasattr(m, "predict") and not hasattr(m, "predict_proba")
            else m.predict_proba(te)[:, 1]
        )
        rows.append(
            pd.DataFrame(
                {
                    "season": s,
                    "y": te[TARGET].astype(int).to_numpy(),
                    "p": p,
                    "game_id": te["game_id"].to_numpy(),
                }
            )
        )
    out = pd.concat(rows)
    out["model"] = label
    return out


class SK:
    def __init__(self, pipe, cols):
        self.pipe, self.cols = pipe, cols

    def fit(self, X, y):
        self.pipe.fit(X[self.cols], y)
        return self

    def predict_proba(self, X):
        return self.pipe.predict_proba(X[self.cols])


if __name__ == "__main__":
    import sys

    res = [
        rolling(lambda: SK(elo_logistic(), ["elo_diff"]), "elo"),
        rolling(lambda: SK(logreg(0.1), FEATURE_COLUMNS), "current_logreg_c0.1"),
    ]
    nonelo = [c for c in FEATURE_COLUMNS if c not in ("elo_diff", "elo_prob_home", "elo_hfa")]
    for lam in [10, 100, 300, 1000, 3000]:
        res.append(rolling(lambda lam=lam: Anchored(nonelo, lam), f"anchored_all_lam{lam}"))
    R = pd.concat(res)
    R["ll"] = ll(R["y"], R["p"])
    R["acc"] = ((R["p"] > 0.5) == R["y"]).astype(float)
    R.to_parquet(sys.argv[1] if len(sys.argv) > 1 else "rolling.parquet")
    t = R.pivot_table(index="model", columns="season", values="ll", aggfunc="mean").round(4)
    t["pooled"] = R.groupby("model")["ll"].mean().round(4)
    t["acc"] = R.groupby("model")["acc"].mean().round(4)
    print(t.sort_values("pooled").to_string())
    base = R[R.model == "elo"].set_index("game_id")["ll"]
    for m in R.model.unique():
        d = R[R.model == m].set_index("game_id")["ll"] - base
        print(f"{m:28s} vs elo: {d.mean():+.4f} ± {1.96 * d.std() / np.sqrt(len(d)):.4f}")
