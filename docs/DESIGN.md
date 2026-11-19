# Design spec: Tip-Off

## 1. Visual direction

**Mood:** a dark, empty arena right before tip-off. Cinematic lighting, team colors as the only saturated color on screen. Think broadcast intro, not cartoon.

- **Players are holograms with real colors** (decided Nov 2026, replacing the line-art holograms; the look follows the hologram site in the user's promo video and the `kyledev223/lions-share` repo). Each player is lit like a real person (skin, shoes, his team's actual jersey colors from `matchupJerseys`) and then turned into projected light: dark, see-through scan lines drifting slowly up the body, a glowing rim in the team's hologram color, the legs fading into the pad's light, a brighter band sweeping up now and then, and a rare flicker. The lit surface is held under the bloom threshold so faces and lettering stay crisp; only the rim, pads and stars glow. Only the surface nearest the camera is drawn (a depth pre-pass), so the back number never shows through the chest. Tuning lives in `HOLO` (`components/scene/tint-material.ts`).
- **Room: points of light in the dark.** A near-black space with a star field (mostly white, some NBA blue and red, slowly twinkling), a faint floor of points receding into fog, and under each player a pad of glowing point rings in the team's hologram color (slowly turning). No walls. Key, fill and back lights plus a soft room reflection light the players. The camera shifts slightly with the pointer (parallax against the stars).
- **Glow colors:** each team's rim and pad glow in its jersey color, brightened (`hologramColor`); if the two would look alike, `hologramMatchup` switches one team to its alternate (or turns the away glow cyan).
- **Post-processing:** bloom (threshold 0.66, so only light sources glow) and a vignette. Fine film grain over every page (CSS).
- **UI: the hologram site's mix of 3D and regular web.** Huge, wide, heavy uppercase headings; small mono labels (e.g. `TONIGHT · 7:30 PM ET`) in NBA red; thin glowing accent bars; dark glass panels with a hairline edge and faint scan lines (`holo-panel`). Every page sits on the same backdrop: near-black with a blue glow overhead, a red one low, faint stars.

### Typography
- Display and body: **Archivo** (variable). Headings use its width axis at 125% and weight 800+ (wide, heavy, uppercase), like the reference site.
- Labels: **JetBrains Mono**, small, uppercase, tracked (`eyebrow` utility).
- Jersey lettering on the 3D uniforms: **Oswald** (condensed, like real jerseys); not used for page text.
- Numbers: tabular figures (`font-variant-numeric: tabular-nums`) in all stat tables.

### Color tokens
- `--bg: #02040A`, `--panel: rgba(8,14,32,0.62)`, `--line: rgba(243,246,252,0.14)`
- `--text: #F3F6FC`, `--text-muted: rgba(243,246,252,0.66)`
- NBA colors: `--nba-blue: #1D428A`, `--nba-red: #C8102E` (Predict button and primary actions). On black, text and glows use brighter versions: `--blue-hi: #5B8CFF` (links, focus rings, accent bars) and `--red-hi: #FF4D5E` (mono labels).
- `--good: #22C55E` (correct prediction ✓), `--bad: #EF4444` (✗)
- Team colors come from `shared/teams.json` at runtime. Check contrast. If a team's primary color is too dark for text on `--bg`, use its secondary color or white.

## 2. Layout

### Desktop (≥1024px)
```
┌──────────────────────────────────────────────────────────────────────┐
│                     Predict   How it works   Performance   Docs   GitHub │  nav (no wordmark on home)
│                           TONIGHT · 7:30 PM ET                            │
│ ▌           BOSTON · 2-0 · AWAY          NEW YORK · 1-1 · HOME            │
│ ▌              CELTICS                       KNICKS                        │
│ T              ───                           ───                           │
│ O            (hologram)                    (hologram)                      │
│ D              player                        player                        │
│ A              ◎ pad                         ◎ pad                         │
│ Y                     [  PREDICT WHO WINS  ]                               │
│ ▌                                             Unofficial fan project… (tiny)│
└──────────────────────────────────────────────────────────────────────┘
```
- The canvas fills the viewport; the UI floats over it.
- **Players:** centered, each under its team name, as big as fits between the names and the Predict button with both fully visible (`lib/scene-framing.ts`; tested at desktop, tablet and phone sizes).
- **Games: today only.** No past days and no way to browse other days. The cards hide in a **drawer on the left edge**: with a mouse it slides out when the pointer comes within about 110px of the left edge and tucks away when the pointer leaves; a thin "Today's games · N" tab on the edge shows it's there (and opens it on touch). Keyboard focus opens it too; Escape closes it.
- **Cards** are flat, in the hologram style: dark glass with faint scan lines, a split strip and wash in the two teams' colors, the time (or live/final score) as a mono label, the matchup wide and heavy, the nicknames below. Hovering (or focusing) pops a card out (slides right and scales up) with a blue glow and a light sweep; the selected card has a red edge. When they don't all fit, the list scrolls.
- **No games today:** "No games today." with a button for the closest later day that has games (e.g. "Show Fri, Nov 21"), which then shows that day's games the same way. If nothing is scheduled, it says so.
- No wordmark and no footer bar on the home page; the disclaimer is one tiny line in a corner (CLAUDE.md, Brand and IP). Other pages keep the nav wordmark and the footer.

