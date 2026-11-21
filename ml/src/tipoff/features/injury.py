"""The official injury report as a pre-game input (ML_PLAN section 3).

The report used for a game is the one current at the snapshot's cutoff on game day (09:00 ET in
the morning, 17:45 ET in the evening; ``ingest/injury_report.py``). Its publish time is checked,
not its filename, so nothing published after the cutoff can reach a feature.

Each listed player gets a chance of playing from his status (``PLAY_PROBS``, measured on the
2019-20..2023-24 morning reports). Then, per team-game:

- ``injury_adj``: lineup strength with each player's recent minutes times his chance of playing,
  minus the plain lineup strength (``lineup.py``). Minutes a listed player is expected to lose go
  to the rest of the rotation in proportion, so the team total stays the same; a player listed as
  available who's missing from the last five games (back from an injury) comes back at his minutes
  per game over his last five appearances for the team. Zero when the team has no report.
- ``listed_out_min``: recent minutes per game the team is expected to lose to the report.
- ``ir_filed``: 1 if the team's report was in (the morning report can be missing a team on the
  second night of a back-to-back, which files on game day).

Before 2019-20 there are no reports, so these are 0 there.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from tipoff.config import CONFIG_DIR
from tipoff.features.lineup import player_ratings

PLAY_PROBS_PATH = CONFIG_DIR / "injury_play_probs.json"
RETURN_WINDOW = 5
RETURN_MAX_DAYS = 365
LISTED = ("Out", "Doubtful", "Questionable", "Probable", "Available")
NOT_SUBMITTED = "Not Submitted"
COLUMNS = ["injury_adj", "listed_out_min", "ir_filed"]


def load_play_probs(path: Path = PLAY_PROBS_PATH) -> dict[str, float]:
    return json.loads(path.read_text())["play_probs"]


def _abbr_ids() -> dict[str, int]:
    from tipoff.teams import load_teams

    return {t["abbr"]: t["team_id"] for t in load_teams()}


def filed_teams(injuries: pd.DataFrame) -> pd.DataFrame:
    """(game_date, team_id) for both teams of every game in the report, minus teams marked
    'not yet submitted'."""
    abbr = _abbr_ids()
    m = injuries[["game_date", "matchup"]].drop_duplicates()
    sides = m["matchup"].str.split("@")
    both = pd.concat([
        pd.DataFrame({"game_date": m["game_date"], "team_id": sides.str[0].map(abbr)}),
        pd.DataFrame({"game_date": m["game_date"], "team_id": sides.str[1].map(abbr)}),
    ]).dropna()  # fmt: skip
    nys = injuries.loc[injuries["status"] == NOT_SUBMITTED, ["game_date", "team_id"]].dropna()
    both = both.astype({"team_id": "int64"}).drop_duplicates()
    nys = nys.astype({"team_id": "int64"}).drop_duplicates().assign(nys=True)
    both = both.merge(nys, on=["game_date", "team_id"], how="left")
    return both[both["nys"].isna()][["game_date", "team_id"]].reset_index(drop=True)


def listed_players(injuries: pd.DataFrame, probs: dict[str, float]) -> pd.DataFrame:
    """Matched players with a status: game_date, team_id, player_id, status, p (chance to play)."""
    inj = injuries[injuries["player_id"].notna() & injuries["team_id"].notna()
                   & injuries["status"].isin(LISTED)]  # fmt: skip
    out = inj[["game_date", "team_id", "player_id", "status"]].astype(
        {"team_id": "int64", "player_id": "int64"}
    )
    out = out.drop_duplicates(["game_date", "team_id", "player_id"], keep="last")
    return out.assign(p=out["status"].map(probs).astype(float)).reset_index(drop=True)


def recent_minutes(player_games: pd.DataFrame, window: int = RETURN_WINDOW) -> pd.DataFrame:
    """Each player's minutes per game over his last ``window`` appearances for a team, as of
    after each appearance (to be used only for later dates)."""
    pg = player_games[player_games["minutes"] > 0]
    pg = pg[["player_id", "team_id", "game_date", "minutes"]].copy()
    pg["game_date"] = pg["game_date"].astype("datetime64[ns]")
    pg = pg.sort_values(["player_id", "team_id", "game_date"])
    pg["recent_min"] = (
        pg.groupby(["player_id", "team_id"])["minutes"]
        .rolling(window, min_periods=1).mean()
        .reset_index(level=[0, 1], drop=True)
    )  # fmt: skip
    return pg.rename(columns={"game_date": "seen"})[["player_id", "team_id", "seen", "recent_min"]]


def injury_features(
    tl: pd.DataFrame,
    player_games: pd.DataFrame,
    pairs: pd.DataFrame,
    injuries: pd.DataFrame | None,
    probs: dict[str, float] | None = None,
    players_out: list | None = None,
) -> pd.DataFrame:
    """``COLUMNS`` per team-game row of ``tl`` (same order as ``tl.reset_index``).

    ``pairs`` is ``lineup.lineup_pairs(tl, player_games)``; ``injuries`` is one snapshot of the
    staged injury table (``ingest.injury_report.load_staged``), or None for no reports at all.
    If ``players_out`` is a list, the per-player rows behind the numbers are appended to it
    (``row``, ``player_id``, ``lost`` = expected minutes lost, ``back`` = expected minutes back),
    for the player features.
    """
    tl = tl.reset_index(drop=True)
    n = len(tl)
    out = pd.DataFrame({c: np.zeros(n) for c in COLUMNS})
    if injuries is None or injuries.empty:
        return out
    probs = probs or load_play_probs()
    inj = injuries.assign(game_date=pd.to_datetime(injuries["game_date"]).astype("datetime64[ns]"))

    keys = pd.DataFrame({
        "row": np.arange(n), "team_id": tl["team_id"].astype("int64").to_numpy(),
        "game_date": tl["game_date"].astype("datetime64[ns]").to_numpy(),
    })  # fmt: skip
    filed = keys.merge(filed_teams(inj), on=["game_date", "team_id"])
    if filed.empty:
        return out
    out.loc[filed["row"].to_numpy(), "ir_filed"] = 1.0
    listed = listed_players(inj, probs)

    # The rotation behind each filed row's lineup strength, with each player's chance to play.
    pr = pairs[pairs["row"].isin(filed["row"])].merge(
        listed[["game_date", "team_id", "player_id", "p"]],
        on=["game_date", "team_id", "player_id"], how="left",
    )  # fmt: skip
    pr["p"] = pr["p"].fillna(1.0)
    pr["m"] = pr["avg_min"] * pr["p"]

    # Players listed as likely to play who aren't in the recent rotation: back from an injury.
    ret = listed[listed["p"] > 0].merge(filed, on=["game_date", "team_id"])
    in_pairs = pr[["row", "player_id"]].assign(found=True)
    ret = ret.merge(in_pairs, on=["row", "player_id"], how="left")
    ret = ret[ret["found"].isna()].drop(columns="found")
    if len(ret):
        ret = ret.sort_values("game_date")
        recent = recent_minutes(player_games).sort_values("seen")
        ret = pd.merge_asof(
            ret, recent, left_on="game_date", right_on="seen", by=["player_id", "team_id"],
            allow_exact_matches=False, tolerance=pd.Timedelta(days=RETURN_MAX_DAYS),
        )  # fmt: skip
        ratings = player_ratings(player_games).sort_values("game_date")
        ratings = ratings.rename(columns={"game_date": "rated"})
        ret = pd.merge_asof(ret, ratings, left_on="game_date", right_on="rated", by="player_id",
                            allow_exact_matches=False)  # fmt: skip
        ret = ret[ret["recent_min"].notna() & (ret["last_team"] == ret["team_id"])]
        ret = ret.assign(avg_min=0.0, m=ret["recent_min"] * ret["p"])
    cols = ["row", "avg_min", "rating", "m", "p"]
    allp = pd.concat([pr[cols], ret[cols]] if len(ret) else [pr[cols]], ignore_index=True)

    g = allp.assign(plain=allp["avg_min"] * allp["rating"], weighted=allp["m"] * allp["rating"],
                    lost=allp["avg_min"] * (1 - allp["p"])).groupby("row")  # fmt: skip
    agg = g.agg(B=("avg_min", "sum"), M=("m", "sum"), plain=("plain", "sum"),
                weighted=("weighted", "sum"), lost=("lost", "sum"))  # fmt: skip
    ok = (agg["B"] > 0) & (agg["M"] > 0)
    adj = (agg["weighted"] * agg["B"] / agg["M"].where(ok) - agg["plain"]).where(ok, 0.0)
    rows = agg.index.to_numpy(dtype=int)
    out.loc[rows, "injury_adj"] = adj.to_numpy()
    out.loc[rows, "listed_out_min"] = agg["lost"].to_numpy()
    if players_out is not None:
        pc = ["row", "player_id", "avg_min", "m", "p"]
        pl = pd.concat([pr[pc], ret[pc]] if len(ret) else [pr[pc]], ignore_index=True)
        players_out.append(pd.DataFrame({
            "row": pl["row"].to_numpy(dtype=int), "player_id": pl["player_id"].to_numpy(),
            "lost": (pl["avg_min"] * (1 - pl["p"])).to_numpy(),
            "back": np.where(pl["avg_min"] == 0, pl["m"], 0.0),
        }))  # fmt: skip
    return out


def fit_play_probs(
    injuries: pd.DataFrame, player_games: pd.DataFrame, seasons_end: str = "2024-07-01"
) -> dict[str, dict]:
    """Share of listed players who played, by status, in the morning reports before
    ``seasons_end`` (2019-20..2023-24; the validation and test seasons never inform it).

    Counted: matched players who appeared for the team in the 60 days before the game, so
    long-term absences and two-way players don't swamp the rates."""
    inj = injuries[pd.to_datetime(injuries["game_date"]) < pd.Timestamp(seasons_end)]
    listed = listed_players(inj.assign(game_date=pd.to_datetime(inj["game_date"])),
                            dict.fromkeys(LISTED, 0.0))  # fmt: skip
    pg = player_games[["player_id", "team_id", "game_date", "minutes"]].copy()
    pg["game_date"] = pd.to_datetime(pg["game_date"])
    played = pg[pg["minutes"] > 0][["player_id", "team_id", "game_date"]].assign(played=True)
    x = listed.merge(played, on=["player_id", "team_id", "game_date"], how="left")
    x["played"] = x["played"].fillna(False).astype(bool)
    recent = pg[pg["minutes"] > 0].rename(columns={"game_date": "seen"}).sort_values("seen")
    x = pd.merge_asof(x.sort_values("game_date"), recent[["player_id", "team_id", "seen"]],
                      left_on="game_date", right_on="seen", by=["player_id", "team_id"],
                      allow_exact_matches=False, tolerance=pd.Timedelta(days=60))  # fmt: skip
    x = x[x["seen"].notna()]
    rates = x.groupby("status")["played"].agg(["mean", "size"])
    return {
        "play_probs": {s: round(float(rates.loc[s, "mean"]), 3) if s in rates.index else 1.0
                       for s in LISTED},
        "counts": {s: int(rates.loc[s, "size"]) if s in rates.index else 0 for s in LISTED},
    }  # fmt: skip


