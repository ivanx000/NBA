# Product requirements: Tip-Off

## 1. Vision

A website that makes an ML model fun to use. A visitor lands on a dark arena scene with two players in the jerseys of tonight's matchup, presses **Predict who wins**, and watches the predicted winner's player hit a shot. Then the numbers appear: win probability, why the model thinks so, and predicted player stat lines. Anyone curious can open the docs and see how the model works.

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
       ├─ Side cards list all games for the selected day
       │    └─ Click a card -> players swap jerseys -> scene resets to idle
       └─ Click "Predict who wins"
            └─ Cinematic: camera pushes in on winner -> jump shot -> swish
                 └─ Results overlay: win prob, key factors, player stat lines
                      ├─ "Back to matchup" -> returns to idle (same game)
                      └─ "Full breakdown" -> /game/[id]
```

### 3.1 Home page (`/`)

**Scene (center)**
- Two generic, identical-build 3D players facing the camera at slight angles, each wearing their team's colors (city name + number on the chest). Home team on the right, away team on the left (a broadcast convention; keep it consistent).
- Both loop idle animations (shifting weight, looking around, light bounce). Their loops are offset so they don't move in sync.
- Above each player, centered over it: team city, record (W-L) and "HOME"/"AWAY", then the nickname. Players are centered on screen and as large as fits with both fully visible.
- Top center: matchup line, e.g. `BOS @ NYK · Tonight 7:30 PM ET`.

**Primary action**
- A prominent **Predict who wins** button, horizontally centered between the players and visually anchored at the lower-middle of the viewport.
- Keyboard accessible (Enter/Space), with a visible focus state.

**Today's games** (DESIGN.md section 2)
- **Only today's games** (ET). No past games and no way to browse other days.
- Cards sit in a drawer on the left edge that slides out when the mouse nears the left side of the screen (a tab on the edge opens it on touch; keyboard focus opens it too). The cards are flat, hologram-styled, pop out and glow when hovered, and scroll when they don't all fit.
- One card per game: both team abbreviations in the two teams' colors, the nicknames, and the tip-off time (user's local timezone) or live/final score.
- **No games today:** the page says so, with a button to show the closest later day that has games.
- **Default selection:** today's next game that hasn't started (otherwise today's last game). The URL updates to `/?game=<id>` so it's shareable and refresh-stable; a `?game=` that isn't today's is ignored.

### 3.2 Prediction cinematic

Full storyboard and timings: `docs/DESIGN.md §4`. Requirements:
- Total length about 4 to 5 seconds, with a **Skip** control visible throughout.
- The shot outcome reflects confidence. A high-confidence prediction is a clean swish. A near coin-flip rattles around the rim before dropping in.
- With `prefers-reduced-motion`, or if the user has already watched a cinematic this session and toggled "Instant results", skip straight to results.

### 3.3 Results overlay

Appears over the scene after the swish. The scene stays visible behind it, dimmed.
- **Winner banner**: team name in its colors, e.g. "Knicks win: 64%".
- **Win probability bar**: split bar, both teams, percentages.
- **Why the model thinks so**: top 3 to 5 factors as signed bars (from SHAP), in plain language, e.g. "Celtics on 2nd night of back-to-back: −6%".
- **Projected player lines**: for each team, the top ~5 players by projected minutes: PTS / REB / AST, plus ranges.
- **For past (Final) games**: the actual score and a ✓ or ✗ showing whether the model got it right.
- Buttons: **Back to matchup** (returns to idle), **Full breakdown** (`/game/[id]`).
- Note: "Predictions are generated daily at ~10 AM ET from data available before tip-off."

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

- **Game postponed or cancelled**: the card shows "Postponed". Predict is disabled with an explanation.
- **Prediction missing** (pipeline failed): the card shows "Prediction pending". The scene still loads and Predict is disabled.
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
- Whether player stat projections ship at launch or in v1.1 (see ROADMAP).
