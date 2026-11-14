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
 │  tipoff.train ─► MLflow (ml/mlruns or remote) ─► registered model "tipoff-game" v{N}     │
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
- `stats.nba.com` drops connections from cloud and CI IP ranges, so anything that needs it (historical game logs, box scores, advanced stats) runs locally on a schedule. `cdn.nba.com` (schedule, scoreboard) works from anywhere, so schedule and result syncing can run in GitHub Actions.
- Predictions change at most once a day, so the website reads precomputed rows. No Python runs on Vercel. That keeps the site fast, cheap, and simple.

## 2. Daily schedule (all times ET)

| Time | Where | Job | What it does |
|---|---|---|---|
| 06:00 | GitHub Actions | `schedule-sync` | Upserts today's and the next 7 days' games from cdn.nba.com into `games` |
| 09:30 | Local (cron / Task Scheduler / launchd) | `daily.sh` | ingest yesterday's box scores → features → predict today → publish |
| 10:30 | GitHub Actions | `freshness-check` | Fails (and emails) if today's games lack predictions |
| hourly 19:00–02:00 | GitHub Actions | `results-sync` | Pulls final scores from cdn.nba.com and fills `games.home_score/away_score/status` |
| Mon 05:00 | Local | `retrain.sh` | Retrains on all data to date, logs to MLflow, promotes it only if it beats the current model on the latest validation window |

If the laptop is off at 09:30, the job runs at next wake (launchd/anacron behaviour). The freshness check makes failures visible.

## 3. Repo layout

```
.
├── shared/teams.json
├── ml/
│   ├── pyproject.toml            # uv; ruff; pytest config
│   ├── src/tipoff/
│   │   ├── config.py             # paths, seasons, constants (pydantic-settings)
│   │   ├── ingest/
│   │   │   ├── nba_stats.py      # nba_api wrappers with rate limit + disk cache
│   │   │   └── nba_cdn.py        # schedule/scoreboard from cdn.nba.com
│   │   ├── features/
│   │   │   ├── team_form.py      # rolling team stats (shifted!)
│   │   │   ├── elo.py
│   │   │   ├── schedule.py       # rest days, back-to-backs, travel
│   │   │   ├── availability.py   # who's out (from previous-game minutes / injury report)
│   │   │   └── build.py          # assembles the game-level feature table
│   │   ├── models/
│   │   │   ├── game_outcome.py   # train/eval/calibrate classifier
│   │   │   ├── player_stats.py   # pts/reb/ast regressors
│   │   │   └── baselines.py
│   │   ├── evaluate/             # backtest, metrics, calibration, plots
│   │   ├── predict/              # inference + SHAP factor extraction
│   │   ├── publish/              # writes to Postgres (SQLAlchemy)
│   │   └── cli.py                # typer CLI: tipoff ingest|features|train|predict|publish|daily
│   ├── tests/
│   │   ├── test_no_leakage.py
│   │   ├── test_features.py
│   │   └── test_publish_schema.py
│   ├── scripts/daily.sh, retrain.sh
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

create table games (
  game_id       text primary key,            -- NBA game id, e.g. 0022600123
  season        text not null,               -- 2026-27
  game_date     date not null,               -- ET schedule date
  tipoff_utc    timestamptz,
  home_team_id  integer references teams,
  away_team_id  integer references teams,
  status        text not null,               -- scheduled | live | final | postponed
  home_score    integer,
  away_score    integer,
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
  factors        jsonb not null,             -- [{feature, value, shap, team}]  top-k
  features_hash  text not null,
  is_pregame     boolean not null default true,  -- generated before tipoff_utc
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

-- Convenience view the website uses: latest pregame prediction per game
create view current_game_predictions as
select distinct on (game_id) *
from game_predictions
where is_pregame
order by game_id, generated_at desc;
```

**Integrity rules**
- `publish` refuses to write a prediction for a game whose `tipoff_utc` has passed (`is_pregame` must be true). Past predictions are immutable.
- `/performance` joins `current_game_predictions` with `games where status = 'final'`.

## 5. Web data flow

- `app/page.tsx` (Server Component) reads `searchParams.date` / `searchParams.game`, queries the slate plus predictions and projections for that date, then passes a serializable `Slate` object to `<HomeExperience>` (Client Component).
- `<HomeExperience>` holds the UI state. The 3D `<Scene>` is loaded with `next/dynamic` and `ssr: false`.
- Revalidation: `export const revalidate = 300` on the home and game pages. `/performance` revalidates hourly.
- Date switching does a client navigation (`router.push('/?date=...')`), so it's server-rendered and cacheable.
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
| `DATABASE_URL` | ml publish, web | local `.env`, Vercel env, GitHub secret |
| `MLFLOW_TRACKING_URI` | ml | local `.env` (default `file:./mlruns`) |
| `MESHY_API_KEY` | scripts/assets | local `.env` only |

Use separate Neon branches for `dev` and `prod`. Vercel preview deployments use the dev branch.

## 7. CI (GitHub Actions)
- `ci.yml` (on PR): `ml` ruff + pytest (with tiny fixture data, no network), `web` lint + typecheck + test + build.
- Scheduled workflows listed in §2. None of them call `stats.nba.com`.
