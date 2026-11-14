# Baselines: 2024-25 validation

Trained on 2015-16..2023-24 (10,749 games), evaluated on 2024-25 (1,230 regular-season games). Features hash `a2aab4e98d28b7b5`. LogReg C = 0.1: the strongest regularization within 0.0001 of the best validation log loss. Training home win rate: 56.8%.

| Model | Log loss ↓ | Brier ↓ | Accuracy ↑ | AUC ↑ | ECE ↓ |
|---|---|---|---|---|---|
| Home team | 0.6905 | 0.2487 | 54.4% | 0.5000 | 0.0241 |
| Elo | 0.6083 | 0.2107 | 66.4% | 0.7233 | 0.0207 |
| LogReg | 0.5960 | 0.2051 | 68.4% | 0.7408 | 0.0209 |
