# ML plan: Tip-Off

Two prediction tasks:
1. **Game outcome**: P(home team wins). This is the headline feature.
2. **Player stat lines**: projected PTS, REB and AST (with intervals) for each team's top ~8 rotation players.

The bar for "good": beat simple baselines on a held-out season, with well-calibrated probabilities, and **zero leakage**.

---

## 1. Data

| Data | Source | Endpoint (nba_api) | Granularity |
|---|---|---|---|
| Team game logs | stats.nba.com | `LeagueGameLog` (player_or_team='T'), one call per season and season type | team-game |
| Player game logs | stats.nba.com | `LeagueGameLog` (player_or_team='P'), one call per season and season type | player-game |
| Team advanced stats (ratings, pace, possessions, eFG%, OREB%, TOV%) | stats.nba.com | `TeamGameLogs` with `MeasureType=Advanced`, one call per season and season type | team-game |
| Schedule (future games) | cdn.nba.com | `staticData/scheduleLeagueV2.json` | game |
| Live/final scores | cdn.nba.com | `liveData/scoreboard/todaysScoreboard_00.json` | game |
| Arena locations (for travel) | static | `arena_coords` in `shared/teams.json` | team |

- **Seasons:** 2015-16 → current (2026-27). Earlier seasons played a different style, so test whether including them helps.
- **Caching:** every raw response is saved as parquet under `ml/data/raw/stats/{endpoint}/{season}/{season_type}.parquet`, with a `_manifest.json`. Completed seasons are fetched once. The current season is refreshed incrementally from its last cached date, at most every 3 hours. cdn responses go to `ml/data/raw/cdn/` (gzipped JSON plus parquet).
- **Staged tables:** `tipoff ingest` then writes validated `games`, `team_games` and `player_games` parquet files to `ml/data/staged/`. Features read only these.
- **Why not per-game advanced box scores:** `TeamGameLogs` Advanced returns a whole season in one call (about 9 s), against about 14,000 slow `BoxScoreAdvancedV3` calls for the same team-level numbers. Player advanced stats (usage) can come from `PlayerGameLogs` Advanced the same way in Phase 9.
- **Rate limit:** about 0.6s between requests, with retries and exponential backoff. Use a browser-like `User-Agent` (nba_api handles headers).
- Exclude preseason, All-Star, and (for v1) Play-In and playoff games. Keep `season_type` as a column so playoffs can be added later. Play-in and playoff games are ingested anyway (cheap) and filtered out at feature time.
- **Game ID prefixes** decide season type: `001` preseason, `002` regular season, `003` All-Star, `004` playoffs, `005` play-in, `006` NBA Cup final. The Cup final doesn't count in the standings and is dropped. Cup group-stage and knockout games before the final are regular-season games.
- **Neutral-site games** (international games, NBA Cup semifinals in Las Vegas; 11 so far) list both teams as away in the game logs. They're flagged `is_neutral`. Their designated home team comes from the cdn schedule when we have it (current season), and otherwise is the lower team id, a rule that never uses the result. Home-court features must be zero for them. For past seasons the official designated home team isn't recovered; that's a known limitation.
- **Unusual seasons:** 2019-20 (suspension, then the bubble: 64–75 regular-season games per team) and 2020-21 (72 games, empty or limited arenas). The EDA shows the home win rate fell from 58–59% before 2019 to 54–55% in most seasons since (2022-23: 58.0%).
- **Injuries (v1):** infer "who's out" as rotation players (≥ 20 mpg over the last 10 games) who aren't in today's projected lineup. Before tip-off we don't know who will play. Pragmatic v1: use a player's availability in the *previous* game plus the official injury report when available (manual or a scraped PDF in v2). Document this limitation honestly on `/docs`.

## 2. Leakage rules (read twice)

