# 3D asset pipeline: Tip-Off

How the player, jerseys, hoop and environment get made, from ChatGPT images through Meshy to optimized files in `web/public/`. No Blender step is needed: the scripts in `web/scripts/assets/` do the renaming, optimizing and masks.

> **Key decision:** build **one** base player, rig and animate it **once**, and make each team's jersey a **texture swap** on that same model. Don't generate 30 separate 3D models. Separate models would differ in body shape and face, need 30 rigs and 30 rounds of animation, and cost far more credits. They would also make the cinematic code much harder, because every model would have different bones and clip timings.

## 0. Brand and IP rules for all assets
- Team **colors**, **city names and nicknames as plain block lettering**, and a jersey number are fine.
- **No** NBA logo, no team logos, no replicas of official uniform designs or wordmark fonts, no real player likenesses.
- Image generators may refuse logo or trademark requests anyway. The prompts below are written to avoid that.

## 1. Asset list

| Asset | File (web/public) | How it's made | Budget |
|---|---|---|---|
| Player (rigged, all clips) | `models/player.glb` | ChatGPT → Meshy image-to-3D → Meshy rig + animations → gltf-transform | ≤ 4 MB |
| Jersey textures ×30 (+ alternates) | `textures/jerseys/{ABBR}/basecolor.webp` | ChatGPT image edit → Meshy Retexture (original UVs) → jersey-mask composite | ≤ 400 KB each |
| Hoop | `models/hoop.glb` | Built from primitives in R3F first; Meshy text-to-3D if you want more detail | ≤ 1 MB |
| Ball | procedural (code) | Sphere + canvas-drawn seam texture | — |
| Floor | `textures/floor/*` | CC0 wood texture (ambientCG / Poly Haven) | ≤ 800 KB |
| HDRI | `hdri/arena_dark.hdr` | CC0 dark interior HDRI (Poly Haven), downsized to 1k | ≤ 1.5 MB |

Raw and intermediate files go in `assets-src/` (large files git-ignored or tracked with Git LFS):
```
assets-src/
  base/         base_front.png, base_back.png, base_side.png, meshy_base.glb, meshy_rigged.glb
  jerseys/BOS/  ref.png, retexture.glb, basecolor_raw.png
  masks/        jersey_mask.png
  hoop/
```

## 2. Step 1: base player image (ChatGPT)

Generate a clean, neutral, rig-friendly character. Use **portrait 2:3** output.

**Prompt: front view**
```
Full-body character reference image for a 3D game asset: a generic adult male
basketball player, athletic build, about 6'6", neutral calm expression, short
cropped hair. Standing in a strict A-pose: arms straight, angled down and out at
about 45 degrees from the body, hands open with fingers slightly apart, palms
facing down, legs straight and shoulder-width apart, feet pointing forward.
Front orthographic view, perfectly centered, the entire body visible from head
to sneakers with empty margin around it.
Clothing: plain white sleeveless basketball jersey and plain white knee-length
basketball shorts, plain white mid-top sneakers, white crew socks.
No logos, no text, no numbers, no stripes, no accessories, no jewelry, no
headband, no tattoos.
Soft, even studio lighting with no harsh shadows, plain light-gray background.
Semi-realistic, high-detail game-asset style with realistic proportions and
fabric detail.
```

**Prompt: back and side views** (send in the same chat, after the front view)
```
Using the exact same character, outfit, A-pose, lighting and background, render
the [back view | left side view], orthographic, full body, centered.
```

Acceptance checklist:
- [ ] A-pose with arms clear of the torso (rigging fails if the arms touch the body)
- [ ] Hands open with separated fingers
- [ ] Nothing cropped, and no extra props
- [ ] The jersey is plain white (it gets repainted later)

## 3. Step 2: image to 3D (Meshy)

Meshy **Image to 3D**, using multi-view if available (front + back + side):
- Latest Meshy model
- Symmetry: **on**
- Topology: triangle or quad, **target ~30k polygons** (web budget)
- Texture: **PBR on**, 2048 resolution
- A-pose option **on** if offered

Download the **GLB** → `assets-src/base/meshy_base.glb`. Check it in Blender or https://gltf-viewer.donmccurdy.com:
- [ ] No holes or fused fingers, and the hands are readable
- [ ] Face is acceptable at the distance the camera will be (about 3 to 5 m). It doesn't need to be perfect.
- [ ] Jersey and shorts are clearly separate shapes from the skin

## 4. Step 3: rig and animations (Meshy)

Rig with Meshy **Auto-Rigging** (web app, or `POST /openapi/v1/rigging`) with `height_meters: 1.98`.

### Clips needed
| Clip name in GLB | Source | Meshy name | Used for |
|---|---|---|---|
| `Idle` | Library | `Idle_3` (10 s) | Home idle |
| `Idle_02`, `Idle_03` | Library | `Idle_02`, `Idle_03` | Idle variety (`Idle_03` trimmed, see below) |
| `Idle_Look` | Library | `Short_Breathe_and_Look_Around` | Idle variety / loser |
| `JumpShot` | **Text to Motion**, 3 s | task `01a1dd3f…` | The shot |
| `Celebrate` | Library (motion capture) | `Cheer_with_Both_Hands_Up` | After the make |

