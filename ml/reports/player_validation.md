# Player projections: validation 2024-25

Trained on 2015-16..2023-24 (201,540 player-games in scope), evaluated on 2024-25 (22,529). Point projection per stat: pts two-stage, reb two-stage, ast two-stage.

| target | last-10 MAE | model MAE | vs baseline | model RMSE | 80% range coverage | mean width |
|---|---|---|---|---|---|---|
| minutes | 5.106 | 4.688 | -8.2% | 6.097 |  |  |
| pts | 4.962 | 4.766 | -3.9% | 6.146 | 80.0% | 15.005 |
| reb | 2.036 | 1.967 | -3.4% | 2.566 | 80.0% | 6.147 |
| ast | 1.453 | 1.408 | -3.1% | 1.882 | 81.3% | 4.439 |

Range coverage before the conformal correction: pts 78.1%, reb 78.3%, ast 81.3%. The correction is fit on this season, so coverage here is about 80% by construction; the test season is the honest check.
