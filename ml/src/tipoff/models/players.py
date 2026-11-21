"""Player stat projections (ML_PLAN section 6): minutes x per-minute rate, with 80% ranges.

- **Minutes:** a LightGBM regressor on the minutes features (and the rest).
- **Rates:** one LightGBM regressor per stat on points, rebounds or assists *per minute*, weighted
  by minutes so short stints don't dominate. Projection = projected minutes x projected rate.
- **Direct:** the same features straight to the stat, as a comparison. For each stat the point
  projection is whichever of the two did better on the validation season (mean absolute error).
- **Ranges:** quantile regressors (10th and 90th percentiles) per stat, then a conformal
  correction from a season the quantile models never saw, so 80% ranges hold about 80% of games.

Splits are by season only. Selection uses 2024-25; 2025-26 is scored once (``final_test``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

from tipoff.config import CONFIG_DIR, FEATURES_DIR, TEST_SEASON, TRAIN_SEASONS, VALID_SEASON
from tipoff.features.players import BASELINE, FEATURE_COLUMNS, V1_FEATURE_COLUMNS

STATS = ["pts", "reb", "ast"]
TARGETS = ["minutes", *STATS]
COVERAGE = 0.8
ALPHAS = (0.1, 0.9)
PLAYER_MODEL_CONFIG_PATH = CONFIG_DIR / "player_model.json"
SEED = 26

# Point models: a few sizes, picked on validation MAE (per target).
GRID: list[dict[str, Any]] = [
    {"num_leaves": 15, "learning_rate": 0.05, "n_estimators": 400, "min_child_samples": 200},
    {"num_leaves": 31, "learning_rate": 0.05, "n_estimators": 500, "min_child_samples": 100},
    {"num_leaves": 63, "learning_rate": 0.03, "n_estimators": 800, "min_child_samples": 100},
]
QUANTILE_PARAMS = {"num_leaves": 31, "learning_rate": 0.05, "n_estimators": 400,
                   "min_child_samples": 200}  # fmt: skip
COMMON = {"subsample": 0.8, "subsample_freq": 1, "colsample_bytree": 0.8, "random_state": SEED,
          "verbose": -1, "n_jobs": -1}  # fmt: skip


# --- Data ------------------------------------------------------------------------------------


@dataclass
class PlayerSplit:
    name: str
    X: pd.DataFrame
    y: pd.DataFrame  # minutes, pts, reb, ast
    meta: pd.DataFrame


def load_player_features(features_dir: Path = FEATURES_DIR) -> tuple[pd.DataFrame, dict]:
    path = features_dir / "player_features.parquet"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run `tipoff features` first.")
    meta = json.loads((features_dir / "player_features.meta.json").read_text())
    return pd.read_parquet(path), meta


def player_split(df: pd.DataFrame, name: str, seasons: tuple[str, ...]) -> PlayerSplit:
    rows = df[df["season"].isin(seasons) & df["played"] & df["in_scope"]]
    return PlayerSplit(name, rows[FEATURE_COLUMNS], rows[TARGETS], rows)


def player_train_valid(df: pd.DataFrame) -> tuple[PlayerSplit, PlayerSplit]:
    """Training and validation splits. The test season is deliberately not reachable here."""
    assert TEST_SEASON not in TRAIN_SEASONS and TEST_SEASON != VALID_SEASON
    return player_split(df, "train", TRAIN_SEASONS), player_split(df, "valid", (VALID_SEASON,))


# --- Model -----------------------------------------------------------------------------------


def _regressor(params: dict[str, Any], **extra: Any) -> lgb.LGBMRegressor:
    return lgb.LGBMRegressor(**{**COMMON, **params, **extra})


@dataclass
class PlayerModel:
    """Everything needed to project a player-game row (FEATURE_COLUMNS) and its ranges."""

    point: dict[str, str]  # stat -> "two_stage" or "direct"
    # LightGBM params per model: minutes, pts_rate, pts_direct, ...
    params: dict[str, dict[str, Any]]
    models: dict[str, lgb.LGBMRegressor] = field(default_factory=dict)
    quantiles: dict[str, tuple[lgb.LGBMRegressor, lgb.LGBMRegressor]] = field(default_factory=dict)
    # Conformal correction per stat: added to the high end and taken off the low end.
    widen: dict[str, float] = field(default_factory=dict)
    # The columns this model was fit on (models pickled before the field existed used v1's).
    features: list[str] = field(default_factory=lambda: list(FEATURE_COLUMNS))

    def __setstate__(self, state: dict[str, Any]) -> None:
        state.setdefault("features", list(V1_FEATURE_COLUMNS))
        self.__dict__.update(state)

    def fit(self, X: pd.DataFrame, y: pd.DataFrame) -> PlayerModel:
        X = X[self.features]
        mins = y["minutes"].to_numpy(float)
        self.models["minutes"] = _regressor(self.params["minutes"]).fit(X, mins)
        for stat in STATS:
            if self.point[stat] == "two_stage":
                rate = y[stat].to_numpy(float) / mins
                self.models[f"{stat}_rate"] = _regressor(self.params[f"{stat}_rate"]).fit(
                    X, rate, sample_weight=mins
                )
            else:
                self.models[f"{stat}_direct"] = _regressor(self.params[f"{stat}_direct"]).fit(
                    X, y[stat].to_numpy(float)
                )
            lo, hi = (
                _regressor(QUANTILE_PARAMS, objective="quantile", alpha=a).fit(X, y[stat])
                for a in ALPHAS
            )
            self.quantiles[stat] = (lo, hi)
        return self

    def predict(self, X: pd.DataFrame) -> pd.DataFrame:
        """Projected minutes, pts, reb, ast, and each stat's 80% range (``pts_lo``, ``pts_hi``)."""
        X = X[self.features]
        out = pd.DataFrame(index=X.index)
        mins = np.clip(self.models["minutes"].predict(X), 0, 48)
        out["minutes"] = mins
        for stat in STATS:
            if self.point[stat] == "two_stage":
                point = mins * np.clip(self.models[f"{stat}_rate"].predict(X), 0, None)
            else:
                point = np.clip(self.models[f"{stat}_direct"].predict(X), 0, None)
            lo_m, hi_m = self.quantiles[stat]
            w = self.widen.get(stat, 0.0)
            lo = np.clip(lo_m.predict(X) - w, 0, None)
            hi = hi_m.predict(X) + w
            out[stat] = point
            # The range always contains the projection.
            out[f"{stat}_lo"] = np.minimum(lo, point)
            out[f"{stat}_hi"] = np.maximum(hi, point)
        return out

    def calibrate(self, X: pd.DataFrame, y: pd.DataFrame) -> dict[str, float]:
        """Conformal correction (CQR) from a season the quantile models weren't trained on."""
        self.widen = {}
        raw = self.predict(X)
        for stat in STATS:
            lo, hi = raw[f"{stat}_lo"].to_numpy(), raw[f"{stat}_hi"].to_numpy()
            actual = y[stat].to_numpy(float)
            scores = np.maximum(lo - actual, actual - hi)
            n = len(scores)
            q = min(1.0, np.ceil((n + 1) * COVERAGE) / n)
            self.widen[stat] = float(np.quantile(scores, q, method="higher"))
        return self.widen