### Mobile (<1024px)
- Nav collapses into a menu; same order: matchup line, team names, players (fully visible), Predict at the bottom.
- The games drawer opens from the edge tab and closes after picking a game or tapping outside it.
- Results overlay becomes a bottom sheet (drag to expand).

## 3. The 3D scene

### Elements
| Element | Source | Notes |
|---|---|---|
| Player ×2 | One rigged GLB (`/models/player.glb`) with all animation clips, instanced twice | Lit in real colors (team jersey via the shader tint of the white base uniform, ASSET_PIPELINE section 5), then the hologram pass (section 1). Rim in the team's hologram color (`hologramMatchup`). No shadow |
| Pad ×2 | Rings of glowing points plus a soft glow disc and a small point light, in the hologram color | Under each player; slowly turns; dims with the loser |
| Floor | A grid of faint points receding into fog | |
| Stars | ~2,600 points, mostly white with some NBA blue and red, twinkling | `components/scene/arena-scene.tsx` |
| Hoop | Drawn in glowing lines (decided in Phase 7): backboard outline and target square, arm, pole, rim in the winner's hologram color, diamond net | 6.8 m in front of the winner once he turns (a long two), rim at 3.05 m; hidden until the cinematic. `components/scene/cinematic-props.tsx` |
| Ball | A real basketball: lit sphere with a generated orange leather texture and black seams, plus a short glowing trail in the team color | Not in the shot clip: it rides between the winner's hands, then flies on the shot path |
| Net | Part of the hoop | On the make it stretches and swings, settling in about 0.7 s |
| Sparks | ~280 glowing points in the winner's colors and white, with a flash of team-color light at the rim (decided in Phase 7 instead of paper confetti) | Spray out from the rim, drift down and fade over 1.5 s |
| Lights | Key (upper left, warm), fill (right, cool), back light (outline), low ambient, a soft room reflection (`RoomEnvironment`), a colored point light at each pad | The players are lit like real people, under the bloom threshold |

### Idle state
- Both players play `Idle` variants with a random start offset and a random variant from `[Idle, Idle_02, Idle_03, ...]`, blending to another variant every 6 to 10s.
- Subtle head look-at toward the cursor (small clamp, ±15°) adds life cheaply. Disable on mobile.
- `prefers-reduced-motion`: animation, hologram effects, stars and pads hold still (`paused`); cards don't pop or sweep.
- The camera drifts slightly with the pointer (parallax), not on its own.

### Swapping games
- On card click: brief fade of the spotlights (200ms) → swap hologram colors, lettering and spotlight colors → fade up. Players don't reload, so there is nothing to preload.

## 4. Prediction cinematic storyboard

Driven by a single **GSAP timeline** controlled by a **zustand state machine**:
`idle → revealing → shooting → results → returning → idle`.

As built in Phase 7 (`components/scene/matchup.tsx`). The camera moves by blending from the home framing toward the cinematic's shot (`camera-override.ts`). Times are from the click; release and later depend on the outcome.

| t (s) | Beat | Camera | Winner | Loser | UI |
|---|---|---|---|---|---|
| 0.0 | Click | Holds | — | Hologram and pad dim to 30%; switches to `Idle_Look` | Predict becomes a thin red progress line; Skip appears; the loser's name dims, then all names and the matchup line fade (0.3 s delay); the games drawer closes and its tab dims |
| 0.4 | Push-in | Blends (1.2 s, `power2.inOut`) to over his right shoulder, 3.6 m behind him, FOV 35→42 | 0.6–1.3: turns half around to face the hoop | — | — |
| 1.2 | Hoop | — | — | — | The hoop fades in (0.6 s) |
| 1.8 | Shot | 2.5–4.1: tilts up to follow the arc toward the rim | `JumpShot`; the ball pops into his hands | — | Scene store: `revealing → shooting` |
| 3.07 | Release | — | At `JUMPSHOT_RELEASE_TIME` (1.27 s into the clip) the ball leaves his hands | — | — |
| ~4.2 to 5.3 | Make | A brief shake (0.35 s) | — | — | Flash and sparks at the rim; the net swings |
| make + 0.3 | Celebrate | — | Turns back to the camera and plays `Celebrate` | — | — |
| make + 0.7 | Results | Moves (1.1 s) to a hero shot: his whole body, off to his side so the panel doesn't cover him; FOV back to 35 | Celebrating, then idle | — | `shooting → results`; the results panel appears; the hoop fades out |
| Back | Return | Blends back to the home framing (1.0 s) | Turns back to rest, idle | Restores | `returning → idle`; names return |

