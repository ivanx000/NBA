"""Turn per-feature contributions into the top factors shown on the site.

Contributions are summed within the groups in ``shared/factors.json``. Each group's effect in
probability points uses the secant slope between the base and the prediction:
``pp_g = c_g * (p - p_base) / (logit(p) - logit(p_base))``. That keeps every group's sign and
makes the groups add up to ``p - p_base`` (p_base = the model's prediction for an average game).
It's an approximation of a non-linear model and is documented as one.
"""

from __future__ import annotations

import json
from functools import cache
from typing import Any

import numpy as np
import pandas as pd
from scipy.special import expit

from tipoff.config import SHARED_DIR

FACTORS_JSON = SHARED_DIR / "factors.json"


@cache
def factor_groups() -> list[dict[str, Any]]:
    return json.loads(FACTORS_JSON.read_text())["groups"]


def group_contributions(contrib: pd.DataFrame) -> pd.DataFrame:
    """Sum feature contributions (log-odds) into factor groups."""
    return pd.DataFrame(
        {g["id"]: contrib[g["features"]].sum(axis=1) for g in factor_groups()}, index=contrib.index
    )


def top_factors(
    contrib: pd.DataFrame, base: np.ndarray, top_k: int = 5, min_pp: float = 0.005
) -> list[list[dict[str, Any]]]:
    """Per row: up to ``top_k`` groups by absolute effect, each with direction and size."""
    groups = group_contributions(contrib)
    labels = {g["id"]: g["label"] for g in factor_groups()}
    total = groups.sum(axis=1).to_numpy()
    p, p0 = expit(base + total), expit(base)
    with np.errstate(divide="ignore", invalid="ignore"):
        slope = np.where(np.abs(total) > 1e-9, (p - p0) / total, p0 * (1 - p0))
    out = []
    for i, (_, row) in enumerate(groups.iterrows()):
        pp = row * slope[i]
        order = pp.abs().sort_values(ascending=False).index[:top_k]
        out.append([
            {
                "factor": gid,
                "label": labels[gid],
                "favors": "home" if pp[gid] > 0 else "away",
                "pp": round(float(pp[gid]), 4),
                "logit": round(float(row[gid]), 4),
            }
            for gid in order
            if abs(pp[gid]) >= min_pp
        ])  # fmt: skip
    return out