def player_injury_features(
    rows: pd.DataFrame,
    injuries: pd.DataFrame | None,
    ir_players: pd.DataFrame | None,
    probs: dict[str, float] | None = None,
) -> pd.DataFrame:
    """Per player-game row (game_id, game_date, team_id, player_id), aligned with ``rows``:

    - ``own_play_prob``: his chance of playing from his status (1 if his team filed and he isn't
      listed)
    - ``team_ir_out_min``: teammates' expected lost minutes (minutes per game over the team's
      last 5 games x chance of missing), i.e. minutes freed up for the others; a teammate out
      for weeks has already lost his minutes, so he counts 0 here
    - ``team_ir_out_max``: the largest single teammate's expected lost minutes
    - ``team_ir_back_min``: expected minutes of teammates back from an injury tonight

    ``ir_players`` is ``Tables.ir_players`` (game_id, team_id, player_id, lost, back). All
    missing (NaN) when the team has no report, including every game before 2019-20.
    """
    n = len(rows)
    out = pd.DataFrame({c: np.full(n, np.nan) for c in PLAYER_COLUMNS}, index=rows.index)
    if injuries is None or injuries.empty or ir_players is None:
        return out
    probs = probs or load_play_probs()
    inj = injuries.assign(game_date=pd.to_datetime(injuries["game_date"]).astype("datetime64[ns]"))
    keys = pd.DataFrame({
        "i": np.arange(n),
        "game_id": rows["game_id"].to_numpy(),
        "game_date": pd.to_datetime(rows["game_date"]).astype("datetime64[ns]").to_numpy(),
        "team_id": rows["team_id"].astype("int64").to_numpy(),
        "player_id": rows["player_id"].astype("int64").to_numpy(),
    })  # fmt: skip
    filed = keys.merge(filed_teams(inj), on=["game_date", "team_id"])
    if filed.empty:
        return out
    listed = listed_players(inj, probs)
    key = ["game_id", "team_id"]
    ip = ir_players.sort_values("lost", ascending=False)
    ip = ip.assign(rank=ip.groupby(key).cumcount())
    tot = ip.groupby(key).agg(total=("lost", "sum"), back=("back", "sum"))
    first, second = (ip[ip["rank"] == r].set_index(key) for r in (0, 1))
    tot["max1"] = first["lost"].reindex(tot.index)
    tot["top"] = first["player_id"].reindex(tot.index)
    tot["max2"] = second["lost"].reindex(tot.index)
    f = filed.merge(tot.reset_index(), on=key, how="left")
    own = ip[[*key, "player_id", "lost", "back"]]
    own = own.rename(columns={"lost": "own_lost", "back": "own_back"})
    f = f.merge(own, on=[*key, "player_id"], how="left")
    f = f.merge(listed[["game_date", "team_id", "player_id", "p"]],
                on=["game_date", "team_id", "player_id"], how="left")  # fmt: skip
    for c in ("total", "back", "max1", "max2", "own_lost", "own_back"):
        f[c] = f[c].fillna(0.0)
    idx = rows.index[f["i"].to_numpy()]
    out.loc[idx, "own_play_prob"] = f["p"].fillna(1.0).to_numpy()
    out.loc[idx, "team_ir_out_min"] = (f["total"] - f["own_lost"]).clip(lower=0).to_numpy()
    out.loc[idx, "team_ir_out_max"] = np.where(
        f["top"].to_numpy() == f["player_id"].to_numpy(), f["max2"], f["max1"]
    )
    out.loc[idx, "team_ir_back_min"] = (f["back"] - f["own_back"]).clip(lower=0).to_numpy()
    return out


PLAYER_COLUMNS = ["own_play_prob", "team_ir_out_min", "team_ir_out_max", "team_ir_back_min"]