# --- Evaluation ------------------------------------------------------------------------------


def score(pred: pd.DataFrame, y: pd.DataFrame, X: pd.DataFrame) -> dict[str, float]:
    """MAE for each target (model and last-10 baseline), plus range coverage and width."""
    m: dict[str, float] = {}
    for t in TARGETS:
        actual = y[t].to_numpy(float)
        m[f"{t}_mae"] = float(np.mean(np.abs(pred[t].to_numpy() - actual)))
        m[f"{t}_rmse"] = float(np.sqrt(np.mean((pred[t].to_numpy() - actual) ** 2)))
        m[f"{t}_baseline_mae"] = float(np.mean(np.abs(X[BASELINE[t]].to_numpy() - actual)))
    for stat in STATS:
        actual = y[stat].to_numpy(float)
        lo, hi = pred[f"{stat}_lo"].to_numpy(), pred[f"{stat}_hi"].to_numpy()
        m[f"{stat}_coverage"] = float(np.mean((actual >= lo) & (actual <= hi)))
        m[f"{stat}_width"] = float(np.mean(hi - lo))
    return m


def score_table(metrics: dict[str, float]) -> pd.DataFrame:
    rows = []
    for t in TARGETS:
        row = {"target": t, "last-10 MAE": metrics[f"{t}_baseline_mae"],
               "model MAE": metrics[f"{t}_mae"],
               "vs baseline": metrics[f"{t}_mae"] / metrics[f"{t}_baseline_mae"] - 1,
               "model RMSE": metrics[f"{t}_rmse"]}  # fmt: skip
        if t in STATS:
            row["80% range coverage"] = metrics[f"{t}_coverage"]
            row["mean width"] = metrics[f"{t}_width"]
        rows.append(row)
    return pd.DataFrame(rows).set_index("target")