Meshy's default `Running` and `Walking` clips are dropped. `Celebrate` was picked from the library after a Text to Motion celebration didn't look human and four other library celebrations were compared in the lab. To change it, add the preset to the character in Meshy, re-export, and map it in `CLIP_NAMES`.

Prefer motion-captured library clips for anything a person would recognize, and keep Text to Motion for what the library lacks (the jump shot).

One-shot clips (shot, celebration) blend back into `Idle` when they finish, so the player never freezes on a clip's last frame.

**The library has no basketball shot.** Make one with Meshy **Text to Motion** (10 credits per generation, Motion Prime model), check it on the mannequin preview, then **Add to Character**. Prompts used (each must fit in 400 characters):
```
JumpShot (3 s): A basketball player does a jump shot in place. Starts balanced,
holding a ball at chest height with both hands. Dips the knees, then jumps straight
up raising the ball above the forehead, right hand under the ball, left hand on its
side. Releases at the peak with a wrist flick, holds the follow-through with the right
arm extended up, then lands softly in place and relaxes.

```
`JUMPSHOT_RELEASE_TIME` in `web/lib/scene-config.ts` is estimated from the jump's peak (1.27 s); confirm it visually in Phase 7.

### Export and optimize (no Blender)
Export the rigged character from the Meshy web app: Download → glb, skeleton template Mixamo, Animation **All Added**, Single file → `assets-src/base/meshy_rigged.glb`. Then:
```bash
cd web && pnpm assets:player   # -> public/models/player.glb (≤ 4 MB, checked)
```
`scripts/assets/prepare-player.mts` renames clips (Text to Motion clips are exported under their task id, so new ones must be added to its `CLIP_NAMES`), checks every clip is in place (hips drift ≤ 0.15 m), prints the height, the hand bone and the jump peak, then optimizes: dedup, prune, resample, WebP textures (1024, roughness/metal 512) and meshopt.

`Idle_03` is trimmed in `prepare-player.mts` (`TRIMS`): the original leans back into a full-body stretch first; the kept part starts at 2.5 s (the arm and shoulder stretch) with a 0.8 s ease in from the clip's first pose, so loops still blend. `trimWithLeadIn` in `scripts/assets/clips.mts` does this for any clip.

### Motion library (for later)
Extra clips live in `web/public/models/motion-library.glb` (skeleton and animations only, no mesh; about 3.3 MB) with an index in `motion-library.json` (name, seconds, hips drift, in place or not, source). They target bones by name, so they play on `player.glb` (`<Player extraClips={...}>`). Browse them in `/dev/jerseys` under **Library**. The home page doesn't load this file.

63 clips: 28 made with Text to Motion (280 credits, prompts asked for subtle, natural, in-place motion) and 35 free library presets.

- Text to Motion: ShoulderStretch, NeckRoll, IdleWeightShift, HandsOnHips, ArmsCrossed, Disappointed, Nod, HeadShake, TurnAround, Dribble, FreeThrow, ChestPass, Clap, FistPumpSmall, PointUp, ThumbsUp, WipeBrow, AdjustJersey, BounceLoose, DefenseStance, LookUpScoreboard, ChestTap, FormShooting, FocusBreath, Handshake, ArmSwings, JumpShot2, PointTeammate.
- Library presets: Agree_Gesture, Catching_Breath, Cheer_with_Both_Hands, Confused_Scratch, Depressed_Full_Turn_Left, Frustrated_Turn_Right, Hand_on_Hip_Gesture, Happy_Sway_Standing, Headache_Relief, Idle_4 to Idle_15, Idle_Step_Turn_Left, Idle_Turn_Left, Idle_Turn_Right, Listening_Gesture, Long_Breathe_and_Look_Around, Motivational_Cheer, Shrug, Stand_and_Chat, Talk_with_Hands_Open, Talk_with_Right_Hand_Open, victory, Victory_Cheer, Victory_Fist_Pump, Wave_One_Hand.
- Not in place (hips move more than 0.15 m; fine for a one-off, but trim or root-lock before using as an idle): Victory_Cheer, IdleWeightShift, ArmsCrossed, Disappointed, TurnAround, FreeThrow, ChestPass, DefenseStance, Agree_Gesture, Catching_Breath (walks about 5 m), Happy_Sway_Standing, Idle_14, Idle_15, Idle_Step_Turn_Left, Idle_Turn_Left, Listening_Gesture, Stand_and_Chat, Confused_Scratch, Depressed_Full_Turn_Left, Motivational_Cheer.