1. A feature row for game *G* on date *D* may only use games with `game_date < D`. (Same-day games are excluded too, since they're simultaneous.)
2. All rolling and expanding statistics are computed on a per-team sorted series and then `.shift(1)`.
3. Season-to-date stats reset at season boundaries. Every season-to-date and windowed stat is blended with a prior: `(n · current + k · prior) / (n + k)`, where `n` is games played so far and the prior is the team's previous regular-season average regressed one third of the way to that season's league average (k = 10 season-to-date, 3 last-10, 2 last-5, 5 EWM). Early-season rows lean on the prior, late-season rows on the current season. 2014-15 is ingested only to provide the priors and Elo warm-up for 2015-16.
4. Elo is updated **after** each game and read **before** it.
5. Scaling/encoding is fit inside the training fold only (use sklearn `Pipeline`).
6. **Test:** `tests/test_no_leakage.py` builds features, then randomly perturbs each game's own final score and confirms that game's feature row doesn't change. Also assert that `max(source_game_date) < game_date` for every row.

## 3. Features: game outcome model

Each row is one game, with features as **home − away differences** (plus a few raw values). Window sizes are tunable.

| Group | Features |
|---|---|
| Strength | Elo diff (with home-court constant), season-to-date net rating diff, point diff per game diff |
| Form | last-5 / last-10 net rating diff, last-10 win% diff, exponentially-weighted net rating (halflife ≈ 7 games) |
| Style/efficiency | off rating, def rating, pace, eFG%, TOV%, OREB%, FT rate (the "four factors"): season-to-date and last-10 diffs |
| Schedule | rest days (home, away), back-to-back flags, games in last 7 days, 3-in-4 flags, travel km since last game, time zones crossed |
| Availability | sum of season minutes share of rotation players out (home, away), star-out flag (top-2 by season-to-date points per game, since usage isn't ingested yet) |
| Context | season phase (game number / 82), home team's home record, away team's road record, neutral-site flag |

**As built (Phase 2):** 56 features in `ml/src/tipoff/features/columns.py`, built by `features/build.py`.
- Four factors are computed from the base box score: eFG% = (FGM + 0.5·3PM)/FGA, TOV% = TOV/(FGA + 0.44·FTA + TOV), OREB% = OREB/(OREB + opp DREB), FT rate = FTM/FGA. Each team gets offensive (own) and defensive (opponents') versions.
- "Out" = rotation players (≥ 20 mpg over the team's last 10 games) who didn't appear in the team's previous game, excluding players whose most recent appearance was for another team (traded). This is exactly what's known at 10 AM on game day. No injury report yet.
- Travel is measured between arenas. For neutral-site games the designated home team's arena stands in for the real venue (a known limitation). Time zones crossed compares both arenas' UTC offsets on the same date, so a DST change isn't counted as travel.
- Scheduled (unplayed) games go through the same code path, so training and prediction features can't drift.

Store the human-readable copy for each feature in `web/lib/factor-copy.ts` (e.g. `rest_days_diff` → "{team} more rested ({n} days vs {m})").

## 4. Models: game outcome

### Baselines (always reported)
1. **Home team wins**: historically wins roughly 55 to 60% of games. Compute the exact rate from your data.
2. **Elo-only logistic**: P(home) from the Elo diff.
   - Tuned on the training seasons only (grid over K, home advantage, carry-over, margin-of-victory; 300 combinations, by Elo's own log loss). Result in `ml/config/elo_params.json`: **K = 15, carry-over 0.6, margin-of-victory multiplier on, home advantage from the previous two seasons' league home win rate** (about 47 Elo points on average; 0 at neutral sites). The rolling home edge beat every fixed value, matching the EDA finding that home advantage shrank after 2019.
3. **Logistic regression** on all features (standardized). A strong, interpretable baseline.

### Main model
- **LightGBM** (or XGBoost) binary classifier, tuned with **Optuna** (≤ 100 trials) on the validation season, optimizing **log loss**.
- **Calibration:** isotonic or Platt via `CalibratedClassifierCV(cv="prefit")` on a separate calibration slice. Check reliability diagrams. A 60% pick should win about 60% of the time.
- Optional: average LR and GBM probabilities if that improves validation log loss.

### Explanations
- `shap.TreeExplainer` on the GBM. For each game, store the top 5 features by |SHAP| with sign and team attribution in `game_predictions.factors`.
- Convert SHAP log-odds to approximate probability-point contributions for display (document the approximation).

## 5. Evaluation protocol

**Splits (time-based):**
- Train: 2015-16 → 2023-24
- Validation (tuning and calibration): 2024-25
- Test (touch once at the end of each major version): 2025-26
- Live: 2026-27, graded every day on the site

**Walk-forward backtest:** for each month of the test season, train on everything before that month and predict it. Report the aggregate. This matches how the model is actually used.

**Metrics:** log loss (primary), Brier score, accuracy, ROC-AUC, calibration (ECE plus a reliability plot). Always shown as a table that includes the baselines.

**Validation season 2024-25** (1,230 regular-season games; trained on 2015-16..2023-24, 10,749 games). Source: `ml/reports/baselines_validation.md`, MLflow experiment `tipoff-game`.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6905 | 0.2487 | 54.4% | 0.5000 | 0.0241 |
| Elo | 0.6083 | 0.2107 | 66.4% | 0.7233 | 0.0207 |
| LogReg (C = 0.1) | 0.5960 | 0.2051 | 68.4% | 0.7408 | 0.0209 |
| LightGBM (calibrated) | | | | | |

LogReg's C was picked on validation (the strongest regularization within 0.0001 of the best log loss; the curve is flat from C = 0.1 up), so its validation numbers are slightly optimistic. The test season (2025-26) hasn't been touched; it's reported once, in Phase 3.

(Good NBA game models typically land in the mid-to-high 60s for accuracy. Don't promise more on the site.)

## 6. Player stat projections

- **Unit:** player-game. Targets: PTS, REB, AST.
- **Two-stage:** (a) project minutes from recent minutes, starter flag, rest, team availability (teammates out → more minutes), and blowout risk (|Elo diff|); (b) project per-minute rates from rolling per-36 stats, usage, opponent defensive rating, opponent pace, and home/away. Projection = minutes × rate.
- **Models:** LightGBM regressors (one per target), plus **quantile** models (α = 0.1 and 0.9) for 80% intervals.
- **Baseline:** player's last-10 average. Report MAE vs baseline for each stat.
- **Scope:** players with ≥ 10 mpg over the last 10 games, top 8 by projected minutes per team.
- Ship after the game model (see ROADMAP Phase 9).

## 7. MLOps

- **MLflow:** SQLite tracking store at `ml/mlflow.db`, artifacts in `ml/mlartifacts/` (both git-ignored); run `uv run mlflow ui --backend-store-uri sqlite:///mlflow.db` from `ml/`. Experiments `tipoff-game` and `tipoff-player`. Log params, metrics (val and test), the feature list, the data window, the calibration plot and SHAP summary plot as artifacts, and the model via `mlflow.sklearn` / `mlflow.lightgbm`.
- **Registry:** register `tipoff-game` with the alias `champion`. `retrain.sh` trains a challenger, compares on the latest 60-day window, and only moves `champion` if log loss improves.
- **Reproducibility:** `uv.lock`, fixed seeds, and a `features_hash` (hash of feature table schema + window) stored with every prediction.
- **Data validation:** pandera schemas on raw and feature tables (no nulls in key columns, sane ranges, unique keys).
- **Monitoring:** `/performance` *is* the monitor. Also log the daily rolling 50-game log loss and alert (GitHub issue via Action) if it degrades past the Elo baseline for 2 weeks.

## 8. What goes on the website's /docs
One MDX page each: Data sources and limitations · Feature engineering · Preventing leakage (with the test) · Models and baselines (table) · Calibration (plot) · Explaining predictions (SHAP) · Player projections · MLOps and the daily pipeline · Limitations and honest caveats.
