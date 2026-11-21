# Model selection: 2024-25 validation

Trained on 2015-16..2023-24 (10,749 games), evaluated on 2024-25 (1,230 games). LightGBM tuned with Optuna (100 trials). Calibration chosen out of time (fit on 2023-24, judged on 2024-25). Ensemble = 0.9 x LogReg + 0.1 x LightGBM in log-odds.

Champion (lowest pooled rolling log loss, below): **Anchored** with platt calibration.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6905 | 0.2487 | 54.4% | 0.5000 | 0.0241 |
| Elo | 0.6083 | 0.2107 | 66.4% | 0.7233 | 0.0207 |
| LogReg | 0.5878 | 0.2016 | 69.2% | 0.7492 | 0.0266 |
| LightGBM | 0.5947 | 0.2047 | 67.9% | 0.7409 | 0.0342 |
| Ensemble | 0.5879 | 0.2017 | 69.0% | 0.7487 | 0.0205 |
| Anchored | 0.5901 | 0.2026 | 69.3% | 0.7469 | 0.0338 |

Calibration log loss by method: LogReg: none 0.5881, platt 0.5878, isotonic 0.5964; LightGBM: none 0.5949, platt 0.5947, isotonic 0.5988; Ensemble: none 0.5882, platt 0.5879, isotonic 0.5992; Anchored: none 0.5905, platt 0.5901, isotonic 0.5961

## Rolling validation (picks the champion)

Each season predicted by the candidate trained only on the seasons before it (uncalibrated). Anchored penalty by pooled log loss: 100: 0.6186, 300: 0.6188, 1000: 0.6201, 3000: 0.6223; chosen 100.

| Model | 2019-20 | 2020-21 | 2021-22 | 2022-23 | 2023-24 | 2024-25 | Pooled | vs Elo | Seasons better | Accuracy |
|---|---|---|---|---|---|---|---|---|---|---|
| Elo | 0.6283 | 0.6456 | 0.6319 | 0.6486 | 0.6118 | 0.6083 | 0.6287 | +0.0000 | 0/6 | 64.5% |
| LogReg | 0.6276 | 0.6362 | 0.6315 | 0.6363 | 0.6006 | 0.5881 | 0.6195 | -0.0092 | 6/6 | 65.9% |
| LightGBM | 0.6375 | 0.6352 | 0.6323 | 0.6405 | 0.6035 | 0.5949 | 0.6234 | -0.0053 | 4/6 | 65.0% |
| Ensemble | 0.6278 | 0.6354 | 0.6310 | 0.6361 | 0.6003 | 0.5882 | 0.6193 | -0.0095 | 6/6 | 65.8% |
| Anchored | 0.6264 | 0.6350 | 0.6262 | 0.6358 | 0.6007 | 0.5905 | 0.6186 | -0.0101 | 6/6 | 66.0% |
