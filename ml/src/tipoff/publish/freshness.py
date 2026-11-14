"""Freshness check: every scheduled regular-season game on a date needs a live prediction."""

from __future__ import annotations

from datetime import date

from sqlalchemy import Engine, text

MISSING_SQL = text("""
    select g.game_id
    from games g
    left join game_predictions p
      on p.game_id = g.game_id and p.is_pregame and p.source = 'live'
    where g.game_date = :day
      and g.season_type = 'regular'
      and g.status <> 'postponed'
    group by g.game_id
    having count(p.game_id) = 0
    order by g.game_id
""")


def missing_predictions(engine: Engine, day: date) -> list[str]:
    with engine.connect() as conn:
        return [r[0] for r in conn.execute(MISSING_SQL, {"day": day})]
