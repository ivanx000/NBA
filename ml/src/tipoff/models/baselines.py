"""Baselines that every game model is compared against (ML_PLAN section 4).

1. Home team: always the training home win rate (accuracy = "home team always wins").
2. Elo: logistic regression on the Elo difference (including the home edge).
3. LogReg: standardized logistic regression on all features, with C chosen on validation.
"""

from __future__ import annotations

from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

SEED = 26
LOGREG_C_GRID = (0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0)
C_TOLERANCE = 1e-4  # pick the strongest regularization within this of the best log loss


def choose_c(scores: dict[float, float]) -> float:
    best = min(scores.values())
    return min(c for c, loss in scores.items() if loss <= best + C_TOLERANCE)


def home_team() -> DummyClassifier:
    return DummyClassifier(strategy="prior")


def elo_logistic() -> Pipeline:
    return Pipeline(
        [
            ("select", ColumnTransformer([("elo", "passthrough", ["elo_diff"])])),
            ("lr", LogisticRegression(random_state=SEED)),
        ]
    )


def logreg(c: float) -> Pipeline:
    # Imputer and scaler are fit inside the pipeline on training rows only (leakage rule 5).
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("lr", LogisticRegression(C=c, max_iter=5000, random_state=SEED)),
        ]
    )
