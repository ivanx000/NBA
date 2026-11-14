"""Shared HTTP plumbing for NBA endpoints: one polite rate limiter, retries with backoff.

stats.nba.com (via nba_api) must only be called from the developer's machine.
cdn.nba.com is fronted by Akamai, which rejects requests without a full browser-like header
set, so cdn calls reuse nba_api's live-data headers.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import Any

import requests
from nba_api.live.nba.library.http import NBALiveHTTP
from tenacity import (
    Retrying,
    before_sleep_log,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from tipoff.config import HTTP_MAX_ATTEMPTS, HTTP_TIMEOUT_SECONDS, NBA_STATS_REQUEST_DELAY

log = logging.getLogger(__name__)


class TransientHTTPError(Exception):
    """Retryable failure: 429, 5xx, or a body that isn't valid JSON (often a throttle page)."""


class PermanentHTTPError(Exception):
    """Non-retryable failure, e.g. 400/403/404."""


RETRYABLE = (requests.Timeout, requests.ConnectionError, TransientHTTPError)


class RateLimiter:
    """Ensures at least `min_interval` seconds between the starts of consecutive calls."""

    def __init__(
        self,
        min_interval: float = NBA_STATS_REQUEST_DELAY,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.min_interval = min_interval
        self._clock = clock
        self._sleep = sleep
        self._last: float | None = None
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            now = self._clock()
            if self._last is not None:
                remaining = self.min_interval - (now - self._last)
                if remaining > 0:
                    self._sleep(remaining)
                    now = self._clock()
            self._last = now


DEFAULT_LIMITER = RateLimiter()


def call_with_retries[T](
    fn: Callable[[], T],
    *,
    limiter: RateLimiter = DEFAULT_LIMITER,
    attempts: int = HTTP_MAX_ATTEMPTS,
    wait_min: float = 2.0,
    wait_max: float = 60.0,
) -> T:
    """Run `fn` behind the rate limiter, retrying transient failures with exponential backoff."""

    def attempt() -> T:
        limiter.wait()
        return fn()

    retrying = Retrying(
        retry=retry_if_exception_type(RETRYABLE),
        stop=stop_after_attempt(attempts),
        wait=wait_exponential(multiplier=wait_min, min=wait_min, max=wait_max),
        before_sleep=before_sleep_log(log, logging.WARNING),
        reraise=True,
    )
    return retrying(attempt)


def check_status(status_code: int | None, url: str) -> None:
    if status_code is None or status_code == 200:
        return
    if status_code == 429 or status_code >= 500:
        raise TransientHTTPError(f"HTTP {status_code} from {url}")
    raise PermanentHTTPError(f"HTTP {status_code} from {url}")


def cdn_headers() -> dict[str, str]:
    """Browser-like headers that cdn.nba.com (Akamai) accepts."""
    return dict(NBALiveHTTP.headers)


def get_cdn_json(url: str, *, limiter: RateLimiter = DEFAULT_LIMITER) -> dict[str, Any]:
    """GET a cdn.nba.com JSON document with retries."""

    def fetch() -> dict[str, Any]:
        resp = requests.get(url, headers=cdn_headers(), timeout=HTTP_TIMEOUT_SECONDS)
        check_status(resp.status_code, url)
        try:
            return resp.json()
        except ValueError as e:
            raise TransientHTTPError(f"Invalid JSON from {url}") from e

    return call_with_retries(fetch, limiter=limiter)
