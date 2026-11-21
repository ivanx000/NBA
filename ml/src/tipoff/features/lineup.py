"""Lineup strength: how good a team's recent rotation is, from its players' box scores.

Each player has a rating: Game Score per minute (John Hollinger's box-score composite), averaged
over his games with weights that halve every ``HALF_LIFE_GAMES`` games and shrunk toward the
league average by ``PRIOR_MINUTES`` of average play. A team's ``lineup_strength`` before a game is
the sum, over the players who played in its previous ``WINDOW`` games, of the player's average
minutes in those games times his rating as of his latest game before this one.

Only games strictly before the game date are used, so a game's own box score never reaches it.
It knows that a player has been out (his recent minutes drop) or has joined the rotation; players
whose latest appearance was for another team (traded) don't count, as in availability v1.
Study: ml/reports/elo_gap_study.md.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

HALF_LIFE_GAMES = 25.0
PRIOR_MINUTES = 300.0
WINDOW = 5
# League Game Score per minute over the training seasons (2015-16..2023-24), fixed so later
# seasons never move it.
LEAGUE_GS_PER_MIN = 0.3576
# A team with no recent games to go on (the start of the data): average players, 240 minutes.
DEFAULT_STRENGTH = 240.0 * LEAGUE_GS_PER_MIN

BOX = ["pts", "fgm", "fga", "fta", "ftm", "oreb", "dreb", "stl", "ast", "blk", "pf", "tov"]


def game_score(pg: pd.DataFrame) -> np.ndarray:
    return (
        pg["pts"] + 0.4 * pg["fgm"] - 0.7 * pg["fga"] - 0.4 * (pg["fta"] - pg["ftm"])
        + 0.7 * pg["oreb"] + 0.3 * pg["dreb"] + pg["stl"] + 0.7 * pg["ast"] + 0.7 * pg["blk"]
        - 0.4 * pg["pf"] - pg["tov"]
    ).to_numpy(dtype=float)  # fmt: skip


def player_ratings(player_games: pd.DataFrame) -> pd.DataFrame:
    """Each player's rating AFTER each of his games (to be used only for later games)."""
    pg = player_games.sort_values(["player_id", "game_date", "game_id"]).reset_index(drop=True)
    gs = game_score(pg)
    mins = pg["minutes"].to_numpy(dtype=float)
    pid = pg["player_id"].to_numpy()
    decay = 0.5 ** (1.0 / HALF_LIFE_GAMES)
    s_out, m_out = np.empty(len(pg)), np.empty(len(pg))
    s = m = 0.0
    for i in range(len(pg)):
        if i == 0 or pid[i] != pid[i - 1]:
            s = m = 0.0
        s = decay * s + gs[i]
        m = decay * m + mins[i]
        s_out[i], m_out[i] = s, m
    rating = (s_out + PRIOR_MINUTES * LEAGUE_GS_PER_MIN) / (m_out + PRIOR_MINUTES)
    return pd.DataFrame({
        "player_id": pid,
        "game_date": pg["game_date"].astype("datetime64[ns]").to_numpy(),
        "last_team": pg["team_id"].to_numpy(),
        "rating": rating,
    })  # fmt: skip


def lineup_pairs(tl: pd.DataFrame, player_games: pd.DataFrame) -> pd.DataFrame:
    """The players behind each team-game's ``lineup_strength``: one row per (``row`` of ``tl``,
    player) with his average minutes over the team's previous ``WINDOW`` games and his rating
    before the game. Traded players (latest appearance for another team) are left out."""
    tl = tl.reset_index(drop=True)
    pg = player_games[["game_id", "team_id", "player_id", "game_date", "minutes", *BOX]].copy()
    pg["game_date"] = pg["game_date"].astype("datetime64[ns]")
    ratings = player_ratings(pg).sort_values("game_date")
    row_dates = tl["game_date"].astype("datetime64[ns]").to_numpy()

    pairs = []  # (tl row, team, date, player, average minutes)
    for team, rows in tl.groupby("team_id", sort=False):
        team_pg = pg[pg["team_id"] == team]
        if team_pg.empty:
            continue
        games = team_pg.drop_duplicates("game_id").sort_values(["game_date", "game_id"])
        pos = {g: i for i, g in enumerate(games["game_id"])}
        players = np.sort(team_pg["player_id"].unique())
        col = {p: j for j, p in enumerate(players)}
        mins = np.zeros((len(games), len(players)))
        mins[team_pg["game_id"].map(pos).to_numpy(), team_pg["player_id"].map(col).to_numpy()] = (
            team_pg["minutes"].to_numpy()
        )
        cum = np.vstack([np.zeros(len(players)), np.cumsum(mins, axis=0)])
        idx = rows.index.to_numpy()
        # Team games strictly before each row's date.
        n = np.searchsorted(games["game_date"].to_numpy(), row_dates[idx], side="left")
        lo = np.maximum(n - WINDOW, 0)
        count = n - lo
        has = count > 0
        avg = np.zeros((len(idx), len(players)))
        avg[has] = (cum[n[has]] - cum[lo[has]]) / count[has, None]
        r, c = np.nonzero(avg > 0)
        pairs.append(pd.DataFrame({
            "row": idx[r], "team_id": team, "game_date": row_dates[idx[r]],
            "player_id": players[c], "avg_min": avg[r, c],
        }))  # fmt: skip

    cols = ["row", "team_id", "game_date", "player_id", "avg_min", "rating"]
    if not pairs:
        return pd.DataFrame(columns=cols)
    cand = pd.concat(pairs, ignore_index=True).sort_values("game_date")
    cand = pd.merge_asof(cand, ratings, on="game_date", by="player_id",
                         allow_exact_matches=False)  # fmt: skip
    cand = cand[cand["last_team"] == cand["team_id"]]
    return cand[cols].reset_index(drop=True)


def strength_from_pairs(pairs: pd.DataFrame, n_rows: int) -> np.ndarray:
    """Sum of average minutes x rating per row; the league default where there's nothing."""
    strength = np.full(n_rows, np.nan)
    if len(pairs):
        total = (pairs["avg_min"] * pairs["rating"]).groupby(pairs["row"]).sum()
        strength[total.index.to_numpy(dtype=int)] = total.to_numpy()
    return np.where(np.isfinite(strength) & (strength > 0), strength, DEFAULT_STRENGTH)


def lineup_features(tl: pd.DataFrame, player_games: pd.DataFrame) -> pd.DataFrame:
    """``lineup_strength`` per team-game row of ``tl`` (same index as ``tl.reset_index``)."""
    pairs = lineup_pairs(tl, player_games)
    return pd.DataFrame({"lineup_strength": strength_from_pairs(pairs, len(tl))})
