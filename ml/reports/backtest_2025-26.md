# Walk-forward backtest: 2025-26

Each month is predicted by models trained on every game before that month (2015-16 onward); 1,230 games. Champion = **Anchored**.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6875 | 0.2472 | 55.5% | 0.4882 | 0.0103 |
| Elo | 0.5979 | 0.2054 | 69.0% | 0.7378 | 0.0430 |
| Anchored | 0.5950 | 0.2046 | 67.9% | 0.7410 | 0.0329 |

## Anchored by month

| Month | Games | Accuracy | Log loss |
|---|---|---|---|
| 2025-10 | 80 | 67.5% | 0.6335 |
| 2025-11 | 219 | 69.9% | 0.5648 |
| 2025-12 | 197 | 60.4% | 0.6988 |
| 2026-01 | 233 | 58.8% | 0.6591 |
| 2026-02 | 166 | 69.3% | 0.5990 |
| 2026-03 | 239 | 75.7% | 0.5054 |
| 2026-04 | 96 | 79.2% | 0.4790 |
