"""The game-outcome model: LogReg, LightGBM, or a log-odds average of both, plus a calibrator.

Every variant is additive in log-odds, so each prediction decomposes exactly into per-feature
contributions plus a base value:
- LogReg: ``w_j * z_j`` on standardized features (base = intercept)
- LightGBM: TreeSHAP values from ``pred_contrib=True`` (base = expected raw score)
- Ensemble: ``w * LogReg + (1 - w) * LightGBM`` in log-odds, contributions mixed the same way
- Platt calibration ``sigmoid(a * raw + b)`` keeps this exact (contributions scale by ``a``).
  Isotonic calibration doesn't; then contributions explain the uncalibrated score.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.special import expit, logit
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from tipoff.features.columns import FEATURE_COLUMNS
from tipoff.models.baselines import SEED, logreg

KINDS = ("logreg", "lgbm", "ensemble")
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
class GameModel:
    kind: str
    lgbm_params: dict[str, Any] = field(default_factory=dict)
    logreg_c: float = 0.1
    weight: float = 0.5  # LogReg share of the log-odds in the ensemble
    calibrator: Calibrator = field(default_factory=Calibrator)
    features: list[str] = field(default_factory=lambda: list(FEATURE_COLUMNS))
    lr: Pipeline | None = None
    gbm: lgb.LGBMClassifier | None = None

    def fit(self, X: pd.DataFrame, y: pd.Series) -> GameModel:
        X = X[self.features]
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
            "lgbm_params": self.lgbm_params if self.kind != "logreg" else None,
        }


def logit_clip(p: np.ndarray) -> np.ndarray:
    return logit(np.clip(p, 1e-6, 1 - 1e-6))
