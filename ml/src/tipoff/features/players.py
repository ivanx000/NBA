"""Player feature table: one row per player-game, for the stat projections (ML_PLAN section 6).

Rows are a player's regular-season appearances (minutes > 0) plus, for scheduled games, the players
we expect to play (``projection_candidates``). Both go through the same code, so training and
prediction rows can't drift apart.

Every value in a row comes from the player's *earlier* appearances (rolling windows over his
career series, shifted by one) or from pre-game team features (``build_tables``). Targets are the
game's own minutes, points, rebounds and assists, and are missing for scheduled games.

Projections are "if he plays": rows are games the player appeared in, and the candidates for a
scheduled game are the players who appeared in the team's previous game.

Usage is computed from the box score, so the cloud job's cdn.nba.com box scores work too:
``(FGA + 0.44 FTA + TOV) * (team minutes / 5) / (minutes * (team FGA + 0.44 team FTA + team TOV))``.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from tipoff.config import FEATURES_DIR, FIRST_SEASON, STAGED_DIR
from tipoff.features.build import Tables
from tipoff.features.injury import player_injury_features
from tipoff.seasons import season_start_year

# Bump whenever a player feature's definition changes. v2: the official injury report.
PLAYER_FEATURES_VERSION = 2

TARGETS = ["minutes", "pts", "reb", "ast"]
BOX = ["minutes", "pts", "reb", "ast", "oreb", "dreb", "fga", "fta", "fg3a", "tov", "started",
       "poss_used", "poss_avail"]  # fmt: skip

# Players in scope: at least this many minutes per game over their last 10 appearances, and an
# appearance in at least one of the team's last 5 games.
SCOPE_MPG = 10.0

KEY_COLUMNS = ["game_id", "season", "game_date", "player_id", "player_name", "team_id",
               "opp_team_id", "is_home", "played", "in_scope"]  # fmt: skip

MINUTES_FEATURES = [
    "min_l3", "min_l5", "min_l10", "min_l25", "min_ewm", "min_sd_l10", "start_rate_l10",
    "start_rate_l3", "days_rest", "missed_prev", "missed_l5", "games_with_team", "season_apps",
    "team_rest_days", "team_b2b", "team_out_min_share", "team_star_out", "blowout", "team_elo_prob",
    "is_home_f", "season_progress",
]  # fmt: skip
RATE_FEATURES = [
    "pts36_l10", "pts36_l25", "pts36_ewm", "reb36_l10", "reb36_l25", "ast36_l10", "ast36_l25",
    "ast36_ewm", "oreb36_l25", "dreb36_l25", "fga36_l10", "fta36_l10", "fg3a36_l25", "tov36_l25",
    "usage_l10", "usage_l25", "pts_l10", "reb_l10", "ast_l10",
    "opp_def_rating", "opp_pace", "team_pace", "opp_oreb_pct", "opp_dreb_pct", "opp_efg",
    "team_off_rating",
]  # fmt: skip
# The injury report (features/injury.py): missing (NaN) where the team has no report, which
# LightGBM handles natively; every row before 2019-20 is like that.
INJURY_FEATURES = ["own_play_prob", "team_ir_out_min", "team_ir_out_max", "team_ir_back_min"]
V1_FEATURE_COLUMNS = [*MINUTES_FEATURES, *RATE_FEATURES]
FEATURE_COLUMNS = [*V1_FEATURE_COLUMNS, *INJURY_FEATURES]
# The last-10 baseline the models must beat (raw averages over the last 10 appearances).
BASELINE = {"minutes": "min_l10", "pts": "pts_l10", "reb": "reb_l10", "ast": "ast_l10"}

DAYS_REST_CAP = 10.0
EWM_HALFLIFE = 5


def _box_rows(player_games: pd.DataFrame, team_games: pd.DataFrame) -> pd.DataFrame:
    """Regular-season appearances with the extra per-game inputs (starter proxy, usage)."""
    pg = player_games[(player_games["season_type"] == "regular") & (player_games["minutes"] > 0)]
    pg = pg.copy()
    # Starter proxy: the team's five biggest minutes that night (the logs have no starter flag).
    rank = pg.groupby(["game_id", "team_id"])["minutes"].rank(method="first", ascending=False)
    pg["started"] = (rank <= 5).astype(float)
    tg = team_games[["game_id", "team_id", "minutes", "fga", "fta", "tov"]].rename(
        columns={"minutes": "t_min", "fga": "t_fga", "fta": "t_fta", "tov": "t_tov"}
    )
    pg = pg.merge(tg, on=["game_id", "team_id"], how="left")
    team_rate = (pg["t_fga"] + 0.44 * pg["t_fta"] + pg["t_tov"]) / (pg["t_min"] / 5)
    pg["poss_used"] = pg["fga"] + 0.44 * pg["fta"] + pg["tov"]
    pg["poss_avail"] = pg["minutes"] * team_rate  # the team's possessions while he was on
    pg["played"] = True
    return pg


# Players listed with these statuses aren't projected (their chance of playing is small).
NOT_PROJECTED = ("Out", "Doubtful")
RETURN_LOOKBACK_GAMES = 10


def projection_candidates(
    day_games: pd.DataFrame, player_games: pd.DataFrame, injuries: pd.DataFrame | None = None
) -> pd.DataFrame:
    """Players expected to play in scheduled games: those whose most recent regular-season
    appearance (before the games' date) was their team's previous game. ``player_games`` must hold
    only games before that date. Returns game_id, game_date, team_id, player_id, player_name.

    With the day's injury report (one snapshot of the staged table): players listed Out or
    Doubtful are dropped, and players listed as likely to play who appeared for the team in its
    last ``RETURN_LOOKBACK_GAMES`` games but missed the previous one (back from an injury) are
    added."""
    pg = player_games[(player_games["season_type"] == "regular") & (player_games["minutes"] > 0)]
    order = pg.sort_values(["game_date", "game_id"])
    last = order.groupby("player_id").tail(1)[["player_id", "player_name", "team_id", "game_id"]]
    team_games = pg[["game_id", "team_id", "game_date"]].drop_duplicates()
    team_games = team_games.sort_values(["game_date", "game_id"])
    prev_game = team_games.groupby("team_id").tail(1).set_index("team_id")["game_id"]
    regulars = last[last["game_id"].to_numpy() == prev_game.reindex(last["team_id"]).to_numpy()]

    listed = pd.DataFrame(columns=["team_id", "player_id", "status"])
    if injuries is not None and not injuries.empty:
        days = pd.to_datetime(day_games["game_date"]).unique()
        listed = injuries[pd.to_datetime(injuries["game_date"]).isin(days)]
        listed = listed[listed["player_id"].notna() & listed["team_id"].notna()]
        listed = listed[["team_id", "player_id", "status"]].astype(
            {"team_id": "int64", "player_id": "int64"}
        )
        recent = team_games.groupby("team_id").tail(RETURN_LOOKBACK_GAMES)
        apps = pg[pg["game_id"].isin(recent["game_id"])][["player_id", "team_id"]]
        back = listed[~listed["status"].isin(NOT_PROJECTED)].merge(
            apps.drop_duplicates(), on=["player_id", "team_id"]
        )
        # His latest appearance must be for this team (not traded away since).
        back = back.merge(last[["player_id", "player_name", "team_id"]],
                          on=["player_id", "team_id"])  # fmt: skip
        regulars = pd.concat([regulars, back[["player_id", "player_name", "team_id"]]])
        regulars = regulars.drop_duplicates(["player_id", "team_id"])
        out = listed[listed["status"].isin(NOT_PROJECTED)][["player_id", "team_id"]]
        regulars = regulars.merge(out.assign(drop=True), on=["player_id", "team_id"], how="left")
        regulars = regulars[regulars["drop"].isna()]

    rows = []
    for g in day_games.itertuples():
        for team in (g.home_team_id, g.away_team_id):
            for p in regulars[regulars["team_id"] == team].itertuples():
                rows.append((g.game_id, pd.Timestamp(g.game_date), team, p.player_id,
                             p.player_name))  # fmt: skip
    return pd.DataFrame(
        rows, columns=["game_id", "game_date", "team_id", "player_id", "player_name"]
    )


def _window(df: pd.DataFrame, by: pd.Series, cols: list[str], w: int) -> pd.DataFrame:
    """Sums of each column over the previous ``w`` rows of each group (this row excluded)."""
    shifted = df[cols].groupby(by).shift(1)
    return (
        shifted.groupby(by).rolling(w, min_periods=1).sum().reset_index(level=0, drop=True)
        .reindex(df.index)
    )  # fmt: skip


def _per36(num: pd.Series, minutes: pd.Series) -> pd.Series:
    return 36 * num / minutes.where(minutes > 0)


def _team_index(tl: pd.DataFrame) -> pd.Series:
    """Each regular-season team-game's position in the team's history (0, 1, 2, ...)."""
    reg = tl[tl["season_type"] == "regular"].sort_values(["team_id", "game_date", "game_id"])
    idx = reg.groupby("team_id").cumcount()
    return pd.Series(idx.to_numpy(), index=pd.MultiIndex.from_frame(reg[["game_id", "team_id"]]))


def _team_presence(df: pd.DataFrame) -> pd.DataFrame:
    """Per row: missed the team's previous game, team games missed of the last 5, and games
    played for this team so far. Uses the row's earlier appearances for the same team."""
    missed_prev = np.ones(len(df))
    missed_l5 = np.zeros(len(df))
    with_team = np.zeros(len(df))
    for _, rows in df.groupby(["player_id", "team_id"], sort=False):
        pos = rows.index.to_numpy()
        t = rows["team_idx"].to_numpy()
        played = rows["played"].to_numpy()
        # Earlier appearances only (scheduled rows don't count as appearances).
        app_t = np.where(played, t, -10_000)
        prev_apps = np.concatenate([[-10_000], np.maximum.accumulate(app_t)[:-1]])
        missed_prev[pos] = (prev_apps != t - 1).astype(float)
        n_prev = np.concatenate([[0], np.cumsum(played)[:-1]])
        with_team[pos] = n_prev
        app_sorted = t[played]
        recent = np.searchsorted(app_sorted, t - 5, side="left")
        before = np.searchsorted(app_sorted, t, side="left")
        avail = np.minimum(5, t)  # team games that exist in the window
        missed_l5[pos] = avail - (before - recent)
    return pd.DataFrame(
        {"missed_prev": missed_prev, "missed_l5": missed_l5,
         "games_with_team": np.minimum(with_team, 82)},
        index=df.index,
    )  # fmt: skip


def build_player_features(
    tables: Tables,
    team_games: pd.DataFrame,
    player_games: pd.DataFrame,
    upcoming_players: pd.DataFrame | None = None,
    first_season: str = FIRST_SEASON,
) -> pd.DataFrame:
    """Player feature table (see module docstring). ``upcoming_players`` comes from
    ``projection_candidates`` for games that are in ``tables`` as scheduled games."""
    box = _box_rows(player_games, team_games)
    frames = [box[["game_id", "game_date", "team_id", "player_id", "player_name", "played",
                   *BOX]]]  # fmt: skip
    if upcoming_players is not None and not upcoming_players.empty:
        up = upcoming_players.assign(played=False)
        up = up[~up.set_index(["game_id", "player_id"]).index.isin(
            box.set_index(["game_id", "player_id"]).index)]  # fmt: skip
        frames.append(up)
    df = pd.concat(frames, ignore_index=True)
    df["game_date"] = pd.to_datetime(df["game_date"])
    df = df.sort_values(["player_id", "game_date", "game_id"]).reset_index(drop=True)
    by = df["player_id"]

    # Game context from the team timeline: season, opponent, home or away.
    tl = tables.tl.set_index(["game_id", "team_id"])
    ctx = tl.reindex(pd.MultiIndex.from_frame(df[["game_id", "team_id"]]))
    df["season"] = ctx["season"].to_numpy()
    df["opp_team_id"] = ctx["opp_team_id"].to_numpy()
    df["is_home"] = ctx["is_home"].astype(bool).to_numpy()
    df["team_idx"] = _team_index(tables.tl).reindex(
        pd.MultiIndex.from_frame(df[["game_id", "team_id"]])
    ).to_numpy()  # fmt: skip

    out = pd.DataFrame(index=df.index)
    stats = ["minutes", "pts", "reb", "ast", "oreb", "dreb", "fga", "fta", "fg3a", "tov",
             "started", "poss_used", "poss_avail"]  # fmt: skip
    apps = df["played"].astype(float)
    vals = df[stats].astype(float).fillna(0.0)
    vals["n"] = apps
    vals["min_sq"] = vals["minutes"] ** 2
    sums = {w: _window(vals, by, [*stats, "n", "min_sq"], w) for w in (3, 5, 10, 25)}

    def avg(stat: str, w: int) -> pd.Series:
        return sums[w][stat] / sums[w]["n"].where(sums[w]["n"] > 0)

    for w in (3, 5, 10, 25):
        out[f"min_l{w}"] = avg("minutes", w)
    var = avg("min_sq", 10) - avg("minutes", 10) ** 2
    out["min_sd_l10"] = np.sqrt(var.clip(lower=0)).where(sums[10]["n"] > 1, 0.0)
    ewm_min = vals["minutes"].where(df["played"]).groupby(by).shift(1)
    out["min_ewm"] = ewm_min.groupby(by).transform(
        lambda s: s.ewm(halflife=EWM_HALFLIFE, ignore_na=True).mean()
    )
    out["start_rate_l10"] = avg("started", 10)
    out["start_rate_l3"] = avg("started", 3)
    for stat in ("pts", "reb", "ast"):
        out[f"{stat}_l10"] = avg(stat, 10)
        out[f"{stat}36_l10"] = _per36(sums[10][stat], sums[10]["minutes"])
        out[f"{stat}36_l25"] = _per36(sums[25][stat], sums[25]["minutes"])
    for stat in ("pts", "ast"):
        per_min = (vals[stat] / vals["minutes"].where(vals["minutes"] > 0)).where(df["played"])
        shifted = per_min.groupby(by).shift(1)
        out[f"{stat}36_ewm"] = 36 * shifted.groupby(by).transform(
            lambda s: s.ewm(halflife=EWM_HALFLIFE, ignore_na=True).mean()
        )
    for stat in ("oreb", "dreb", "fg3a", "tov"):
        out[f"{stat}36_l25"] = _per36(sums[25][stat], sums[25]["minutes"])
    for stat in ("fga", "fta"):
        out[f"{stat}36_l10"] = _per36(sums[10][stat], sums[10]["minutes"])
    for w in (10, 25):
        out[f"usage_l{w}"] = sums[w]["poss_used"] / sums[w]["poss_avail"].where(
            sums[w]["poss_avail"] > 0
        )

    # Days since his previous appearance; games this season so far.
    prev_date = df["game_date"].where(df["played"]).groupby(by).shift(1)
    prev_date = prev_date.groupby(by).ffill()
    out["days_rest"] = ((df["game_date"] - prev_date).dt.days.astype(float)).clip(
        upper=DAYS_REST_CAP
    ).fillna(DAYS_REST_CAP)  # fmt: skip
    season_n = apps.groupby([by, df["season"]]).cumsum() - apps
    out["season_apps"] = season_n.clip(upper=82)
    out["apps_total"] = apps.groupby(by).cumsum() - apps
    out = out.join(_team_presence(df))

    # Team context (pre-game team features for his team and the opponent; Elo).
    team = tables.team
    own = team.reindex(pd.MultiIndex.from_frame(df[["game_id", "team_id"]]))
    opp = team.reindex(pd.MultiIndex.from_arrays([df["game_id"], df["opp_team_id"]]))
    out["team_rest_days"] = own["rest_days"].to_numpy()
    out["team_b2b"] = own["b2b"].to_numpy()
    out["team_out_min_share"] = own["out_min_share"].to_numpy()
    out["team_star_out"] = own["star_out"].to_numpy()
    out["team_pace"] = own["pace_std"].to_numpy()
    out["team_off_rating"] = own["off_rating_std"].to_numpy()
    out["season_progress"] = own["games_played"].to_numpy() / 82
    out["opp_def_rating"] = opp["def_rating_std"].to_numpy()
    out["opp_pace"] = opp["pace_std"].to_numpy()
    out["opp_oreb_pct"] = opp["oreb_pct_std"].to_numpy()
    out["opp_dreb_pct"] = opp["dreb_pct_std"].to_numpy()
    out["opp_efg"] = opp["opp_efg_std"].to_numpy()  # what the opponent allows
    e = tables.elo.reindex(df["game_id"])
    home_edge = (e["elo_home"] + e["elo_hfa"] - e["elo_away"]).to_numpy()
    edge = np.where(df["is_home"], home_edge, -home_edge)
    out["blowout"] = np.abs(edge)
    p_home = e["elo_prob_home"].to_numpy()
    out["team_elo_prob"] = np.where(df["is_home"], p_home, 1 - p_home)
    out["is_home_f"] = df["is_home"].astype(float)
    out = out.join(player_injury_features(df, tables.injuries, tables.ir_players))

    res = df[["game_id", "season", "game_date", "player_id", "player_name", "team_id",
              "opp_team_id", "is_home", "played"]].copy()  # fmt: skip
    res["in_scope"] = (
        (out["apps_total"] > 0)
        & (out["min_l10"] >= SCOPE_MPG)
        & (out["missed_l5"] < 5)  # an appearance in the team's last 5 games
        & df["opp_team_id"].notna().to_numpy()
    )
    for c in TARGETS:
        res[c] = df[c].where(df["played"]).astype(float)
    res = pd.concat([res, out[FEATURE_COLUMNS]], axis=1)
    res[FEATURE_COLUMNS] = res[FEATURE_COLUMNS].astype(float)
    in_window = res["season"].map(
        lambda s: season_start_year(s) if isinstance(s, str) else -1
    ) >= season_start_year(first_season)
    return (
        res[in_window]
        .sort_values(["game_date", "game_id", "team_id", "player_id"])
        .reset_index(drop=True)
    )


def player_features_hash(df: pd.DataFrame) -> str:
    """Hash of the player feature schema and data window (stored with projections)."""
    played = df[df["played"]]
    payload = {
        "version": PLAYER_FEATURES_VERSION,
        "columns": [[c, str(df[c].dtype)] for c in df.columns],
        "window": [str(played["game_date"].min().date()), str(played["game_date"].max().date())],
        "rows": len(played),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def build_and_save_players(
    staged_dir: Path = STAGED_DIR, out_dir: Path = FEATURES_DIR
) -> tuple[pd.DataFrame, str]:
    """Build the player feature table from the staged tables and save it with its hash."""
    from tipoff.features.build import build_tables
    from tipoff.features.elo import EloParams
    from tipoff.features.schemas import PlayerFeatures
    from tipoff.ingest.injury_report import load_staged

    staged = {n: pd.read_parquet(staged_dir / f"{n}.parquet")
              for n in ("games", "team_games", "player_games")}  # fmt: skip
    tables = build_tables(staged["games"], staged["team_games"], staged["player_games"],
                          elo_params=EloParams.load(),
                          injuries=load_staged(staged_dir, "am"))  # fmt: skip
    df = build_player_features(tables, staged["team_games"], staged["player_games"])
    df = PlayerFeatures.validate(df, lazy=True)
    digest = player_features_hash(df)
    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_dir / "player_features.parquet", index=False)
    meta = {
        "features_hash": digest,
        "version": PLAYER_FEATURES_VERSION,
        "feature_columns": FEATURE_COLUMNS,
        "rows": len(df),
        "in_scope_rows": int(df["in_scope"].sum()),
    }
    (out_dir / "player_features.meta.json").write_text(json.dumps(meta, indent=2))
    return df, digest
