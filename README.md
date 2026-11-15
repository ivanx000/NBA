# Tip-Off

**Who wins tonight?** An NBA game outcome and player stat forecaster, with a 3D website where the winning team's player hits a shot when you hit *Predict*.

**Live:** https://nba-alpha-olive.vercel.app (placeholder until the web phases land)

> Unofficial fan project. Not affiliated with or endorsed by the NBA or any team.

## What's inside

- **`ml/`**: Python pipeline. Ingests NBA data, engineers leakage-safe features, trains gradient-boosted models (tracked in MLflow), explains predictions with SHAP, and publishes daily predictions to Postgres.
- **`web/`**: Next.js site on Vercel. A three.js scene with two players in team jerseys, a prediction cinematic, stat overlays, a model report card, and technical docs.

## Getting started

Requirements: Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 26, pnpm 12 (`npm i -g pnpm@12`), and on macOS `brew install libomp` (for LightGBM).

```bash
# ML pipeline
cd ml
uv sync
uv run tipoff --help
uv run pytest

# Website
cd web
pnpm install
pnpm dev        # http://localhost:3000
```

Copy `.env.example` to `.env` and fill in the values when a phase needs them. The web app reads the same root `.env`; for local web development point `DATABASE_URL` at the Neon `dev` branch (the Neon HTTP driver is used for `*.neon.tech` URLs) or at local Docker Postgres (`docker compose up -d db`). Optional: install the
pre-push hook with `ln -sf ../../scripts/pre-push .git/hooks/pre-push`.

See `CLAUDE.md` for all commands and `docs/ROADMAP.md` for build status.

## Daily predictions

Predictions are generated on the developer's machine (stats.nba.com blocks cloud IPs) and published
to Postgres; GitHub Actions keep schedules and scores in sync and email if predictions are missing.

**macOS (launchd)**: `ml/scripts/install_launchd.sh` installs an agent that runs `ml/scripts/daily.sh`
at 09:30 local time, retries hourly until 18:30, and runs at login. Each run exits immediately once
today's predictions are published. Logs: `~/Library/Logs/tipoff/daily.log`. Remove it with
`ml/scripts/install_launchd.sh --uninstall`. To wake a sleeping Mac before the job:
`sudo pmset repeat wake MTWRFSU 09:25:00`. If the Mac is off all day, that day has no predictions.

**Linux (cron)**: `30 9-18 * * * TZ=America/New_York /path/to/NBA/ml/scripts/daily.sh >> ~/tipoff-daily.log 2>&1`
(adjust the hours if the machine isn't on Eastern time).

**Windows (Task Scheduler)**: create a daily task at 09:30 that repeats every hour for 9 hours and runs
`uv run tipoff daily --target prod --if-needed` in the `ml` folder (for example via Git Bash running `daily.sh`).

## License

MIT. See `LICENSE`.

## Docs

- [Product requirements](docs/PRD.md)
- [Design & cinematic storyboard](docs/DESIGN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [ML plan](docs/ML_PLAN.md)
- [3D asset pipeline](docs/ASSET_PIPELINE.md)
- [Roadmap](docs/ROADMAP.md)
