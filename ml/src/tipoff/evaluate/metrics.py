"""Metrics, calibration and the comparison table used for every game model."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score

METRIC_NAMES = ["log_loss", "brier", "accuracy", "auc", "ece"]


def expected_calibration_error(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    """Weighted mean |predicted - observed| over equal-width probability bins."""
    y, p = np.asarray(y, float), np.asarray(p, float)
    idx = np.minimum((p * bins).astype(int), bins - 1)
    ece = 0.0
    for b in range(bins):
        mask = idx == b
        if mask.any():
            ece += mask.mean() * abs(p[mask].mean() - y[mask].mean())
    return float(ece)


def compute_metrics(y: np.ndarray, p: np.ndarray) -> dict[str, float]:
    y, p = np.asarray(y, int), np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    auc = roc_auc_score(y, p) if len(np.unique(p)) > 1 else 0.5
    return {
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "brier": float(brier_score_loss(y, p)),
        "accuracy": float(accuracy_score(y, p >= 0.5)),
        "auc": float(auc),
        "ece": expected_calibration_error(y, p),
    }


def metrics_table(results: Mapping[str, Mapping[str, float]]) -> pd.DataFrame:
    """Rows = models, columns = metrics (rounded), in the order given."""
    return pd.DataFrame(results).T[METRIC_NAMES].round(4)


def to_markdown(table: pd.DataFrame) -> str:
    header = (
        "| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |\n|---|---|---|---|---|---|"
    )
    rows = [
        f"| {name} | {r.log_loss:.4f} | {r.brier:.4f} | {r.accuracy:.1%} "
        f"| {r.auc:.4f} | {r.ece:.4f} |"
        for name, r in table.iterrows()
    ]
    return "\n".join([header, *rows])


def reliability_plot(
    y: np.ndarray, probs: Mapping[str, np.ndarray], path: Path, title: str, bins: int = 10
) -> Path:
    """Predicted probability (binned) vs observed home win rate, one line per model."""
    bg, text, muted = "#0A0A0C", "#F5F5F7", "#A1A1AA"
    colors = ["#A1A1AA", "#60A5FA", "#FF6B1A", "#22C55E", "#FACC15"]
    fig, ax = plt.subplots(figsize=(5.5, 5.5), facecolor=bg)
    ax.set_facecolor(bg)
    ax.plot([0, 1], [0, 1], ls="--", color="#52525B", lw=1, label="Perfect calibration")
    y = np.asarray(y, float)
    for (name, p), color in zip(probs.items(), colors, strict=False):
        p = np.asarray(p, float)
        if np.ptp(p) < 1e-9:  # constant predictor: a single point
            ax.scatter([p.mean()], [y.mean()], color=color, s=40, label=name, zorder=3)
            continue
        idx = np.minimum((p * bins).astype(int), bins - 1)
        df = (
            pd.DataFrame({"b": idx, "p": p, "y": y})
            .groupby("b")
            .agg(p=("p", "mean"), y=("y", "mean"), n=("y", "size"))
        )
        df = df[df["n"] >= 20]
        ax.plot(df["p"], df["y"], marker="o", color=color, label=name)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("Predicted home win probability", color=text)
    ax.set_ylabel("Observed home win rate", color=text)
    ax.set_title(title, color=text, fontweight="bold")
    ax.tick_params(colors=muted)
    for spine in ax.spines.values():
        spine.set_color("#3F3F46")
    ax.legend(frameon=False, labelcolor=text, loc="upper left")
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(path, dpi=160, facecolor=bg)
    plt.close(fig)
    return path
