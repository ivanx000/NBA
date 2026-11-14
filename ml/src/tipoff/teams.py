"""Loader for `shared/teams.json`, the single source of truth for the 30 teams."""

import json
from functools import lru_cache
from typing import Any

from tipoff.config import TEAMS_JSON


@lru_cache
def load_teams() -> list[dict[str, Any]]:
    with TEAMS_JSON.open(encoding="utf-8") as f:
        return json.load(f)["teams"]


def team_by_abbr(abbr: str) -> dict[str, Any]:
    for team in load_teams():
        if team["abbr"] == abbr.upper():
            return team
    raise KeyError(f"Unknown team abbreviation: {abbr}")
