# Why the game model trails Elo (study, Nov 2026)

Exploration scripts (nothing imports from here). Run from `ml/` with
`uv run python notebooks/elo_gap/rolling.py notebooks/elo_gap/r1.parquet` first (it writes the
baseline predictions the other scripts compare against), then `groups.py`, `compact.py`,
`withmr.py`, `headroom.py` with the same argument.

Method: every season 2019-20..2024-25 is predicted by models trained on all earlier seasons
(from 2015-16). The test season (2025-26) and later are never touched. Log loss is reported as the
difference from the Elo baseline, with a 95% interval over games.

Findings (see ml/reports/elo_gap_study.md):
- The current model beats Elo by 0.0030 on average but loses in 3 of 6 seasons.
- Anchoring on Elo (start from Elo's log-odds, penalize only the adjustments) is steadier.
- Season-to-date averages add nothing beyond Elo; rest/travel, availability and last-10 form do.
- A ridge margin rating adds nothing beyond Elo + last-10.
- Lineup strength (player ratings x minutes over the last 5 games) is the biggest single gain.
- Diagnostic only: knowing tonight's real minutes would be worth about 0.004 more, an upper bound
  on what injury reports could add (it overstates: blowouts change who plays).
