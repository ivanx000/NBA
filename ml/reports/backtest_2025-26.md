# Walk-forward backtest: 2025-26

Each month is predicted by models trained on every game before that month (2015-16 onward); 1,230 games. Champion = **LogReg**.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6875 | 0.2472 | 55.5% | 0.4882 | 0.0103 |
| Elo | 0.5979 | 0.2054 | 69.0% | 0.7378 | 0.0430 |
| LogReg | 0.6018 | 0.2072 | 67.2% | 0.7335 | 0.0340 |

## LogReg by month

| Month | Games | Accuracy | Log loss |
|---|---|---|---|
| 2025-10 | 80 | 62.5% | 0.6284 |
| 2025-11 | 219 | 70.3% | 0.5581 |
| 2025-12 | 197 | 59.4% | 0.7080 |
| 2026-01 | 233 | 60.5% | 0.6621 |
| 2026-02 | 166 | 67.5% | 0.6117 |
| 2026-03 | 239 | 74.5% | 0.5214 |
| 2026-04 | 96 | 77.1% | 0.4980 |
