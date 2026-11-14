# Roadmap: Tip-Off

Work top to bottom. One phase is roughly one or a few Claude Code sessions. Tick boxes as you go and add notes under each phase.

The ML track (Phases 1–4) and web track (Phases 5–8) can be interleaved. The web starts with **placeholder 3D and fixture data**, so it isn't blocked on the model or the Meshy assets.

---

## Phase 0: Repo setup
- [ ] `git init`, `.gitignore`, `.env.example`, MIT license, `README.md` (files from planning are already here)
- [ ] `ml/`: uv project (Python 3.12), ruff, pytest, `src/tipoff/` package skeleton, typer CLI with stub commands
- [ ] `web/`: Next.js (App Router, TS, Tailwind, ESLint), pnpm, shadcn/ui init, Inter + Oswald fonts, dark theme tokens from DESIGN §1
- [ ] Add `web/lib/teams.ts` with types for `shared/teams.json` (already present)
- [ ] GitHub repo + `ci.yml` (ml lint/test, web lint/typecheck/build)
- [ ] Vercel project linked to `web/` (it deploys the placeholder page)

Notes:

## Phase 1: Data ingestion (local)
- [ ] `ingest/nba_stats.py`: team and player game logs for 2015-16 → current, with rate limit, retries and parquet cache
- [ ] `ingest/nba_cdn.py`: schedule + scoreboard
- [ ] pandera schemas for the raw tables, and a `tipoff ingest` CLI that's idempotent
- [ ] EDA notebook: home win rate by season, score distributions, rest-day effects (keep the plots for the docs)

Notes:

## Phase 2: Features + baselines
- [ ] Elo (tuned K and home advantage), rolling form, four factors, schedule/rest/travel, availability v1
- [ ] `features/build.py` produces one row per game
- [ ] **`test_no_leakage.py` passes**
- [ ] Baselines: home team, Elo-logistic, logistic regression, all logged to MLflow
- [ ] Evaluation module: metrics table + calibration plot

Notes:

## Phase 3: Main game model
- [ ] LightGBM + Optuna tuning on the 2024-25 validation season
- [ ] Calibration, then a final test on 2025-26 (once) and a walk-forward backtest
- [ ] SHAP top factors per game, plus the feature → human copy mapping
- [ ] Register `tipoff-game` with the `champion` alias in MLflow
- [ ] Fill in the metrics table in `docs/ML_PLAN.md §5`

Notes:

## Phase 4: Publish pipeline + DB
- [ ] Neon project (dev + prod branches), schema from ARCHITECTURE §4 (Drizzle migrations in `web/`, the single source of truth)
- [ ] `tipoff predict --date` + `tipoff publish` (with the pregame-only guard)
- [ ] Backfill: walk-forward pregame predictions for the 2025-26 season and 2026-27 to date, so `/performance` has history
- [ ] `ml/scripts/daily.sh` + a local scheduler (launchd/cron/Task Scheduler) with instructions in README
- [ ] GitHub Actions: `schedule-sync`, `results-sync`, `freshness-check`

Notes:

## Phase 5: Web skeleton with placeholder 3D
- [ ] Layout, nav, footer (with the unofficial disclaimer), routes for all pages
- [ ] Drizzle queries + `Slate` type. Use fixture JSON if the DB isn't ready yet.
- [ ] Home: GameRail, GameCard, DateSwitcher, the no-games-today states, `?game=` and `?date=` URL state, random default game
- [ ] `<Scene>` with placeholder players (capsules or a simple stand-in rigged model, e.g. three.js's example `Xbot.glb`, **for dev only**), floor, spotlights in team colors
- [ ] zustand scene state machine (ARCHITECTURE §5)
- [ ] 2D fallback when WebGL is unavailable

Notes:

## Phase 6: Real 3D assets (follow ASSET_PIPELINE.md)
- [ ] Base character images → Meshy model → rig + clips → `player.glb` optimized
- [ ] Jersey spike: BOS + LAL with approach A. Decide between A and B, and record the decision here.
- [ ] `scripts/assets/composite_jersey.py` (+ `meshy_pipeline.py` if automating)
- [ ] All 30 jerseys (+ alternates), clash rule implemented
- [ ] Idle variety, offset loops, cursor look-at, jersey swap on card click with preload

Notes:

## Phase 7: The prediction cinematic
- [ ] GSAP master timeline per DESIGN §4 (camera rig, winner turn, loser dim)
- [ ] Ball attach to the hand bone → release at `JUMPSHOT_RELEASE_TIME` → Bezier flight
- [ ] Confidence-based shot outcome (swish / back-iron / rattle)
- [ ] Hoop reveal, swish net wobble, team-color flash + confetti
- [ ] Skip / Esc, reduced-motion path, return-to-home reverse
- [ ] Performance pass: `<PerformanceMonitor>`, DPR scaling, post-processing toggle

Notes:

## Phase 8: Results + content pages
- [ ] Results overlay: win prob bar, factor bars, Final-game ✓/✗ (player lines placeholder until Phase 9)
- [ ] `/game/[id]` + OG image
- [ ] `/performance`: tiles, rolling accuracy, calibration, recent table
- [ ] `/docs` MDX setup with sidebar + TOC. Write the pages listed in ML_PLAN §8 and an architecture page.
- [ ] `/how-it-works` scroll story

Notes:

## Phase 9: Player stat projections
- [ ] Minutes model + per-minute rate models + quantile intervals, compared against the last-10 baseline
- [ ] Publish to `player_projections`, show in the overlay and the game page
- [ ] Docs page

Notes:

## Phase 10: Launch polish
- [ ] Lighthouse ≥ 80 mobile on home, a11y audit (keyboard, focus, aria-live)
- [ ] Error and empty states, 404, loading skeletons
- [ ] Analytics (Vercel Analytics), SEO metadata
- [ ] Custom domain, final README with screenshots and a GIF of the cinematic
- [ ] Weekly retrain job + champion/challenger promotion

Notes:

## Later ideas
- Predicted final score / spread (regression model)
- Live in-game win probability using play-by-play from cdn.nba.com
- Team pages with model rating over time
- Playoff series simulator (Monte Carlo over game probabilities)
