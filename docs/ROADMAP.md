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
- [x] After a week of clean cloud runs, uninstall the launchd fallback (`ml/scripts/install_launchd.sh --uninstall`): removed 2026-11-20, after six clean days in a row (every run since 2026-11-15, including the first on the Phase 9 code)

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
- [x] All 30 jerseys (+ alternates) checked in the lab (`/dev/jerseys/all`, `?alt=1`), clash rule implemented
- [x] Hologram players in the home scene: idle variety, offset loops, loser dims, reduced motion pauses, colors swap on card click
- [x] Home redesign: hologram chamber room (glossy floor, grid walls, bloom, pointer parallax), reference-style holograms (contour lines, sparkles, outline, solid lettering, front surface only), arcade game wheel on the left (today + 2 days back), big hero players, no wordmark/footer on home
- [x] Motion library: 63 extra clips (28 Text to Motion, 35 presets) in `motion-library.glb` for later (`pnpm assets:motions`); `Idle_03` trimmed to its shoulder stretch
- [x] Redesign 2 (Nov 2026): real-color hologram players (scan lines, team rim, floor fade) centered and big under their names; star-field room with point-ring pads; today's games only, as flat hologram cards in a left-edge drawer (hover to reveal, tab on touch), "No games today" with a next-day button; site restyled after the hologram reference (Archivo wide headings, mono labels, NBA blue/red, grain)
- [x] Redesign 3 (Nov 2026): pick a winner by clicking a player (hover grows and brightens him; no Predict button); the picked player's shot goes in if the pick is right (model before the game, final score after) and misses if wrong; results screen with the team's numbers and the game's, a corner button for the other team, and Home; arena drawn in light; still hexagonal platforms; tick column for today's games; bigger, livelier players with smaller names
- [x] Cursor look-at
- [x] ~~Poly Haven floor + HDRI~~ (replaced by the arena drawn in light, generated in code), `web/public/CREDITS.md`, CI size budget for `player.glb` (`lib/asset-budget.test.ts`)

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
- The Neon `dev` branch had disappeared (Vercel-linked branches auto-delete; the create dialog defaults to 1 day), so local dev pointed at a dead endpoint. Recreated 2026-11-19 from main with auto-delete Never (see ARCHITECTURE section 6).
- Redesign 3 decisions (with the user): the picked player shoots and misses when the pick is wrong; "right" means the model's pick before the game and the final score after; team stats come from data already in Postgres (no pipeline change); the background is an arena drawn in light.
- Moving vertices in the hologram shader (for a glitch) speckled the surface: even an unused branch changed how the GPU computed positions, so the hologram no longer matched its depth pre-pass. Glitches are done per fragment instead.
- `player.glb` is about 2 MB; ~390 KB of it is glTF JSON for ~2,400 animation accessors. Trim static channels in Phase 10 if the payload needs it.

## Phase 7: The prediction cinematic
- [x] GSAP master timeline per DESIGN §4 (camera rig, winner turn, loser dim)
- [x] Ball attach to the hand bone → release at `JUMPSHOT_RELEASE_TIME` → Bezier flight
- [x] Confidence-based shot outcome (swish / back-iron / rattle)
- [x] Hoop reveal, swish net wobble, team-color flash + confetti
- [x] Skip / Esc, reduced-motion path, return-to-home reverse
- [x] Performance pass: `<PerformanceMonitor>`, DPR scaling, post-processing toggle

Notes:
- Decided with the user: the hoop is drawn in glowing lines (matching the room), the ball is a real basketball with a team-color trail, and "confetti" is a burst of light sparks.
- The cinematic never fights the home camera: it writes a target shot and a blend weight (`camera-override.ts`) and the rig lerps toward it, so push-in, hero shot and return are all one weight tween plus shot moves.
- The ball sits between both hands (the jump shot is two-handed) and leaves at 1.27 s into `JumpShot`, which looks right with the arms overhead. Shot timing depends only on the outcome, so the timeline is built up front; the real path is computed at release from where the ball is.
- `Player` now starts one-shot clips at their first frame (the idle offset that keeps the two players out of step was also applied to the jump shot).
- `PerformanceMonitor`: DPR starts at 1.5, rises to 1.75 on fast devices, drops to 1 on slow ones, and turns off bloom if it keeps struggling.
- Checked in Chrome with sample games in local Postgres: back iron (58%), swish (70%), rattle (51%), Skip/Esc, and Back. Reduced motion skips straight to results (no timeline), as before.

