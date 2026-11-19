# Player projections: validation 2024-25

Trained on 2015-16..2023-24 (201,540 player-games in scope), evaluated on 2024-25 (22,529). Point projection per stat: pts two-stage, reb two-stage, ast two-stage.

| target | last-10 MAE | model MAE | vs baseline | model RMSE | 80% range coverage | mean width |
|---|---|---|---|---|---|---|
| minutes | 5.106 | 4.771 | -6.6% | 6.204 |  |  |
| pts | 4.962 | 4.787 | -3.5% | 6.179 | 80.0% | 15.029 |
| reb | 2.036 | 1.975 | -3.0% | 2.578 | 80.0% | 6.142 |
| ast | 1.453 | 1.409 | -3.0% | 1.887 | 80.6% | 4.434 |

Range coverage before the conformal correction: pts 77.9%, reb 78.4%, ast 80.6%. The correction is fit on this season, so coverage here is about 80% by construction; the test season is the honest check.
