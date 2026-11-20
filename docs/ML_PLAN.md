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
- **Pace and ratings (since v2 features):** computed from the box score for every season with the Basketball-Reference possession estimate averaged over both teams, not taken from stats.nba.com. Against stats.nba.com's own numbers: possessions r = 0.97, offensive rating r = 0.991 (mean abs diff 1.4), net rating r = 0.997. This lets the cloud job use cdn.nba.com box scores (which have no possession counts) with no seam between history and new games. `features_hash` includes `FEATURES_VERSION` (v1 = stats.nba.com ratings, v2 = formula).
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

**v2 features (cloud move):** selection re-run on 2024-25 validation with formula-based ratings. LogReg 0.5957 (v1: 0.5955), LightGBM 0.5999, ensemble (0.9 LogReg + 0.1 LightGBM, Platt) 0.5957. The ensemble won by 0.00004, which is noise, but the rule is "lowest validation log loss", so **champion v2 = ensemble + Platt** (`tipoff-game` v2). The test season wasn't re-run; the 2025-26 walk-forward, run for information only, gave 0.6024 (v1 LogReg: 0.6018; Elo 0.5979).

**As built (Phase 3):** LightGBM tuned with Optuna (100 trials, TPE, seed 26) settled on very shallow trees (5 leaves, 350 trees, learning rate 0.024) and still trailed LogReg on validation (0.6001 vs 0.5955). The log-odds ensemble's best weight was 0.9 LogReg and added nothing (0.5956). **Champion: LogReg (C = 0.1) with Platt calibration.** Calibration was chosen out of time: each calibrator is fit on one season's predictions from a model trained only on earlier seasons. Platt won for every candidate, and isotonic was worst every time. The fitted Platt map is close to identity (a ≈ 1.01), so LogReg was already nearly calibrated. Settings: `ml/config/game_model.json`.

### Explanations
- Every model variant is additive in log-odds, so explanations are exact. LogReg uses `coef × standardized value`. LightGBM uses its built-in TreeSHAP (`pred_contrib=True`), the same algorithm as `shap.TreeExplainer`, without the extra dependency. The ensemble mixes both with its weight. Platt scaling multiplies them by `a`. Tests check that contributions plus base equal the predicted log-odds.
- Features are summed into 11 human factors defined in `shared/factors.json`, which `web/lib/factor-copy.ts` uses for copy. Each game stores its top 5 factors (≥ 0.5 points) in `game_predictions.factors` as `{factor, label, favors, pp, logit}`.
- **Probability points are an approximation:** `pp = contribution × (p − p_base) / (logit p − logit p_base)`, where p_base is the model's prediction for an average game. Signs are always kept, and the factors add up to `p − p_base`.
- Average effect over 2025-26 (model trained through 2024-25): Team rating 10.6 pts, Recent form 4.1, Shooting 3.3, Rest and schedule 2.6, Turnovers and rebounding 2.1, Home court 2.1, Missing players 1.8, Season-long strength 1.7, Travel 0.6, Point in the season 0.5, Pace 0.3 (`ml/reports/figures/factor_importance.png`).
- **Known quirk:** `elo_diff` includes the home-court edge, so part of home advantage shows up as "Team rating". Correlated groups (Elo, season strength, form) also share credit in ways that look arbitrary to a stats-savvy reader. Splitting `elo_diff` into a pure rating gap plus the home edge would make this cleaner (Phase 8, with the copy).

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
| LogReg + Platt (champion) | 0.5955 | 0.2049 | 68.1% | 0.7408 | 0.0221 |
| LightGBM (Optuna, Platt) | 0.6001 | 0.2065 | 67.9% | 0.7369 | 0.0264 |
| Ensemble (0.9 LogReg, Platt) | 0.5956 | 0.2049 | 68.0% | 0.7409 | 0.0257 |

