# Tip-Off

**Who wins tonight?** An NBA game outcome and player stat forecaster, with a 3D website where the winning team's player hits a shot when you hit *Predict*.

**Live:** https://nba-alpha-olive.vercel.app (placeholder until the web phases land)

> Unofficial fan project. Not affiliated with or endorsed by the NBA or any team.

## What's inside

- **`ml/`**: Python pipeline. Ingests NBA data, engineers leakage-safe features, trains gradient-boosted models (tracked in MLflow), explains predictions with SHAP, and publishes daily predictions to Postgres.
- **`web/`**: Next.js site on Vercel. A three.js scene with two players in team jerseys, a prediction cinematic, stat overlays, a model report card, and technical docs.

## Getting started

Requirements: Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 26, and pnpm 12 (`npm i -g pnpm@12`).

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

Copy `.env.example` to `.env` and fill in the values when a phase needs them. Optional: install the
pre-push hook with `ln -sf ../../scripts/pre-push .git/hooks/pre-push`.

See `CLAUDE.md` for all commands and `docs/ROADMAP.md` for build status.

## License

MIT. See `LICENSE`.

## Docs

- [Product requirements](docs/PRD.md)
- [Design & cinematic storyboard](docs/DESIGN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [ML plan](docs/ML_PLAN.md)
- [3D asset pipeline](docs/ASSET_PIPELINE.md)
- [Roadmap](docs/ROADMAP.md)