How it was exported: Meshy downloads at most the 20 most recently added clips, and its default Running and Walking can't be removed, so clips were added to the character 18 at a time and each batch exported (Download → glb, Mixamo, All Added) as `assets-src/motions/batch_N.glb` (git-ignored). Then:
```bash
cd web && pnpm assets:motions   # batches -> public/models/motion-library.glb + .json
```
`scripts/assets/build-motion-library.mts` names Text to Motion clips by task id (`TEXT_TO_MOTION`), skips clips already in `player.glb` (`SKIP`), reports drift and compresses (resample, meshopt "high"). To move a clip into the site, add its preset to the character, re-export `meshy_rigged.glb`, and map it in `CLIP_NAMES`; or load the library on demand.

The hand bone is `mixamorig:RightHand` in the glTF, but three's GLTFLoader strips `:` from node names, so at runtime it's `mixamorigRightHand` (`HAND_BONE` in `scene-config.ts`).

Facts about the current model: 31,111 triangles, one 66-joint skin, 1.98 m tall with feet at y = 0, facing +z. The UV layout is heavily fragmented (auto-unwrapped islands packed edge to edge).

## 5. Step 4: jerseys (decided: approach B, shader tint)

Every team wears the **same white base uniform, recolored in the shader** (`web/components/scene/tint-material.ts`). The decision was made in Phase 6 after a spike on BOS and LAL that compared both approaches on the rigged model:
- Approach A (Meshy Retexture with a ChatGPT-edited reference, then composite the uniform pixels onto the base texture) worked. Meshy's web app keeps the original UVs, and A looked slightly more photographic. But it costs one image edit plus 10 Meshy credits per team and per alternate (about 40 runs), and its colors and lettering vary run to run.
- Approach B gives exact `teams.json` colors, identical lettering for every team, and alternates for free, with one 70 KB mask for all teams.

### How B works
1. `cd web && pnpm assets:mask` bakes `public/textures/player/uniform_mask.webp` (and `assets-src/masks/jersey_mask.png`) from the base texture and mesh, with no hand painting:
   - **R = uniform.** Whole triangles between the shorts hem and the collar (0.5 to 1.75 m) whose color isn't skin-saturated, smoothed with a majority filter over mesh neighbors, OR'd with a dilated per-pixel color mask so island borders are covered.
   - **G = trim.** Uniform texels above the waist within 2.8 cm of skin, at the collar or the armholes.
   - **B = side stripes.** Shorts texels on the outer side of each leg.
2. The shader tints R with `jersey.base` (above the waist, 1.06 m) or `jersey.shorts`, G and B with `jersey.trim`, keeping fabric shading from the base texture's brightness.
3. Lettering (chest text and number on the front, number on the back) is drawn on a canvas in Oswald and projected in **bind-pose space** (the vertex position before skinning), so it follows every animation. A drei `<Decal>` would not follow the skin.
4. The mask texture has **no mipmaps**: with islands packed edge to edge, mipmapping blends neighbors and leaves untinted seams.

On the site the players are drawn as **holograms** (DESIGN.md section 1): the same material with `hologram` set takes the brightness of the tinted uniform, skin and lettering and outputs it in the jersey's hologram color, unlit and additive. The tint still matters: it's what makes the lettering and trim visible inside the hologram.

`/dev/jerseys` (development only) shows any two teams, primary or alternate, with every clip, as holograms or with realistic shading, optionally pixelated. Add `?mask=1` to see the mask channels on the model.

### Alternates
`teams.json` defines `jersey.alt` colors. When two teams' primary jerseys clash (color distance too small, e.g. CHI vs HOU), the away team wears its alternate. With approach B this is just a different colorway.

## 6. Hoop, ball, environment
- **Hoop:** start with primitives in R3F: a pole (cylinder), a backboard (box with a transparent physical material and white border), a rim (torus, orange), and a net (open cone with a diamond line texture, alpha). It's cheaper and crisper than a generated mesh. Only use Meshy text-to-3D if it looks too plain:
  ```
  Basketball hoop on a single dark steel pole, rectangular clear glass backboard
  with a thin white border and white inner square, orange steel rim, white nylon
  net. No logos, no text. Clean game-asset style.
  ```
- **Ball:** `SphereGeometry(0.12, 48, 48)` with a canvas-generated orange texture with black seams, plus a slight bump.
- **Floor and HDRI:** CC0 only. Record the source and license in `web/public/CREDITS.md`.

## 7. Optimize for the web
`pnpm assets:player` does this (section 4). To check the result:
```bash
cd web && pnpm dlx @gltf-transform/cli@4.5.1 inspect public/models/player.glb
```
- meshopt over Draco: a smaller decoder, and good for animations. drei's `useGLTF` decodes it by default.
- When showing two players, clone with `SkeletonUtils.clone()` so each has its own skeleton and material (`web/components/scene/player.tsx`).

## 8. Final asset checklist
- [x] `player.glb` ≤ 4 MB, clips named per §4, in place, hand bone recorded
- [x] Jerseys for all 30 teams and alternates (approach B: shader tint from `teams.json`)
- [ ] Ball attaches to the hand and releases at `JUMPSHOT_RELEASE_TIME`
- [ ] Hoop visible at ~20 m and reads clearly at the end of the cinematic
- [ ] `CREDITS.md` lists all third-party CC0 assets
- [ ] No logos or official artwork anywhere
