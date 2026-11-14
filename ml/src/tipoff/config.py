"""Project paths, constants and settings.

Settings are read from environment variables (and a `.env` file at the repo root or in `ml/`).
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ML_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = ML_DIR.parent
SHARED_DIR = REPO_ROOT / "shared"
TEAMS_JSON = SHARED_DIR / "teams.json"

DATA_DIR = ML_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
FEATURES_DIR = DATA_DIR / "features"

FIRST_SEASON = "2015-16"
CURRENT_SEASON = "2026-27"

# Seconds between stats.nba.com requests. Be polite (see CLAUDE.md).
NBA_STATS_REQUEST_DELAY = 0.6


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ML_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str | None = None
    mlflow_tracking_uri: str = f"file:{ML_DIR / 'mlruns'}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