def _mae(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a - b)))


def select(train: PlayerSplit, valid: PlayerSplit) -> dict[str, Any]:
    """Pick each point model's size and two-stage vs direct per stat, on validation MAE."""
    X, X_v = train.X, valid.X
    mins, mins_v = train.y["minutes"].to_numpy(float), valid.y["minutes"].to_numpy(float)
    candidates: dict[str, dict[str, Any]] = {}

    def best(name: str, fit_predict) -> dict[str, Any]:
        tried = []
        for i, params in enumerate(GRID):
            tried.append((fit_predict(params), i))
        mae, i = min(tried)
        candidates[name] = {"tried": [round(t, 4) for t, _ in sorted(tried, key=lambda x: x[1])],
                            "best": i}  # fmt: skip
        return {"params": GRID[i], "mae": mae}

    minutes = best("minutes", lambda p: _mae(_regressor(p).fit(X, mins).predict(X_v), mins_v))
    proj_min = (
        _regressor(minutes["params"]).fit(X, mins).predict(X_v).clip(0, 48)
    )  # the stage-one output the rate models multiply
    chosen: dict[str, Any] = {"minutes": minutes}
    point: dict[str, str] = {}
    for stat in STATS:
        y, yv = train.y[stat].to_numpy(float), valid.y[stat].to_numpy(float)

        def two_stage(p, y=y, yv=yv):
            rate = _regressor(p).fit(X, y / mins, sample_weight=mins).predict(X_v).clip(0)
            return _mae(proj_min * rate, yv)

        def direct(p, y=y, yv=yv):
            return _mae(_regressor(p).fit(X, y).predict(X_v).clip(0), yv)

        chosen[f"{stat}_rate"] = best(f"{stat}_rate", two_stage)
        chosen[f"{stat}_direct"] = best(f"{stat}_direct", direct)
        point[stat] = (
            "two_stage"
            if chosen[f"{stat}_rate"]["mae"] <= chosen[f"{stat}_direct"]["mae"]
            else "direct"
        )
    params = {k: v["params"] for k, v in chosen.items()}
    return {"point": point, "params": params, "valid_mae": {k: round(v["mae"], 4)
            for k, v in chosen.items()}, "candidates": candidates}  # fmt: skip


def save_config(cfg: dict[str, Any], path: Path = PLAYER_MODEL_CONFIG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2) + "\n")


def load_config(path: Path = PLAYER_MODEL_CONFIG_PATH) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run `tipoff train --only player` first.")
    return json.loads(path.read_text())


def from_config(cfg: dict[str, Any]) -> PlayerModel:
    return PlayerModel(point=dict(cfg["point"]), params=dict(cfg["params"]))