**Test season 2025-26, run once** (all models refit on 2015-16..2024-25, 11,979 games; 1,230 test games). Source: `ml/reports/test_2025-26.md`.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6874 | 0.2472 | 55.5% | 0.5000 | 0.0110 |
| Elo | 0.5978 | 0.2054 | 69.2% | 0.7379 | 0.0446 |
| LogReg + Platt (champion) | 0.6022 | 0.2073 | 67.1% | 0.7330 | 0.0331 |
| LightGBM (Platt) | 0.6020 | 0.2071 | 68.1% | 0.7350 | 0.0299 |
| Ensemble (Platt) | 0.6018 | 0.2072 | 67.1% | 0.7337 | 0.0354 |

**Walk-forward 2025-26** (monthly refits on every earlier game): Home team 0.6875 / 55.5%, Elo 0.5979 / 69.0%, LogReg 0.6018 / 67.2%. Source: `ml/reports/backtest_2025-26.md`.

**Honest reading:** every model clearly beats the home-team baseline (the PRD bar). **On the test season, plain Elo edged out the champion.** The per-game log-loss gap (LogReg − Elo) is +0.0039 with a paired-bootstrap 95% CI of [−0.0036, +0.0113], so it isn't statistically meaningful. The two models' predictions correlate at 0.956, and LogReg led on validation by 0.013. The champion stays LogReg as selected; swapping it now would turn the test season into a tuning set. Elo is the challenger, compared on live 2026-27 games, which nobody has seen, by the Phase 10 champion/challenger job. The site's `/performance` page should show Elo next to the model.

LogReg's C was picked on validation (the strongest regularization within 0.0001 of the best log loss; the curve is flat from C = 0.1 up), so its validation numbers are slightly optimistic. The test season (2025-26) hasn't been touched; it's reported once, in Phase 3.

