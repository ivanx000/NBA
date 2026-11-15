# Architecture: Tip-Off

## 1. Overview

```
 ┌────────────────────────── Developer machine (residential IP) ───────────────────────────┐
 │  tipoff.ingest  ── stats.nba.com (via nba_api) ──►  ml/data/raw/  (parquet, cached)      │
 │        │                                                                                 │
 │        ▼                                                                                 │
 │  tipoff.features ─► ml/data/features/*.parquet                                           │
 │        │                                                                                 │
 │        ▼                                                                                 │
 │  tipoff.train ─► MLflow (ml/mlflow.db or remote) ─► registered model "tipoff-game" v{N}   │
 │        │                                                                                 │
 │        ▼                                                                                 │
 │  tipoff.predict ─► predictions + SHAP factors + player projections                       │
 │        │                                                                                 │
 │        ▼                                                                                 │
 │  tipoff.publish ─────────────────────────────────────────────┐                           │
 └──────────────────────────────────────────────────────────────┼───────────────────────────┘
                                                                ▼
 ┌──────────── GitHub Actions (cloud) ────────────┐     ┌──────────────┐     ┌────────────────────┐
 │ schedule-sync: cdn.nba.com schedule/scoreboard │ ──► │ Neon Postgres│ ◄── │ Next.js on Vercel  │ ◄── visitors
 │ results-sync:  final scores → grade preds      │     └──────────────┘     │ (reads only, ISR)  │
 │ CI: tests, lint, typecheck, build              │                          └────────────────────┘
 └────────────────────────────────────────────────┘
```

