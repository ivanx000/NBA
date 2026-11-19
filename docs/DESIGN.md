# Design spec: Tip-Off

## 1. Visual direction

**Mood:** a dark, empty arena right before tip-off. Cinematic lighting, team colors as the only saturated color on screen. Think broadcast intro, not cartoon.

- **Players are holograms with real colors** (decided Nov 2026, replacing the line-art holograms; the look follows the hologram site in the user's promo video and the `kyledev223/lions-share` repo). Each player is lit like a real person (skin, shoes, his team's actual jersey colors from `matchupJerseys`) and then turned into projected light: fine, dark, see-through scan lines drifting slowly up the body, a glowing rim in the team's hologram color with a crisp bright edge at the silhouette, the legs fading into the platform's light, a brighter band sweeping up now and then, a rare flicker, and every ten seconds or so a quick glitch where a few thin slices flash (done in the fragment shader; moving vertices would fight the depth pre-pass and speckle the surface). The lit surface is held under the bloom threshold so faces and lettering stay crisp; only the rim, platforms and arena lights glow. Only the surface nearest the camera is drawn (a depth pre-pass), so the back number never shows through the chest. Tuning lives in `HOLO` (`components/scene/tint-material.ts`).
- **Room: an arena drawn in light** (decided Nov 2026). Court lines in points on the floor around the players (boundary, half-court line and circle, keys, three-point arcs), tiered stands of faint twinkling lights behind and at both ends, a big screen of blue and red cells on the far wall between the players' heads, rows of lights in the rafters, a soft blue glow behind the far stands, and faint dust in the air (`components/scene/arena.tsx`). Key, fill and back lights plus a soft room reflection light the players. The camera shifts slightly with the pointer (parallax).
- **Platforms:** each player stands on a raised, dark, glossy hexagonal plinth with glowing edges and a target inlay in the team's color, a faint column of light rising from it and a few motes drifting up the light (`components/scene/platform.tsx`). They hold still (no turning). They brighten when the player is hovered and dim when the other team is in focus.
- **Glow colors:** each team's rim and pad glow in its jersey color, brightened (`hologramColor`); if the two would look alike, `hologramMatchup` switches one team to its alternate (or turns the away glow cyan).
- **Post-processing:** bloom (threshold 0.66, so only light sources glow) and a vignette. Fine film grain over every page (CSS).
- **UI: the hologram site's mix of 3D and regular web.** Huge, wide, heavy uppercase headings; small mono labels (e.g. `TONIGHT · 7:30 PM ET`) in NBA red; thin glowing accent bars; dark glass panels with a hairline edge and faint scan lines (`holo-panel`). Every page sits on the same backdrop: near-black with a blue glow overhead, a red one low, faint stars. Team names over the players are small (the players are the hero).

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
│ ▬       BOSTON · 2-0 · AWAY     ┌big screen┐   NEW YORK · 1-1 · HOME      │  small names
│ ▬           CELTICS             └──────────┘        KNICKS                 │
│ ━          (hologram)                             (hologram)               │  ticks = today's games
│ ▬            player                                 player                 │
│ ▬           ⬡ platform          court lines        ⬡ platform              │
│                    CLICK A PLAYER TO PICK WHO WINS                         │
│                                             Unofficial fan project… (tiny)│
└──────────────────────────────────────────────────────────────────────┘
```
- The canvas fills the viewport; the UI floats over it.
- **Players:** centered, each on its platform under its team name, as big as fits between the (small) names and the one-line hint, with both fully visible (`lib/scene-framing.ts`; tested at desktop, tablet and phone sizes).
- **Picking:** hovering a player grows him 6% and brightens him and his platform; the team name's color bar lengthens. Clicking picks. The team names are buttons too.
- **Games: today only.** A slim column of small two-tone ticks on the left edge, one per game in its teams' colors, the selected one longer and lit, with "10 games" set vertically below. With a mouse the drawer slides out when the pointer comes within about 110px of the left edge and tucks away when it leaves; a tap on the ticks opens it on touch; keyboard focus opens it too; Escape closes it.
- **Cards** are flat, in the hologram style: dark glass with faint scan lines, a wash in the two teams' colors, the time (or live/final score) as a mono label, the matchup wide and heavy, and the nicknames with a small glowing dot in each team's color. Hovering (or focusing) pops a card out (slides right and scales up) with a blue glow and a light sweep; the selected card has a red edge. When they don't all fit, the list scrolls.
- **No games today:** "No games today." with a button for the closest later day that has games (e.g. "Show Fri, Nov 21"), which then shows that day's games the same way. If nothing is scheduled, it says so.
- No wordmark and no footer bar on the home page; the disclaimer is one tiny line in a corner (CLAUDE.md, Brand and IP). Other pages keep the nav wordmark and the footer.

### Mobile (<1024px)
- Nav collapses into a menu; same order: matchup line, team names (record on its own line), players (fully visible; platforms sized to the gap between them), the "Tap a player" hint.
- The games drawer opens from the ticks and closes after picking a game or tapping outside it.
- The results panel is a sheet over the lower part of the screen; the camera puts the viewed player above it.

## 3. The 3D scene

### Elements
| Element | Source | Notes |
|---|---|---|
| Player ×2 | One rigged GLB (`/models/player.glb`) with all animation clips, instanced twice | Lit in real colors (team jersey via the shader tint of the white base uniform, ASSET_PIPELINE section 5), then the hologram pass (section 1). Rim in the team's hologram color (`hologramMatchup`). No shadow |
| Platform ×2 | Raised hexagonal plinth (0.16 m) with glowing edges, an inlay, a column of light and rising motes, in the hologram color | Still; brightens on hover, dims out of focus |
| Arena | Court lines, stands, big screen and rafter lights in points; a soft back glow; ~900 dust motes | `components/scene/arena.tsx`; the floor is 0.16 m below the players' feet |
| Hoop | Drawn in glowing lines (decided in Phase 7): backboard outline and target square, arm, pole, rim in the winner's hologram color, diamond net | 6.8 m in front of the winner once he turns (a long two), rim at 3.05 m; hidden until the cinematic. `components/scene/cinematic-props.tsx` |
| Ball | A real basketball: lit sphere with a generated orange leather texture and black seams, plus a short glowing trail in the team color | Not in the shot clip: it rides between the winner's hands, then flies on the shot path |
| Net | Part of the hoop | On the make it stretches and swings, settling in about 0.7 s |
| Sparks | ~280 glowing points in the winner's colors and white, with a flash of team-color light at the rim (decided in Phase 7 instead of paper confetti) | Spray out from the rim, drift down and fade over 1.5 s |
| Lights | Key (upper left, warm), fill (right, cool), back light (outline), low ambient, a soft room reflection (`RoomEnvironment`), a colored point light at each pad | The players are lit like real people, under the bloom threshold |

### Idle state
- Both players play idle variants with a random start offset, blending to another after each loop: mostly the plain idles (`Idle`, `Idle_02`, `Idle_03`, `Idle_Look`), with a livelier one 40% of the time (`BounceLoose`, `ArmSwings`, `ShoulderStretch`, `NeckRoll`, `FocusBreath`, `AdjustJersey`, `LookUpScoreboard`), never two lively ones in a row.
- Head look-at: while waiting for a pick, the head and neck turn toward where the cursor points (yaw up to about 25°, pitch about 12°, eased), on top of the animation. Off during the cinematic and with reduced motion.
- `prefers-reduced-motion`: animation, hologram effects, stars and pads hold still (`paused`); cards don't pop or sweep.
- The camera drifts slightly with the pointer (parallax), not on its own.

### Swapping games
- On card click: brief fade of the spotlights (200ms) → swap hologram colors, lettering and spotlight colors → fade up. Players don't reload, so there is nothing to preload.

## 4. Prediction cinematic storyboard

Driven by a single **GSAP timeline** controlled by a **zustand state machine**:
`idle → revealing → shooting → results → returning → idle`.

As built (`components/scene/matchup.tsx`). The camera moves by blending from the home framing toward the cinematic's shot (`camera-override.ts`). Times are from the click; release and later depend on the outcome.

| t (s) | Beat | Camera | Picked player | Other player | UI |
|---|---|---|---|---|---|
| 0.0 | Click (pick) | Holds | — | Hologram and platform dim to 30%; switches to `Idle_Look` | A thin red progress line replaces the hint; Skip appears; the names and matchup line fade (0.3 s delay); the games drawer closes and its ticks dim |
| 0.4 | Push-in | Blends (1.2 s, `power2.inOut`) to over his right shoulder, 3.6 m behind him, FOV 35→42 | 0.6–1.3: turns half around to face the hoop | — | — |
| 1.2 | Hoop | — | — | — | The hoop fades in (0.6 s) |
| 1.8 | Shot | 2.5–4.1: tilts up to follow the arc toward the rim | `JumpShot`; the ball pops into his hands | — | Scene store: `revealing → shooting` |
| 3.07 | Release | — | At `JUMPSHOT_RELEASE_TIME` (1.27 s into the clip) the ball leaves his hands | — | — |
| ~4.2 to 5.3 | Decided | A brief shake (softer on a miss) | — | — | Make: flash and sparks at the rim, the net swings. Miss: nothing |
| decided + 0.3 | Reaction | — | Turns back to the camera; `Celebrate` on a make, `HeadShake` on a miss | — | — |
| decided + 0.7 | Results | Moves (1.1 s) to a hero shot: his whole body in his half of the screen, clear of the panel | Then idle | — | `shooting → results`; the results panel appears; the hoop fades out |
| Switch team | — | Moves (0.9 s) to the other player's hero shot | Dims | Lights up | The panel moves to the other side |
| Home | Return | Blends back to the home framing (1.0 s) | Turns back to rest, idle | Restores | `returning → idle`; names and the drawer return |

Without WebGL (2D fallback), the page advances the phases on short timers instead.

### Shot outcome
Let `p` = the model's win probability for the picked team. If the pick is right (`lib/slate.ts` `verdict`):
- `p ≥ 0.70`: clean swish (ball path ends at the rim center).
- `0.58 ≤ p < 0.70`: kisses the back iron, then drops (2-segment path).
- `p < 0.58`: rattles: hits the front rim, bounces up, rolls around, drops in (3 to 4 segments). (This also covers a right pick against the model, once the final score decides.)

If it's wrong (`pickShot` in `lib/shot-path.ts`):
- `p ≥ 0.40`: off the back iron, around the rim and out the side.
- `p < 0.40`: off the front of the rim and back toward the shooter.

### Ball flight math
- Parabola from release point `P0` to rim `P1` with apex height `h = max(P0.y, P1.y) + 2.5m`. Sample it with a quadratic Bezier, and drive `t` with GSAP `power1.in` for slight acceleration.
- Ball spin: backspin around the axis perpendicular to the travel direction, about 2 rotations per second.
- Rattle: precomputed keyframes relative to the rim. Don't use a physics engine.

### Skipping and accessibility
- **Skip** button (bottom-right) and the `Esc` key jump the timeline to the `results` label (the make's sparks still fire, and the camera goes on to the hero shot).
- `prefers-reduced-motion`: no camera moves. Crossfade to results with a static winner highlight.
- All results content is real DOM (not canvas) so it's readable by screen readers. Announce "Prediction: Knicks win with 64% probability" via an `aria-live` region.

## 5. Results screen

```
[← HOME]                                    ┌─────────────────────────────────┐
                                            │ YOUR PICK · CELTICS             │
        (hero shot of the viewed            │ YOU'RE RIGHT.                   │
         player, in his half)               │ The model gives the Celtics 58% │
                                            ├─────────────────────────────────┤
                                            │ BOSTON              [NYK STATS →]│
                                            │ CELTICS ───                     │
                                            │ Record  Home   Away             │
                                            │ Last 10 Streak Rest             │
                                            │ Points  Allowed Margin          │
                                            ├─────────────────────────────────┤
                                            │ THE GAME                        │
                                            │ ██████████░░░░░  BOS 58 · NYK 42│
                                            │ Simple Elo baseline …           │
                                            │ Celtics in better recent form +5│
                                            │ Season series · Tip-off         │
                                            └─────────────────────────────────┘
