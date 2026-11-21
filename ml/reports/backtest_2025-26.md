# Walk-forward backtest: 2025-26

Each month is predicted by models trained on every game before that month (2015-16 onward); 1,230 games. Champion = **Anchored**.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6875 | 0.2472 | 55.5% | 0.4882 | 0.0103 |
| Elo | 0.5979 | 0.2054 | 69.0% | 0.7378 | 0.0430 |
| Anchored | 0.5862 | 0.2009 | 68.5% | 0.7501 | 0.0260 |

## Anchored by month

| Month | Games | Accuracy | Log loss |
|---|---|---|---|
| 2025-10 | 80 | 66.2% | 0.6306 |
| 2025-11 | 219 | 69.4% | 0.5635 |
| 2025-12 | 197 | 59.9% | 0.6962 |
| 2026-01 | 233 | 61.8% | 0.6522 |
| 2026-02 | 166 | 69.9% | 0.5839 |
| 2026-03 | 239 | 76.6% | 0.4893 |
| 2026-04 | 96 | 80.2% | 0.4604 |
