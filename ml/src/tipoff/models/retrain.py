"""Weekly retrain with champion/challenger promotion (ROADMAP Phase 10).

Each week both models are refit on every completed game. Before a refit replaces its champion it
has to show, on the last ``WEEKS`` complete weeks, that it's no worse than what the site actually
published for those games:

- **Challenger:** the champion's recipe (``ml/config/game_model.json``, ``player_model.json``) run
  as a weekly walk-forward over the window: for each week, fit on everything before it and predict
  that week. That's how a weekly retrain would have done.
- **Published:** the stored pregame predictions for the same games (``current_game_predictions``,
  live beats backfill) and the stored projections with their real lines
  (``current_player_projections``).
- **Rule:** the game model is promoted if its log loss is at most the published log loss plus
  ``GAME_TOLERANCE``; the player model if its mean absolute error on points, rebounds and assists
  (averaged as ratios to the published errors) is at most ``1 + PLAYER_TOLERANCE``. A week of NBA
  games is noisy, so "no worse" allows a little slack; a real regression still stops it.

Elo's own pregame probability (stored next to each prediction) is reported as the challenger the
model has to keep beating. It's never promoted automatically.

The refits use only the staged history (cdn.nba.com box scores in the cloud), never stats.nba.com.
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import Engine, text

from tipoff.config import FIRST_SEASON, TEST_SEASON
from tipoff.features.columns import FEATURE_COLUMNS, TARGET
from tipoff.features.players import FEATURE_COLUMNS as PLAYER_FEATURES
from tipoff.models.data import Split
from tipoff.models.players import STATS, PlayerModel
from tipoff.models.players import from_config as player_from_config
from tipoff.seasons import season_start_year

WEEKS = 4
GAME_TOLERANCE = 0.005  # log loss
PLAYER_TOLERANCE = 0.01  # 1% on the MAE ratio
MIN_GAMES = 30  # fewer graded games in the window than this: not enough to judge, keep the champion
EPS = 1e-6


# --- Window and scoring ----------------------------------------------------------------------


def window_weeks(latest_game: pd.Timestamp, weeks: int = WEEKS) -> list[pd.Timestamp]:
    """Mondays starting the last ``weeks`` complete weeks (Monday to Sunday) up to ``latest_game``.
    A week whose Sunday is after the latest staged game isn't complete and isn't used."""
    latest = pd.Timestamp(latest_game).normalize()
    this_monday = latest - pd.Timedelta(days=latest.weekday())
    last_complete = this_monday if latest.weekday() == 6 else this_monday - pd.Timedelta(days=7)
    return [last_complete - pd.Timedelta(days=7 * k) for k in range(weeks - 1, -1, -1)]


def log_loss(p: np.ndarray, y: np.ndarray) -> float:
    p = np.clip(p, EPS, 1 - EPS)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def accuracy(p: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean((p > 0.5) == (y == 1)))


@dataclass
class Decision:
    kind: str  # "game" or "player"
    promote: bool
    reason: str
    metrics: dict[str, Any] = field(default_factory=dict)


def decide_game(challenger_ll: float, published_ll: float, n: int) -> Decision:
    m = {"n": n, "challenger_log_loss": challenger_ll, "published_log_loss": published_ll}
    if n < MIN_GAMES:
        return Decision("game", False, f"only {n} graded games in the window (need {MIN_GAMES})", m)
    if challenger_ll <= published_ll + GAME_TOLERANCE:
        return Decision("game", True, "refit is no worse than what was published", m)
    return Decision("game", False, f"refit log loss {challenger_ll:.4f} is worse than published "
                    f"{published_ll:.4f} by more than {GAME_TOLERANCE}", m)  # fmt: skip


def decide_player(challenger: dict[str, float], published: dict[str, float], n: int) -> Decision:
    ratio = float(np.mean([challenger[s] / max(published[s], EPS) for s in STATS]))
    m = {"n": n, "mae_ratio": ratio, **{f"challenger_{s}_mae": challenger[s] for s in STATS},
         **{f"published_{s}_mae": published[s] for s in STATS}}  # fmt: skip
    if n < MIN_GAMES * 10:
        return Decision("player", False, f"only {n} projected lines in the window", m)
    if ratio <= 1 + PLAYER_TOLERANCE:
        return Decision("player", True, "refit is no worse than what was published", m)
    return Decision("player", False, f"refit errors are {ratio - 1:.1%} above published "
                    f"(allowed {PLAYER_TOLERANCE:.0%})", m)  # fmt: skip


# --- What was published ----------------------------------------------------------------------


def published_games(engine: Engine, game_ids: list[str]) -> pd.DataFrame:
    """Stored pregame predictions (live beats backfill) with the final result, for ``game_ids``."""
    sql = text("""
        select p.game_id, p.home_win_prob, p.elo_home_win_prob, p.source,
               (g.home_score > g.away_score)::int as home_win
          from current_game_predictions p join games g using (game_id)
         where g.status = 'final' and g.game_id = any(:ids)""")
    with engine.connect() as conn:
        return pd.DataFrame(conn.execute(sql, {"ids": game_ids}).mappings().all())


def published_lines(engine: Engine, game_ids: list[str]) -> pd.DataFrame:
    """Stored projections with their real lines (players who played), for ``game_ids``."""
    sql = text("""
        select game_id, player_id, proj_minutes, pts, reb, ast,
               actual_minutes, actual_pts, actual_reb, actual_ast
          from current_player_projections
         where game_id = any(:ids) and actual_minutes > 0""")
    with engine.connect() as conn:
        return pd.DataFrame(conn.execute(sql, {"ids": game_ids}).mappings().all())


# --- Game model ------------------------------------------------------------------------------


def _in_window(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["season"].map(season_start_year) >= season_start_year(FIRST_SEASON)]


def game_challenger(df: pd.DataFrame, cfg: dict[str, Any], weeks: list[pd.Timestamp]):
    """Weekly walk-forward predictions over ``weeks`` and the final refit on everything.
    Returns (predictions: game_id, p, home_win; the refit GameModel)."""
    from tipoff.models.final import template
    from tipoff.models.train_game import out_of_time_calibrator

    played = _in_window(df[df["played"]])
    method = cfg["candidates"][cfg["kind"]]["calibration"]
    # The champion's calibrator: fit on 2025-26 by a model trained only through 2024-25. Fixed,
    # so one copy serves every refit.
    calibrator = out_of_time_calibrator(template(cfg), df, TEST_SEASON, method)
    out = []
    for start in weeks:
        end = start + pd.Timedelta(days=7)
        past = played[played["game_date"] < start]
        now = played[(played["game_date"] >= start) & (played["game_date"] < end)]
        if now.empty:
            continue
        model = template(cfg).fit(past[FEATURE_COLUMNS], past[TARGET].astype(int))
        model.calibrator = calibrator
        out.append(pd.DataFrame({"game_id": now["game_id"].to_numpy(),
                                 "p": model.predict_proba(now[FEATURE_COLUMNS]),
                                 "home_win": now[TARGET].astype(int).to_numpy()}))  # fmt: skip
    final = template(cfg).fit(played[FEATURE_COLUMNS], played[TARGET].astype(int))
    final.calibrator = calibrator
    preds = (
        pd.concat(out, ignore_index=True)
        if out
        else pd.DataFrame(columns=["game_id", "p", "home_win"])
    )
    return preds, final, Split("all", played[FEATURE_COLUMNS], played[TARGET].astype(int), played)


def evaluate_game(preds: pd.DataFrame, published: pd.DataFrame) -> Decision:
    both = preds.merge(published, on="game_id", suffixes=("", "_pub"))
    y = both["home_win"].to_numpy(float)
    d = decide_game(log_loss(both["p"].to_numpy(), y) if len(both) else np.inf,
                    log_loss(both["home_win_prob"].to_numpy(float), y) if len(both) else np.inf,
                    len(both))  # fmt: skip
    if len(both):
        elo = both["elo_home_win_prob"].astype(float).to_numpy()
        d.metrics.update({
            "challenger_accuracy": accuracy(both["p"].to_numpy(), y),
            "published_accuracy": accuracy(both["home_win_prob"].to_numpy(float), y),
            "elo_log_loss": log_loss(elo, y), "elo_accuracy": accuracy(elo, y),
            "live_games": int((both["source"] == "live").sum()),
        })  # fmt: skip
    return d


# --- Player model ----------------------------------------------------------------------------


def player_challenger(pf: pd.DataFrame, cfg: dict[str, Any], weeks: list[pd.Timestamp],
                      widen: dict[str, float]):  # fmt: skip
    """Weekly walk-forward projections over ``weeks`` (in-scope appearances) and the final refit."""
    rows = _in_window(pf[pf["played"] & pf["in_scope"]])
    targets = ["minutes", *STATS]
    out = []
    for start in weeks:
        end = start + pd.Timedelta(days=7)
        past = rows[rows["game_date"] < start]
        now = rows[(rows["game_date"] >= start) & (rows["game_date"] < end)]
        if now.empty:
            continue
        model = player_from_config(cfg).fit(past[PLAYER_FEATURES], past[targets])
        model.widen = dict(widen)
        pred = model.predict(now[PLAYER_FEATURES]).reset_index(drop=True)
        out.append(pd.concat([now[["game_id", "player_id"]].reset_index(drop=True),
                              pred[["minutes", *STATS]]], axis=1))  # fmt: skip
    final: PlayerModel = player_from_config(cfg).fit(rows[PLAYER_FEATURES], rows[targets])
    final.widen = dict(widen)
    preds = pd.concat(out, ignore_index=True) if out else pd.DataFrame()
    return preds, final, rows


def evaluate_player(preds: pd.DataFrame, published: pd.DataFrame) -> Decision:
    """MAE on the player-games both sets projected (published lines whose player played)."""
    if preds.empty or published.empty:
        return decide_player(dict.fromkeys(STATS, np.inf), dict.fromkeys(STATS, 1.0), 0)
    both = preds.merge(published, on=["game_id", "player_id"], suffixes=("", "_pub"))
    ch = {s: float(np.mean(np.abs(both[s] - both[f"actual_{s}"]))) for s in STATS}
    pub = {s: float(np.mean(np.abs(both[f"{s}_pub"] - both[f"actual_{s}"]))) for s in STATS}
    d = decide_player(ch, pub, len(both))
    d.metrics["challenger_minutes_mae"] = float(
        np.mean(np.abs(both["minutes"] - both["actual_minutes"]))
    )
    d.metrics["published_minutes_mae"] = float(
        np.mean(np.abs(both["proj_minutes"] - both["actual_minutes"]))
    )
    return d


# --- Report ----------------------------------------------------------------------------------


def _sentence(reason: str) -> str:
    return f"{reason[:1].upper()}{reason[1:]}."


def _game_table(gm: dict[str, Any]) -> list[str]:
    rows = [
        (f"Published ({gm['n']} games, {gm.get('live_games', 0)} live)", "published"),
        ("Refit (challenger)", "challenger"),
        ("Elo (baseline)", "elo"),
    ]
    out = ["| | Log loss | Accuracy |", "|---|---|---|"]
    for label, key in rows:
        out.append(f"| {label} | {gm[f'{key}_log_loss']:.4f} | {gm[f'{key}_accuracy']:.1%} |")
    return out


def _player_table(pm: dict[str, Any]) -> list[str]:
    out = ["| | Minutes | Points | Rebounds | Assists |", "|---|---|---|---|---|"]
    for label, key in (("Published", "published"), ("Refit (challenger)", "challenger")):
        cells = [f"{pm[f'{key}_{s}_mae']:.2f}" for s in ("minutes", *STATS)]
        out.append(f"| {label} | " + " | ".join(cells) + " |")
    return out


def report(
    weeks: list[pd.Timestamp], game: Decision, player: Decision | None, versions: dict[str, str]
) -> str:
    """The job summary (markdown)."""
    first, last = weeks[0].date(), (weeks[-1] + pd.Timedelta(days=6)).date()
    lines = [
        f"# Weekly retrain, {datetime.now(UTC):%Y-%m-%d}",
        "",
        f"Window: the last {len(weeks)} complete weeks, {first} to {last}. Challengers are weekly "
        "walk-forward refits of the champions' recipes, compared with what was published for the "
        "same games.",
        "",
        f"## Game model: {'promoted' if game.promote else 'kept'}",
        "",
        f"{_sentence(game.reason)}",
    ]
    if game.metrics.get("n"):
        lines += ["", *_game_table(game.metrics)]
    if player is not None:
        verdict = "promoted" if player.promote else "kept"
        lines += ["", f"## Player model: {verdict}", "", _sentence(player.reason)]
        if player.metrics.get("n"):
            n = player.metrics["n"]
            lines += ["", f"Mean absolute error on {n} projected lines whose player played:", ""]
            lines += _player_table(player.metrics)
    named = ", ".join(f"{k} `{v}`" for k, v in versions.items())
    lines += ["", f"Model versions now: {named}."]
    return "\n".join(lines) + "\n"


# --- The weekly job ----------------------------------------------------------------------------


def _version(base: str, day: pd.Timestamp) -> str:
    """'game-v2' -> 'game-v2-r20261123': a refit keeps its lineage (older date replaced)."""
    root = base.split("-r20")[0]
    return f"{root}-r{day:%Y%m%d}"


@dataclass
class RetrainResult:
    weeks: list[pd.Timestamp]
    game: Decision
    player: Decision | None
    versions: dict[str, str]
    pushed: list[str]
    summary: str


def run_retrain(engine: Engine, pull: bool = True, dry_run: bool = False,
                weeks: int = WEEKS) -> RetrainResult:  # fmt: skip
    """Refit both models, compare with what was published, push the ones that are no worse."""
    from tipoff.config import STAGED_DIR
    from tipoff.features.build import build_features, build_tables
    from tipoff.features.elo import EloParams
    from tipoff.features.players import build_player_features
    from tipoff.models.final import load_config as load_game_config
    from tipoff.models.players import load_config as load_player_config
    from tipoff.state import (
        StateError,
        pull_champion,
        pull_player_champion,
        pull_staged,
        push_champion,
        push_player_champion,
    )

    # Pulled history goes to a temporary folder, so a local run never overwrites data/staged.
    with tempfile.TemporaryDirectory() as tmp:
        staged_dir = Path(tmp) if pull else STAGED_DIR
        if pull:
            pull_staged(engine, staged_dir)
        staged = {n: pd.read_parquet(staged_dir / f"{n}.parquet")
                  for n in ("games", "team_games", "player_games")}  # fmt: skip
    params = EloParams.load()
    tables = build_tables(staged["games"], staged["team_games"], staged["player_games"],
                          elo_params=params)  # fmt: skip
    games = build_features(staged["games"], staged["team_games"], staged["player_games"],
                           elo_params=params, tables=tables)  # fmt: skip
    latest = games.loc[games["played"], "game_date"].max()
    window = window_weeks(latest, weeks)
    now = datetime.now(UTC)
    versions: dict[str, str] = {}
    pushed: list[str] = []

    # Game model.
    _, game_info = pull_champion(engine)
    preds, refit, _ = game_challenger(games, load_game_config(), window)
    game = evaluate_game(preds, published_games(engine, preds["game_id"].tolist()))
    versions["game"] = game_info["model_version"]
    if game.promote:
        info = {**game_info, "model_version": _version(game_info["model_version"], latest),
                "run_id": None, "trained_at": now, "trained_through": str(latest.date()),
                "retrain": game.metrics}  # fmt: skip
        versions["game"] = info["model_version"]
        if not dry_run:
            push_champion(engine, refit, info)
            pushed.append(info["model_version"])

    # Player model (skipped if none has been pushed yet).
    player: Decision | None = None
    try:
        current, player_info = pull_player_champion(engine)
    except StateError:
        current = None
    if current is not None:
        pf = build_player_features(tables, staged["team_games"], staged["player_games"])
        ppreds, prefit, _ = player_challenger(pf, load_player_config(), window, current.widen)
        ids = ppreds["game_id"].unique().tolist() if not ppreds.empty else []
        player = evaluate_player(ppreds, published_lines(engine, ids))
        versions["player"] = player_info["model_version"]
        if player.promote:
            info = {**player_info, "model_version": _version(player_info["model_version"], latest),
                    "run_id": None, "trained_at": now, "trained_through": str(latest.date()),
                    "retrain": player.metrics}  # fmt: skip
            versions["player"] = info["model_version"]
            if not dry_run:
                push_player_champion(engine, prefit, info)
                pushed.append(info["model_version"])

    summary = report(window, game, player, versions)
    if dry_run:
        summary += "\nDry run: nothing was pushed.\n"
    return RetrainResult(window, game, player, versions, pushed, summary)
