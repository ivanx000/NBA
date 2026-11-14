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

# Ingest starts one season early: 2014-15 only warms up Elo and the season blends, and never
# appears as a training row.
WARMUP_SEASON = "2014-15"
FIRST_SEASON = "2015-16"
CURRENT_SEASON = "2026-27"

# Time-based splits (ML_PLAN section 5). The test season is touched once per major version.
TRAIN_SEASONS = tuple(f"{y}-{(y + 1) % 100:02d}" for y in range(2015, 2024))  # 2015-16..2023-24
VALID_SEASON = "2024-25"
TEST_SEASON = "2025-26"

CONFIG_DIR = ML_DIR / "config"
ELO_PARAMS_PATH = CONFIG_DIR / "elo_params.json"
GAME_MODEL_CONFIG_PATH = CONFIG_DIR / "game_model.json"
PREDICTIONS_DIR = DATA_DIR / "predictions"

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
    mlflow_tracking_uri: str = f"sqlite:///{ML_DIR / 'mlflow.db'}"
    mlflow_artifact_root: str = (ML_DIR / "mlartifacts").as_uri()


@lru_cache
def get_settings() -> Settings:
    return Settings()
