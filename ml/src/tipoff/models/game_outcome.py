"""The game-outcome model: LogReg, LightGBM, a log-odds average of both, or Elo-anchored, plus a
calibrator.

Every variant is additive in log-odds, so each prediction decomposes exactly into per-feature
contributions plus a base value:
- LogReg: ``w_j * z_j`` on standardized features (base = intercept)
- LightGBM: TreeSHAP values from ``pred_contrib=True`` (base = expected raw score)
- Ensemble: ``w * LogReg + (1 - w) * LightGBM`` in log-odds, contributions mixed the same way
- Anchored: ``a * Elo log-odds + b + w . z``, the adjustments ``w`` on standardized
  ``ANCHOR_FEATURES`` with an L2 penalty on ``w`` only, so the model starts from Elo and noisy
  inputs can't drag it far away (ml/reports/elo_gap_study.md). Elo's log-odds split exactly into
  the rating gap (``elo_diff - elo_hfa``) and the home edge (``elo_hfa``); base = ``b``
- Platt calibration ``sigmoid(a * raw + b)`` keeps this exact (contributions scale by ``a``).
  Isotonic calibration doesn't; then contributions explain the uncalibrated score.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit, logit
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from tipoff.features.columns import ANCHOR_FEATURES, FEATURE_COLUMNS
from tipoff.models.baselines import SEED, logreg

KINDS = ("logreg", "lgbm", "ensemble", "anchored")
ELO_TO_LOGIT = np.log(10.0) / 400.0  # Elo points -> log-odds (the Elo win-probability formula)
CALIBRATIONS = ("none", "platt", "isotonic")


def lgbm(params: dict[str, Any]) -> lgb.LGBMClassifier:
    return lgb.LGBMClassifier(
        objective="binary",
        random_state=SEED,
        deterministic=True,
        force_row_wise=True,
        n_jobs=4,
        verbose=-1,
        **params,
    )


@dataclass
class Calibrator:
    method: str = "none"
    a: float = 1.0
    b: float = 0.0
    iso: IsotonicRegression | None = None

    @classmethod
    def fit(cls, method: str, raw: np.ndarray, y: np.ndarray) -> Calibrator:
        if method == "none":
            return cls()
        if method == "platt":
            lr = LogisticRegression(C=1e6, max_iter=1000).fit(raw.reshape(-1, 1), y)
            return cls("platt", float(lr.coef_[0, 0]), float(lr.intercept_[0]))
        if method == "isotonic":
            iso = IsotonicRegression(out_of_bounds="clip", y_min=1e-4, y_max=1 - 1e-4)
            return cls("isotonic", iso=iso.fit(expit(raw), y))
        raise ValueError(method)

    def __call__(self, raw: np.ndarray) -> np.ndarray:
        if self.method == "none":
            return expit(raw)
        if self.method == "platt":
            return expit(self.a * raw + self.b)
        assert self.iso is not None
        return self.iso.predict(expit(raw))


@dataclass
class Anchor:
    """Fitted Elo-anchored model: ``a * elo_logit + b + coef . z`` (z = standardized inputs)."""

    features: list[str]
    lam: float
    imputer: SimpleImputer | None = None
    scaler: StandardScaler | None = None
    a: float = 1.0
    b: float = 0.0
    coef: np.ndarray | None = None

    @staticmethod
    def elo_logit(X: pd.DataFrame) -> np.ndarray:
        return X["elo_diff"].to_numpy(dtype=float) * ELO_TO_LOGIT

    def z(self, X: pd.DataFrame) -> np.ndarray:
        assert self.imputer is not None and self.scaler is not None
        return self.scaler.transform(self.imputer.transform(X[self.features]))

    def fit(self, X: pd.DataFrame, y: pd.Series) -> Anchor:
        # Imputer and scaler are fit on training rows only (leakage rule 5).
        self.imputer = SimpleImputer(strategy="median").fit(X[self.features])
        self.scaler = StandardScaler().fit(self.imputer.transform(X[self.features]))
        z, e, t = self.z(X), self.elo_logit(X), y.to_numpy(dtype=float)
        lam = self.lam

        def loss(theta: np.ndarray) -> tuple[float, np.ndarray]:
            a, b, w = theta[0], theta[1], theta[2:]
            s = a * e + b + z @ w
            g = expit(s) - t
            value = np.sum(np.logaddexp(0.0, s) - t * s) + 0.5 * lam * (w @ w)
            return value, np.r_[g @ e, g.sum(), z.T @ g + lam * w]

        start = np.r_[1.0, 0.0, np.zeros(z.shape[1])]
        theta = minimize(loss, start, jac=True, method="L-BFGS-B").x
        self.a, self.b, self.coef = float(theta[0]), float(theta[1]), theta[2:]
        return self

    def raw(self, X: pd.DataFrame) -> np.ndarray:
        assert self.coef is not None
        return self.a * self.elo_logit(X) + self.b + self.z(X) @ self.coef


@dataclass
class GameModel:
    kind: str
    lgbm_params: dict[str, Any] = field(default_factory=dict)
    logreg_c: float = 0.1
    weight: float = 0.5  # LogReg share of the log-odds in the ensemble
    calibrator: Calibrator = field(default_factory=Calibrator)
    features: list[str] = field(default_factory=lambda: list(FEATURE_COLUMNS))
    lr: Pipeline | None = None
    gbm: lgb.LGBMClassifier | None = None
    anchor_lambda: float = 1000.0  # the anchored model's penalty on its adjustments
    anchor: Anchor | None = None
    anchor_features: list[str] | None = None  # None: ANCHOR_FEATURES

    def __setstate__(self, state: dict[str, Any]) -> None:
        state.setdefault("anchor_features", None)  # models pickled before the field existed
        self.__dict__.update(state)

    def fit(self, X: pd.DataFrame, y: pd.Series) -> GameModel:
        X = X[self.features]
        if self.kind == "anchored":
            feats = self.anchor_features or ANCHOR_FEATURES
            self.anchor = Anchor(list(feats), self.anchor_lambda).fit(X, y)
            return self
        if self.kind in ("logreg", "ensemble"):
            self.lr = logreg(self.logreg_c).fit(X, y)
        if self.kind in ("lgbm", "ensemble"):
            self.gbm = lgbm(self.lgbm_params).fit(X, y)
        return self

    def _w(self) -> tuple[float, float]:
        return {"logreg": (1.0, 0.0), "lgbm": (0.0, 1.0)}.get(
            self.kind, (self.weight, 1 - self.weight)
        )

    def raw(self, X: pd.DataFrame) -> np.ndarray:
        """Uncalibrated log-odds of a home win."""
        X = X[self.features]
        if self.kind == "anchored":
            assert self.anchor is not None
            return self.anchor.raw(X)
        w_lr, w_gb = self._w()
        out = np.zeros(len(X))
        if w_lr:
            out += w_lr * self.lr.decision_function(X)
        if w_gb:
            out += w_gb * self.gbm.predict_proba(X, raw_score=True)
        return out

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        return self.calibrator(self.raw(X))

    def contributions(self, X: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray]:
        """Per-feature log-odds contributions and base values; rows sum to ``raw`` (or the
        Platt-calibrated log-odds when Platt scaling is used)."""
        X = X[self.features]
        w_lr, w_gb = self._w()
        contrib = np.zeros((len(X), len(self.features)))
        base = np.zeros(len(X))
        if self.kind == "anchored":
            w_lr = w_gb = 0.0
            m = self.anchor
            assert m is not None and m.coef is not None
            col = {f: i for i, f in enumerate(self.features)}
            hfa = X["elo_hfa"].to_numpy(dtype=float) * ELO_TO_LOGIT
            contrib[:, col["elo_diff"]] = m.a * (m.elo_logit(X) - hfa)  # the rating gap
            contrib[:, col["elo_hfa"]] = m.a * hfa  # the home edge
            z = m.z(X)
            for j, f in enumerate(m.features):
                contrib[:, col[f]] = z[:, j] * m.coef[j]
            base += m.b
        if w_lr:
            impute, scale, model = (self.lr.named_steps[s] for s in ("impute", "scale", "lr"))
            z = scale.transform(impute.transform(X))
            contrib += w_lr * z * model.coef_[0]
            base += w_lr * model.intercept_[0]
        if w_gb:
            c = self.gbm.booster_.predict(X, pred_contrib=True)
            contrib += w_gb * c[:, :-1]
            base += w_gb * c[:, -1]
        if self.calibrator.method == "platt":
            contrib *= self.calibrator.a
            base = self.calibrator.a * base + self.calibrator.b
        return pd.DataFrame(contrib, columns=self.features, index=X.index), base

    def describe(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "calibration": self.calibrator.method,
            "logreg_c": self.logreg_c if self.kind != "lgbm" else None,
            "ensemble_weight_logreg": self.weight if self.kind == "ensemble" else None,
            "lgbm_params": self.lgbm_params if self.kind in ("lgbm", "ensemble") else None,
            "anchor_lambda": self.anchor_lambda if self.kind == "anchored" else None,
        }


def logit_clip(p: np.ndarray) -> np.ndarray:
    return logit(np.clip(p, 1e-6, 1 - 1e-6))
