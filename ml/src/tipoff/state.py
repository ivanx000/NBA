"""Pipeline state in Postgres (``pipeline_state`` table) for the cloud daily job.

- ``staged``: the three staged parquet tables, packed as a tar.gz
- ``champion``: the champion ``GameModel`` (joblib) plus its provenance in ``meta``

GitHub Actions can't reach stats.nba.com and has no MLflow store, so it pulls these, adds new games
from cdn.nba.com box scores, predicts, publishes, and pushes ``staged`` back.
"""

from __future__ import annotations

import hashlib
import io
import json
import tarfile
from pathlib import Path
from typing import Any

import joblib
from sqlalchemy import Engine, func, select

from tipoff.config import STAGED_DIR
from tipoff.db import tables, upsert

STAGED_FILES = ("games.parquet", "team_games.parquet", "player_games.parquet")


class StateError(RuntimeError):
    pass


def push(engine: Engine, key: str, data: bytes, meta: dict[str, Any] | None = None) -> str:
    digest = hashlib.sha256(data).hexdigest()
    row = {"key": key, "data": data, "sha256": digest, "bytes": len(data),
           "meta": meta or {}, "updated_at": func.now()}  # fmt: skip
    upsert(engine, tables(engine)["pipeline_state"], [row], ["key"],
           update=["data", "sha256", "bytes", "meta", "updated_at"])  # fmt: skip
    return digest


def pull(engine: Engine, key: str) -> tuple[bytes, dict[str, Any]]:
    t = tables(engine)["pipeline_state"]
    with engine.connect() as conn:
        row = conn.execute(select(t.c.data, t.c.sha256, t.c.meta).where(t.c.key == key)).first()
    if row is None:
        raise StateError(f"No '{key}' in pipeline_state. Run `tipoff state push` locally first.")
    data = bytes(row.data)
    if hashlib.sha256(data).hexdigest() != row.sha256:
        raise StateError(f"Checksum mismatch for '{key}'")
    return data, dict(row.meta or {})


def pack_staged(staged_dir: Path = STAGED_DIR) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name in STAGED_FILES:
            tar.add(staged_dir / name, arcname=name)
    return buf.getvalue()


def unpack_staged(data: bytes, staged_dir: Path = STAGED_DIR) -> None:
    staged_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        members = {m.name: m for m in tar.getmembers()}
        if set(members) != set(STAGED_FILES) or not all(m.isfile() for m in members.values()):
            raise StateError(f"Unexpected staged archive contents: {sorted(members)}")
        for name in STAGED_FILES:  # only the expected plain files, never arbitrary paths
            (staged_dir / name).write_bytes(tar.extractfile(members[name]).read())


def push_staged(engine: Engine, staged_dir: Path = STAGED_DIR) -> str:
    import pandas as pd

    games = pd.read_parquet(staged_dir / "games.parquet", columns=["game_date"])
    meta = {"rows": len(games), "through": str(games["game_date"].max().date())}
    return push(engine, "staged", pack_staged(staged_dir), meta)


def pull_staged(engine: Engine, staged_dir: Path = STAGED_DIR) -> dict[str, Any]:
    data, meta = pull(engine, "staged")
    unpack_staged(data, staged_dir)
    return meta


def push_champion(engine: Engine, model: Any, info: dict[str, Any]) -> str:
    buf = io.BytesIO()
    joblib.dump(model, buf)
    meta = json.loads(json.dumps(info, default=str))
    return push(engine, "champion", buf.getvalue(), meta)


def pull_champion(engine: Engine) -> tuple[Any, dict[str, Any]]:
    """The champion GameModel and its provenance (model_version, run_id, trained_at, ...).

    The bytes come only from our own database, written by `tipoff state push`."""
    data, meta = pull(engine, "champion")
    return joblib.load(io.BytesIO(data)), meta
