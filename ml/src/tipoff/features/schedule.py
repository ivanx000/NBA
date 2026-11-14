"""Rest, schedule density and travel. Uses only dates and venues, which are known in advance."""

from __future__ import annotations

import math
from datetime import datetime
from functools import cache
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from tipoff.teams import load_teams

REST_CAP = 4  # days; also used for a team's first game of the season


@cache
def _arenas() -> dict[int, tuple[float, float, str]]:
    return {
        t["team_id"]: (t["arena_coords"]["lat"], t["arena_coords"]["lon"], t["timezone"])
        for t in load_teams()
    }


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@cache
def _utc_offset_hours(tz: str, day: datetime) -> float:
    return ZoneInfo(tz).utcoffset(day.replace(hour=19)).total_seconds() / 3600


def schedule_features(tl: pd.DataFrame) -> pd.DataFrame:
    """Per team-game row of ``tl`` (sorted by team, date): rest, density, travel."""
    tl = tl.reset_index(drop=True)
    prev_date = tl.groupby(["team_id", "season"])["game_date"].shift(1)
    prev_venue = tl.groupby(["team_id", "season"])["venue_team_id"].shift(1)
    rest = (tl["game_date"] - prev_date).dt.days.clip(upper=REST_CAP).fillna(REST_CAP)

    ones = pd.Series(1.0, index=pd.DatetimeIndex(tl["game_date"]))

    def window_count(days: int) -> np.ndarray:
        counts = ones.groupby(tl["team_id"].to_numpy()).transform(
            lambda s: s.rolling(f"{days}D", closed="left").sum()
        )
        return counts.fillna(0.0).to_numpy()

    arenas = _arenas()
    travel, tz_crossed = [], []
    for venue, pvenue, day in zip(tl["venue_team_id"], prev_venue, tl["game_date"], strict=True):
        if pd.isna(pvenue):
            travel.append(0.0)
            tz_crossed.append(0.0)
            continue
        lat1, lon1, tz1 = arenas[int(pvenue)]
        lat2, lon2, tz2 = arenas[int(venue)]
        travel.append(haversine_km(lat1, lon1, lat2, lon2))
        # Compare both zones on the same date, so a DST change isn't counted as travel.
        off1 = _utc_offset_hours(tz1, day.to_pydatetime())
        off2 = _utc_offset_hours(tz2, day.to_pydatetime())
        tz_crossed.append(abs(off2 - off1))

    last3 = window_count(3)
    return pd.DataFrame(
        {
            "rest_days": rest,
            "b2b": (rest == 1).astype(float),
            "three_in_four": (last3 >= 2).astype(float),
            "games_last7": window_count(7),
            "travel_km": travel,
            "tz_crossed": tz_crossed,
        }
    )
