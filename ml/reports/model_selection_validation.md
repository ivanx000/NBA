# Model selection: 2024-25 validation

Trained on 2015-16..2023-24 (10,749 games), evaluated on 2024-25 (1,230 games). LightGBM tuned with Optuna (100 trials). Calibration chosen out of time (fit on 2023-24, judged on 2024-25). Ensemble = 0.9 x LogReg + 0.1 x LightGBM in log-odds.

Champion: **Ensemble** with platt calibration.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6905 | 0.2487 | 54.4% | 0.5000 | 0.0241 |
| Elo | 0.6083 | 0.2107 | 66.4% | 0.7233 | 0.0207 |
| LogReg | 0.5957 | 0.2049 | 68.1% | 0.7407 | 0.0162 |
| LightGBM | 0.5999 | 0.2064 | 68.8% | 0.7376 | 0.0335 |
| Ensemble | 0.5957 | 0.2049 | 68.0% | 0.7407 | 0.0189 |

Calibration log loss by method: LogReg: none 0.5962, platt 0.5957, isotonic 0.6055; LightGBM: none 0.6003, platt 0.5999, isotonic 0.6250; Ensemble: none 0.5962, platt 0.5957, isotonic 0.5990
