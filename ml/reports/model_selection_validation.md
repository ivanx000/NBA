# Model selection: 2024-25 validation

Trained on 2015-16..2023-24 (10,749 games), evaluated on 2024-25 (1,230 games). LightGBM tuned with Optuna (100 trials). Calibration chosen out of time (fit on 2023-24, judged on 2024-25). Ensemble = 0.8 x LogReg + 0.2 x LightGBM in log-odds.

Champion (lowest pooled rolling log loss, below): **Anchored** with platt calibration.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6905 | 0.2487 | 54.4% | 0.5000 | 0.0241 |
| Elo | 0.6083 | 0.2107 | 66.4% | 0.7233 | 0.0207 |
| LogReg | 0.5935 | 0.2039 | 69.0% | 0.7433 | 0.0365 |
| LightGBM | 0.5981 | 0.2058 | 68.5% | 0.7393 | 0.0360 |
| Ensemble | 0.5931 | 0.2037 | 69.2% | 0.7440 | 0.0532 |
| Anchored | 0.5952 | 0.2047 | 68.8% | 0.7412 | 0.0538 |

Calibration log loss by method: LogReg: none 0.5940, platt 0.5935, isotonic 0.5983; LightGBM: none 0.5983, platt 0.5981, isotonic 0.6070; Ensemble: none 0.5936, platt 0.5931, isotonic 0.6003; Anchored: none 0.5956, platt 0.5952, isotonic 0.5977

## Rolling validation (picks the champion)

Each season predicted by the candidate trained only on the seasons before it (uncalibrated). Anchored penalty by pooled log loss: 100: 0.6212, 300: 0.6213, 1000: 0.6223, 3000: 0.6239; chosen 100.

| Model | 2019-20 | 2020-21 | 2021-22 | 2022-23 | 2023-24 | 2024-25 | Pooled | vs Elo | Seasons better | Accuracy |
|---|---|---|---|---|---|---|---|---|---|---|
| Elo | 0.6283 | 0.6456 | 0.6319 | 0.6486 | 0.6118 | 0.6083 | 0.6287 | +0.0000 | 0/6 | 64.5% |
| LogReg | 0.6276 | 0.6408 | 0.6358 | 0.6416 | 0.5998 | 0.5940 | 0.6228 | -0.0059 | 5/6 | 65.4% |
| LightGBM | 0.6447 | 0.6421 | 0.6409 | 0.6512 | 0.6045 | 0.5983 | 0.6297 | +0.0009 | 3/6 | 64.6% |
| Ensemble | 0.6288 | 0.6394 | 0.6354 | 0.6421 | 0.5996 | 0.5936 | 0.6227 | -0.0061 | 4/6 | 65.3% |
| Anchored | 0.6264 | 0.6359 | 0.6306 | 0.6411 | 0.5999 | 0.5956 | 0.6212 | -0.0076 | 6/6 | 65.6% |
