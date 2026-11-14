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
RAW_STATS_DIR = RAW_DIR / "stats"
RAW_CDN_DIR = RAW_DIR / "cdn"
STAGED_DIR = DATA_DIR / "staged"
FEATURES_DIR = DATA_DIR / "features"
REPORTS_DIR = ML_DIR / "reports"
FIGURES_DIR = REPORTS_DIR / "figures"

FIRST_SEASON = "2015-16"
CURRENT_SEASON = "2026-27"

# Seconds between requests to NBA endpoints. Be polite (see CLAUDE.md).
NBA_STATS_REQUEST_DELAY = 0.6
HTTP_TIMEOUT_SECONDS = 60
HTTP_MAX_ATTEMPTS = 5

# Don't re-fetch the in-progress season more often than this (hours).
CURRENT_SEASON_REFRESH_HOURS = 3


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
