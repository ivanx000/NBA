"""Train and evaluate the baselines on the validation season, logging each run to MLflow."""

from __future__ import annotations

import json
import tempfile
import warnings
from pathlib import Path

import mlflow
import mlflow.sklearn
import numpy as np

from tipoff.config import FIGURES_DIR, REPORTS_DIR, TRAIN_SEASONS, VALID_SEASON, get_settings
from tipoff.evaluate.metrics import compute_metrics, metrics_table, reliability_plot, to_markdown
from tipoff.features.columns import FEATURE_COLUMNS
from tipoff.models import baselines
from tipoff.models.data import load_features, train_valid

EXPERIMENT = "tipoff-game"
# The dummy baseline predicts integer labels; MLflow's schema hint about it is noise.
warnings.filterwarnings("ignore", message=".*Inferred schema contains integer column.*")


def setup_mlflow() -> None:
    settings = get_settings()
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    if mlflow.get_experiment_by_name(EXPERIMENT) is None:
        mlflow.create_experiment(EXPERIMENT, artifact_location=settings.mlflow_artifact_root)
    mlflow.set_experiment(EXPERIMENT)


def run_baselines(log_to_mlflow: bool = True) -> dict:
    df, feat_meta = load_features()
    train, valid = train_valid(df)

    # LogReg: choose C on validation log loss.
    c_scores = {}
    for c in baselines.LOGREG_C_GRID:
        m = baselines.logreg(c).fit(train.X, train.y)
        c_scores[c] = compute_metrics(valid.y, m.predict_proba(valid.X)[:, 1])["log_loss"]
    best_c = baselines.choose_c(c_scores)

    models = {
        "Home team": (baselines.home_team(), {}),
        "Elo": (baselines.elo_logistic(), {"features": "elo_diff"}),
        "LogReg": (baselines.logreg(best_c), {"C": best_c, "C_grid_val_log_loss": c_scores}),
    }
    results, probs = {}, {}
    if log_to_mlflow:
        setup_mlflow()
    common = {
        "train_seasons": f"{TRAIN_SEASONS[0]}..{TRAIN_SEASONS[-1]}",
        "valid_season": VALID_SEASON,
        "n_train": len(train.y),
        "n_valid": len(valid.y),
        "features_hash": feat_meta["features_hash"],
        "elo_params": json.dumps(feat_meta["elo_params"], sort_keys=True),
    }
    for name, (model, params) in models.items():
        model.fit(train.X, train.y)
        p_train = model.predict_proba(train.X)[:, 1]
        p_valid = model.predict_proba(valid.X)[:, 1]
        m_train, m_valid = compute_metrics(train.y, p_train), compute_metrics(valid.y, p_valid)
        results[name], probs[name] = m_valid, p_valid
        if not log_to_mlflow:
            continue
        with mlflow.start_run(run_name=f"baseline: {name}"):
            mlflow.set_tags({"kind": "baseline", "model": name, "phase": "2"})
            mlflow.log_params({**common, "model": name,
                               **{k: str(v) for k, v in params.items()}})  # fmt: skip
            mlflow.log_metrics({f"train_{k}": v for k, v in m_train.items()})
            mlflow.log_metrics({f"val_{k}": v for k, v in m_valid.items()})
            with tempfile.TemporaryDirectory() as tmp:
                plot = reliability_plot(valid.y, {name: p_valid}, Path(tmp) / "calibration.png",
                                        f"{name}: {VALID_SEASON} validation")  # fmt: skip
                mlflow.log_artifact(str(plot))
                (Path(tmp) / "features.json").write_text(json.dumps(FEATURE_COLUMNS, indent=2))
                mlflow.log_artifact(str(Path(tmp) / "features.json"))
            # Our own freshly trained models; skops needs numpy dtypes listed as trusted.
            mlflow.sklearn.log_model(
                model,
                name="model",
                input_example=valid.X.head(3),
                skops_trusted_types=["numpy.dtype"],
            )

    table = metrics_table(results)
    reliability_plot(valid.y, probs, FIGURES_DIR / "calibration_baselines.png",
                     f"Baselines: {VALID_SEASON} validation")  # fmt: skip
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    home_rate = float(np.mean(train.y))
    (REPORTS_DIR / "baselines_validation.md").write_text(
        f"# Baselines: {VALID_SEASON} validation\n\n"
        f"Trained on {common['train_seasons']} ({len(train.y):,} games), evaluated on "
        f"{VALID_SEASON} ({len(valid.y):,} regular-season games). Features hash "
        f"`{feat_meta['features_hash']}`. LogReg C = {best_c}: the strongest regularization "
        f"within {baselines.C_TOLERANCE} of the best validation log loss. "
        f"Training home win rate: {home_rate:.1%}.\n\n{to_markdown(table)}\n"
    )
    return {"table": table, "best_c": best_c, "c_scores": c_scores}
