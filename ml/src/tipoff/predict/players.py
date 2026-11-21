"""Player projections for a date's scheduled games, and the walk-forward backfill.

Candidates are the players who appeared in their team's previous game (``projection_candidates``);
they go through the same feature code as training. Each team's top ``TOP_N`` in-scope players by
projected minutes are kept. Projections mean "if he plays".
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import pandas as pd

from tipoff.config import FIRST_SEASON, PREDICTIONS_DIR, STAGED_DIR
from tipoff.features.build import build_tables
from tipoff.features.elo import EloParams
from tipoff.features.players import (
    FEATURE_COLUMNS,
    build_player_features,
    player_features_hash,
    projection_candidates,
)
from tipoff.models.players import STATS, PlayerModel, from_config, load_config, player_split
from tipoff.seasons import season_start_year

TOP_N = 8
UPCOMING_COLS = ["game_id", "season", "season_type", "game_date", "home_team_id",
                 "away_team_id", "is_neutral"]  # fmt: skip
PROJ_COLS = ["minutes", *STATS, *(f"{s}_{e}" for s in STATS for e in ("lo", "hi"))]


def top_players(rows: pd.DataFrame, pred: pd.DataFrame, n: int = TOP_N) -> pd.DataFrame:
    """Each team-game's ``n`` players with the most projected minutes, with their projections."""
    out = pd.concat([rows.reset_index(drop=True), pred.reset_index(drop=True)[PROJ_COLS]
                     .add_prefix("proj_")], axis=1)  # fmt: skip
    out = out.sort_values(["game_id", "team_id", "proj_minutes"], ascending=[True, True, False])
    return out.groupby(["game_id", "team_id"], sort=False).head(n).reset_index(drop=True)


def injury_status(rows: pd.DataFrame, injuries: pd.DataFrame | None, day: date) -> pd.Series:
    """Each row's status on ``day``'s injury report (e.g. "Questionable"), or None if unlisted."""
    none = pd.Series([None] * len(rows), index=rows.index, dtype=object)
    if injuries is None or injuries.empty:
        return none
    inj = injuries[(pd.to_datetime(injuries["game_date"]) == pd.Timestamp(day))
                   & injuries["player_id"].notna() & injuries["team_id"].notna()]  # fmt: skip
    if inj.empty:
        return none
    inj = inj.astype({"team_id": "int64", "player_id": "int64"})
    status = inj.drop_duplicates(["team_id", "player_id"], keep="last").set_index(
        ["team_id", "player_id"])["status"]  # fmt: skip
    keys = pd.MultiIndex.from_arrays([rows["team_id"].astype("int64"),
                                      rows["player_id"].astype("int64")])  # fmt: skip
    vals = status.reindex(keys).to_numpy(dtype=object)
    return pd.Series([None if pd.isna(v) else str(v) for v in vals], index=rows.index)


def load_player_model(model_source: str = "mlflow", engine=None) -> tuple[PlayerModel, dict]:
    """The champion PlayerModel and its provenance, from MLflow (local) or pipeline_state."""
    if model_source == "db":
        from tipoff.state import pull_player_champion

        model, info = pull_player_champion(engine)
        info["trained_at"] = pd.Timestamp(info["trained_at"]).to_pydatetime()
        return model, info
    from tipoff.models.train_player import load_player_champion

    return load_player_champion()


def _rows_for_publish(top: pd.DataFrame, sched: pd.DataFrame, info: dict[str, Any],
                      digest: str, source: str) -> pd.DataFrame:  # fmt: skip
    games = sched.set_index("game_id")
    g = games.reindex(top["game_id"])
    return pd.DataFrame({
        "game_id": top["game_id"].to_numpy(),
        "season": g["season"].to_numpy(),
        "game_date": pd.to_datetime(g["game_date"]).dt.date.to_numpy(),
        "tipoff_utc": g["tipoff_utc"].to_numpy() if "tipoff_utc" in g else pd.NaT,
        "home_team_id": g["home_team_id"].to_numpy(),
        "away_team_id": g["away_team_id"].to_numpy(),
        "is_neutral": g["is_neutral"].to_numpy(),
        "player_id": top["player_id"].to_numpy(),
        "team_id": top["team_id"].to_numpy(),
        "player_name": top["player_name"].to_numpy(),
        **{f"proj_{c}": top[f"proj_{c}"].to_numpy() for c in PROJ_COLS},
        "features_hash": digest,
        "model_version": info["model_version"],
        "mlflow_run_id": info.get("run_id"),
        "trained_at": info["trained_at"],
        "train_window": f"2015-16..{info.get('trained_through')}",
        "generated_at": datetime.now(UTC),
        "source": source,
    })  # fmt: skip