**Why it's split this way**
- `stats.nba.com` drops connections from cloud and CI IP ranges, so anything that needs it (historical game logs, box scores, advanced stats) runs locally on a schedule. `cdn.nba.com` (schedule, scoreboard) works from anywhere, so schedule and result syncing can run in GitHub Actions. It sits behind Akamai, which returns 403 unless requests carry a full browser-like header set (nba_api's live headers); the manual `cdn-probe` workflow confirmed GitHub-hosted runners get through with those headers.
- Predictions change at most once a day, so the website reads precomputed rows. No Python runs on Vercel. That keeps the site fast, cheap, and simple.

## 2. Daily schedule (all times ET)

| Time | Where | Job | What it does |
|---|---|---|---|
| ~06:07 | GitHub Actions | `schedule-sync` | `tipoff sync --target prod`: upserts the whole current season's games from the cdn schedule (which also carries final scores) |
| hourly ~09:07–18:07 | GitHub Actions | `daily` → `tipoff daily --cloud --target prod --if-needed` | pull staged history + champion from `pipeline_state` → cdn.nba.com box scores for newly finished games → incremental stage → push history back → sync → predict today → publish → freshness check. Exits immediately once today is published |
| 09:30, retried hourly to 18:30, and at login | Local launchd agent (`ml/scripts/daily.sh`), **fallback** | `tipoff daily --target prod --if-needed` | same job using stats.nba.com; only acts if the cloud run hasn't published. To be removed after a week of clean cloud runs |
| ~10:37 | GitHub Actions | `freshness-check` | syncs, then fails (GitHub emails) if any of today's games lacks a live prediction |
| hourly ~18:17–02:17 | GitHub Actions | `results-sync` | same sync, plus live status/scores from today's scoreboard |
| Mon 05:00 | Local | `retrain.sh` | Retrains on all data to date, logs to MLflow, promotes it only if it beats the current model on the latest validation window |

GitHub cron runs in UTC, so Actions times drift by an hour with DST (shown for EST) and can start late. The daily job no longer needs the Mac: cdn.nba.com box scores carry every counting stat the features use (verified field by field against stats.nba.com), and pace and ratings come from the box-score possession formula for every season, so history and new games match. stats.nba.com is still used locally for historical ingest and rebuilds.

**Pipeline state** (`pipeline_state` table, written by `tipoff state push`): `staged` = the three staged parquet tables (tar.gz, ~5 MB), `champion` = the champion `GameModel` (joblib) with its provenance. The cloud job reads both and pushes `staged` back after adding games. Pulls verify a SHA-256 and only unpack the three expected files. After registering a new champion locally, run `tipoff state push --what champion --target prod`.

## 3. Repo layout

```
.
├── shared/teams.json, shared/factors.json   # factors: feature groups + copy for explanations
├── ml/
│   ├── pyproject.toml            # uv; ruff; pytest config
│   ├── src/tipoff/
│   │   ├── config.py             # paths, seasons, constants (pydantic-settings)
│   │   ├── seasons.py            # season strings, season types, game-id prefixes
│   │   ├── ingest/
│   │   │   ├── http.py           # shared rate limiter, retries, cdn headers
│   │   │   ├── nba_stats.py      # nba_api wrappers with rate limit + disk cache + manifest
│   │   │   ├── nba_cdn.py        # schedule/scoreboard from cdn.nba.com
│   │   │   ├── stage.py          # raw -> validated games / team_games / player_games
│   │   │   └── schemas.py        # pandera schemas
│   │   ├── features/
│   │   │   ├── timeline.py       # played + scheduled games, one row per team-game
│   │   │   ├── team_form.py      # rolling team stats (shifted!) blended with priors
│   │   │   ├── elo.py            # Elo + grid-search tuning (params in ml/config/elo_params.json)
│   │   │   ├── schedule.py       # rest days, back-to-backs, travel, time zones
│   │   │   ├── availability.py   # who's out (missed the previous game; injury report later)
│   │   │   ├── columns.py, schemas.py
│   │   │   └── build.py          # assembles the game-level feature table + features_hash
│   │   ├── models/
│   │   │   ├── data.py           # load features, time-based splits (test season unreachable)
│   │   │   ├── baselines.py      # home team, Elo-logistic, LogReg
│   │   │   ├── train_baselines.py
│   │   │   ├── game_outcome.py   # GameModel: LogReg / LightGBM / log-odds ensemble + calibrator
│   │   │   ├── train_game.py     # Optuna, out-of-time calibration, champion kind (validation only)
│   │   │   ├── final.py          # one-time test, walk-forward, champion registration
│   │   │   └── player_stats.py   # pts/reb/ast regressors (Phase 9)
│   │   ├── evaluate/             # backtest, metrics, calibration, plots
│   │   ├── predict/              # inference; explain.py turns contributions into top factors
│   │   ├── publish/              # writes to Postgres (SQLAlchemy)
│   │   └── cli.py                # typer CLI: tipoff ingest|features|train|predict|publish|daily
│   ├── tests/
│   │   ├── test_no_leakage.py
│   │   ├── test_features.py
│   │   └── test_publish_schema.py
│   ├── scripts/daily.sh, retrain.sh
│   ├── data/                     # git-ignored: raw/stats, raw/cdn, staged, features
│   ├── reports/figures/          # PNGs from notebooks, reused by the website docs
│   └── notebooks/                # EDA only
├── web/
│   ├── app/
│   │   ├── page.tsx                      # home (server: fetch slate) → <HomeExperience/>
│   │   ├── how-it-works/page.tsx
│   │   ├── performance/page.tsx
│   │   ├── docs/[[...slug]]/page.tsx     # MDX
│   │   ├── game/[id]/page.tsx (+ opengraph-image.tsx)
│   │   └── api/                          # (optional) small JSON routes for client date switching
│   ├── components/
│   │   ├── scene/                # Canvas, Player, Hoop, Ball, Lights, CameraRig, Cinematic
│   │   ├── home/                 # GameRail, GameCard, DateSwitcher, PredictButton, ResultsOverlay
│   │   ├── charts/               # WinProbBar, FactorBars, CalibrationChart, RollingAccuracy
│   │   └── ui/                   # shadcn components
│   ├── lib/
│   │   ├── db/ (schema.ts, client.ts, queries.ts)   # Drizzle
│   │   ├── teams.ts               # imports ../../shared/teams.json
│   │   ├── scene-store.ts         # zustand state machine
│   │   └── factor-copy.ts         # feature name → human copy
│   ├── content/docs/*.mdx
│   └── public/models, public/textures/jerseys
├── assets-src/                   # raw ChatGPT/Meshy outputs (git-ignored or Git LFS)
├── scripts/assets/               # meshy_pipeline.py, optimize_assets.sh
└── .github/workflows/ ci.yml, schedule-sync.yml, results-sync.yml, freshness-check.yml
```

## 4. Database schema (Postgres)

```sql
-- Teams are static; seeded from shared/teams.json
create table teams (
  team_id      integer primary key,          -- NBA team id, e.g. 1610612738
  abbr         text unique not null,         -- BOS
  city         text not null,
  name         text not null,
  conference   text not null,
  division     text not null
);

-- Source of truth: web/lib/db/schema.ts (Drizzle) -> web/drizzle/*.sql. This block summarizes it.
create table games (
  game_id       text primary key,            -- NBA game id, e.g. 0022600123
  season        text not null,               -- 2026-27
  season_type   text not null default 'regular', -- regular | playin | playoffs | cup_final
  game_date     date not null,               -- ET schedule date
  tipoff_utc    timestamptz,
  home_team_id  integer references teams,
  away_team_id  integer references teams,
  status        text not null,               -- scheduled | live | final | postponed
  home_score    integer,
  away_score    integer,
  is_neutral    boolean not null default false,
  game_label    text,                        -- e.g. "Emirates NBA Cup"
  updated_at    timestamptz default now()
);
create index on games (game_date);

create table model_versions (
  model_version text primary key,            -- e.g. game-v7 (MLflow registered version)
  kind          text not null,               -- game | player
  trained_at    timestamptz not null,
  train_window  text,                        -- "2015-16..2025-26"
  metrics       jsonb,                       -- validation metrics
  mlflow_run_id text
);

create table game_predictions (
  game_id        text references games,
  model_version  text references model_versions,
  generated_at   timestamptz not null,
  home_win_prob  real not null,
  factors        jsonb not null,             -- [{factor, label, favors, pp, logit}] top 5 (shared/factors.json)
  features_hash  text not null,
  is_pregame     boolean not null default true,  -- data cutoff before tip-off
  source         text not null default 'live',   -- live | backfill (walk-forward backtest)
  elo_home_win_prob real,                    -- Elo's own pregame probability (challenger)
  primary key (game_id, model_version)
);

create table player_projections (
  game_id        text references games,
  player_id      integer not null,
  team_id        integer references teams,
  player_name    text not null,
  jersey_number  text,
  model_version  text references model_versions,
  proj_minutes   real,
  pts real, reb real, ast real,
  pts_lo real, pts_hi real,                  -- 80% interval
  primary key (game_id, player_id, model_version)
);

-- Convenience view the website uses: latest pregame prediction per game (live beats backfill)
create view current_game_predictions as
select distinct on (game_id) *
from game_predictions
where is_pregame
order by game_id, (source = 'live') desc, generated_at desc;
```

**Integrity rules**
- `publish` refuses to write a live prediction for a game whose `tipoff_utc` has passed. The upsert also carries `WHERE games.tipoff_utc > now()`, so a started game's prediction can't be replaced even if the local clock is wrong. Past predictions are immutable.
- Backfilled rows (`source = 'backfill'`, model version `game-vN-wf`) are weekly walk-forward predictions: each comes from a model trained only on games before its week. They're labelled so `/performance` can say which history is a backtest and which was published live. They never replace live rows.
- `/performance` joins `current_game_predictions` with `games where status = 'final'`.

## 5. Web data flow

Next.js 16 with **Cache Components** (`cacheComponents: true`): route-segment `revalidate` no longer exists.

- `app/page.tsx` renders a static shell and, inside `<Suspense>`, a request-time `Home` that calls `await connection()`, reads `searchParams.date` / `searchParams.game`, computes "today" in ET, and loads the slate. With no `?game=`, it picks a random game from the day; the client then writes `?date=&game=` into the URL with `history.replaceState`, so refreshes and shares keep the game.
- `getSlate(date, today)` (`lib/db/queries.ts`) is a `'use cache'` function with `cacheLife('minutes')` (stale 5 min, revalidate 1 min). It wraps `fetchSlate(db, ...)`, a plain function that the tests run against Postgres. It returns the day's games with team records (regular-season W-L before that date), `current_game_predictions` (live beats backfill), and, on days without games, the next 7 days and the previous 7.
- DB driver (`lib/db/client.ts`, server-only): Neon's HTTP driver for `*.neon.tech` URLs, node-postgres otherwise (local Docker, CI).
- Env: `next.config.ts` loads the repo-root `.env` with `@next/env` (`forceReload`, because Next has already cached `web/`'s env by then). Vercel sets `DATABASE_URL` itself.
- `<HomeExperience>` (client) holds UI state in the zustand scene store. The 3D scene is loaded with `next/dynamic` and `ssr: false`; without WebGL (or if the scene crashes) a 2D fallback renders, and `?webgl=0` forces it.
- Picking a game card updates the store and the URL (`replaceState`, no server round trip). Date switching is a client navigation (`router.push('/?date=...')`), server-rendered from the cached slate.
- Prediction data ships with the page, so pressing Predict triggers no network call. The cinematic starts instantly.

### Scene state machine (zustand)
```ts
type Phase = 'loading' | 'idle' | 'revealing' | 'shooting' | 'results' | 'returning';
interface SceneState {
  phase: Phase;
  game: SlateGame;           // selected
  winner: 'home' | 'away' | null;
  instantResults: boolean;   // user toggle / reduced motion
  predict(): void;           // idle -> revealing
  skip(): void;              // any -> results
  back(): void;              // results -> returning -> idle
  selectGame(id: string): void; // only allowed in idle/results
}
```
The GSAP timeline subscribes to `phase` and owns all camera and character timing. React components only render current state.

## 6. Environments and secrets

| Var | Used by | Where set |
|---|---|---|
| `DATABASE_URL` | ml (dev runs), web | local `.env`: dev database (local Docker now; the Neon `dev` branch once it exists, needed for local web dev). Vercel: set by the Neon integration (main branch) |
| `DATABASE_URL_PROD` | ml daily job | local `.env`: Neon main branch, **direct** (non-`-pooler`) host. GitHub secret `DATABASE_URL` holds the same value (mapped to `DATABASE_URL_PROD` in workflows) |
| `MLFLOW_TRACKING_URI` | ml | local `.env` (default `sqlite:///<repo>/ml/mlflow.db`, artifacts in `ml/mlartifacts/`) |
| `MESHY_API_KEY` | scripts/assets | local `.env` only |

The Neon project was created through the Vercel integration; its main branch is prod (Postgres 18). The site only reads, so Vercel previews reading prod is harmless and needs no separate setting. A Neon `dev` branch is for local web development (the Neon HTTP driver can't talk to plain Postgres). The pipeline's dev runs and the DB tests use Postgres 18 in Docker (`docker compose up -d db`, port 5433). Migrations: `pnpm db:generate` → commit `web/drizzle/*.sql` → `pnpm db:migrate` (dev, then `DATABASE_URL=$DATABASE_URL_PROD pnpm db:migrate`) → `pnpm db:seed`.

## 7. CI (GitHub Actions)
- `ci.yml` (on PR and main): `ml` ruff + pytest (fixture data, no network, plus DB tests against a Postgres 17 service using the real Drizzle migrations), `web` lint + typecheck + test + build.
- Scheduled workflows listed in §2. None of them call `stats.nba.com`.
