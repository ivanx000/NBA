# Product requirements: Tip-Off

## 1. Vision

A website that makes an ML model fun to use. A visitor lands on an arena drawn in light with two hologram players in the jerseys of tonight's matchup, **clicks the player they think will win**, and watches him shoot: it goes in if they're right and misses if they're wrong. Then the numbers appear: that team's numbers, the game's win probabilities and why the model thinks so. Anyone curious can open the docs and see how the model works.

### Goals
1. A memorable 3D experience that takes under 10 seconds from landing to seeing a prediction.
2. Honest, explainable predictions, with the model's track record shown publicly.
3. A portfolio-grade codebase built with industry-standard ML and web tooling.

### Non-goals (v1)
- Betting odds, betting advice, or any gambling features.
- User accounts, logins, saved picks.
- Live in-game win probability (possible v2).
- Real player likenesses, official logos, or official uniforms.

## 2. Users

- **Casual fan**: wants the cool animation and a quick answer.
- **Stats-curious fan**: wants the "why", player projections, and the model's accuracy.
- **Recruiter or engineer**: wants the docs, architecture, and evidence of rigor.

## 3. Core user flow

```
Land on home
  └─ Scene loads with a featured game (today's next game that hasn't started)
       ├─ Today's games in a drawer on the left edge
       │    └─ Pick a card -> players swap jerseys -> scene resets to idle
       └─ Click a player (or its team name) to pick that team to win
            └─ Cinematic: the picked player shoots -> in if the pick is right, off the rim if wrong
                 └─ Results: right or wrong, the picked team's numbers, the game's numbers
                      ├─ "<other team> stats" (corner button) -> the other team's numbers
                      └─ "Home" -> back to the matchup (pick another game from the drawer)
```

### 3.1 Home page (`/`)

**Scene (center)**
- Two generic, identical-build 3D players in their team's colors, standing at center court in an arena dressed in the two teams' colors. Home team on the right, away team on the left (a broadcast convention; keep it consistent).
- Both loop idle animations, with livelier ones now and then (a bounce, a stretch, a look up at the scoreboard). Their loops are offset so they don't move in sync. Their heads follow the cursor a little.
- Above each player, small: team city, record (W-L) and "HOME"/"AWAY", then the nickname. Players are centered and as large as fits with both fully visible.
- Top center: a small matchup line, e.g. `TONIGHT · 7:30 PM ET`.

**Primary action: pick a winner** (no Predict button)
- Hovering a player highlights him and makes him a little bigger; clicking him picks his team.
- Each team name is also a button ("Pick the Boston Celtics to win") for keyboards and touch; focusing it highlights the player. A small line under the players says "Click a player to pick who wins" (or "Tap…" on touch).
- Picking is off, with the reason shown, when the game is postponed or its prediction isn't published yet. Finished games can always be picked (the final score judges them).

