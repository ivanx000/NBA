# 3D asset pipeline: Tip-Off

How the player, jerseys, hoop and environment get made, from ChatGPT images through Meshy and Blender to optimized files in `web/public/`.

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
| Clip name in GLB | Source | Meshy library id | Used for |
|---|---|---|---|
| `Idle` | Library | 0 `Idle` | Home idle |
| `Idle_02`, `Idle_03` | Library | 11, 12 | Idle variety |
| `Idle_Look` | Library | 338 `Short_Breathe_and_Look_Around` | Idle variety / loser |
| `Celebrate` | Library | 403 `Victory_Fist_Pump` | After the make |
| `Celebrate_Alt` | Library | 412 `victory` or 298 `Cheer_with_Both_Hands_Up` | Variety |
| `JumpShot` | **Text to Motion** (see below) | — | The shot |

Library IDs come from Meshy's Animation Library reference. Re-check the names in the app before using them.

**The library has no basketball shot.** Make one with Meshy **Text to Motion**, then apply it to the rig (the Animation API accepts a `motion_task_id`). Prompt:
```
A basketball player performs a jump shot in place. Starts in a balanced stance
holding a ball at chest height with both hands. Dips the knees, then jumps
straight up while raising the ball above the forehead, right hand under the
ball and left hand on its side. Releases the ball at the peak of the jump with
a wrist flick, holds the follow-through with the right arm extended up toward
the hoop, then lands softly in place and relaxes.
```
Generate 3 to 4 variants and keep the cleanest. **Note the release frame** (the frame where the hand flicks). It goes in `web/lib/scene-config.ts` as `JUMPSHOT_RELEASE_TIME` (seconds).

Fallback if the Text to Motion result looks bad: browse Adobe Mixamo for a basketball shooting clip. Upload the base model there for an auto-rig, download the clip "without skin", and retarget it in Blender. This costs more time, so try Meshy first.

### Export
Export the rigged character with **all clips in one GLB** (the Meshy web app supports exporting all of a character's animations as a single file) → `assets-src/base/meshy_rigged.glb`. Then in Blender, if needed:
- Rename clips to the names in the table above
- Make sure the clips are **in place** (no root motion drift). The cinematic moves the character in code.
- Find the **right-hand bone name** (e.g. `RightHand` or `mixamorig:RightHand`) and put it in `scene-config.ts` as `HAND_BONE`. The ball attaches there.

## 5. Step 4: jerseys (texture swap)

### Approach A (try first): Meshy Retexture with original UVs
1. **ChatGPT image edit.** Upload `base_front.png` and use the per-team prompt from `assets-src/prompts/jersey_prompts.md` (generated from `shared/teams.json`). The prompt keeps the same person and pose and changes only the uniform.
2. **Meshy Retexture** (`POST /openapi/v1/retexture`) on the **unrigged** base model, with:
   - `image_style_url`: the team image
   - `enable_original_uv: true` (critical: the texture must line up with the rigged model's UVs)
   - `enable_pbr: true`
3. Download the base color texture → `assets-src/jerseys/{ABBR}/basecolor_raw.png`.
4. **Composite with a jersey mask** (`scripts/assets/composite_jersey.py`, written in Phase 6). Paint `assets-src/masks/jersey_mask.png` once in Blender's texture paint mode: white over the jersey and shorts, black elsewhere. The script takes the jersey pixels from the team texture and everything else (skin, face, shoes) from the base texture. That keeps every team's player looking like the **same person**, because retexturing repaints the face slightly differently each time.
5. Export as WebP 1024² → `web/public/textures/jerseys/{ABBR}/basecolor.webp`.

**Run a spike before doing all 30:** do BOS and LAL first. Load both on the rigged model in the browser. If the UVs line up and the composite looks good, automate the rest with `scripts/assets/meshy_pipeline.py` (uses `MESHY_API_KEY`; API access may need a paid Meshy plan, and the web app works too).

### Approach B (fallback, or later upgrade): tint shader + decals
If retexture alignment is unreliable:
1. In Blender, paint a **channel mask** texture: R = jersey body, G = trim (collar, armholes, side stripes), B = shorts.
2. In three.js, patch the player material (`onBeforeCompile`) to tint the masked regions with the team's `jersey.base`, `jersey.trim` and `jersey.shorts` colors from `teams.json`, keeping the fabric shading from the original texture's luminance.
3. Put the chest lettering and number on with drei `<Decal>`, using a texture drawn at runtime on a `<canvas>` (team text + number in the team's text color).

Pros: every team and alternate color for free, tiny downloads, perfectly consistent. Cons: looks less "photographic" than A.

### Alternates
`teams.json` defines `jersey.alt` colors. When two teams' primary jerseys clash (color distance too small, e.g. CHI vs HOU), the away team wears its alternate. With approach A this means generating an extra texture per team that needs one. With approach B it's free.

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
```bash
# from repo root
npx @gltf-transform/cli optimize assets-src/base/meshy_rigged.glb web/public/models/player.glb \
  --compress meshopt --texture-compress webp --texture-size 1024

npx @gltf-transform/cli inspect web/public/models/player.glb   # check size, clips, textures

# typed R3F component scaffold
cd web && npx gltfjsx public/models/player.glb --types --output components/scene/PlayerModel.tsx
```
- Prefer meshopt (smaller decoder than Draco, and good for animations).
- For texture swaps, load with `useTexture`. Set `flipY = false` and `colorSpace = SRGBColorSpace` to match glTF conventions.
- When showing two players, use `SkeletonUtils.clone()` (via drei `useGLTF` + `useMemo`) so each has its own skeleton and its own material instance (so each can have its own jersey).

## 8. Final asset checklist
- [ ] `player.glb` ≤ 4 MB, clips named per §4, in place, hand bone recorded
- [ ] 30 jersey textures (plus needed alternates), consistent face and skin across all
- [ ] Ball attaches to the hand and releases at `JUMPSHOT_RELEASE_TIME`
- [ ] Hoop visible at ~20 m and reads clearly at the end of the cinematic
- [ ] `CREDITS.md` lists all third-party CC0 assets
- [ ] No logos or official artwork anywhere
