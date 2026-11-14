import socket
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Tests must never touch the network (and never stats.nba.com)."""

    def guard(*args, **kwargs):
        raise RuntimeError("Network access is disabled in tests.")

    monkeypatch.setattr(socket.socket, "connect", guard)
    monkeypatch.setattr(socket, "create_connection", guard)


@pytest.fixture
def fixtures() -> Path:
    return FIXTURES
