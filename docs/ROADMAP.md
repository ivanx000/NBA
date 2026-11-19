# Roadmap: Tip-Off

Work top to bottom. One phase is roughly one or a few Claude Code sessions. Tick boxes as you go and add notes under each phase.

The ML track (Phases 1–4) and web track (Phases 5–8) can be interleaved. The web starts with **placeholder 3D and fixture data**, so it isn't blocked on the model or the Meshy assets.

---

## Phase 0: Repo setup
- [x] `git init`, `.gitignore`, `.env.example`, MIT license, `README.md` (files from planning are already here)
- [x] `ml/`: uv project (Python 3.12), ruff, pytest, `src/tipoff/` package skeleton, typer CLI with stub commands
- [x] `web/`: Next.js (App Router, TS, Tailwind, ESLint), pnpm, shadcn/ui init, Inter + Oswald fonts, dark theme tokens from DESIGN §1
- [x] Add `web/lib/teams.ts` with types for `shared/teams.json` (already present)
- [x] GitHub repo + `ci.yml` (ml lint/test, web lint/typecheck/build)
- [x] Vercel project linked to `web/` (it deploys the placeholder page)

Notes:
- The home directory (`~`) is itself a git repo. `NBA/` got its own repo with `git init`, so it no longer shows up there. The home-directory repo was left alone.
- GitHub: `ivanx000/NBA` (public). pnpm wasn't installed: added globally (`npm i -g pnpm@12`) and pinned via `packageManager`.
- Next.js is 16.4 (Turbopack, Tailwind v4 through the `@tailwindcss/turbopack` loader, no PostCSS; `cacheComponents` on). ESLint uses the flat config (`next lint` is gone). `pnpm typecheck` runs `next typegen` first so the global `LayoutProps`/`PageProps` types exist.
- shadcn 4.23 (`radix-nova` preset) replaces `clsx` + `tailwind-merge` with its own `cn` package.
- `web/` imports `../../shared/teams.json` directly. `turbopack.root` and `outputFileTracingRoot` are set to the repo root so this works in dev, build and on Vercel.
- The site is dark only: brand tokens from DESIGN §1 live in `:root`, mapped onto shadcn's semantic tokens, and `<html>` carries `dark`.
- CLI is `tipoff <cmd>` (typer), with `python -m tipoff` as an alias. CLAUDE.md commands now use 2015-16 as the first season, matching ML_PLAN.
- Vercel project `nba`, Root Directory `web`. Production is https://nba-alpha-olive.vercel.app and it deployed on the first try with pnpm 12 (no Corepack setting needed). Deploys from GitHub post a `Vercel` commit status. CI pins `astral-sh/setup-uv@v10.3.3` because setup-uv has no moving `v10` tag.
- Added `pipeline.yaml` and `scripts/pre-push` for the local `pipeline` runner. `pipeline` isn't installed on this machine yet, so the yaml hasn't been run; the hook skips with a warning until it is.

## Phase 1: Data ingestion (local)
- [x] `ingest/nba_stats.py`: team and player game logs for 2015-16 → current, with rate limit, retries and parquet cache
- [x] `ingest/nba_cdn.py`: schedule + scoreboard
- [x] pandera schemas for the raw tables, and a `tipoff ingest` CLI that's idempotent
- [x] EDA notebook: home win rate by season, score distributions, rest-day effects (keep the plots for the docs)

Notes:
- Advanced team stats come from `TeamGameLogs` (MeasureType=Advanced), one call per season, instead of per-game `BoxScoreAdvancedV3`. The full backfill (2015-16 to 2026-27, regular season + play-in + playoffs) is 102 calls, took about 2 minutes, and is 12 MB of parquet.
- Staged on 2026-11-14: 14,348 games, 28,696 team-games, 305,771 player-games, all passing validation.
- Neutral-site games: 11 (Paris, Mexico City, London/Berlin, NBA Cup semifinals). Both log rows say "@", which the first staging run caught. They're flagged `is_neutral` with a designated home that never depends on the result.
- NBA Cup final (game id prefix `006`) doesn't appear in the regular-season logs; staging would drop it if it did.
- cdn.nba.com is behind Akamai: curl and UA-only requests get 403; nba_api's live header set works, locally and from GitHub Actions (`cdn-probe` run on 2026-11-14 passed).
- cdn reports 0-0 for games that haven't started; those scores are stored as null. `postponedStatus` has only been seen as "N" so far; the postponed mapping is a guess until a real postponement appears.
- EDA headline numbers: home teams won 58–59% before 2019 and 54–55% in most seasons since; back-to-back teams win 44.6% vs 51.2% rested; combined scoring rose from about 205 to 231 points a game.

