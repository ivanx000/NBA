# Walk-forward backtest: 2025-26

Each month is predicted by models trained on every game before that month (2015-16 onward); 1,230 games. Champion = **Ensemble**.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6875 | 0.2472 | 55.5% | 0.4882 | 0.0103 |
| Elo | 0.5979 | 0.2054 | 69.0% | 0.7378 | 0.0430 |
| Ensemble | 0.6024 | 0.2074 | 67.0% | 0.7331 | 0.0362 |

## Ensemble by month

| Month | Games | Accuracy | Log loss |
|---|---|---|---|
| 2025-10 | 80 | 58.8% | 0.6304 |
| 2025-11 | 219 | 69.9% | 0.5585 |
| 2025-12 | 197 | 60.4% | 0.7081 |
| 2026-01 | 233 | 60.9% | 0.6619 |
| 2026-02 | 166 | 68.1% | 0.6133 |
| 2026-03 | 239 | 74.1% | 0.5219 |
| 2026-04 | 96 | 76.0% | 0.4989 |
