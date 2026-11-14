"""Season strings ("2015-16") and season types."""

from datetime import date
from enum import StrEnum

from tipoff.config import CURRENT_SEASON


class SeasonType(StrEnum):
    """Season types we ingest. Values are the slugs used in file paths."""

    REGULAR = "regular"
    PLAYIN = "playin"
    PLAYOFFS = "playoffs"

    @property
    def api_name(self) -> str:
        """The value stats.nba.com expects for `SeasonType`."""
        return {"regular": "Regular Season", "playin": "PlayIn", "playoffs": "Playoffs"}[self.value]

    @property
    def game_id_prefix(self) -> str:
        """NBA game ids start with this prefix for the season type (e.g. 0022400001)."""
        return {"regular": "002", "playin": "005", "playoffs": "004"}[self.value]


GAME_ID_PREFIX_TO_TYPE = {st.game_id_prefix: st for st in SeasonType}


def season_start_year(season: str) -> int:
    """'2015-16' -> 2015. Raises ValueError for malformed seasons."""
    start, _, end = season.partition("-")
    if len(start) != 4 or len(end) != 2 or not (start + end).isdigit():
        raise ValueError(f"Bad season {season!r}; expected like '2015-16'.")
    if (int(start) + 1) % 100 != int(end):
        raise ValueError(f"Bad season {season!r}; years must be consecutive.")
    return int(start)


def season_from_start_year(year: int) -> str:
    return f"{year}-{(year + 1) % 100:02d}"


def parse_season_range(spec: str) -> list[str]:
    """'2015-16:2017-18' -> ['2015-16', '2016-17', '2017-18']. A single season is allowed."""
    first, _, last = spec.partition(":")
    last = last or first
    start, end = season_start_year(first), season_start_year(last)
    if end < start:
        raise ValueError(f"Season range {spec!r} is reversed.")
    return [season_from_start_year(y) for y in range(start, end + 1)]


def is_current_season(season: str) -> bool:
    return season == CURRENT_SEASON


def postseason_may_have_started(season: str, today: date | None = None) -> bool:
    """Play-in and playoffs never start before April of the season's second year."""
    today = today or date.today()
    return today >= date(season_start_year(season) + 1, 4, 1)
