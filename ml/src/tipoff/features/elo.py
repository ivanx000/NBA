"""Elo ratings for game outcomes.

Ratings are read before a game and updated after it, in date order. Every team plays at most once
per date, so a game's own result can never reach its pre-game ratings. Playoff and play-in games
update ratings too. Neutral-site games get no home-court edge.

Parameters (K, home advantage, season carry-over, margin-of-victory multiplier) are tuned by grid
search on Elo's own log loss over the training seasons only (``tune``), and saved to
``ml/config/elo_params.json``.
"""

from __future__ import annotations

import itertools
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from tipoff.config import ELO_PARAMS_PATH, TRAIN_SEASONS
from tipoff.seasons import season_start_year

MEAN_RATING = 1505.0
DEFAULT_HOME_WIN_RATE = 0.58  # used for rolling home advantage when there's no history


@dataclass(frozen=True)
class EloParams:
    k: float = 20.0
    home_adv: float = 70.0  # Elo points; ignored when hfa_mode == "rolling"
    hfa_mode: str = "fixed"  # "fixed" | "rolling" (from the previous two seasons' home win rate)
    carryover: float = 0.75  # share of rating kept between seasons (rest regresses to the mean)
    mov: bool = True  # margin-of-victory multiplier (FiveThirtyEight-style)

    def save(self, path: Path = ELO_PARAMS_PATH, **extra: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({**asdict(self), **extra}, indent=2, sort_keys=True) + "\n")

    @classmethod
    def load(cls, path: Path = ELO_PARAMS_PATH) -> EloParams:
        if not path.exists():
            return cls()
        data = json.loads(path.read_text())
        return cls(**{k: data[k] for k in cls.__dataclass_fields__})


def expected_home(home: float, away: float, hfa: float) -> float:
    return 1.0 / (1.0 + 10.0 ** (-(home + hfa - away) / 400.0))


def rate_to_elo_points(home_win_rate: float) -> float:
    """Home-court edge in Elo points implied by a league home win rate."""
    h = min(max(home_win_rate, 0.5), 0.75)
    return 400.0 * math.log10(h / (1.0 - h))


def rolling_home_adv(games: pd.DataFrame) -> dict[str, float]:
    """season -> Elo home edge from the previous two seasons' regular-season home win rate."""
    reg = games[(games["season_type"] == "regular") & ~games["is_neutral"] & games["played"]]
    rate = reg.groupby("season")["home_win"].agg(["sum", "size"])
    seasons = sorted(games["season"].unique(), key=season_start_year)
    out = {}
    for season in seasons:
        prev = [s for s in rate.index if season_start_year(s) in
                (season_start_year(season) - 1, season_start_year(season) - 2)]  # fmt: skip
        if prev:
            wins, n = rate.loc[prev, "sum"].sum(), rate.loc[prev, "size"].sum()
            out[season] = rate_to_elo_points(wins / n)
        else:
            out[season] = rate_to_elo_points(DEFAULT_HOME_WIN_RATE)
    return out


def run_elo(games: pd.DataFrame, params: EloParams) -> pd.DataFrame:
    """Pre-game ratings for every game (played or scheduled).

    ``games`` needs: game_id, season, season_type, game_date, home_team_id, away_team_id,
    is_neutral, played, home_pts, away_pts. Returns game_id, elo_home, elo_away, elo_hfa,
    elo_prob_home.
    """
    g = games.sort_values(["game_date", "game_id"]).reset_index(drop=True)
    hfa_by_season = rolling_home_adv(g) if params.hfa_mode == "rolling" else {}
    ratings: dict[int, float] = {}
    team_season: dict[int, str] = {}

    n = len(g)
    out_home, out_away, out_hfa, out_prob = (np.empty(n) for _ in range(4))
    cols = [
        "season",
        "home_team_id",
        "away_team_id",
        "is_neutral",
        "played",
        "home_pts",
        "away_pts",
    ]
    for i, (season, h, a, neutral, played, hp, ap) in enumerate(g[cols].itertuples(index=False)):
        for team in (h, a):
            r = ratings.get(team, MEAN_RATING)
            if team in team_season and team_season[team] != season:
                r = params.carryover * r + (1 - params.carryover) * MEAN_RATING
            ratings[team] = r
            team_season[team] = season
        rh, ra = ratings[h], ratings[a]
        hfa = 0.0 if neutral else hfa_by_season.get(season, params.home_adv)
        p = expected_home(rh, ra, hfa)
        out_home[i], out_away[i], out_hfa[i], out_prob[i] = rh, ra, hfa, p
        if not played:
            continue
        home_won = hp > ap
        mult = 1.0
        if params.mov:
            mov = abs(hp - ap)
            winner_diff = (rh + hfa - ra) if home_won else (ra - rh - hfa)
            mult = ((mov + 3.0) ** 0.8) / (7.5 + 0.006 * winner_diff)
        delta = params.k * mult * ((1.0 if home_won else 0.0) - p)
        ratings[h] = rh + delta
        ratings[a] = ra - delta

    return pd.DataFrame(
        {
            "game_id": g["game_id"],
            "elo_home": out_home,
            "elo_away": out_away,
            "elo_hfa": out_hfa,
            "elo_prob_home": out_prob,
        }
    )


def _log_loss(y: np.ndarray, p: np.ndarray) -> float:
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


GRID = {
    "k": [8.0, 10.0, 12.0, 15.0, 20.0, 25.0],
    "home_adv": [40.0, 60.0, 80.0, 100.0, None],  # None = rolling
    "carryover": [0.3, 0.45, 0.6, 0.75, 0.9],
    "mov": [True, False],
}


def tune(games: pd.DataFrame, seasons: tuple[str, ...] = TRAIN_SEASONS) -> tuple[EloParams, float]:
    """Grid search on Elo's log loss over regular-season games in ``seasons`` (training only)."""
    mask = (games["season"].isin(seasons) & (games["season_type"] == "regular")
            & games["played"])  # fmt: skip
    eval_ids = set(games.loc[mask, "game_id"])
    y_by_id = games.set_index("game_id")["home_win"]

    best: tuple[float, EloParams] | None = None
    for k, hfa, carry, mov in itertools.product(*GRID.values()):
        params = EloParams(
            k=k,
            home_adv=hfa if hfa is not None else 0.0,
            hfa_mode="fixed" if hfa is not None else "rolling",
            carryover=carry,
            mov=mov,
        )
        res = run_elo(games, params)
        res = res[res["game_id"].isin(eval_ids)]
        loss = _log_loss(
            y_by_id.loc[res["game_id"]].to_numpy(float), res["elo_prob_home"].to_numpy()
        )
        if best is None or loss < best[0]:
            best = (loss, params)
    assert best is not None
    return best[1], best[0]
