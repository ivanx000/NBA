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
- `stats.nba.com` drops connections from cloud and CI IP ranges, so anything that needs it (historical game logs, box scores, advanced stats) runs locally on a schedule. `cdn.nba.com` (schedule, scoreboard) works from anywhere, so schedule and result syncing can run in GitHub Actions. It sits behind Akamai, which returns 403 unless requests carry a full browser-like header set (nba_api's live headers); the manual `cdn-probe` workflow confirmed GitHub-hosted runners get through with those headers. The official injury report PDFs (`ak-static.cms.nba.com`, a static S3 host behind Akamai) also answer GitHub-hosted runners (probed 2026-11-21), with the same headers minus `Host`.
- Predictions change at most once a day, so the website reads precomputed rows. No Python runs on Vercel. That keeps the site fast, cheap, and simple.

## 2. Daily schedule (all times ET)

| Time | Where | Job | What it does |
|---|---|---|---|
| ~06:07 | GitHub Actions | `schedule-sync` | `tipoff sync --target prod`: upserts the whole current season's games from the cdn schedule (which also carries final scores) |
| hourly ~09:07–18:07 | GitHub Actions | `daily` → `tipoff daily --cloud --target prod --if-needed` | pull staged history + champions from `pipeline_state` → cdn.nba.com box scores for newly finished games → incremental stage → push history back → sync → the official injury report as of 09:00 ET (staged and pushed) → predict today and project its players → publish both → fill projected players' actual lines → freshness check. The player steps run after the game predictions are out and never stop the job; neither does a missing injury report (predictions go out without it). Exits immediately once today is published |
| ~17:52 (and ~18:52) | GitHub Actions | `daily` → `tipoff daily --cloud --target prod --refresh` | the evening refresh: once the 17:45 ET injury report snapshot is due, stage it, re-predict today's games and players and re-publish the ones that haven't started (the pregame guard keeps started games untouched). Once a day: a later run, or a day with no evening report, does nothing |
| 09:30, retried hourly to 18:30, and at login | Local launchd agent (`ml/scripts/daily.sh`), **fallback** | `tipoff daily --target prod --if-needed` | same job using stats.nba.com; only acts if the cloud run hasn't published. **Uninstalled 2026-11-20** after six clean cloud days; `ml/scripts/install_launchd.sh` reinstalls it if the cloud job ever needs a backup |
| ~10:37 | GitHub Actions | `freshness-check` | syncs, then fails (GitHub emails) if any of today's games lacks a live prediction |
| hourly ~18:17–02:17 | GitHub Actions | `results-sync` | same sync, plus live status/scores from today's scoreboard |
| Mon ~07:17 | GitHub Actions | `retrain` → `tipoff retrain --target prod` | pull staged history + both champions from `pipeline_state` → refit each recipe on every completed game → weekly walk-forward over the last 4 complete weeks, compared with what was published for the same games → push a refit (`game-v4-r<date>`, `player-v2-r<date>`) only if it's no worse (log loss within 0.005; player MAE ratio within 1%) → report in the job summary; an issue when a champion is kept. Shares the daily job's concurrency group |

GitHub cron runs in UTC, so Actions times drift by an hour with DST (shown for EST) and can start late. The daily job no longer needs the Mac: cdn.nba.com box scores carry every counting stat the features use (verified field by field against stats.nba.com), and pace and ratings come from the box-score possession formula for every season, so history and new games match. stats.nba.com is still used locally for historical ingest and rebuilds.

**Pipeline state** (`pipeline_state` table, written by `tipoff state push`): `staged` = the three staged parquet tables plus the staged injury report snapshots (`injury_reports.parquet`, `injury_snapshots.parquet`) (tar.gz, ~5 MB), `champion` = the champion `GameModel` (joblib) with its provenance, `player_champion` = the champion `PlayerModel` (joblib) with its provenance. The cloud job reads them and pushes `staged` back after adding games; without a `player_champion` it still publishes game predictions and skips the projections. Pulls verify a SHA-256 and only unpack the expected files (the injury tables are optional, so archives from before them still unpack). After registering a new champion locally, run `tipoff state push --what champion --target prod` (or `--what player-champion` for the player model).

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
│   │   │   ├── injury_report.py  # official injury report PDFs: as-of fetch, parse, name matching
│   │   │   ├── stage.py          # raw -> validated games / team_games / player_games
│   │   │   └── schemas.py        # pandera schemas
│   │   ├── features/
│   │   │   ├── timeline.py       # played + scheduled games, one row per team-game
│   │   │   ├── team_form.py      # rolling team stats (shifted!) blended with priors
│   │   │   ├── elo.py            # Elo + grid-search tuning (params in ml/config/elo_params.json)
│   │   │   ├── schedule.py       # rest days, back-to-backs, travel, time zones
│   │   │   ├── availability.py   # who's out (missed the previous game)
│   │   │   ├── lineup.py         # lineup strength (recent minutes × player rating)
│   │   │   ├── injury.py         # the injury report: adjusted lineup strength, player inputs
│   │   │   ├── columns.py, schemas.py
│   │   │   └── build.py          # assembles the game-level feature table + features_hash
│   │   ├── models/
│   │   │   ├── data.py           # load features, time-based splits (test season unreachable)
│   │   │   ├── baselines.py      # home team, Elo-logistic, LogReg
│   │   │   ├── train_baselines.py
│   │   │   ├── game_outcome.py   # GameModel: LogReg / LightGBM / log-odds ensemble + calibrator
│   │   │   ├── train_game.py     # Optuna, out-of-time calibration, champion kind (validation only)
│   │   │   ├── final.py          # one-time test, walk-forward, champion registration
│   │   │   ├── players.py        # PlayerModel: minutes × per-minute rates, quantile ranges + CQR
│   │   │   └── train_player.py   # selection on 2024-25, one-time test, tipoff-player@champion
│   │   ├── evaluate/             # backtest, metrics, calibration, plots
│   │   ├── predict/              # inference; explain.py turns contributions into top factors; players.py projects lines (+ backfill)
│   │   ├── publish/              # writes to Postgres (SQLAlchemy); players.py: projections + actual lines
│   │   └── cli.py                # typer CLI: tipoff ingest|features|train|predict|publish|results|backfill|daily|state
│   ├── tests/
│   │   ├── test_no_leakage.py
│   │   ├── test_features.py
│   │   └── test_publish_schema.py
│   ├── scripts/daily.sh            # local fallback for the daily job (launchd)
│   ├── data/                     # git-ignored: raw/stats, raw/cdn, staged, features
│   ├── reports/figures/          # PNGs from notebooks, reused by the website docs
│   └── notebooks/                # EDA only
├── web/
│   ├── app/
│   │   ├── page.tsx                      # home (server: fetch slate) → <HomeExperience/>
│   │   ├── how-it-works/page.tsx         # static scroll story (content in lib/story.ts)
│   │   ├── performance/page.tsx
│   │   ├── docs/[[...slug]]/page.tsx     # MDX
│   │   ├── game/[id]/page.tsx (+ opengraph-image.tsx)
│   ├── components/
│   │   ├── scene/                # Canvas, Player, Hoop, Ball, Lights, CameraRig, Cinematic
│   │   ├── home/                 # GameDrawer (today's cards), MatchupHeader, TeamLabel (pick buttons), ResultsView
│   │   ├── how-it-works/         # Chapter (ScrollTrigger progress), the chapter visuals, the chapter 5 hologram
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
  pts_lo real, pts_hi real,                  -- 80% ranges
  reb_lo real, reb_hi real, ast_lo real, ast_hi real,
  generated_at   timestamptz not null default now(),
  features_hash  text,
  source         text not null default 'live',   -- live | backfill (walk-forward backtest)
  actual_minutes real,                        -- the real line once final (0 = didn't play)
  actual_pts integer, actual_reb integer, actual_ast integer,
  injury_status  text,                        -- e.g. 'Questionable' on the official report when projected
  primary key (game_id, player_id, model_version)
);

-- One whole projection set per game: newest live set, else newest backfill
create view current_player_projections as
select p.* from player_projections p join (
  select distinct on (game_id) game_id, model_version from player_projections
  order by game_id, (source = 'live') desc, generated_at desc
) pick using (game_id, model_version);

-- Convenience view the website uses: latest pregame prediction per game (live beats backfill)
create view current_game_predictions as
select distinct on (game_id) *
from game_predictions
where is_pregame
order by game_id, (source = 'live') desc, generated_at desc;

-- Box scores for the advanced stats (migration 0003_box_score_stats): regular season, this
-- season and last. Facts, upserted by `tipoff stats` (part of the daily job).
create table team_game_stats (
  game_id text references games, team_id int references teams, opp_team_id int references teams,
  season text, game_date date, is_home boolean,
  minutes int, pts int, fgm int, fga int, fg3m int, fg3a int, ftm int, fta int,
  oreb int, dreb int, ast int, stl int, blk int, tov int, pf int,
  opp_pts int, poss real,              -- box-score possession estimate (same as the ML features)
  primary key (game_id, team_id)
);
create table player_game_stats (
  game_id text references games, player_id int, team_id int references teams,
  season text, game_date date, player_name text,
  minutes int, pts int, fgm int, fga int, fg3m int, fg3a int, ftm int, fta int,
  oreb int, dreb int, ast int, stl int, blk int, tov int, pf int,
  primary key (game_id, player_id)
);
```

**Integrity rules**
- `publish` refuses to write a live prediction for a game whose `tipoff_utc` has passed. The upsert also carries `WHERE games.tipoff_utc > now()`, so a started game's prediction can't be replaced even if the local clock is wrong. Past predictions are immutable.
- Backfilled rows (`source = 'backfill'`, model version `game-vN-wf`) are weekly walk-forward predictions: each comes from a model trained only on games before its week. They're labelled so `/performance` can say which history is a backtest and which was published live. They never replace live rows.
- `/performance` joins `current_game_predictions` with `games where status = 'final'`.
- Player projections follow the same rules: live sets are only written for games that haven't tipped off (checked against the database clock in the write's transaction, with the games' rows locked), each game's set is replaced whole for its model version so a player who drops out doesn't linger, and backfilled sets (`player-vN-wf`) never touch live rows. `tipoff results` fills `actual_*` from the staged box scores once a game is final; a projected player missing from a final box score gets `actual_minutes = 0`.

## 5. Web data flow

Next.js 16 with **Cache Components** (`cacheComponents: true`): route-segment `revalidate` no longer exists.

- `app/page.tsx` renders a static shell and, inside `<Suspense>`, a request-time `Home` that calls `await connection()`, reads `searchParams.game`, computes "today" in ET, and loads the slate. With no `?game=` (or one that isn't today's), `defaultGame` picks today's next game that hasn't started (`lib/slate.ts`); the client then writes `?game=` into the URL with `history.replaceState`, so refreshes and shares keep the game.
- `getSlate(today)` (`lib/db/queries.ts`) is a `'use cache'` function with `cacheLife('minutes')` (stale 5 min, revalidate 1 min). It wraps `fetchSlate(db, today)`, a plain function that the tests run against Postgres. It returns today's games in tip-off order and, only when today has none, the closest later day with games (`next`), with `current_game_predictions` (live beats backfill). It also loads the season's finished regular-season games before that day and works out each team's numbers (`lib/team-stats.ts`: record, home/away, last 10, streak, points for/against, margin, rest) and the season series, so the results screen needs no extra request. Advanced stats come with it (`advancedFor`): one query sums every team's box scores (and its opponents') this season before the day, one sums the projected players' (with their teams' totals in those games, for usage, and their last 5); `lib/advanced-stats.ts` turns the sums into ratings, pace, the Four Factors, league ranks, true shooting, usage and per-36. `fetchGameDetail` does the same for one game. Each game also carries its projected player lines from `current_player_projections` (one whole set per game, split by team, most projected minutes first; `lib/players.ts`). Past days are never returned.
- `/docs/[[...slug]]` imports `web/content/docs/{slug}.mdx` (`@next/mdx`; `mdx-components.tsx` maps links and adds `<Diagram>`), prerendered for every page in `lib/docs.ts` (`DOC_SECTIONS`, the single list behind the sidebar, static params and previous/next). "On this page" comes from `docToc(slug)`, which reads the MDX source's headings (cached for good).
- `/performance` reads `getGradedSeasons()` (cached, `cacheLife('hours')`, after `await connection()` so the page renders per request and CI builds need no database): every finished regular-season game with its `current_game_predictions` row, by season. `lib/performance.ts` turns a season into a summary (metrics vs Elo and the home-team baseline, rolling accuracy, calibration, best and worst calls, the last 150 picks) that a client component charts with Recharts.
- `/game/[id]` reads `getGameDetail(id)` (cached, `cacheLife('minutes')`; wraps `fetchGameDetail`): the game for any day (with its player lines and, once final, their real numbers), plus each team's last 10 results and the season series, from the same finished-games query. The page reads `params` inside `<Suspense>` (no `generateStaticParams`), and `generateMetadata` and `opengraph-image.tsx` use the same cached call.
- DB driver (`lib/db/client.ts`, server-only): Neon's HTTP driver for `*.neon.tech` URLs, node-postgres otherwise (local Docker, CI).
- Env: `next.config.ts` loads the repo-root `.env` with `@next/env` (`forceReload`, because Next has already cached `web/`'s env by then). Vercel sets `DATABASE_URL` itself.
- `<HomeExperience>` (client) holds UI state in the zustand scene store. The 3D scene is loaded with `next/dynamic` and `ssr: false`; without WebGL (or if the scene crashes) a 2D fallback renders, and `?webgl=0` forces it.
- Picking a card updates the store and the URL (`replaceState`, no server round trip); all of the day's games ship with the page.
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
As built: `lib/scene-store.ts` holds `phase`, `gameId`, `pick` and `viewing` (whose numbers the results screen shows) and `instantResults`, with a pure `transition(state, event)` (events: predict with the picked side, view, revealDone, shotDone, skip, back, returned, select), plus UI-only `hover` and a `cinematic` flag. `components/scene/matchup.tsx` watches `phase` and owns one GSAP timeline per prediction: it moves the camera (through `camera-override.ts`, which the camera rig blends toward), turns the picked player, switches his clips, flies the ball on `lib/shot-path.ts` (in or out by `verdict`), frames the viewed team on the results screen, and sends `revealDone`/`shotDone`/`returned` itself. Skip seeks the timeline to its `results` label. When the 3D scene isn't mounted (2D fallback), `cinematic` is false and the home page advances the phases on short timers.

### Search and analytics

- **Metadata:** every page builds its title, description, canonical URL and Open Graph/Twitter tags with `pageMeta()` (`lib/site.ts`; Next merges these objects shallowly, so each page sets them in full). The share image is `app/opengraph-image.tsx` (static), or the game's own `app/game/[id]/opengraph-image.tsx`. Metadata that depends on request data (the game pages) streams into the body for browsers; HTML-limited bots (Slackbot, X, Facebook, Bingbot and Google's crawlers among them, Next's default list) get it in `<head>` before the page streams, so link previews work. Googlebot also renders the body.
- **`/sitemap.xml`** (`app/sitemap.ts`, per request): the main pages, the docs, and every graded game (this season and last) from the cached graded-games query; the static pages alone if the database is unreachable. **`/robots.txt`**: everything allowed except `/dev/`, which also carries `noindex`.
- **Vercel Web Analytics** (cookieless page views) and **Speed Insights** (real-user Core Web Vitals) are in the root layout (`@vercel/analytics`, `@vercel/speed-insights`, inside `<Suspense>`). Their scripts are served by Vercel at `/_vercel/insights` and `/_vercel/speed-insights` only once each is enabled in the Vercel project; elsewhere they 404 and record nothing.

## 6. Environments and secrets

| Var | Used by | Where set |
|---|---|---|
| `DATABASE_URL` | ml (dev runs), web | local `.env`: the Neon `dev` branch, **direct** host (branched from main with its data; auto-delete set to Never). Vercel: set by the Neon integration (main branch) |
| `DATABASE_URL_PROD` | ml daily job | local `.env`: Neon main branch, **direct** (non-`-pooler`) host. GitHub secret `DATABASE_URL` holds the same value (mapped to `DATABASE_URL_PROD` in workflows) |
| `MLFLOW_TRACKING_URI` | ml | local `.env` (default `sqlite:///<repo>/ml/mlflow.db`, artifacts in `ml/mlartifacts/`) |
| `MESHY_API_KEY` | scripts/assets | local `.env` only |
| `NEXT_PUBLIC_SITE_URL` | web (canonical links, sitemap, share images) | optional; defaults to the production vercel.app URL (`web/lib/site.ts`). Set in Vercel when a custom domain is connected |

The Neon project was created through the Vercel integration; its main branch is prod (Postgres 18). The site only reads, so Vercel previews reading prod is harmless and needs no separate setting. A Neon `dev` branch is for local web development (the Neon HTTP driver can't talk to plain Postgres). Branches in this Vercel-linked project are tied to Vercel deployments and the create dialog defaults to auto-deleting after a day, so `dev` must be created by hand with auto-delete set to Never (Branches → Create a branch manually); if it disappears, recreate it that way and copy its direct connection string into `.env`. The pipeline's dev runs and the DB tests use Postgres 18 in Docker (`docker compose up -d db`, port 5433). Migrations: `pnpm db:generate` → commit `web/drizzle/*.sql` → `pnpm db:migrate` (dev, then `DATABASE_URL=$DATABASE_URL_PROD pnpm db:migrate`) → `pnpm db:seed`.

## 7. CI (GitHub Actions)
- `ci.yml` (on PR and main): `ml` ruff + pytest (fixture data, no network, plus DB tests against a Postgres 17 service using the real Drizzle migrations), `web` lint + typecheck + test + build.
- Scheduled workflows listed in §2. None of them call `stats.nba.com`.
