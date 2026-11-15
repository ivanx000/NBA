"""Postgres access for the pipeline. The schema is owned by Drizzle (web/lib/db/schema.ts); this
module reflects the live tables instead of redefining them."""

from __future__ import annotations

from datetime import date, datetime
from functools import cache
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import Engine, MetaData, Table, create_engine
from sqlalchemy.dialects.postgresql import insert

from tipoff.config import get_settings

Target = Literal["dev", "prod"]
ET = ZoneInfo("America/New_York")


def today_et() -> date:
    """The NBA schedule day (America/New_York)."""
    return datetime.now(ET).date()


def database_url(target: Target = "dev") -> str:
    s = get_settings()
    url = s.database_url_prod if target == "prod" else s.database_url
    if not url:
        var = "DATABASE_URL_PROD" if target == "prod" else "DATABASE_URL"
        raise RuntimeError(f"{var} is not set (see .env.example).")
    return url


def to_sqlalchemy_url(url: str) -> str:
    """Use psycopg 3 for plain postgres:// URLs."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


@cache
def _engine(url: str) -> Engine:
    return create_engine(to_sqlalchemy_url(url), pool_pre_ping=True)


def get_engine(target: Target = "dev", url: str | None = None) -> Engine:
    return _engine(url or database_url(target))


def tables(engine: Engine) -> dict[str, Table]:
    meta = MetaData()
    meta.reflect(bind=engine, only=["teams", "games", "model_versions", "game_predictions",
                                    "player_projections", "pipeline_state"])  # fmt: skip
    return dict(meta.tables)


def upsert(engine: Engine, table: Table, rows: list[dict[str, Any]], keys: list[str],
           update: list[str] | None = None, where=None) -> int:  # fmt: skip
    """INSERT ... ON CONFLICT (keys) DO UPDATE (or DO NOTHING when ``update`` is empty)."""
    if not rows:
        return 0
    stmt = insert(table).values(rows)
    if update:
        stmt = stmt.on_conflict_do_update(
            index_elements=keys,
            set_={c: stmt.excluded[c] for c in update},
            where=where(stmt) if where is not None else None,
        )
    else:
        stmt = stmt.on_conflict_do_nothing(index_elements=keys)
    with engine.begin() as conn:
        result = conn.execute(stmt)
    # psycopg reports -1 for multi-row statements; fall back to the number of rows sent.
    return result.rowcount if result.rowcount >= 0 else len(rows)
