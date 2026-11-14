# Design spec: Tip-Off

## 1. Visual direction

**Mood:** a dark, empty arena right before tip-off. Cinematic lighting, team colors as the only saturated color on screen. Think broadcast intro, not cartoon.

- **Background:** near-black (`#0A0A0C`) with a subtle polished hardwood floor that reflects the lights.
- **Lighting:** a spotlight on each player tinted with their team's primary color, a soft rim light, and a faint haze/volumetric feel (fake it with a gradient plane plus bloom; no real volumetrics).
- **Post-processing:** light bloom, vignette, subtle film grain. Must be toggleable for low-end devices.
- **UI:** clean and minimal. Glassy dark panels (`bg-white/5`, `backdrop-blur`, 1px `white/10` border). The UI should never fight the scene.

### Typography
- Display: a condensed sports face (e.g. **Oswald** or **Bebas Neue** from Google Fonts) for team names, scores and big numbers.
- Body/UI: **Inter**.
- Numbers: tabular figures (`font-variant-numeric: tabular-nums`) in all stat tables.

### Color tokens
- `--bg: #0A0A0C`, `--panel: rgba(255,255,255,0.05)`, `--border: rgba(255,255,255,0.10)`
- `--text: #F5F5F7`, `--text-muted: #A1A1AA`
- `--accent: #FF6B1A` (basketball orange, used for the Predict button and links)
- `--good: #22C55E` (correct prediction ✓), `--bad: #EF4444` (✗)
- Team colors come from `shared/teams.json` at runtime. Check contrast. If a team's primary color is too dark for text on `--bg`, use its secondary color or white.

## 2. Layout

### Desktop (≥1024px)
```
┌──────────────────────────────────────────────────────────────────────┐
│ TIP-OFF     Predict   How it works   Performance   Docs     [GitHub] │  nav (transparent over scene)
├──────────────────────────────────────────────────────┬───────────────┤
│              BOS @ NYK · Tonight 7:30 PM ET          │ ‹ Today ›  📅 │
│                                                      │ ┌───────────┐ │
│        CELTICS                       KNICKS          │ │ BOS @ NYK │◄│ selected
│        12-4 · AWAY                   10-6 · HOME     │ │ 7:30 PM   │ │
│                                                      │ └───────────┘ │
│          🧍 (3D)                      🧍 (3D)         │ ┌───────────┐ │
│                                                      │ │ LAL @ DEN │ │
│                                                      │ │ 9:00 PM   │ │
│              [  PREDICT WHO WINS  ]                  │ └───────────┘ │
│                                                      │      ...      │
└──────────────────────────────────────────────────────┴───────────────┘
```
- The canvas fills the full viewport behind everything. The rail is an overlay (width about 300px) and the scene camera is offset left so the players are centered in the remaining space.

### Mobile (<768px)
- Nav collapses into a hamburger menu.
- Players are closer together with the camera pulled back. The team labels sit above each player.
- Predict button sits above a bottom horizontal card strip (cards ~140px wide, scroll-snap).
- Results overlay becomes a bottom sheet (drag to expand).

## 3. The 3D scene

### Elements
| Element | Source | Notes |
|---|---|---|
| Player ×2 | One rigged GLB (`/models/player.glb`) with all animation clips, instanced twice | Jersey per team = texture swap (see ASSET_PIPELINE) |
| Floor | Plane + hardwood texture (CC0 from Poly Haven / ambientCG) | Use `MeshReflectorMaterial` from drei, low resolution |
| Hoop | GLB (`/models/hoop.glb`) generated in Meshy or modeled simply | Placed far behind the players (~20m), hidden in fog until the cinematic |
| Ball | Procedural sphere + simple seam texture | The ball is NOT in the shot animation clip. It's a separate object, attached to the hand bone, then flown procedurally |
| Net | Simple cylinder/cone mesh with a line texture | "Swish" = quick vertex wobble or a scale pulse |
| Environment | drei `<Environment>` with a dark HDRI (Poly Haven, CC0), low intensity | For reflections on jerseys and skin |
| Lights | 2 spotlights (team colors), 1 rim light, low ambient | Spotlights cast soft shadows on the floor (shadow map ≤ 1024) |

### Idle state
- Both players play `Idle` variants with a random start offset and a random variant from `[Idle, Idle_02, Idle_03, ...]`, blending to another variant every 6 to 10s.
- Subtle head look-at toward the cursor (small clamp, ±15°) adds life cheaply. Disable on mobile.
- The camera does a very slow orbital drift (±2°, 12s period).

### Swapping games
- On card click: brief fade of the spotlights (200ms) → swap jersey textures and spotlight colors → fade up. Players don't reload. Only textures change.
- Preload the textures for all teams on the selected day after first render (idle callback).

## 4. Prediction cinematic storyboard

Driven by a single **GSAP timeline** controlled by a **zustand state machine**:
`idle → revealing → shooting → results → returning → idle`.

| t (s) | Beat | Camera | Winner | Loser | UI |
|---|---|---|---|---|---|
| 0.0 | Click | — | — | — | Button pulses, then morphs into a thin progress line; nav and rail fade to 30% |
| 0.2 | Reveal | Holds | Spotlight intensifies, color flares | Spotlight dims to 20%; plays a "disappointed" or idle-look-down clip | Team names fade except the winner's |
| 0.6 | Push-in | Dolly + arc (1.2s, `power2.inOut`) to an over-the-shoulder shot behind the winner, looking down-court; FOV 45→35 | Turns to face the hoop (rotate root 180° over 0.6s while playing `Turn`/idle) | Out of frame | Hide labels |
| 1.8 | Hoop reveal | Fog recedes and the hoop lights up far down-court | Holds ball at chest | — | — |
| 2.0 | Shot | Slight push toward the rim | Plays `JumpShot` clip. At the clip's **release frame** (marker in config), the ball detaches from the hand bone | — | — |
| ~2.6 | Ball flight | Camera tilts to follow the arc | Follow-through hold | — | — |
| ~3.8 | Make | Quick micro-shake (very subtle) | — | — | — |
| 3.8 | Swish | — | Lands, plays `Victory_Fist_Pump` | — | Light flash in team color + a short confetti burst in team colors |
| 4.2 | Results | Camera settles at a 3/4 hero angle on the winner | Celebrating idle | — | Results overlay slides in (stagger 60ms per section); numbers count up |
| — | Return | Reverse to the home camera (1.0s) | Turns back, idle | Spotlight restores | Overlay fades out; nav and rail return |

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
- **Skip** button (bottom-right) and the `Esc` key jump the timeline to the `results` label.
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
