# Why the game model trails Elo (study, 2026-11-20)

The champion lost to the Elo baseline on the one-time 2025-26 test (log loss 0.6022 vs 0.5978,
accuracy 67.1% vs 69.2%), though it beat Elo on the 2024-25 validation season (0.5957 vs 0.6083).
One validation season (1,230 games) is too few to pick a model by a margin this small, so this
study scores every season 2019-20..2024-25 with models trained only on the seasons before it. The
test season and later are never touched. Scripts: `ml/notebooks/elo_gap/`.

Log loss is the mean per-game difference from the Elo baseline (negative is better), with a 95%
interval; "better" counts the seasons in which the model beat Elo.

| Model | Log loss vs Elo | Seasons better | Accuracy |
|---|---|---|---|
| Elo baseline | 0 | — | 64.5% |
| Current setup (LogReg, all 61 inputs, C = 0.1) | −0.0030 ± 0.0029 | 3/6 | 65.2% |
| Elo-anchored, all inputs except Elo (λ = 300) | −0.0046 ± 0.0023 | 5/6 | 65.0% |
| Elo-anchored, rest/travel + availability + last 10 + venue (λ = 1000) | −0.0045 ± 0.0018 | 6/6 | 64.9% |
| … + ridge margin rating (half-life 80 days) | −0.0046 ± 0.0018 | 6/6 | 64.9% |
| **… + lineup strength (pre-game)** | **−0.0068 ± 0.0020** | **6/6** | **65.3%** |
| Diagnostic only, not a model: … + tonight's real minutes | −0.0105 ± 0.0023 | 6/6 | 65.9% |

**Elo-anchored** means log-odds = a · logit(Elo) + b + w · z, with an L2 penalty λ on w only: the
model starts from Elo and learns adjustments, so a noisy input can't drag it far from Elo.

## Input groups, each alone on top of Elo (anchored, λ = 300)

| Group | Log loss vs Elo | Seasons better |
|---|---|---|
| Rest and travel (rest days, back-to-backs, 3-in-4, travel, time zones, games in 7 days) | −0.0022 | 6/6 |
| Availability v1 (missing minutes share, star out) | −0.0011 | 4/6 |
| Last-10 form | −0.0010 | 5/6 |
| Venue win rates | −0.0006 | 3/6 |
| Last-5 and EWM net rating | −0.0003 | 4/6 |
| Season-to-date ratings and Four Factors | −0.0001 | 4/6 |
| Neutral site, season progress | +0.0001 | 2/6 |

Dropping the season-to-date group from the full set slightly helps (−0.0048): Elo already carries it.

## Lineup strength

Each player gets a pre-game rating: Game Score per minute over his previous games, decayed with a
25-game half-life and shrunk toward the league average (300-minute prior). A team's strength is the
sum over its players of (average minutes over the team's previous 5 games) x rating; the input is
home minus away. It knows a player has been out (his recent minutes drop) and that a newcomer is
playing, which availability v1 only partly captures.

The diagnostic row swaps in the minutes actually played tonight. It shows roughly how much more an
injury report could add (about 0.004), but overstates it: in blowouts benches play more, so real
minutes leak a little of the result.

## Takeaways

1. Anchor the model on Elo and drop the season-to-date inputs: steadier, never worse than Elo in a
   season.
2. Add lineup strength: the largest single gain, more than doubling the edge over Elo.
3. Official injury reports are the next lever after that (worth up to about 0.004 more).