(Good NBA game models typically land in the mid-to-high 60s for accuracy. Don't promise more on the site.)

## 6. Player stat projections

- **Unit:** player-game. Targets: PTS, REB, AST.
- **Two-stage:** (a) project minutes from recent minutes, starter flag, rest, team availability (teammates out → more minutes), and blowout risk (|Elo diff|); (b) project per-minute rates from rolling per-36 stats, usage, opponent defensive rating, opponent pace, and home/away. Projection = minutes × rate.
- **Models:** LightGBM regressors (one per target), plus **quantile** models (α = 0.1 and 0.9) for 80% intervals.
- **Baseline:** player's last-10 average. Report MAE vs baseline for each stat.
- **Scope:** players with ≥ 10 mpg over the last 10 games, top 8 by projected minutes per team.
- Ship after the game model (see ROADMAP Phase 9).

**As built (Phase 9, part 1: features):** `ml/src/tipoff/features/players.py` builds `data/features/player_features.parquet` (with `tipoff features`, next to the game table; `PLAYER_FEATURES_VERSION` in its hash).
- **Rows:** one per regular-season appearance (minutes > 0) since 2015-16, plus scheduled games' candidates through the same code. Projections are "if he plays": candidates are the players whose most recent appearance was their team's previous game (a traded player counts for his new team only once he's played for it).
- **Scope (`in_scope`):** ≥ 10 minutes per game over his last 10 appearances and an appearance in the team's last 5 games. 250,794 of 284,256 rows; about 22,500 per full season.
- **Features (47):** minutes stage: last 3/5/10/25 and exponentially weighted minutes, their spread, a starter proxy (share of recent games among his team's five biggest minutes; the logs have no starter flag), days since his last game, missed the team's previous game, team games missed of the last 5, games with this team and this season, team rest and back-to-back, teammates out (the game model's `out_min_share`, `star_out`), blowout risk (|Elo edge|), the team's Elo win chance, home, point in the season. Rate stage: per-36 points, rebounds (offensive, defensive) and assists over 10 and 25 games and weighted, shot volume (FGA, FTA, 3PA per 36), turnovers, usage over 10 and 25 games, raw last-10 averages, and the opponent's defensive rating, pace, offensive and defensive rebound rates and eFG% allowed, plus his team's pace and offensive rating (season-to-date, blended with the prior).
- **Usage from the box score:** `(FGA + 0.44 FTA + TOV) × (team minutes / 5) / (minutes × (team FGA + 0.44 team FTA + team TOV))`, summed over the window, so the cloud job's cdn.nba.com box scores need nothing extra.
- Windows run over his career (across seasons and teams); everything is shifted so a row never sees its own game. `tests/test_player_features.py` repeats the game model's leakage checks for player rows (perturb a day's box scores; delete the future and predict the day as scheduled, on synthetic and real data).
- **Last-10 baseline on 2024-25 (in-scope rows), MAE:** minutes 5.11, points 4.96, rebounds 2.04, assists 1.45.

**As built (Phase 9, part 2: models):** `ml/src/tipoff/models/players.py` (the `PlayerModel`) and `models/train_player.py` (MLflow experiment `tipoff-player`). Settings in `ml/config/player_model.json`.
- **Minutes:** LightGBM regressor. **Rates:** one LightGBM regressor per stat on stat per minute, weighted by minutes; projection = minutes × rate. **Direct** stat models were tried as a comparison; two-stage won for all three stats on validation (points 4.787 vs 4.803 MAE, rebounds 1.975 vs 1.979, assists 1.409 vs 1.413). Sizes come from a 3-step grid, picked on 2024-25 MAE; the differences between sizes were in the third decimal.
- **Ranges:** LightGBM quantile regressors (10th and 90th percentiles) per stat, then a conformal correction (CQR) learned on a season the quantile models never saw (2024-25 for the test model; 2025-26 for the champion, from a model fit through 2024-25). Before the correction 2024-25 coverage was 77.9% (points), 78.4% (rebounds), 80.6% (assists), so the correction is small (under 0.1 of a point). Ranges never go below 0 and always contain the projection.
- **Validation 2024-25** (trained on 2015-16..2023-24, 201,540 player-games; 22,529 evaluated). Source: `ml/reports/player_validation.md`.

| Target | Last-10 MAE | Model MAE | vs baseline |
|---|---|---|---|
| Minutes | 5.106 | 4.771 | −6.6% |
| Points | 4.962 | 4.787 | −3.5% |
| Rebounds | 2.036 | 1.975 | −3.0% |
| Assists | 1.453 | 1.409 | −3.0% |

- **Test 2025-26, run once** (refit on 2015-16..2024-25; 23,170 player-games). Source: `ml/reports/test_player_2025-26.md`; `tipoff evaluate --test --player` refuses to run again without `--force-retest`.

| Target | Last-10 MAE | Model MAE | vs baseline | 80% range coverage | Mean width |
|---|---|---|---|---|---|
| Minutes | 5.079 | 4.729 | −6.9% | | |
| Points | 4.880 | 4.729 | −3.1% | 81.3% | 15.2 |
| Rebounds | 2.001 | 1.936 | −3.2% | 81.1% | 6.2 |
| Assists | 1.439 | 1.397 | −2.9% | 80.7% | 4.4 |

- **Honest reading:** the models beat the last-10 average on every stat on a season they never saw, which was the bar to ship. The gains are modest (about 3% on the counting stats, 7% on minutes); a player's recent average is a strong baseline, and single games are noisy (the typical miss on points is still about 4.7). Most of the edge comes from minutes (rest, teammates out, blowout risk), which the last-10 average can't see. The 80% ranges are honest: 81% of real lines fell inside them.
- **Champion:** `tipoff-player` v1 (`player-v1`), an MLflow pyfunc around the `PlayerModel`, fit on every in-scope player-game since 2015-16 (250,794 through 2026-11-13), registered `@champion`.

**As built (Phase 9, part 3: pipeline):** `predict/players.py` projects a date's candidates through the champion and keeps each team's top 8 by projected minutes; `publish/players.py` writes them to `player_projections` (pregame-only, whole set per game) and fills `actual_*` once games are final (`tipoff results`). `tipoff predict`/`publish` do games and players together, and the daily job (local and `--cloud`, which pulls `player_champion` from `pipeline_state`) runs predict → publish → results. The player steps come after the game predictions are published, and a missing player champion or a database error there is reported without stopping the job.
- **Walk-forward backfill 2026-27** (`tipoff backfill --what players`, model version `player-v1-wf`): each week refit on every in-scope player-game before it, with the champion's out-of-time range correction; projects the players who actually appeared (top 8 per team). On the 222 games through 2026-11-18 (3,469 lines): minutes 4.65 vs last-10 4.99 (−6.7%), points 5.00 vs 5.18 (−3.6%), rebounds 1.96 vs 2.02 (−2.7%), assists 1.47 vs 1.51 (−2.8%); ranges held 79.4% / 80.3% / 79.6%.

**Weekly retrain (Phase 10):** `ml/src/tipoff/models/retrain.py`, run by `.github/workflows/retrain.yml` on Mondays. Both champions' recipes (`ml/config/game_model.json`, `player_model.json`) are refit on every completed game from the cloud's staged history. Before a refit replaces its champion, a weekly walk-forward over the last 4 complete weeks (fit on everything before each week, predict the week) is compared with what was actually published for the same games: the stored pregame predictions (live beats backfill) and the stored projections with their real lines. Promotion rule: game log loss at most published + 0.005; player MAE on points, rebounds and assists, as the average ratio to published, at most 1.01. Fewer than 30 graded games (300 lines) keeps the champion. The game calibrator stays the out-of-time one (fit on 2025-26); the player refit keeps the champion's range correction. Elo's stored probability is reported beside the model as the standing challenger, never promoted automatically. Promoted refits are pushed to `pipeline_state` as `game-v2-r<YYYYMMDD>` / `player-v1-r<YYYYMMDD>`; the local MLflow registry isn't touched.
- First dry run against prod (2026-11-20; window 2026-10-19 to 11-15): published and refit were identical (game 0.5726 log loss, 70.2%, Elo 0.5853 and 71.2%; player MAE minutes 4.68, points 5.03, rebounds 1.95, assists 1.46) because 183 of the 191 games were walk-forward backfill made with the same recipe. The rule only starts comparing something different as live picks fill the window. About 3 minutes locally.

## 7. MLOps

- **MLflow:** SQLite tracking store at `ml/mlflow.db`, artifacts in `ml/mlartifacts/` (both git-ignored); run `uv run mlflow ui --backend-store-uri sqlite:///mlflow.db` from `ml/`. Experiments `tipoff-game` and `tipoff-player`. Log params, metrics (val and test), the feature list, the data window, the calibration plot and SHAP summary plot as artifacts, and the model via `mlflow.sklearn` / `mlflow.lightgbm`.
- **Registry:** register `tipoff-game` with the alias `champion`. As built: an MLflow pyfunc bundling the fitted `GameModel` (model, calibrator, feature list), trained on every completed game since 2015-16 (13,392 through 2026-11-13), with the calibrator fit out of time on 2025-26. v1 = LogReg. Phase 4 loads it with `tipoff.models.final.load_champion()`, which exposes `predict_proba` and `contributions`. The weekly retrain (Phase 10, `models/retrain.py`, GitHub Actions) refits the recipe in the cloud and moves the cloud champion (`pipeline_state`) only if a 4-week walk-forward is no worse than what was published; the local MLflow registry keeps the versions trained by hand.
- **Reproducibility:** `uv.lock`, fixed seeds, and a `features_hash` (hash of feature table schema + window) stored with every prediction.
- **Data validation:** pandera schemas on raw and feature tables (no nulls in key columns, sane ranges, unique keys).
- **Monitoring:** `/performance` *is* the monitor. Also log the daily rolling 50-game log loss and alert (GitHub issue via Action) if it degrades past the Elo baseline for 2 weeks.

## 8. What goes on the website's /docs
One MDX page each: Data sources and limitations · Feature engineering · Preventing leakage (with the test) · Models and baselines (table) · Calibration (plot) · Explaining predictions (SHAP) · Player projections · MLOps and the daily pipeline · Limitations and honest caveats.
