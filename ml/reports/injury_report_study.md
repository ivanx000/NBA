# The official injury report as a model input (study, 2026-11-21)

`ml/reports/elo_gap_study.md` put the remaining headroom at up to about 0.004 log loss: the gap
between lineup strength from recent minutes and lineup strength from the minutes actually played
that night. This study adds the league's official injury report, as it stood at the prediction
time, and measures it the same way the v3 game model was chosen. The 2025-26 test season is never
touched. Scripts: `ml/notebooks/injury/compare.py` (games), `ml/notebooks/injury/players.py`
(players). Raw numbers: `injury_report_study.json`, `injury_report_players.json`. Runs logged to
MLflow (experiment `injury-report-study`).

## Data

- 2,275 game-day snapshots staged from 2019-20 to 2026-11-21 (morning, 09:00 ET, and evening,
  17:45 ET), 2,274 with a report (the morning of opening night 2019 had none yet); 154,539 rows.
- The report used is the latest one **published** at or before the cutoff (S3 `Last-Modified`),
  never the time in its filename.
- Morning coverage: about 82% of team-games have their team's report in (the rest are mostly the
  second night of a back-to-back, which files on game day). Evening coverage: 99.9%.
- 93% of listed names match a player. The unmatched ones never played for the team in the
  previous 400 days (debuts, two-way players, multi-season injuries), so they carry no recent
  minutes either way.
- Chance of playing by status (morning reports 2019-20..2023-24, players who played for the team
  in the previous 60 days): Out 1.7%, Doubtful 7.4%, Questionable 50.9%, Probable 87.0%,
  Available 74.0% (431 cases, mostly fringe players). Stored in `ml/config/injury_play_probs.json`.

## Inputs

- `injury_adj`: lineup strength with each listed player's recent minutes (team's last 5 games)
  times his chance of playing, minus plain lineup strength. Lost minutes go to the rest of the
  rotation in proportion; a player listed as likely to play who missed the last 5 games comes back
  at his minutes per game over his last 5 appearances for the team.
- `listed_out_min`: recent minutes per game the team is expected to lose to the report.
- `ir_filed`: the team's report was in.

## Game model: rolling validation, 2019-20..2024-25

Elo-anchored, λ = 100, trained on the morning snapshot. Mean per-game log loss difference with a
95% interval; 2019-20 can't change (no earlier reports to learn from).

| Adjustments on top of Elo | Morning report: vs v3 | Seasons better | Evening report: vs v3 | Seasons better |
|---|---|---|---|---|
| v3 (35 inputs) | 0 | — | 0 | — |
| + `injury_adj` | −0.0020 ± 0.0014 | 4/6 | −0.0036 ± 0.0019 | 5/6 |
| **+ `injury_adj` + `listed_out_min`** | **−0.0026 ± 0.0017** | **5/6** | **−0.0052 ± 0.0022** | **6/6** |
| + both + `ir_filed` | −0.0026 ± 0.0018 | 5/6 | −0.0049 ± 0.0024 | 6/6 |

Against the baselines (morning, chosen variant): log loss 0.6186 vs v3 0.6212, Elo 0.6287;
accuracy 66.0% vs v3 65.6%, Elo 64.5%, home team 55.1%. With the evening report: 0.6160.

Per season vs v3, morning: 2020-21 −0.0009, 2021-22 −0.0044, 2022-23 −0.0053, 2023-24 +0.0008,
2024-25 −0.0051. Evening: −0.0046, −0.0094, −0.0068, −0.0030, −0.0067.

Chosen: `injury_adj` + `listed_out_min` (37 adjustment inputs). The full selection
(`tipoff train --only game`) kept the anchored model as champion with λ = 100: pooled rolling
log loss 0.6186 (Elo 0.6287, LogReg 0.6195, ensemble 0.6193), better than Elo in 6 of 6 seasons;
2024-25 validation 0.5901 (v3: 0.5952).

**Reading it:** the morning report recovers about two-thirds of the study's 0.004 ceiling, and the
evening report more than all of it (the ceiling was an underestimate: real minutes don't say who
is missing as plainly as the report does). The intervals exclude zero for both. That's why the
daily job re-publishes with the 17:45 ET report.

## Player projections: validation 2024-25 (trained on 2015-16..2023-24)

Inputs added: his own chance of playing, teammates' expected lost minutes (total and the largest
single one; a teammate out for weeks counts 0, his minutes are already gone), and minutes coming
back from injury. Missing (not zero) before 2019-20 and when the team hasn't filed.

| MAE | Last-10 | v1 inputs | + injury report | Change |
|---|---|---|---|---|
| Minutes | 5.106 | 4.771 | **4.688** | −1.7% |
| Points | 4.962 | 4.787 | **4.766** | −0.4% |
| Rebounds | 2.036 | 1.975 | **1.967** | −0.4% |
| Assists | 1.453 | 1.409 | **1.408** | −0.1% |

Where teammates were expected to lose 10+ minutes (12,146 of 22,529 rows), minutes MAE 4.871 →
4.766. Rolling check (each of 2021-22..2024-25 trained on the seasons before it): minutes MAE
4.848 → 4.779, better in all four seasons; points 4.754 → 4.735.

The bigger effect isn't in these numbers: they score players who played. Before the report,
players listed Out were still projected and players back from injury weren't; now players listed
Out or Doubtful aren't projected, returning players are, and Questionable/Probable players carry
the tag on the site.

## Re-test on 2025-26 (run once, after everything above was chosen; user's OK)

Game, refit on 2015-16..2024-25, morning report (`test_2025-26.md`, `test_2025-26_bootstrap.json`):

| Model | Log loss | Brier | Accuracy | AUC |
|---|---|---|---|---|
| Home team | 0.6874 | 0.2472 | 55.5% | 0.500 |
| Elo | 0.5978 | 0.2054 | 69.2% | 0.738 |
| v3 (anchored) | 0.5952 | 0.2047 | 68.0% | 0.741 |
| **v4 (anchored + injury report)** | **0.5866** | **0.2011** | 68.1% | **0.750** |

Paired bootstrap, 10,000 resamples of the 1,230 games: v4 − Elo −0.0112 [−0.0200, −0.0023],
v4 − v3 −0.0086 [−0.0134, −0.0038]. Larger than the rolling estimate (−0.0026); one season, so the
rolling number is the better guide to what to expect. Walk-forward over 2025-26: v4 0.5862 / 68.5%
(v3 0.5950 / 67.9%, Elo 0.5979 / 69.0%).

Players (`test_player_2025-26.md`): minutes 4.658 (v1 4.729, last-10 5.079), points 4.705 (4.729),
rebounds 1.933 (1.936), assists 1.397 (1.397); 80% ranges held 80.9% / 80.7% / 82.2%.
