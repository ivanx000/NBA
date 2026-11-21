"""Injury report study, player projections: v1 inputs vs + the morning injury report.

Same protocol as the player models' selection: train on 2015-16..2023-24, score 2024-25 (the
2025-26 test season is never touched), with the current recipe (ml/config/player_model.json).
Also a rolling check: each of 2021-22..2024-25 predicted by a model trained on the seasons before
it. Reported overall and for player-games where a teammate was listed out (team_ir_out_min >= 10),
which is where the report should matter. Logged to MLflow ("injury-report-study").

Usage: uv run python notebooks/injury/players.py
"""

import json

import mlflow
import numpy as np
import pandas as pd

from tipoff.config import REPORTS_DIR
from tipoff.features.players import FEATURE_COLUMNS, V1_FEATURE_COLUMNS
from tipoff.models.data import seasons_through
from tipoff.models.players import (
    PlayerModel,
    load_config,
    load_player_features,
    player_split,
    player_train_valid,
)
from tipoff.models.train_baselines import setup_mlflow
from tipoff.models.train_game import _prev

TARGETS = ["minutes", "pts", "reb", "ast"]


def fit_predict(cfg, feats, train, target):
    m = PlayerModel(point=dict(cfg["point"]), params=dict(cfg["params"]), features=list(feats))
    m.fit(train.meta, train.y)  # meta holds every feature column
    return m.predict(target.meta)


def mae(pred, y, mask=None):
    mask = np.ones(len(y), bool) if mask is None else mask
    return {t: float(np.mean(np.abs(pred[t].to_numpy()[mask] - y[t].to_numpy(float)[mask])))
            for t in TARGETS}  # fmt: skip


def main() -> None:
    df, meta = load_player_features()
    cfg = load_config()
    out = {}
    train, valid = player_train_valid(df)
    hit = (valid.meta["team_ir_out_min"] >= 10).to_numpy()
    baseline = {t: valid.meta[b] for t, b in
                {"minutes": "min_l10", "pts": "pts_l10", "reb": "reb_l10", "ast": "ast_l10"}.items()}  # fmt: skip
    base_pred = pd.DataFrame(baseline)
    res = {
        "last-10 baseline": {
            "all": mae(base_pred, valid.y),
            "teammate_out": mae(base_pred, valid.y, hit),
        }
    }
    for name, feats in (("v1", V1_FEATURE_COLUMNS), ("+injury", FEATURE_COLUMNS)):
        pred = fit_predict(cfg, feats, train, valid)
        res[name] = {"all": mae(pred, valid.y), "teammate_out": mae(pred, valid.y, hit)}
    out["valid_2024-25"] = {"rows": len(valid.y), "teammate_out_rows": int(hit.sum()), **res}

    rolling = {"v1": [], "+injury": []}
    for season in ("2021-22", "2022-23", "2023-24", "2024-25"):
        tr = player_split(df, "fit", seasons_through(_prev(season)))
        tg = player_split(df, "target", (season,))
        for name, feats in (("v1", V1_FEATURE_COLUMNS), ("+injury", FEATURE_COLUMNS)):
            pred = fit_predict(cfg, feats, tr, tg)
            err = np.abs(pred[TARGETS].to_numpy() - tg.y[TARGETS].to_numpy(float))
            rolling[name].append(pd.DataFrame(err, columns=TARGETS).assign(
                season=season, teammate_out=(tg.meta["team_ir_out_min"] >= 10).to_numpy()))  # fmt: skip
    roll = {}
    for name, frames in rolling.items():
        e = pd.concat(frames)
        roll[name] = {"all": e[TARGETS].mean().round(4).to_dict(),
                      "teammate_out": e[e["teammate_out"]][TARGETS].mean().round(4).to_dict(),
                      "by_season_minutes": e.groupby("season")["minutes"].mean().round(4).to_dict()}  # fmt: skip
    out["rolling_2021-22..2024-25"] = roll

    setup_mlflow("injury-report-study")
    for name in ("v1", "+injury"):
        with mlflow.start_run(run_name=f"players {name}"):
            mlflow.log_params({"variant": name, "features_hash": meta["features_hash"]})
            mlflow.log_metrics({f"valid_{t}_mae": v for t, v in res[name]["all"].items()})
            mlflow.log_metrics(
                {f"valid_teammate_out_{t}_mae": v for t, v in res[name]["teammate_out"].items()}
            )
            mlflow.log_metrics({f"rolling_{t}_mae": v for t, v in roll[name]["all"].items()})
    path = REPORTS_DIR / "injury_report_players.json"
    path.write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