Without WebGL (2D fallback), the page advances the phases on short timers instead.

### Shot outcome tied to confidence
Let `p = winner's win probability`.
- `p ≥ 0.70`: clean swish (ball path ends at the rim center).
- `0.58 ≤ p < 0.70`: kisses the back iron, then drops (2-segment path).
- `p < 0.58`: rattles: hits the front rim, bounces up, rolls around, drops in (3 to 4 segments). Show the copy "Coin flip. The model barely leans this way."

### Ball flight math
- Parabola from release point `P0` to rim `P1` with apex height `h = max(P0.y, P1.y) + 2.5m`. Sample it with a quadratic Bezier, and drive `t` with GSAP `power1.in` for slight acceleration.
- Ball spin: backspin around the axis perpendicular to the travel direction, about 2 rotations per second.
- Rattle: precomputed keyframes relative to the rim. Don't use a physics engine.

### Skipping and accessibility
- **Skip** button (bottom-right) and the `Esc` key jump the timeline to the `results` label (the make's sparks still fire, and the camera goes on to the hero shot).
- `prefers-reduced-motion`: no camera moves. Crossfade to results with a static winner highlight.
- All results content is real DOM (not canvas) so it's readable by screen readers. Announce "Prediction: Knicks win with 64% probability" via an `aria-live` region.

## 5. Results overlay

```
┌───────────────────────────────────────────────┐
│  KNICKS WIN                          64%      │ team color stripe
│  ██████████████████░░░░░░░░░  NYK 64 · BOS 36 │ win prob split bar
├───────────────────────────────────────────────┤
│  WHY                                          │
│  Home court                         +4%  ███  │
│  BOS on back-to-back                +6%  ████ │
│  NYK last-10 net rating             +5%  ███▌ │
│  BOS better season net rating       −7%  ████ │ (bars in the favored team's color)
├───────────────────────────────────────────────┤
│  PROJECTED LINES          PTS   REB   AST     │
│  NYK  #11  J. Brunson     27.4  3.1   6.8     │  (tabs: NYK | BOS)
│  ...                                          │
├───────────────────────────────────────────────┤
│  [ ← Back to matchup ]     [ Full breakdown → ]│
└───────────────────────────────────────────────┘
```
- Factor copy is generated from feature names via a mapping table in `web/lib/factor-copy.ts`. Never show raw feature names to casual users.
- For Final games, add a header badge: `FINAL · NYK 112 – 104 BOS · ✓ Model correct`.

## 6. Other pages

- **How it works:** a vertical scroll story with 5 chapters (Data → Features → Model → Prediction → Animation). Each chapter has a big number or mini visual that animates on scroll (GSAP ScrollTrigger or framer-motion `whileInView`). Reuse the 3D player in chapter 5 as a small canvas.
- **Performance:** a grid of stat tiles (Accuracy, Log loss, Brier, Games predicted) with a "vs. home-team baseline" delta, a rolling 50-game accuracy line chart, a calibration chart (predicted bucket vs actual win rate, with the diagonal), and a recent predictions table with ✓/✗ and filters.
- **Docs:** classic docs layout with a left sidebar, content, and a right "On this page" TOC. Code blocks have syntax highlighting (Shiki). Diagrams use Mermaid.
- **Game breakdown:** a static version of the overlay plus full tables. OG image is generated with `next/og` in team colors.

## 7. Motion and performance budgets
- Home JS (excluding three.js chunk) under 150KB gzip. The three.js and scene chunk loads after first paint.
- `player.glb` under 4MB (meshopt-compressed). Each jersey texture set under 400KB (WebP or KTX2, 1024²).
- Target 60fps on a mid-range laptop and 30fps or more on recent phones. Use drei's `<PerformanceMonitor>` to drop DPR and post-processing when needed.
- Show a branded loader (a basketball spinning in CSS) while the 3D chunk streams. Display team names and the Predict button immediately so the page is usable before 3D is ready.
