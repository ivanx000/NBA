"""Shared inputs for feature builders.

``prepare_games`` merges played games (staged) with scheduled ones (no result yet). Feature code
never sees a played game's result unless it comes from a strictly earlier row of the same team.

``team_timeline`` explodes games into one row per team-game, from that team's point of view,
with per-game stats (NaN for games not yet played).
"""

from __future__ import annotations

import pandas as pd

GAME_COLS = [
    "game_id", "season", "season_type", "game_date", "home_team_id", "away_team_id", "is_neutral",
]  # fmt: skip

# Per-game team stats used by the form features (team point of view).
STATS = [
    "net_rating", "off_rating", "def_rating", "pace",
    "efg", "tov_pct", "oreb_pct", "ft_rate",  # offence: the four factors
    "opp_efg", "opp_tov_pct", "dreb_pct", "opp_ft_rate",  # defence: opponents' four factors
    "margin", "win",
]  # fmt: skip


def prepare_games(staged_games: pd.DataFrame, upcoming: pd.DataFrame | None = None) -> pd.DataFrame:
    """Played games plus scheduled ones. Scheduled rows have ``played=False`` and no scores."""
    played = staged_games.assign(played=True)
    frames = [played]
    if upcoming is not None and not upcoming.empty:
        up = upcoming[~upcoming["game_id"].isin(played["game_id"])][GAME_COLS].copy()
        up["game_date"] = pd.to_datetime(up["game_date"])
        up = up.assign(
            played=False, home_pts=pd.NA, away_pts=pd.NA, home_win=pd.NA, overtimes=pd.NA
        )
        frames.append(up)
    games = pd.concat(frames, ignore_index=True)
    games["game_date"] = pd.to_datetime(games["game_date"])
    return games.sort_values(["game_date", "game_id"]).reset_index(drop=True)


def _game_stats(team_games: pd.DataFrame) -> pd.DataFrame:
    """Per team-game stats including the four factors, computed from the base box score."""
    tg = team_games
    opp = tg[["game_id", "team_id", "fgm", "fga", "fg3m", "fta", "ftm", "oreb", "dreb", "tov"]]
    m = tg.merge(opp, left_on=["game_id", "opp_team_id"], right_on=["game_id", "team_id"],
                 suffixes=("", "_o"))  # fmt: skip

    def efg(fgm, fg3m, fga):
        return (fgm + 0.5 * fg3m) / fga

    def tov_pct(tov, fga, fta):
        return tov / (fga + 0.44 * fta + tov)

    return pd.DataFrame(
        {
            "game_id": m["game_id"],
            "team_id": m["team_id"],
            "net_rating": m["off_rating"] - m["def_rating"],
            "off_rating": m["off_rating"],
            "def_rating": m["def_rating"],
            "pace": m["pace"],
            "efg": efg(m["fgm"], m["fg3m"], m["fga"]),
            "tov_pct": tov_pct(m["tov"], m["fga"], m["fta"]),
            "oreb_pct": m["oreb"] / (m["oreb"] + m["dreb_o"]),
            "ft_rate": m["ftm"] / m["fga"],
            "opp_efg": efg(m["fgm_o"], m["fg3m_o"], m["fga_o"]),
            "opp_tov_pct": tov_pct(m["tov_o"], m["fga_o"], m["fta_o"]),
            "dreb_pct": m["dreb"] / (m["dreb"] + m["oreb_o"]),
            "opp_ft_rate": m["ftm_o"] / m["fga_o"],
            "margin": (m["pts"] - m["opp_pts"]).astype(float),
            "win": m["win"].astype(float),
        }
    )


def team_timeline(games: pd.DataFrame, team_games: pd.DataFrame) -> pd.DataFrame:
    """One row per team per game (played or scheduled), sorted by team then date."""
    base = games[[*GAME_COLS, "played"]]
    home = base.assign(team_id=base["home_team_id"], opp_team_id=base["away_team_id"], is_home=True)
    away = base.assign(
        team_id=base["away_team_id"], opp_team_id=base["home_team_id"], is_home=False
    )
    tl = pd.concat([home, away], ignore_index=True)
    tl = tl.rename(columns={"home_team_id": "venue_team_id"}).drop(columns="away_team_id")
    tl = tl.merge(_game_stats(team_games), on=["game_id", "team_id"], how="left")
    tl.loc[~tl["played"], STATS] = float("nan")
    return tl.sort_values(["team_id", "game_date", "game_id"]).reset_index(drop=True)