```
- The panel sits on the side away from the viewed player (`components/home/results-view.tsx`); on phones it's a sheet at the bottom. The verdict is red when wrong, white with a blue glow when right; the team name is underlined in its color.
- The reasons are bars (`components/game/factor-bars.tsx`): each in the color of the team it favors, its length the effect's size; finished games show the Final badge (`final-badge.tsx`); "Full breakdown" links to `/game/[id]`.
- Factor copy comes from `web/lib/factor-copy.ts`. Never show raw feature names.
- The verdict is announced in an `aria-live` region and focus moves to it.

## 6. Other pages

- **How it works:** a vertical scroll story with 5 chapters (Data → Features → Model → Prediction → Animation). Each chapter has a big number or mini visual that animates on scroll (GSAP ScrollTrigger or framer-motion `whileInView`). Reuse the 3D player in chapter 5 as a small canvas.
- **Performance** (`/performance`, `components/performance/performance-view.tsx`): a season toggle (this season, last season), a plain headline ("Right on 68% of 216 games, 1.4 points behind Elo.") and what's being graded (live vs walk-forward backtest picks), four glass tiles (accuracy, log loss, Brier score, games graded) with Elo and the home team under each number, a rolling 50-game accuracy line (model solid blue, Elo dashed, home team dotted), a calibration chart from the favorite's side with the diagonal and a small table, the three most confident hits and misses, and a recent-picks table (✓/✗, model pick and confidence, Elo's pick, final, live or backtest) with filters, each row linking to its game. Chart animations are off with reduced motion. The model trails Elo; the page says so.
- **Docs** (`/docs`, `app/docs`, `components/docs`, content in `web/content/docs/*.mdx`): sections on the left (mono red section labels, current page marked with a blue edge), the page in a 46rem column (huge wide uppercase title, a lede, prose with uppercase H2s over hairlines, glass code blocks highlighted by Shiki, mono table headers, figures framed in the panel edge), and "On this page" on the right, which marks the heading in view. Previous/next links close each page. Diagrams are Mermaid, themed in the site's colors and loaded only where used. On phones the sections become a compact block above the page and "On this page" hides.
- **Game breakdown** (`/game/[id]`, `components/game/game-breakdown.tsx`): the date and status as a mono label, the matchup in huge wide type, the Final badge, then glass panels: win chance (split bar in the teams' glow colors, the Elo baseline, live or backtest), the reasons as bars, the two teams side by side (numbers tiles and a last-10 strip of W/L chips with opponent and score, green and red edges), the season series, and a placeholder for player lines. The link preview (`next/og`, 1200×630) shows the matchup and both win chances in the teams' glow colors on the blue-glow backdrop.

## 7. Motion and performance budgets
- Home JS (excluding three.js chunk) under 150KB gzip. The three.js and scene chunk loads after first paint.
- `player.glb` under 4MB (meshopt-compressed). Each jersey texture set under 400KB (WebP or KTX2, 1024²).
- Target 60fps on a mid-range laptop and 30fps or more on recent phones. Use drei's `<PerformanceMonitor>` to drop DPR and post-processing when needed.
- Show a branded loader (a basketball spinning in CSS) while the 3D chunk streams. Display team names and the Predict button immediately so the page is usable before 3D is ready.