## Phase 8: Results + content pages
- [x] Results overlay: win prob bar, factor bars, Final-game ✓/✗ (player lines placeholder until Phase 9)
- [x] `/game/[id]` + OG image
- [x] `/performance`: tiles, rolling accuracy, calibration, recent table
- [x] `/docs` MDX setup with sidebar + TOC. Write the pages listed in ML_PLAN §8 and an architecture page.
- [x] `/how-it-works` scroll story

Notes:
- Part 1 done: the results screen's reasons are bars in the favored team's color, finished games get a "Final · … · ✓ Model correct" badge, and "Full breakdown" links to `/game/[id]`. That page works for any game (past ones too, for `/performance`): win chance with the Elo baseline and where the prediction came from (live or walk-forward backtest), the reasons, both teams' numbers and last-10 strips, the season series game by game, and a placeholder for player lines. Its link preview (`opengraph-image.tsx`) shows the matchup and both win chances in the teams' glow colors.
- Win bars use the teams' glow colors (`hologramMatchup`), not jersey colors: a black jersey (Heat) disappears on the dark background.
- Inner pages scroll under the fixed nav, so it now has a dark glass backing there (not on home).
- Part 2 done: `/performance` grades every finished regular-season game that had a pregame prediction (the `current_game_predictions` view: live beats backfill). This season mixes live picks and walk-forward backtest picks, labeled; a toggle shows last season's full backtest. Tiles (accuracy, log loss, Brier, games) show Elo and the home-team baseline under the model, the headline says plainly whether the model is ahead of or behind Elo, then the rolling 50-game accuracy, calibration from the favorite's side (50–60% … 90–100%, with a table), the most confident hits and misses, and the last 150 picks with filters (right/missed, live/backtest) linking to `/game/[id]`.
- Last season reads 67.0% vs Elo 69.2% on 1,230 games, matching the one-time test report (`ml/reports/test_2025-26.json`), so the page and the pipeline agree.
- The home-team baseline uses a constant 56.8% (the training home win rate), as `tipoff` does; home teams are only 49.5% this season so far.
- Recharts is pinned to 3.10.1: 3.11.0 was two days old.
- After adding a new `'use cache'` export to `lib/db/queries.ts`, the dev server served the old module ("… is not a function") until restarted with `web/.next` cleared.
- Part 3 done: `/docs` is `@next/mdx` (versions pinned; plugins named by string for Turbopack: remark-gfm, rehype-slug, rehype-pretty-code with Shiki's github-dark-dimmed) with our own layout: sections on the left, the page, "On this page" on the right (built from the MDX source's headings with github-slugger, the same slugs rehype-slug gives; the heading in view is marked). Eleven pages in `web/content/docs/`, written from ML_PLAN, ARCHITECTURE, the reports and the code; four report figures copied to `public/docs/figures` as WebP; two Mermaid diagrams (architecture, daily jobs), with Mermaid loaded only on pages that use one.
- Cache Components gotchas: reading the MDX files counts as uncached data, so the TOC read is `'use cache'` + `cacheLife('max')`; the page reads `params` inside `<Suspense>` (partial prefetching's instant-navigation check), yet all pages still prerender from `generateStaticParams`; `dynamicParams` doesn't exist with Cache Components (unknown slugs hit `notFound()`); a static property on a client component (`DocsSidebar.Fallback`) is `undefined` across the server boundary, so the fallback is its own export.
- The weekly retrain isn't built yet (Phase 10), so the docs say it's planned rather than describing it.
- Part 4 done: `/how-it-works` is a static scroll story in five chapters, following one made-up example game (Celtics at Knicks) whose reasons add up to its prediction (57% → 63%) with the real factor names and copy from `shared/factors.json` (tested in `lib/story.test.ts`, with the game counts matching the model docs: 11,979 learned from, 1,230 held out). The test-season numbers are the one-time report's. On wide, tall screens each chapter pins and its visual plays with the scroll (GSAP ScrollTrigger feeding a 0–1 progress to the visuals); elsewhere chapters flow. Chapter 5 is the home page's hologram player on his platform, loaded only when the chapter comes near, with a 2D fallback.
- `gsap.matchMedia` only runs its callback when one of its conditions matches, so the chapter adds an always-true one; without it nothing played on screens that weren't pinned.
- A function prop can't cross from a Server Component to a client one, so the big numbers take a `unit` (`"count"`/`"percent"`) instead of a formatter.
- The page-stub component is gone; every nav page is built.

## Phase 9: Player stat projections
- [x] Minutes model + per-minute rate models + quantile intervals, compared against the last-10 baseline
- [x] Publish to `player_projections`, show in the overlay and the game page
- [x] Docs page

Notes:
- Decisions: 80% ranges for points, rebounds and assists (the table gets `reb_lo/hi`, `ast_lo/hi`); usage computed from the box score, not ingested; the results screen shows the viewed team's top 5, the game page both teams' 8 with actual lines once final; this season gets a walk-forward backfill, labeled as backtest.
- Part 1 done (features): `features/players.py`, built by `tipoff features` (see ML_PLAN section 6, "As built"). `build_features` was split so the player builder reuses the same team tables (`build_tables`); the game feature hash didn't change. Projections are "if he plays": candidates for a scheduled game are the players who appeared in the team's previous game.
- The game logs have no starter flag, so "started" is a proxy: the team's five biggest minutes that night.
- Opening night uses last season's finale for candidates, so roster moves over the summer aren't reflected until a player has played for his new team.
- Part 2 done (models): minutes × per-minute rate (LightGBM), quantile ranges with a conformal correction; two-stage beat direct models for every stat. On the one-time 2025-26 test the projections beat each player's last-10 average on every stat (minutes −6.9%, points −3.1%, rebounds −3.2%, assists −2.9% MAE), and the 80% ranges held 80.7–81.3% of real lines. Registered `tipoff-player@champion` (v1). Details in ML_PLAN section 6.
- The player test season was scored once, as the game model's was; `tipoff evaluate --test --player` writes `ml/reports/test_player_2025-26.json` and refuses to run again without `--force-retest`.
- Part 3 done (pipeline): `player_projections` gained rebound and assist ranges, provenance (`generated_at`, `features_hash`, `source`) and the actual lines (`actual_*`), plus the `current_player_projections` view (migration `0002_player_projections`). `tipoff predict`/`publish` handle players too, `tipoff results` fills actual lines, `backfill --what players` runs the 2026-27 walk-forward, and `state push --what player-champion` gives the cloud job the model (`player_champion` key). Run on dev: tonight's 4 games (64 lines) live, 222 games backfilled with the same edge over the last-10 average as the test season.
- Each game's projection set is replaced whole on republish, so a player who drops out of the candidates between morning runs doesn't linger.
- No jersey numbers yet: the stats.nba.com logs don't carry them, so `jersey_number` stays empty and the site shows initials.
- Staging found a feed error: stats.nba.com listed 168 team minutes for Denver in 0022600231 (Nov 14), which made its pace 142 and failed validation. Staging now uses the longer of the two teams' minutes (both play the same length) and logs it; it's the only such game since 2014.
- Prod set up on 2026-11-19: migration `0002_player_projections` applied, `player_champion` pushed to `pipeline_state` (player-v1, trained through 2026-11-13), and the 2026-27 walk-forward backfilled (3,469 lines for all 222 finished games, with real lines). Live projections start with the first daily run after this code is on `main`.
- Part 4 done (web): the slate and game queries attach each game's projection set (`lib/players.ts`, from `current_player_projections`). The results screen lists the viewed team's top 5 (initials badge, short name, minutes, each stat with its range, the real line once final); the game page has a table per team with all 8, the real numbers marked ✓/✗ against the ranges, and a note saying whether the lines were live or a backtest. `/docs/player-projections` now describes what was built, with the test-season table and this season's backtest; the overview, architecture, pipeline and limitations pages no longer call projections upcoming.

## Phase 10: Launch polish
- [x] Lighthouse ≥ 80 mobile on home, a11y audit (keyboard, focus, aria-live)
- [x] Error and empty states, 404, loading skeletons
- [x] Analytics (Vercel Analytics), SEO metadata
- [ ] Custom domain (deferred: the site stays on vercel.app for now; set `NEXT_PUBLIC_SITE_URL` when one is connected)
- [x] Final README with screenshots and a GIF of the cinematic
- [x] Weekly retrain job + champion/challenger promotion

Notes:
- Decisions: the weekly retrain runs on GitHub Actions from the staged history in Postgres and promotes a refit only if a 4-week walk-forward is no worse than what was published (otherwise it keeps the champion and opens an issue); the domain stays on vercel.app for now; Vercel Web Analytics and Speed Insights.
- Part 1 done (error, empty and loading states): a shared status page for "No such page" (unknown URLs and docs pages) and "No such game", an error boundary that keeps the nav and footer ("Try again" re-fetches; the docs are static so they're offered meanwhile), a global error page for a failed root layout, and skeletons in the shape of `/game/[id]` and `/performance`. The empty states (no games today, prediction pending, no graded games, no player lines) were already in place.
- Unknown docs pages and game IDs answer 200 rather than 404: `notFound()` runs inside a streamed Suspense boundary (params and data are read there under Cache Components), and the status can't change once streaming starts. Next adds `<meta name="robots" content="noindex">` to them, so they're never indexed. Unknown URLs get a real 404.
- Part 2 done (speed and accessibility). Lighthouse mobile, home, local production build, median of 4: **83** (75/83/83/85), up from 74–75; the live site scored 58 and then 80 on two runs before the changes (the variance is large: Lighthouse renders WebGL in software, and the first run after a deploy is cold). Blocking time went from 0.8–10 s to 0.3–0.5 s. What it took, measured one change at a time with a CPU-sampled profile:
  - the film grain (a fixed SVG noise filter with `mix-blend-mode: overlay` over the animated canvas) was half a second of main-thread work on its own; it's now a static noise tile (without 3D the page went from 79 to 93);
  - `Intl.DateTimeFormat` was built on every call (90 ms across the header and game cards), and `LocalTime` built one inside a `useSyncExternalStore` snapshot; formats are now made once;
  - the WebGL probe created a throwaway context (50 ms); it's a feature check now, and R3F still sends a failed context to the error boundary and the 2D fallback;
  - the reflection map moved out of the first commit (idle callback), shaders go through `compileAsync` with rendering paused;
  - phones start without bloom and add it after 8 s of smooth frames (it was being added as soon as headless Chrome saw a good frame rate, and its shader compile then landed inside the measured window: 1–1.6 s tasks).
  - Inner pages: `/performance` 84, `/game/[id]` 95, `/docs/*` 96, `/how-it-works` 94.
- Accessibility is 100 on every page. Fixed: the pick buttons' names now contain their visible text (WCAG 2.5.3; the visible text is wrapped in screen-reader-only "Pick the … to win" instead of an `aria-label`), the games tab's name includes its visible "N games", the smallest labels went from 9–10.4px to 11px on phones, the disclaimer is brighter (it failed contrast over the 2D fallback). Keyboard: skip link → nav → pick buttons → games tab (Enter opens the drawer, Tab moves into the cards, Escape closes); after a pick focus moves to the verdict, and Home now returns focus to the picked team's button instead of the page body; switching games is announced in a polite live region.
- Still flagged, not changed: Lighthouse's legible-text check (60% of text at 12px or more; home has 26%, the game page 47%) because the design's mono labels are 11–11.5px; raising them site-wide is a design change. The game page's meta description is missing from what Lighthouse reads (part 3).
- `.claude/launch.json` has a `web-prod` entry (`next start` on port 3100) for measuring production builds locally.
- Part 3 done (SEO and analytics): `lib/site.ts` (site URL, overridable with `NEXT_PUBLIC_SITE_URL`; `pageMeta()` for title, description, canonical, Open Graph and Twitter tags on every page), a default share image (`app/opengraph-image.tsx`), `/sitemap.xml` (main pages, docs, and every graded game: about 1,460 URLs), `/robots.txt` (everything but `/dev/`, which is also `noindex`), and Vercel Web Analytics plus Speed Insights in the root layout (pinned 2.0.1 and 2.1.0). Their scripts only exist once both are switched on in the Vercel project.
- Next merges `openGraph` shallowly, so a page that sets its own drops the inherited share image; `pageMeta` names the image every time. An explicit image also beats a file-based one, so the game pages pass their own `/game/[id]/opengraph-image`.
- Game-page metadata depends on the request, so Next streams it into the body for browsers (Lighthouse's "no meta description" on `/game/[id]`). Checked on a production build: Slackbot gets the full set in `<head>`, so shared links unfurl with the matchup image; Googlebot reads the streamed tags (it renders the page).
- Part 4 done (weekly retrain): `tipoff retrain` (`models/retrain.py`) and `.github/workflows/retrain.yml` (Mondays ~07:17 ET, before the daily job, in the same concurrency group). It refits both recipes on the cloud's staged history, runs a weekly walk-forward over the last 4 complete weeks, and promotes each refit only if it's no worse than what was published for the same games (game log loss within 0.005, player MAE ratio within 1%); the report goes in the job summary and a kept champion opens an issue. A dry run against prod took about 3 minutes and reproduced the stored backfill exactly (183 of the 191 games in the window were backfill made with the same recipe), which is a good check of the cloud refit; it becomes a real comparison as live picks accumulate. Details in ML_PLAN section 6.
- `--pull` unpacks the prod history into a temporary folder, so running the retrain on the Mac never overwrites `ml/data/staged`.
- The old plan's `retrain.sh` (local, MLflow) was dropped: the cloud champion lives in `pipeline_state`, and promoted refits are named `game-v2-r<date>` so they're never confused with the hand-trained MLflow versions.
- Part 5 done (README): rewritten for launch, with a GIF of the cinematic, six screenshots (`docs/images/`, WebP), the test-season numbers next to their baselines, an architecture diagram, the scheduled jobs and setup. Captured from a local production build on the dev data (refreshed with `tipoff daily --target dev`) by a headless Chrome on the Mac's GPU through puppeteer: screenshots at 1440×900 (and one phone at 390×844), and the cinematic as a CDP screencast (539 frames in 9.3 s), retimed from its frame timestamps and encoded with ffmpeg at 600px and 12 fps with a 96-color palette and ordered dithering (5.3 MB; the film grain and scan lines make error-diffusion GIFs two to three times larger).
- Design pass on 2026-11-20 (DESIGN.md sections 1–3 and 6): a site icon (`app/icon.svg`, `favicon.ico`, `apple-icon.png`) and no Next.js dev badge; the platforms and their light columns are gone, the players stand in the center circle of a hardwood court in an arena dressed in the matchup's colors (painted crowd, ribbon board, scoreboard, searchlights) that reacts to hover; hovering a player pops him out with a highlight and a floor ring; `/how-it-works` lost its boxes and dividers (outlined step numbers, pointer glow and tilt, a progress bar, hover readouts in every visual); and a site-wide interaction layer (pointer glow, panel spotlights, tilt, count-ups, scroll reveals). The README screenshots and GIF still show the platforms and need retaking.
- Second design pass on 2026-11-20, after feedback (DESIGN.md sections 1–4 and 6): the arena went back to real-life colors, after the audience in `kyledev223/lions-share`: tiers of seats in one color with fans in one color sitting in them (heads and shoulders in dust), no scoreboard, ribbon boards or colored searchlights. The pick's cinematic is new: the other player collapses into the floor while the camera swings round the shooter (a polar orbit with a midpoint pull-back, rise and wider lens) to a side-on shot of him and the court's real basket at the far end, with letterbox bars and light cuts; the shot is a long one (about 13.9 m), so its flight and arc scale with distance (`shotPath`'s new optional `flightS`/`apexM`). And no page outside home has framed panels any more; the tilt on the report-card tiles went with them.
- Third design pass on 2026-11-20: the court redrawn after a real NBA home court (maple, painted lanes and apron, every marking, baseline lettering, scorer's table and benches) with the site's own center crest for the home team (no real logos); the fans one color per side, in each team's color; the lions-share cursor (ring and dot) and its lens, with the fans near the cursor hopping; a gentler hover pop.
- `postprocessing` won't let one effect both move uvs (`mainUv`) and sample its input (convolution), so the lens does its magnify and ripple where it samples, in `mainImage`.
- Tailwind's CSS pipeline silently dropped everything after a `font:` shorthand that mixed `var()` with a `/line-height` (the cursor's label); written as longhands it compiles.
- 2026-11-20, at the user's request: the home team's official logo at center court (30 SVGs from `cdn.nba.com/logos/nba/{team_id}/primary/L/logo.svg`, cleaned and stored in `web/public/logos/`, 244 KB); CLAUDE.md's brand rule now allows exactly that and nothing more. The site's own crests stay as the fallback. Also: players keep one calm idle, the ball sits on the fingers, the letterbox and light cuts are gone, and the shot's camera is one continuous path; the shot's props are compiled at load (they froze the move for 300 ms when first drawn).
- The stands are unlit (`meshBasicMaterial`): lit by the court's key light, the seats read as a bright grey wall and hid the fans.
- Scroll reveals are a CSS scroll-driven animation rather than a script: tagging elements from a layout-level effect raced the streamed Suspense content and caused hydration mismatches. The pointer effects write only to `<html>` for the same reason.
- Results redesign on 2026-11-20 (DESIGN.md sections 4–5): the other player fades out instead of sinking into the floor and stays gone; after the shot the camera closes in on the shooter's upper body; the stats sit on the scene with no panel, in a column that scrolls through the whole breakdown (the slate now carries each team's last 10 and the season series, `Slate.details`); a corner button switches teams in one 1.3 s glide; the initials badges are gone. The "unofficial fan project" disclaimer is now said once, on Docs → Limitations (removed from the footer, the home corner, the error page, the share images and page descriptions; CLAUDE.md updated).
- Name and mark on 2026-11-20: the site dropped the "Tip-Off" name (title "NBA Game Predictor", no wordmark) and its icon became a plain basketball (`components/ball-mark.tsx`, icons from `web/scripts/make-icons.mjs`); the spinning CSS ball loader was replaced by `ArenaLoader`. Vercel saves a project's avatar from the favicon once, so the new mark has to be uploaded by hand (`web/public/brand/avatar.png`, Settings → General → Project Avatar).
- The launchd fallback (Phase 4) was removed on 2026-11-20: the cloud daily job had run clean every day since 2026-11-15, and the fallback only ever acted when the cloud hadn't published, so a seventh day added little. `ml/scripts/install_launchd.sh` reinstalls it.

## Phase 11: Model v2 (beat Elo reliably)
Study: `ml/reports/elo_gap_study.md`. The v1 champion lost to Elo on the 2025-26 test; across six
held-out seasons its edge over Elo is small and it loses in three of them.
- [x] Study: rolling validation over 2019-20..2024-25, input groups, margin rating, lineup headroom
- [x] Lineup strength as a pre-game feature (player Game Score ratings x last-5 minutes; bump `FEATURES_VERSION`), computable from cdn box scores in the cloud job
- [x] Elo-anchored model kind (adjustments on Elo's log-odds, penalty on the adjustments only), with contributions for the "Why" factors and factor copy for lineup strength
- [x] Model selection on rolling validation (2019-20..2024-25) instead of one season
- [x] Champion refit (`tipoff-game` v3, local registry) and 2025-26 walk-forward
- [ ] Deploy: push the code, then `tipoff state push --what champion --target prod` for the cloud job (in that order: the cloud job needs `features/lineup.py` before the v3 model)
- [ ] The one-time re-test on 2025-26 for the new major version (`--force-retest`), with the user's OK
- [ ] Later: official injury reports (worth up to about 0.004 more log loss)

Notes:
- Rolling validation (2019-20..2024-25), pooled log loss: Elo 0.6287, LogReg 0.6228, LightGBM 0.6297, ensemble 0.6227, Elo-anchored (λ = 100) 0.6212, better than Elo in all 6 seasons: champion v3 with Platt. 2025-26 walk-forward: v3 0.5950 vs Elo 0.5979 (v2: 0.6024); accuracy 67.9% vs Elo 69.0%.
- Adding lineup strength also lifted the plain logistic regression from −0.0030 to −0.0059 vs Elo: it's the feature, not just the anchoring.
- The study scripts in `ml/notebooks/elo_gap/` have relaxed ruff rules (math-style names); nothing imports them.

## Later ideas
- Predicted final score / spread (regression model)
- Live in-game win probability using play-by-play from cdn.nba.com
- Team pages with model rating over time
- Playoff series simulator (Monte Carlo over game probabilities)
