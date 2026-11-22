# CLAUDE.md

Guidance for Claude Code when working in this repository. Read this first, every session.

## What this project is

An NBA game outcome and player stat forecaster with an interactive 3D website. The site has **no brand name** (the user's decision, Nov 2026): its title is **NBA Game Predictor** (`SITE_NAME` in `web/lib/site.ts`) and its mark is a plain basketball (`web/components/ball-mark.tsx`). "Tip-Off" was the old working name; it survives only in code identifiers (the `tipoff` Python package and CLI) and older docs headings.

- A **Python ML pipeline** (`ml/`) ingests NBA data, builds features, trains models, and writes daily predictions to Postgres.
- A **Next.js website** (`web/`) hosted on Vercel reads those predictions and presents them through a 3D scene: two players in team jerseys, a "Predict who wins" button, and a cinematic where the winning team's player hits a shot, after which the stats appear.
- The website also has technical docs explaining the ML, so it doubles as a portfolio piece.

The full specs live in `docs/`:

| File | What it covers |
|---|---|
| `docs/PRD.md` | Product requirements, user flow, pages, edge cases |
| `docs/DESIGN.md` | Visual design, 3D scene, the prediction cinematic storyboard |
| `docs/ARCHITECTURE.md` | System design, repo layout, DB schema, data flow |
| `docs/ML_PLAN.md` | Data, features, leakage rules, models, evaluation |
| `docs/ASSET_PIPELINE.md` | How 3D models/textures are made (ChatGPT -> Meshy -> web) |
| `docs/ROADMAP.md` | Phased build plan with checkboxes. **Work from this.** |

## How to work in this repo

1. Find the first unchecked phase in `docs/ROADMAP.md`. Work on one phase at a time.
2. Before writing code for a phase, briefly plan it and confirm the plan with the user if the phase has open decisions.
3. When a task is done, tick its checkbox in `docs/ROADMAP.md` and note anything surprising under that phase's "Notes".
4. If a decision changes a spec, update the relevant `docs/*.md` file in the same change. The docs must stay true.
5. Prefer small, reviewable commits with clear messages.

## Repo layout (target)

```
.
├── CLAUDE.md
├── README.md
├── docs/                  # planning specs (not the website's docs pages)
├── shared/
│   └── teams.json         # single source of truth for 30 teams (ids, abbrevs, colors)
├── ml/                    # Python package (uv-managed)
│   ├── pyproject.toml
│   ├── src/tipoff/        # ingest/, features/, models/, predict/, publish/
│   ├── tests/
│   └── notebooks/         # exploration only; nothing imports from here
├── web/                   # Next.js (App Router, TypeScript)
│   ├── app/
│   ├── components/        # ui/, scene/ (3D), charts/
│   ├── content/docs/      # MDX for the website's /docs section
│   ├── lib/
│   └── public/models, public/textures
├── assets-src/            # raw generated assets (ChatGPT images, Meshy exports). Large files git-ignored.
├── scripts/pre-push       # git hook: runs pipeline.yaml locally (skips if `pipeline` isn't installed)
├── pipeline.yaml          # local CI for the `pipeline` runner; mirrors ci.yml
└── .github/workflows/
```

## Commands

ML (run from `ml/`):
```bash
uv sync                          # install deps
uv run pytest                    # tests
uv run ruff check . && uv run ruff format .
uv run tipoff --help             # typer CLI (also: uv run python -m tipoff ...)
uv run tipoff ingest              # stats + cdn, then stage/validate (idempotent; --dry-run, --force)
uv run tipoff ingest --source cdn # cdn.nba.com only (safe in CI)
uv run tipoff features           # build data/features/game_features.parquet + player_features.parquet (--tune-elo to re-tune Elo)
uv run tipoff train --only baselines   # train + evaluate on 2024-25, log to MLflow
uv run tipoff train --only game        # Optuna + calibration + champion kind -> ml/config/game_model.json
uv run tipoff evaluate                 # 2025-26 walk-forward + factor importance (add --test only for a new major version)
uv run tipoff evaluate --test --player  # the player models' one-time 2025-26 test (already run)
uv run tipoff train --only champion    # fit on all games, register tipoff-game@champion
uv run tipoff train --only player      # player projections: pick models on 2024-25 -> ml/config/player_model.json
uv run tipoff train --only player-champion   # fit on all player-games, register tipoff-player@champion
uv run tipoff sync [--target prod]     # games from cdn.nba.com (safe in CI)
uv run tipoff predict --date today     # champion predictions + factors (live/) and player projections (players/) in data/predictions/
uv run tipoff publish --date today [--target prod]   # games + player projections, pregame-only guard
uv run tipoff results [--target prod]  # fill projected players' actual lines from staged box scores
uv run tipoff stats [--target prod] [--rewrite]  # box scores (this season and last) for the site's advanced stats
uv run tipoff backfill [--target prod] # weekly walk-forward history, source='backfill' (--what players: this season's projections)
uv run tipoff freshness-check [--target prod]
uv run tipoff daily --target prod --if-needed        # local fallback (launchd, scripts/daily.sh)
uv run tipoff daily --cloud --target prod            # what .github/workflows/daily.yml runs (cdn only)
uv run tipoff state push --what all --target prod    # staged history + both champions for the cloud job
uv run tipoff retrain --target prod --dry-run        # weekly retrain (what .github/workflows/retrain.yml runs, without --dry-run)
uv run tipoff predict --date today
uv run tipoff publish            # writes predictions to Postgres
uv run tipoff daily              # ingest -> features -> predict -> publish
uv run mlflow ui --backend-store-uri sqlite:///mlflow.db   # MLflow UI at localhost:5000
uv run --group notebook jupyter nbconvert --to notebook --execute --inplace notebooks/01_eda.ipynb
```

Web (run from `web/`):
```bash
pnpm install
pnpm dev                         # localhost:3000
pnpm lint && pnpm typecheck     # typecheck runs `next typegen` first
pnpm test                        # Vitest
pnpm build
pnpm db:generate                 # after editing lib/db/schema.ts (commit drizzle/*.sql)
pnpm db:migrate && pnpm db:seed  # uses DATABASE_URL (root .env)
```

Whole repo (from the root): `pipeline` runs `pipeline.yaml` (same checks as CI). `docker compose up -d db` starts local Postgres (port 5433) for development and the DB tests.

Next.js 16 has breaking changes from older versions. Read `web/AGENTS.md` and the bundled guides in `web/node_modules/next/dist/docs/` before writing web code.

(Keep this section updated as commands change.)

LightGBM on macOS needs `brew install libomp` (CI's Ubuntu image already has it).

## Hard rules

**Data and ML**
- **No data leakage.** Every feature for a game must be computable using only information available *before tip-off*. Rolling stats use `.shift(1)` or an equivalent. There's a test for this. Keep it passing.
- **Time-based splits only.** Never random-split games for train/test. Train 2015-16..2023-24, validate 2024-25, test 2025-26 (`tipoff.config`). Only each model's one-time final evaluation may touch the test season (the game model's in Phase 3, the player models' in Phase 9); `models/data.train_valid` and `models/players.player_train_valid` can't return it. The one-time tests already ran (`ml/reports/test_2025-26.json`, `ml/reports/test_player_2025-26.json`); `tipoff evaluate --test` refuses to run again without `--force-retest`, which is for a new major model version only. Never pick or tune a model based on test numbers.
- Always report against baselines (home team wins, Elo) next to any model metric.
- Log every training run to MLflow with params, metrics, and the model artifact. After registering a new champion, push it for the cloud job: `tipoff state push --what champion --target prod` (`--what player-champion` for the player model).
- If a feature's definition changes, bump `FEATURES_VERSION` in `features/build.py` so `features_hash` changes.
- `stats.nba.com` blocks cloud and CI IP ranges. **Never call it from GitHub Actions or Vercel.** The cloud daily job (`daily --cloud`) uses cdn.nba.com box scores only; a test enforces this. Historical and box-score ingestion runs on the developer's machine. The `cdn.nba.com` live and schedule JSON endpoints are fine to call from CI.
- Be polite to NBA endpoints: rate-limit requests (about 0.6s between calls), cache raw responses to disk, and never re-fetch data you already have. All NBA HTTP goes through `tipoff.ingest.http` (shared limiter and retries).
- `cdn.nba.com` returns 403 without a full browser-like header set. Use `tipoff.ingest.http.cdn_headers()` (nba_api's live headers), never a bare User-Agent.

**Web**
- The website **never** runs model inference. It only reads precomputed predictions from Postgres.
- Server Components fetch data. 3D runs in Client Components loaded with `dynamic(..., { ssr: false })`.
- Cache Components are on: cache data with `'use cache'` + `cacheLife(...)`, never `export const revalidate`. Anything per request (`searchParams`, "today", `Math.random`) goes inside `<Suspense>` after `await connection()`. Client hooks that read the URL (`usePathname`) in the layout need a `<Suspense>` boundary.
- `?webgl=0` forces the 2D fallback for testing.
- Respect `prefers-reduced-motion`: skip the cinematic and go straight to results; holograms, stars, the game cards and the camera hold still.
- The site must stay usable on mobile and when WebGL fails (provide a 2D fallback).
- Keep the initial JS and 3D payload small. Compress models (meshopt or Draco) and use compressed textures. See `docs/ASSET_PIPELINE.md`.

**Brand and IP**
- Use team **city and nickname text and colors**. The one exception (the user's decision, Nov 2026, risk accepted): each team's **official primary logo** at center court of the 3D court, from NBA.com's CDN, cleaned of scripts and stored in `web/public/logos/{ABBR}.svg`. Don't use logos anywhere else, and never the NBA's league logo, team wordmark artwork, or real player likenesses or headshots. Players are shown as name, number and initials.
- The site says it's an unofficial fan project, not affiliated with the NBA, once: on the Docs → Limitations page (`web/content/docs/limitations.mdx`). The user's decision (Nov 2026): don't put it in the footer, on the home page, or in page descriptions.

**Database**
- The schema lives only in `web/lib/db/schema.ts` (Drizzle). Python reflects tables; never define them twice.
- Commands write to the dev branch by default. Only the daily job (and explicit `--target prod`) writes to prod.

**Secrets**
- Never commit `.env*` files except `.env.example`. Secrets: `DATABASE_URL`, `DATABASE_URL_PROD`, `MESHY_API_KEY`, and in Vercel only `CRON_SECRET` and `GITHUB_DISPATCH_TOKEN` (the Vercel Schedules that start the daily workflow). Don't print them or ask the user to paste them into chat.

## Tech stack (decided)

- ML: Python 3.12, uv, pandas, scikit-learn, LightGBM and/or XGBoost, SHAP, MLflow, pytest, ruff, nba_api
- DB: Postgres (Neon), Drizzle ORM on the web side, SQLAlchemy/psycopg on the Python side
- Web: Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, three.js + @react-three/fiber + @react-three/drei + @react-three/postprocessing, GSAP (camera/cinematic timeline), zustand (scene state machine), Recharts (charts), MDX (docs)
- Hosting: Vercel (web), Neon (DB), GitHub Actions (scheduled jobs that don't touch stats.nba.com)

Use the latest stable versions at setup time and pin them.