def project_date(
    day: date, model_source: str = "mlflow", engine=None, injuries: pd.DataFrame | None = None
) -> pd.DataFrame:
    """Projections for the players in ``day``'s unplayed regular-season games. With the injury
    report (``injuries``, as for ``predict_date``), players listed Out or Doubtful aren't
    projected, players back from an injury are, and each row carries the player's status."""
    from tipoff.predict.run import scheduled_games

    sched = scheduled_games(day)
    if sched.empty:
        return pd.DataFrame()
    staged = {n: pd.read_parquet(STAGED_DIR / f"{n}.parquet")
              for n in ("games", "team_games", "player_games")}  # fmt: skip
    played_ids = set(staged["games"]["game_id"])
    sched = sched[~sched["game_id"].isin(played_ids)]
    if sched.empty:
        return pd.DataFrame()
    before = staged["player_games"][staged["player_games"]["game_date"] < pd.Timestamp(day)]
    cand = projection_candidates(sched, before, injuries)
    tables = build_tables(staged["games"], staged["team_games"], staged["player_games"],
                          upcoming=sched[UPCOMING_COLS], elo_params=EloParams.load(),
                          injuries=injuries)  # fmt: skip
    feats = build_player_features(tables, staged["team_games"], staged["player_games"], cand)
    digest = player_features_hash(feats)
    rows = feats[(feats["game_date"] == pd.Timestamp(day)) & ~feats["played"] & feats["in_scope"]]
    if rows.empty:
        return pd.DataFrame()
    model, info = load_player_model(model_source, engine)
    top = top_players(rows, model.predict(rows))
    out = _rows_for_publish(top, sched, info, digest, "live")
    out["injury_status"] = injury_status(out, injuries, day)
    (PREDICTIONS_DIR / "players").mkdir(parents=True, exist_ok=True)
    out.to_parquet(PREDICTIONS_DIR / "players" / f"{day.isoformat()}.parquet", index=False)
    return out


def backfill_projections(seasons: list[str], model_version: str, widen: dict[str, float],
                         df: pd.DataFrame | None = None, cfg: dict | None = None,
                         features_hash: str | None = None) -> pd.DataFrame:  # fmt: skip
    """Weekly walk-forward: for each week, fit on every in-scope player-game before it and project
    that week's appearances (top 8 per team-game). ``widen`` is the out-of-time range correction
    (the champion's). Rows carry the actual lines and ``data_cutoff``."""
    from tipoff.models.players import load_player_features

    cfg = cfg or load_config()
    if df is None:
        df, meta = load_player_features()
        features_hash = meta["features_hash"]
    in_window = df["season"].map(season_start_year) >= season_start_year(FIRST_SEASON)
    df = df[in_window]
    games = pd.read_parquet(STAGED_DIR / "games.parquet")
    generated_at = datetime.now(UTC)
    info = {"model_version": model_version, "run_id": None, "trained_at": generated_at,
            "trained_through": "weekly walk-forward"}  # fmt: skip
    out = []
    for season in seasons:
        target = player_split(df, season, (season,)).meta
        if target.empty:
            continue
        week_start = target["game_date"].min().normalize()
        week_start -= pd.Timedelta(days=week_start.weekday())  # Monday
        while week_start <= target["game_date"].max():
            week_end = week_start + pd.Timedelta(days=7)
            now = target[(target["game_date"] >= week_start) & (target["game_date"] < week_end)]
            if not now.empty:
                past = df[(df["game_date"] < week_start) & df["played"] & df["in_scope"]]
                model = from_config(cfg).fit(past[FEATURE_COLUMNS], past[["minutes", *STATS]])
                model.widen = dict(widen)
                top = top_players(now, model.predict(now[FEATURE_COLUMNS]))
                rows = _rows_for_publish(top, games, info, features_hash or "unknown", "backfill")
                rows["data_cutoff"] = (week_start - pd.Timedelta(days=1)).date()
                for c in ("minutes", *STATS):
                    rows[f"actual_{c}"] = top[c].to_numpy()
                out.append(rows)
            week_start = week_end
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


def save(proj: pd.DataFrame, name: str) -> None:
    (PREDICTIONS_DIR / "players").mkdir(parents=True, exist_ok=True)
    proj.to_parquet(PREDICTIONS_DIR / "players" / f"{name}.parquet", index=False)
