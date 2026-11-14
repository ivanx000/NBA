# Model selection: 2024-25 validation

Trained on 2015-16..2023-24 (10,749 games), evaluated on 2024-25 (1,230 games). LightGBM tuned with Optuna (100 trials). Calibration chosen out of time (fit on 2023-24, judged on 2024-25). Ensemble = 0.9 x LogReg + 0.1 x LightGBM in log-odds.

Champion: **LogReg** with platt calibration.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6905 | 0.2487 | 54.4% | 0.5000 | 0.0241 |
| Elo | 0.6083 | 0.2107 | 66.4% | 0.7233 | 0.0207 |
| LogReg | 0.5955 | 0.2049 | 68.1% | 0.7408 | 0.0221 |
| LightGBM | 0.6001 | 0.2065 | 67.9% | 0.7369 | 0.0264 |
| Ensemble | 0.5956 | 0.2049 | 68.0% | 0.7409 | 0.0257 |

Calibration log loss by method: LogReg: none 0.5960, platt 0.5955, isotonic 0.6055; LightGBM: none 0.6009, platt 0.6001, isotonic 0.6092; Ensemble: none 0.5961, platt 0.5956, isotonic 0.5996
