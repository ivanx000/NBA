"""Team strength and form: season-to-date, last-5/10 and exponentially weighted stats.

Every value for a game uses only that team's earlier games (exclusive sums / shift(1)).
Season-to-date values reset each season and are blended with a prior so early-season rows are
stable: ``(n * current + k * prior) / (n + k)``, where ``n`` is games played so far and the prior is
the team's previous-season average regressed one third of the way to that season's league average.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from tipoff.features.timeline import STATS
from tipoff.seasons import season_from_start_year, season_start_year

PRIOR_REGRESSION = 1 / 3
K_SEASON, K_L10, K_L5, K_EWM = 10.0, 3.0, 2.0, 5.0
EWM_HALFLIFE = 7
L10_STATS = STATS
L5_STATS = ["net_rating", "margin"]
EWM_STATS = ["net_rating"]


def _priors(tl: pd.DataFrame, stats: list[str]) -> pd.DataFrame:
    """Per (team, season): last regular season's mean, regressed toward that league mean."""
    reg = tl[tl["played"] & (tl["season_type"] == "regular")]
    team_mean = reg.groupby(["team_id", "season"])[stats].mean()
    league_mean = reg.groupby("season")[stats].mean()
    regressed = (
        team_mean * (1 - PRIOR_REGRESSION)
        + league_mean.reindex(team_mean.index.get_level_values("season")).to_numpy()
        * PRIOR_REGRESSION
    )

    # Shift to the next season: the prior for season S comes from season S-1.
    def next_season(s: str) -> str:
        return season_from_start_year(season_start_year(s) + 1)

    regressed.index = pd.MultiIndex.from_arrays(
        [regressed.index.get_level_values("team_id"),
         regressed.index.get_level_values("season").map(next_season)],
        names=["team_id", "season"],
    )  # fmt: skip
    league_next = league_mean.copy()
    league_next.index = league_next.index.map(next_season)
    keys = pd.MultiIndex.from_frame(tl[["team_id", "season"]])
    prior = regressed.reindex(keys)
    # Teams with no previous season (none since 2004-05) fall back to the league mean.
    fallback = league_next.reindex(tl["season"]).set_axis(keys)
    return prior.fillna(fallback).reset_index(drop=True)


def _blend(current: pd.Series, n: pd.Series, prior: pd.Series, k: float) -> pd.Series:
    cur = current.fillna(0.0)
    blended = (n * cur + k * prior) / (n + k)
    return blended.where(prior.notna(), current.where(n > 0))


def team_form(tl: pd.DataFrame) -> pd.DataFrame:
    """Pre-game form features per team-game row of ``tl`` (same index)."""
    tl = tl.reset_index(drop=True)
    by_ts = tl.groupby(["team_id", "season"], sort=False)
    played = tl["played"].astype(float)
    n = by_ts["played"].transform(lambda s: s.astype(float).cumsum().shift(1, fill_value=0.0))
    prior = _priors(tl, STATS)
    out = {"games_played": n}

    for stat in STATS:
        vals = tl[stat]
        total = vals.fillna(0.0).groupby([tl["team_id"], tl["season"]]).cumsum() - vals.fillna(0.0)
        std = total / n.replace(0, np.nan)
        out[f"{stat}_std"] = _blend(std, n, prior[stat], K_SEASON)

    for window, stats, k in ((10, L10_STATS, K_L10), (5, L5_STATS, K_L5)):
        cnt = (
            by_ts["played"]
            .transform(lambda s, w=window: s.astype(float).shift(1).rolling(w, min_periods=1).sum())
            .fillna(0.0)
        )
        for stat in stats:
            tot = (
                tl[stat].fillna(0.0).groupby([tl["team_id"], tl["season"]])
                .transform(lambda s, w=window: s.shift(1).rolling(w, min_periods=1).sum())
                .fillna(0.0)
            )  # fmt: skip
            out[f"{stat}_l{window}"] = _blend(tot / cnt.replace(0, np.nan), cnt, prior[stat], k)

    for stat in EWM_STATS:
        ewm = by_ts[stat].transform(
            lambda s: s.shift(1).ewm(halflife=EWM_HALFLIFE, ignore_na=True).mean()
        )
        out[f"{stat}_ewm"] = _blend(ewm, n.clip(upper=10), prior[stat], K_EWM)

    # Home team's home record and away team's road record, season to date.
    loc_played = played * tl["played"]
    by_loc = [tl["team_id"], tl["season"], tl["is_home"]]
    loc_n = loc_played.groupby(by_loc).cumsum() - loc_played
    loc_w = tl["win"].fillna(0.0).groupby(by_loc).cumsum() - tl["win"].fillna(0.0)
    league_home = (
        tl[tl["played"] & tl["is_home"] & ~tl["is_neutral"] & (tl["season_type"] == "regular")]
        .groupby("season")["win"].mean()
    )  # fmt: skip
    prev_home = tl["season"].map(
        lambda s: league_home.get(season_from_start_year(season_start_year(s) - 1), 0.58)
    )
    loc_prior = prev_home.where(tl["is_home"], 1 - prev_home)
    out["venue_win_pct"] = (loc_w + 5.0 * loc_prior) / (loc_n + 5.0)

    return pd.DataFrame(out)
