# Tip-Off

**Who wins tonight?** An NBA game outcome and player stat forecaster, with a 3D website where the winning team's player hits a shot when you hit *Predict*.

> Unofficial fan project. Not affiliated with or endorsed by the NBA or any team.

## What's inside

- **`ml/`**: Python pipeline. Ingests NBA data, engineers leakage-safe features, trains gradient-boosted models (tracked in MLflow), explains predictions with SHAP, and publishes daily predictions to Postgres.
- **`web/`**: Next.js site on Vercel. A three.js scene with two players in team jerseys, a prediction cinematic, stat overlays, a model report card, and technical docs.

## Getting started

See `CLAUDE.md` for commands, and `docs/ROADMAP.md` for build status.

## Docs

- [Product requirements](docs/PRD.md)
- [Design & cinematic storyboard](docs/DESIGN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [ML plan](docs/ML_PLAN.md)
- [3D asset pipeline](docs/ASSET_PIPELINE.md)
- [Roadmap](docs/ROADMAP.md)
