"""stats.nba.com ingestion (via nba_api). LOCAL ONLY: never run this from CI or Vercel.

Three endpoints, one call per (season, season type) each:

- ``team_logs``      LeagueGameLog, team rows: base box score per team-game
- ``player_logs``    LeagueGameLog, player rows: base box score per player-game
- ``team_adv_logs``  TeamGameLogs, MeasureType=Advanced: ratings, pace, possessions per team-game

Raw responses are cached as parquet at ``raw/stats/{endpoint}/{season}/{season_type}.parquet``.
A manifest records each fetch. Completed seasons are fetched once and never again (unless
``force``). The in-progress season is refreshed incrementally from its last cached game date.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from pathlib import Path
from typing import Any

import pandas as pd

from tipoff.config import CURRENT_SEASON_REFRESH_HOURS, HTTP_TIMEOUT_SECONDS, RAW_STATS_DIR
from tipoff.ingest.http import (
    DEFAULT_LIMITER,
    RateLimiter,
    TransientHTTPError,
    call_with_retries,
    check_status,
)
from tipoff.seasons import SeasonType, is_current_season, postseason_may_have_started

log = logging.getLogger(__name__)


class Endpoint(StrEnum):
    TEAM_LOGS = "team_logs"
    PLAYER_LOGS = "player_logs"
    TEAM_ADV_LOGS = "team_adv_logs"

    @property
    def key_columns(self) -> list[str]:
        entity = "PLAYER_ID" if self is Endpoint.PLAYER_LOGS else "TEAM_ID"
        return ["GAME_ID", entity]


# (endpoint, season, season_type, date_from) -> DataFrame. Injected in tests.
Fetcher = Callable[[Endpoint, str, SeasonType, date | None], pd.DataFrame]


def nba_api_fetcher(limiter: RateLimiter = DEFAULT_LIMITER) -> Fetcher:
    """The real fetcher: calls stats.nba.com through nba_api with rate limiting and retries."""
    # Imported lazily so tests and CI never need these modules to make a request.
    from nba_api.stats.endpoints import leaguegamelog, teamgamelogs

    def fetch(
        endpoint: Endpoint, season: str, season_type: SeasonType, date_from: date | None
    ) -> pd.DataFrame:
        date_from_str = date_from.strftime("%m/%d/%Y") if date_from else ""

        def request() -> pd.DataFrame:
            if endpoint is Endpoint.TEAM_ADV_LOGS:
                ep: Any = teamgamelogs.TeamGameLogs(
                    season_nullable=season,
                    season_type_nullable=season_type.api_name,
                    measure_type_player_game_logs_nullable="Advanced",
                    date_from_nullable=date_from_str,
                    timeout=HTTP_TIMEOUT_SECONDS,
                )
            else:
                ep = leaguegamelog.LeagueGameLog(
                    player_or_team_abbreviation="P" if endpoint is Endpoint.PLAYER_LOGS else "T",
                    season=season,
                    season_type_all_star=season_type.api_name,
                    date_from_nullable=date_from_str,
                    timeout=HTTP_TIMEOUT_SECONDS,
                )
            resp = ep.nba_response
            check_status(resp._status_code, resp.get_url())
            try:
                return ep.get_data_frames()[0]
            except ValueError as e:  # JSON decode error: usually a throttle/HTML page
                raise TransientHTTPError(f"Invalid JSON for {endpoint} {season}") from e

        return call_with_retries(request, limiter=limiter)

    return fetch


@dataclass(frozen=True)
class FetchTask:
    endpoint: Endpoint
    season: str
    season_type: SeasonType

    @property
    def key(self) -> str:
        return f"{self.endpoint}/{self.season}/{self.season_type}"

    def path(self, root: Path) -> Path:
        return root / self.endpoint / self.season / f"{self.season_type}.parquet"


@dataclass
class FetchResult:
    task: FetchTask
    action: str  # "fetched" | "refreshed" | "skipped" | "planned"
    rows: int
    reason: str = ""


class Manifest:
    """JSON record of what has been fetched, so ingest is idempotent and resumable."""

    def __init__(self, root: Path) -> None:
        self.path = root / "_manifest.json"
        self.entries: dict[str, dict[str, Any]] = (
            json.loads(self.path.read_text()) if self.path.exists() else {}
        )

    def get(self, key: str) -> dict[str, Any] | None:
        return self.entries.get(key)

    def record(self, key: str, **entry: Any) -> None:
        self.entries[key] = entry
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.entries, indent=2, sort_keys=True))
        tmp.replace(self.path)


def plan_tasks(
    seasons: Iterable[str],
    season_types: Iterable[SeasonType] = tuple(SeasonType),
    endpoints: Iterable[Endpoint] = tuple(Endpoint),
    today: date | None = None,
) -> list[FetchTask]:
    tasks = []
    for season in seasons:
        for season_type in season_types:
            if season_type is not SeasonType.REGULAR and not postseason_may_have_started(
                season, today
            ):
                continue
            tasks.extend(FetchTask(ep, season, season_type) for ep in endpoints)
    return tasks


def _max_game_date(df: pd.DataFrame) -> str | None:
    if df.empty or "GAME_DATE" not in df:
        return None
    return pd.to_datetime(df["GAME_DATE"]).max().date().isoformat()


def _write_parquet(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.parquet")
    df.to_parquet(tmp, index=False)
    tmp.replace(path)


def ingest_stats(
    tasks: Iterable[FetchTask],
    *,
    fetcher: Fetcher | None = None,
    root: Path = RAW_STATS_DIR,
    force: bool = False,
    dry_run: bool = False,
    now: datetime | None = None,
) -> list[FetchResult]:
    """Fetch whatever is missing or stale. Safe to re-run: it only requests what it needs."""
    now = now or datetime.now(UTC)
    manifest = Manifest(root)
    fetch = fetcher
    results: list[FetchResult] = []

    for task in tasks:
        path = task.path(root)
        entry = manifest.get(task.key)
        current = is_current_season(task.season)
        cached = path.exists() and entry is not None

        if cached and not force:
            if not current:
                results.append(FetchResult(task, "skipped", entry["rows"], "complete season"))
                continue
            fetched_at = datetime.fromisoformat(entry["fetched_at"])
            if now - fetched_at < timedelta(hours=CURRENT_SEASON_REFRESH_HOURS):
                results.append(FetchResult(task, "skipped", entry["rows"], "fetched recently"))
                continue

        incremental = cached and current and not force and entry.get("max_game_date")
        date_from = date.fromisoformat(entry["max_game_date"]) if incremental else None

        if dry_run:
            how = f"from {date_from}" if date_from else "full"
            results.append(FetchResult(task, "planned", 0, how))
            continue

        if fetch is None:
            fetch = nba_api_fetcher()
        log.info("fetching %s (%s)", task.key, f"from {date_from}" if date_from else "full")
        new = fetch(task.endpoint, task.season, task.season_type, date_from)

        if incremental:
            old = pd.read_parquet(path)
            # Re-fetching the last cached date picks up games that finished late; new rows win.
            df = pd.concat([old, new], ignore_index=True).drop_duplicates(
                subset=task.endpoint.key_columns, keep="last"
            )
            action = "refreshed"
        else:
            df = new
            action = "fetched"

        _write_parquet(df, path)
        manifest.record(
            task.key,
            fetched_at=now.isoformat(),
            rows=len(df),
            max_game_date=_max_game_date(df),
            complete=not current,
        )
        results.append(FetchResult(task, action, len(df)))
    return results