## Phase 2: Features + baselines
- [x] Elo (tuned K and home advantage), rolling form, four factors, schedule/rest/travel, availability v1
- [x] `features/build.py` produces one row per game
- [x] **`test_no_leakage.py` passes**
- [x] Baselines: home team, Elo-logistic, logistic regression, all logged to MLflow
- [x] Evaluation module: metrics table + calibration plot

Notes:
- 2014-15 is now ingested as a warm-up season (Elo and season priors for 2015-16); it never appears as a training row. Its play-in/playoff files came along (9 calls, not 3).
- Elo tuning (300 combinations, training seasons only) picked K = 15, carry-over 0.6, margin-of-victory on, and a **rolling** home edge from the previous two seasons; every fixed home edge did worse. The first grid's best sat on its edges, so it was widened until the optimum was interior. Train log loss 0.6222.
- Leakage tests run on a synthetic league in CI (perturbation + truncation + provenance) and on real data locally (truncation on 2024-12-25 and 2025-03-14). Two deliberately planted leaks (season-to-date sums including the current game; availability using the current game's box score) were each caught by both main tests.
- Four factors are computed from the base box score: the advanced endpoint's `oreb_pct` is missing for 799 team-games.
- First trial build showed `tz_crossed` up to 4 hours: comparing each arena's UTC offset on its own game date counted DST changes as travel. Fixed by comparing both on the current date.
- Validation (2024-25): Home team 54.4% / 0.6905 log loss, Elo 66.4% / 0.6083, LogReg 68.4% / 0.5960 (C = 0.1). The LogReg C curve is flat from 0.1 up, so the rule picks the strongest regularization within 0.0001 of the best.
- MLflow uses a SQLite store (`ml/mlflow.db`). MLflow 3.18 serializes sklearn models with skops, which needs `skops_trusted_types=["numpy.dtype"]` for our own models.
- Feature build on all data takes about 3 s; 13,392 regular-season games from 2015-16; features hash `a2aab4e98d28b7b5`.

## Phase 3: Main game model
- [x] LightGBM + Optuna tuning on the 2024-25 validation season
- [x] Calibration, then a final test on 2025-26 (once) and a walk-forward backtest
- [x] SHAP top factors per game, plus the feature → human copy mapping
- [x] Register `tipoff-game` with the `champion` alias in MLflow
- [x] Fill in the metrics table in `docs/ML_PLAN.md §5`

Notes:
- `brew install libomp` was needed for LightGBM on macOS.
- Tuned LightGBM (100 Optuna trials) didn't beat LogReg on validation (0.6001 vs 0.5955); Optuna chose 5-leaf trees, which suggests the signal is mostly linear. The ensemble's best weight was 0.9 LogReg. **Champion = LogReg + Platt**, as the plan allowed.
- **Test 2025-26 (run once): Elo 0.5978 / 69.2% edged out LogReg 0.6022 / 67.1%.** The gap isn't significant (bootstrap 95% CI for LogReg − Elo per-game log loss: [−0.0036, +0.0113]). The champion wasn't changed, because that would use the test as a tuning set. Elo becomes the challenger on live 2026-27 games (Phase 10), and `/performance` should show Elo beside the model.
- Explanations use exact additive contributions (LogReg terms or LightGBM's built-in TreeSHAP); no `shap` package. 11 factor groups live in `shared/factors.json`, shared by ml and web (`web/lib/factor-copy.ts`).
- Known explanation quirk: `elo_diff` includes the home edge, so some home advantage shows as "Team rating". Fix with the copy work in Phase 8 (split the feature).
- MLflow 3.18 registered the pyfunc via its logged-model id and printed a "no artifacts at path 'model'" warning; registration and loading by `models:/tipoff-game@champion` both work.
- Walk-forward predictions for 2025-26 are in `ml/data/predictions/backtest_2025-26.parquet` (git-ignored) for the Phase 4 backfill.

## Phase 4: Publish pipeline + DB
- [x] Neon project (dev + prod branches), schema from ARCHITECTURE §4 (Drizzle migrations in `web/`, the single source of truth). `dev` branch still to create (needed for local web dev in Phase 5).
- [x] `tipoff predict --date` + `tipoff publish` (with the pregame-only guard)
- [x] Backfill: walk-forward pregame predictions for the 2025-26 season and 2026-27 to date, so `/performance` has history
- [x] `ml/scripts/daily.sh` + a local scheduler (launchd/cron/Task Scheduler) with instructions in README
- [x] GitHub Actions: `schedule-sync`, `results-sync`, `freshness-check`

Notes:
- Built and tested against Postgres in Docker first, then went live on Neon (created via the Vercel integration; main branch = prod, Postgres 18). Local Docker and CI moved from Postgres 17 to 18 to match.
- With the Vercel integration, its `DATABASE_URL` is the **prod** (main branch) URL. Locally it lives in `DATABASE_URL_PROD` with the direct (non-`-pooler`) host; `DATABASE_URL` points at the dev database. The GitHub secret was set from `.env` without the value passing through chat.
- Prod on 2026-11-14: 1,200 games synced, 1,413 backfilled predictions (`game-v1-wf`: 2025-26 log loss 0.6014 vs Elo 0.5995; 2026-27 to date 0.5839 vs 0.5948 on 183 games). Live predictions start 2026-11-15; that night's games had already tipped when it went live.
- Pregame guard is enforced twice: Python skips started games, and the upsert has `WHERE games.tipoff_utc > now()`. A test proves a caller with a wrong clock can't overwrite a started game.
- Backfill first stored 2025-26 games as `scheduled` with no scores; fixed (backfilled games are written as final with their results).
- `daily --if-needed` only counts games that haven't tipped off, so evening runs don't fail on games that can no longer be predicted. The 10:37 GitHub freshness check still counts every game.
- launchd agent installed (09:30, hourly retries to 18:30, run at login); first run exited 0. If the Mac is off all day, that day gets no predictions. Moving the daily job to GitHub Actions with cdn.nba.com box scores is the planned follow-up.
- pnpm 12 fails CI on unreviewed install scripts: `esbuild` is explicitly denied in `web/pnpm-workspace.yaml` (it doesn't need its script).
- node-postgres warns that `sslmode=require` will mean something weaker in pg v9; today it's treated as `verify-full`. Revisit when upgrading `pg`.

## Phase 4b: Daily job in the cloud
- [x] Spike: box-score possession formula vs stats.nba.com (net rating r = 0.997) and cdn box scores vs stats.nba.com counting stats (identical with `turnoversTotal` and player-only rebounds; minutes rounded half up)
- [x] Formula-based pace/ratings for every season; `FEATURES_VERSION` in the features hash
- [x] cdn box-score ingest + incremental staging (`stage_incremental`), proven equal to a full rebuild
- [x] `pipeline_state` table (Drizzle) + `tipoff state push/pull`; champion v2 and staged history pushed to dev and prod
- [x] Re-selection on validation (champion v2 = ensemble + Platt), v2 walk-forward backfill (`game-v2-wf`)
- [x] `.github/workflows/daily.yml` (hourly 09:07–18:07 ET, `--if-needed`; manual `force` input)
- [ ] After a week of clean cloud runs, uninstall the launchd fallback (`ml/scripts/install_launchd.sh --uninstall`)

Notes:
- The first features rebuild kept the same `features_hash` because the hash didn't cover feature definitions; added `FEATURES_VERSION` (now v2) before retraining.
- `tipoff.db.tables()` reflected a fixed list that missed `pipeline_state`; the state round-trip test caught it.
- cdn's `turnovers` excludes team turnovers and `reboundsTotal` includes team rebounds; using `turnoversTotal` and offensive + defensive player rebounds matches stats.nba.com exactly. Player minutes needed half-up rounding (Python's `round` is half-to-even) to match.
- Rehearsed `daily --cloud` against the dev branch before enabling it on prod.

## Phase 5: Web skeleton with placeholder 3D
- [x] Layout, nav, footer (with the unofficial disclaimer), routes for all pages
- [x] Drizzle queries + `Slate` type. Use fixture JSON if the DB isn't ready yet.
- [x] Home: GameRail, GameCard, DateSwitcher, the no-games-today states, `?game=` and `?date=` URL state, random default game
- [x] `<Scene>` with placeholder players (capsules or a simple stand-in rigged model, e.g. three.js's example `Xbot.glb`, **for dev only**), floor, spotlights in team colors
- [x] zustand scene state machine (ARCHITECTURE §5)
- [x] 2D fallback when WebGL is unavailable

Notes:
- Placeholder players are built from primitives (no downloaded model, nothing to license); jersey number and chest text are drawn on a canvas texture in Oswald. Spotlights use each team's brightest brand color; the clash rule (away wears its alternate when primaries are within RGB distance 90) applies to jerseys, the 2D fallback and the result bar.
- Predict currently advances the state machine on short timers (reveal 0.7 s, shot 0.9 s) and shows a minimal result panel (winner, probability split, final-game check, live vs backtest note). Phases 7 and 8 replace both.
- Next 16 details that bit: `new Date()`/`Math.random` in a page need `await connection()`; `usePathname()` in the layout broke the build for `/game/[id]` until the nav got a `<Suspense>` boundary; `@next/env` needed `forceReload` to read the repo-root `.env`.
- Phones: players move closer and the camera distance is computed from the aspect ratio so both stay in frame; the game strip needed 13.5rem of room below the Predict button.
- Schedule labels carry sponsor names ("Emirates NBA Cup"); the UI shows the event name only.
- Live/final games with no pregame prediction say so instead of "Prediction pending".
- Client JS (gz): the three.js/scene chunk is 241 KB and loads after first paint; all other client chunks across every route total 190 KB. Measure the home page's initial JS properly in Phase 10 (budget: 150 KB excluding the 3D chunk).
- Dev server: the 3D chunk takes ~10 s to compile on a fresh navigation in `next dev`; production builds don't have this.

## Phase 6: Real 3D assets (follow ASSET_PIPELINE.md)
- [x] Base character images → Meshy model → rig + clips → `player.glb` optimized (`pnpm assets:player`, about 2 MB)
- [x] Jersey spike: BOS + LAL with approaches A and B. **Decision: B (shader tint)**, see ASSET_PIPELINE section 5.
- [x] Uniform mask baked automatically (`pnpm assets:mask`), `Player` component with tint material, `/dev/jerseys` lab
- [x] Celebration: Meshy library preset "Cheer with Both Hands Up"
- [x] Players' look: **holograms** in the jersey color (DESIGN.md section 1)
- [ ] All 30 jerseys (+ alternates) checked in the lab, clash rule implemented
- [x] Hologram players in the home scene: idle variety, offset loops, loser dims, reduced motion pauses, colors swap on card click
- [x] Home redesign: hologram chamber room (glossy floor, grid walls, bloom, pointer parallax), reference-style holograms (contour lines, sparkles, outline, solid lettering, front surface only), arcade game wheel on the left (today + 2 days back), big hero players, no wordmark/footer on home
- [x] Motion library: 63 extra clips (28 Text to Motion, 35 presets) in `motion-library.glb` for later (`pnpm assets:motions`); `Idle_03` trimmed to its shoulder stretch
- [x] Redesign 2 (Nov 2026): real-color hologram players (scan lines, team rim, floor fade) centered and big under their names; star-field room with point-ring pads; today's games only, as flat hologram cards in a left-edge drawer (hover to reveal, tab on touch), "No games today" with a next-day button; site restyled after the hologram reference (Archivo wide headings, mono labels, NBA blue/red, grain)
- [ ] Cursor look-at
- [ ] Poly Haven floor + HDRI, `web/public/CREDITS.md`, CI size budget for `player.glb`

Notes:
- No Blender needed. gltf-transform scripts rename clips, check drift and optimize; the uniform mask is generated from the base texture and mesh.
- Text to Motion clips export under their task id; map new ones in `prepare-player.mts`.
- three's GLTFLoader strips `:` from bone names: the hand bone is `mixamorigRightHand` at runtime.
- Meshy's web Retexture keeps the original UVs (verified), so approach A stays possible if we ever want photographic jerseys for a few teams.
- A Text to Motion celebration didn't look human; `Celebrate` is the library preset "Cheer with Both Hands Up". One-shot clips blend back into the idle when they end.
- The AI-generated model reads as slightly "off" when shaded realistically. A hologram variant of the player shader (team-colored, unlit, scanlines, rim glow) and a pixelated render (low `dpr` + `image-rendering: pixelated`) are prototyped in the lab as stylized alternatives. About 95 Meshy credits spent in Phase 6 before the motion library, then 290 more for it (balance 855). Library clips are free.
- The motion library's index marks 20 clips as not in place (hips drift > 0.15 m); see ASSET_PIPELINE section 4.
- Turbopack's dev server sometimes keeps serving a stale `app/globals.css`, even after a restart: stop the server and delete `web/.next`. Component styles live in their own CSS files (`components/home/game-drawer.css`, `home.css`), which reload reliably.
- Redesign 2 replaced the arcade wheel and the line-art holograms; the old look is in git history (commit b7e7033).
- `player.glb` is about 2 MB; ~390 KB of it is glTF JSON for ~2,400 animation accessors. Trim static channels in Phase 10 if the payload needs it.

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
