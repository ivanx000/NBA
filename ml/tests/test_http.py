import pytest
import requests

from tipoff.ingest.http import (
    PermanentHTTPError,
    RateLimiter,
    TransientHTTPError,
    call_with_retries,
    check_status,
)


class FakeClock:
    def __init__(self):
        self.now = 100.0
        self.sleeps = []

    def time(self):
        return self.now

    def sleep(self, s):
        self.sleeps.append(s)
        self.now += s


def test_rate_limiter_spaces_calls():
    clock = FakeClock()
    limiter = RateLimiter(0.6, clock=clock.time, sleep=clock.sleep)
    limiter.wait()  # first call: no wait
    clock.now += 0.1
    limiter.wait()  # 0.1s later: waits the remaining 0.5s
    clock.now += 1.0
    limiter.wait()  # 1s later: no wait
    assert clock.sleeps == [pytest.approx(0.5)]


def _free_limiter():
    return RateLimiter(0)


def test_retries_transient_errors_then_succeeds():
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise requests.Timeout("slow")
        return "ok"

    assert call_with_retries(flaky, limiter=_free_limiter(), wait_min=0, wait_max=0) == "ok"
    assert len(calls) == 3


def test_does_not_retry_permanent_errors():
    calls = []

    def forbidden():
        calls.append(1)
        raise PermanentHTTPError("403")

    with pytest.raises(PermanentHTTPError):
        call_with_retries(forbidden, limiter=_free_limiter(), wait_min=0, wait_max=0)
    assert len(calls) == 1


def test_gives_up_after_max_attempts():
    calls = []

    def always_429():
        calls.append(1)
        raise TransientHTTPError("429")

    with pytest.raises(TransientHTTPError):
        call_with_retries(always_429, limiter=_free_limiter(), attempts=3, wait_min=0, wait_max=0)
    assert len(calls) == 3


@pytest.mark.parametrize(
    ("code", "exc"),
    [(429, TransientHTTPError), (503, TransientHTTPError), (403, PermanentHTTPError)],
)
def test_check_status(code, exc):
    check_status(200, "u")
    with pytest.raises(exc):
        check_status(code, "u")
