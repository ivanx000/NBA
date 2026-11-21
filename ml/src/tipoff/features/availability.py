"""Player availability, v1: who missed the team's previous game.

At prediction time (about 10 AM ET) we don't know who will play tonight, so v1 uses what we do know:
which rotation players didn't appear in the team's previous game. A rotation player averages at
least 20 minutes over the team's last 10 games. Players whose most recent appearance was for another
team (traded) are not counted. The official injury report is a separate input (features/injury.py).

Features per team-game:
- ``out_min_share``: season-to-date share of the team's minutes played by those missing players
- ``star_out``: 1 if one of the team's top two scorers (season-to-date points per game) is missing
"""

from __future__ import annotations

import numpy as np
import pandas as pd

ROTATION_MPG = 20.0
ROTATION_WINDOW = 10
MIN_GAMES_FOR_STAR = 5


def availability_features(tl: pd.DataFrame, player_games: pd.DataFrame) -> pd.DataFrame:
    """Per team-game row of ``tl`` (sorted by team, season, date). Same index as ``tl``."""
    tl = tl.reset_index(drop=True)
    pg = player_games[["game_id", "team_id", "player_id", "game_date", "minutes", "pts"]]
    out_share = np.zeros(len(tl))
    star_out = np.zeros(len(tl))

    # Each player's most recent appearance before a date, for the traded-player check.
    last_seen = pg.sort_values("game_date")[["player_id", "game_date", "team_id"]]

    candidates = []  # (row index, team_id, game_date, player_id, share, is_star)
    for (team, _season), rows in tl.groupby(["team_id", "season"], sort=False):
        idx = rows.index.to_numpy()
        gids = rows["game_id"].to_numpy()
        team_pg = pg[(pg["team_id"] == team) & pg["game_id"].isin(gids)]
        if team_pg.empty:
            continue
        pos = {g: i for i, g in enumerate(gids)}
        players = np.sort(team_pg["player_id"].unique())
        col = {p: j for j, p in enumerate(players)}
        mins = np.zeros((len(gids), len(players)))
        pts = np.zeros_like(mins)
        appeared = np.zeros_like(mins, dtype=bool)
        r = team_pg["game_id"].map(pos).to_numpy()
        c = team_pg["player_id"].map(col).to_numpy()
        mins[r, c] = team_pg["minutes"].to_numpy()
        pts[r, c] = team_pg["pts"].to_numpy()
        appeared[r, c] = True
        played_game = rows["played"].to_numpy()
        game_dates = rows["game_date"].to_numpy()

        # Everything below is "before game i": cumulative sums exclude row i.
        cum_min = np.cumsum(mins, axis=0) - mins
        cum_pts = np.cumsum(pts, axis=0) - pts
        cum_app = np.cumsum(appeared, axis=0) - appeared
        team_min = cum_min.sum(axis=1)
        games_before = np.cumsum(played_game) - played_game
        for i in range(1, len(gids)):
            prev = i - 1
            if not played_game[prev]:
                continue
            lo = max(0, i - ROTATION_WINDOW)
            n_win = played_game[lo:i].sum()
            if n_win == 0 or team_min[i] == 0:
                continue
            mpg = mins[lo:i].sum(axis=0) / n_win
            missing = (mpg >= ROTATION_MPG) & ~appeared[prev]
            if not missing.any():
                continue
            ppg = np.where(
                cum_app[i] >= MIN_GAMES_FOR_STAR, cum_pts[i] / np.maximum(cum_app[i], 1), 0
            )
            stars = set(np.argsort(-ppg)[:2]) if games_before[i] >= MIN_GAMES_FOR_STAR else set()
            for j in np.flatnonzero(missing):
                candidates.append(
                    (idx[i], team, game_dates[i], players[j],
                     cum_min[i, j] / team_min[i], j in stars)
                )  # fmt: skip

    if candidates:
        cand = pd.DataFrame(
            candidates, columns=["row", "team_id", "game_date", "player_id", "share", "star"]
        ).sort_values("game_date")
        # Drop players whose latest appearance before this game was for a different team.
        seen = pd.merge_asof(
            cand, last_seen.rename(columns={"team_id": "last_team"}), on="game_date",
            by="player_id", allow_exact_matches=False,
        )  # fmt: skip
        seen = seen[seen["last_team"] == seen["team_id"]]
        agg = seen.groupby("row").agg(share=("share", "sum"), star=("star", "max"))
        out_share[agg.index.to_numpy()] = agg["share"].to_numpy()
        star_out[agg.index.to_numpy()] = agg["star"].astype(float).to_numpy()

    return pd.DataFrame({"out_min_share": out_share, "star_out": star_out})