**Today's games** (DESIGN.md section 2)
- **Only today's games** (ET). No past games and no way to browse other days.
- A slim column of ticks on the left edge (one per game, in its two teams' colors) shows they're there. The cards sit in a drawer that slides out when the mouse nears the left side (a tap on the ticks opens it on touch; keyboard focus opens it too). The cards are flat, hologram-styled, pop out and glow when hovered, and scroll when they don't all fit.
- One card per game: both team abbreviations in the two teams' colors, the nicknames, and the tip-off time (user's local timezone) or live/final score.
- **No games today:** the page says so, with a button to show the closest later day that has games.
- **Default selection:** today's next game that hasn't started (otherwise today's last game). The URL updates to `/?game=<id>` so it's shareable and refresh-stable; a `?game=` that isn't today's is ignored.

### 3.2 Pick cinematic

Full storyboard and timings: `docs/DESIGN.md §4`. Requirements:
- The picked player shoots. **Right or wrong:** before the game ends, a pick is right when it matches the model's pick; once the game is final, when it matches the real winner.
- Right: it goes in, and how depends on the model's confidence in that team (clean swish, off the back iron, or a rattle in). Wrong: it misses (around the rim and out if the team had a fair chance, off the front of the rim if not).
- About 5 to 6 seconds, with a **Skip** control (and Esc) throughout.
- With `prefers-reduced-motion`, skip straight to results.

### 3.3 Results screen

A panel beside the player being viewed; the camera frames that player.
- **Verdict:** "You're right." or "Not this time.", with why: the model's chance for the pick (and which team it likes), or the final score.
- **Team numbers** (the picked team first): record, home and away records, last 10, streak, rest (days off, back-to-back), points scored and allowed per game, average margin. Worked out from the season's finished games before this one (`lib/team-stats.ts`).
- **The game:** the model's win probability for both teams (split bar), the simple Elo baseline, the model's top reasons (factor copy), the season series, the tip-off time.
- **Corner button** ("NYK stats →") switches to the other team's numbers and frames that player.
- **Home** (top left) goes back to the matchup, where the drawer offers today's other games.
- **Projected lines** for the viewed team: its top 5 players by projected minutes, each with minutes, points, rebounds and assists and an 80% range for each stat ("if he plays"); the real line once the game is final.

### 3.4 Other pages (nav bar)

Top nav: **Predict** (home) · **How it works** · **Model performance** · **Docs** · GitHub icon link.

| Route | Audience | Content |
|---|---|---|
| `/how-it-works` | Casual fans | Scroll-driven visual explainer: data → features → model → prediction → animation. No code, plain language, small illustrations or animated diagrams. |
| `/performance` | Everyone | The model's report card: season accuracy vs baselines, a rolling accuracy chart, a calibration chart, log loss and Brier score, the best and worst calls, a recent predictions table. |
| `/docs` + `/docs/[slug]` | Technical | MDX docs: architecture, data pipeline, features, leakage prevention, models and experiments, evaluation, MLOps, 3D asset pipeline, tech stack. Sidebar nav. |
| `/game/[id]` | Stats-curious | Static full breakdown of one game: everything in the overlay plus full player tables, team recent form charts, and head-to-head. Shareable, with an OG image. |
| `/teams/[abbr]` | (v1.1, optional) | A team's predicted vs actual results this season, and how the model rates them over time. |

### 3.5 Footer
On every page except home: "Unofficial fan project. Not affiliated with the NBA." · data source credit · GitHub link. The home page is a full-screen 3D room with no footer bar; it shows the disclaimer as one small line in a corner.

## 4. Functional requirements

| ID | Requirement |
|---|---|
| F1 | Load today's games and the featured game in under 2s on broadband (excluding 3D asset streaming). |
| F2 | Selecting a game card updates the scene's jerseys in under 300ms after textures are cached. |
| F3 | Predictions exist for every scheduled game of the current day by 11 AM ET. |
| F4 | Past games show the stored prediction from **before** tip-off, never one regenerated afterward. |
| F5 | Every prediction records `model_version`, `generated_at`, and the features snapshot hash. |
| F6 | `/performance` numbers are computed from stored pre-game predictions joined to final results. |
| F7 | Works in current Chrome, Safari, Firefox, Edge; mobile Safari and Chrome. |
| F8 | WebGL unavailable → 2D fallback (team color panels, same flow, no 3D). |

## 5. Edge cases

- **Game postponed or cancelled**: the card shows "Postponed". Picking is off, with an explanation.
- **Prediction missing** (pipeline failed): the hint under the players says the prediction is pending. The scene still loads and picking is off (unless the game is already final).
- **Live game**: the prediction is still the pre-game one. The card shows the live score with a "Live" badge, and results include "Pre-game prediction".
- **Same team colors clash** (e.g. two red teams): use the away team's alternate color (see `shared/teams.json` `jersey.away`).
- **Very slow device**: auto-reduce quality (lower DPR, disable post-processing) using a performance monitor.
- **Timezones**: all times stored in UTC. Display in the user's local timezone. "Today" is defined in America/New_York (the NBA schedule day).

## 6. Success metrics
- Time to first prediction: under 10s median.
- Lighthouse performance score of 80 or more on home (mobile), with 3D lazy-loaded.
- Model: beats the home-team baseline on accuracy **and** log loss on the held-out season.

## 7. Open questions
- Project name and domain (placeholder: Tip-Off).
- Whether to include predicted final score/spread in v1 (it needs a separate regression model; suggested for v1.1).
- ~~Whether player stat projections ship at launch~~: they shipped in Phase 9, after beating the last-10 baseline on the held-out season.
