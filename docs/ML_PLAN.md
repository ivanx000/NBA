# ML plan: Tip-Off

Two prediction tasks:
1. **Game outcome**: P(home team wins). This is the headline feature.
2. **Player stat lines**: projected PTS, REB and AST (with intervals) for each team's top ~8 rotation players.

The bar for "good": beat simple baselines on a held-out season, with well-calibrated probabilities, and **zero leakage**.

---

## 1. Data

| Data | Source | Endpoint (nba_api) | Granularity |
|---|---|---|---|
| Team game logs | stats.nba.com | `LeagueGameLog` (player_or_team='T') | team-game |
| Player game logs | stats.nba.com | `LeagueGameLog` (player_or_team='P') | player-game |
| Advanced box scores (pace, ratings) | stats.nba.com | `BoxScoreAdvancedV3` (per game; slow, so cache aggressively) | team-game, player-game |
| Schedule (future games) | cdn.nba.com | static schedule JSON | game |
| Live/final scores | cdn.nba.com | live scoreboard JSON | game |
| Arena locations (for travel) | static | `arena_coords` in `shared/teams.json` | team |

- **Seasons:** 2015-16 → current (2026-27). Earlier seasons played a different style, so test whether including them helps.
- **Caching:** every raw response is saved as parquet under `ml/data/raw/{endpoint}/{season}/...`. Ingest is idempotent and resumable.
- **Rate limit:** about 0.6s between requests, with retries and exponential backoff. Use a browser-like `User-Agent` (nba_api handles headers).
- Exclude preseason, All-Star, and (for v1) Play-In and playoff games. Keep `season_type` as a column so playoffs can be added later.
- **Injuries (v1):** infer "who's out" as rotation players (≥ 20 mpg over the last 10 games) who aren't in today's projected lineup. Before tip-off we don't know who will play. Pragmatic v1: use a player's availability in the *previous* game plus the official injury report when available (manual or a scraped PDF in v2). Document this limitation honestly on `/docs`.

## 2. Leakage rules (read twice)

1. A feature row for game *G* on date *D* may only use games with `game_date < D`. (Same-day games are excluded too, since they're simultaneous.)
2. All rolling and expanding statistics are computed on a per-team sorted series and then `.shift(1)`.
3. Season-to-date stats reset at season boundaries. Early-season rows (fewer than 5 games) fall back to a blend with the previous season's final values, shrunk toward the league mean.
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
| Availability | sum of season minutes share of rotation players out (home, away), star-out flag (top-2 by usage) |
| Context | season phase (game number / 82), home team's home record, away team's road record |

Store the human-readable copy for each feature in `web/lib/factor-copy.ts` (e.g. `rest_days_diff` → "{team} more rested ({n} days vs {m})").

## 4. Models: game outcome

### Baselines (always reported)
1. **Home team wins**: historically wins roughly 55 to 60% of games. Compute the exact rate from your data.
2. **Elo-only logistic**: P(home) from the Elo diff.
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

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ |
|---|---|---|---|---|
| Home team | | | | |
| Elo | | | | |
| LogReg | | | | |
| LightGBM (calibrated) | | | | |

(Fill in. Good NBA game models typically land in the mid-to-high 60s for accuracy. Don't promise more on the site.)

## 6. Player stat projections

- **Unit:** player-game. Targets: PTS, REB, AST.
- **Two-stage:** (a) project minutes from recent minutes, starter flag, rest, team availability (teammates out → more minutes), and blowout risk (|Elo diff|); (b) project per-minute rates from rolling per-36 stats, usage, opponent defensive rating, opponent pace, and home/away. Projection = minutes × rate.
- **Models:** LightGBM regressors (one per target), plus **quantile** models (α = 0.1 and 0.9) for 80% intervals.
- **Baseline:** player's last-10 average. Report MAE vs baseline for each stat.
- **Scope:** players with ≥ 10 mpg over the last 10 games, top 8 by projected minutes per team.
- Ship after the game model (see ROADMAP Phase 9).

## 7. MLOps

- **MLflow:** experiment `tipoff-game` and `tipoff-player`. Log params, metrics (val and test), the feature list, the data window, the calibration plot and SHAP summary plot as artifacts, and the model via `mlflow.sklearn` / `mlflow.lightgbm`.
- **Registry:** register `tipoff-game` with the alias `champion`. `retrain.sh` trains a challenger, compares on the latest 60-day window, and only moves `champion` if log loss improves.
- **Reproducibility:** `uv.lock`, fixed seeds, and a `features_hash` (hash of feature table schema + window) stored with every prediction.
- **Data validation:** pandera schemas on raw and feature tables (no nulls in key columns, sane ranges, unique keys).
- **Monitoring:** `/performance` *is* the monitor. Also log the daily rolling 50-game log loss and alert (GitHub issue via Action) if it degrades past the Elo baseline for 2 weeks.

## 8. What goes on the website's /docs
One MDX page each: Data sources and limitations · Feature engineering · Preventing leakage (with the test) · Models and baselines (table) · Calibration (plot) · Explaining predictions (SHAP) · Player projections · MLOps and the daily pipeline · Limitations and honest caveats.
