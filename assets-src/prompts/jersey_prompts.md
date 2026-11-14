# Jersey image-edit prompts (ChatGPT)

Generated from `shared/teams.json`. For each team: open a chat, **upload `assets-src/base/base_front.png`**, paste the prompt, and save the result as `assets-src/jerseys/{ABBR}/ref.png`. Then follow `docs/ASSET_PIPELINE.md §5`.

Tips:
- Always edit the *same* base image. Never generate from scratch, because the person and pose must stay identical.
- If the model invents a logo or emblem, reply: *"Remove any logo or emblem; keep only the plain block lettering and number."*
- Hex codes are included because image models follow them roughly. Check the colors by eye and re-prompt if they're off.

## Shared template

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: {BASE} sleeveless basketball jersey with {TRIM} trim on the collar and armholes.
- Across the chest: the word "{TEXT}" in simple bold athletic block letters, color {LETTER},
  with the number "{NUM}" centered below it in the same style.
- Shorts: {SHORTS} basketball shorts with a {TRIM} stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## ATL: Atlanta Hawks

**Primary** → save as `assets-src/jerseys/ATL/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #E03A3E sleeveless basketball jersey with #C1D32F trim on the collar and armholes.
- Across the chest: the word "HAWKS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #E03A3E basketball shorts with a #C1D32F stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/ATL/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #E03A3E trim on the collar and armholes.
- Across the chest: the word "HAWKS" in simple bold athletic block letters, color #E03A3E,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #E03A3E stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## BOS: Boston Celtics

**Primary** → save as `assets-src/jerseys/BOS/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #007A33 sleeveless basketball jersey with #FFFFFF trim on the collar and armholes.
- Across the chest: the word "CELTICS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #007A33 basketball shorts with a #FFFFFF stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/BOS/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #007A33 trim on the collar and armholes.
- Across the chest: the word "CELTICS" in simple bold athletic block letters, color #007A33,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #007A33 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## BKN: Brooklyn Nets

**Primary** → save as `assets-src/jerseys/BKN/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #000000 sleeveless basketball jersey with #FFFFFF trim on the collar and armholes.
- Across the chest: the word "NETS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #000000 basketball shorts with a #FFFFFF stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/BKN/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #000000 trim on the collar and armholes.
- Across the chest: the word "NETS" in simple bold athletic block letters, color #000000,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #000000 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## CHA: Charlotte Hornets

**Primary** → save as `assets-src/jerseys/CHA/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #00788C sleeveless basketball jersey with #1D1160 trim on the collar and armholes.
- Across the chest: the word "HORNETS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #00788C basketball shorts with a #1D1160 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/CHA/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #00788C trim on the collar and armholes.
- Across the chest: the word "HORNETS" in simple bold athletic block letters, color #1D1160,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #00788C stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## CHI: Chicago Bulls

**Primary** → save as `assets-src/jerseys/CHI/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #CE1141 sleeveless basketball jersey with #000000 trim on the collar and armholes.
- Across the chest: the word "BULLS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #CE1141 basketball shorts with a #000000 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/CHI/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #CE1141 trim on the collar and armholes.
- Across the chest: the word "BULLS" in simple bold athletic block letters, color #CE1141,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #CE1141 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## CLE: Cleveland Cavaliers

**Primary** → save as `assets-src/jerseys/CLE/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #860038 sleeveless basketball jersey with #FDBB30 trim on the collar and armholes.
- Across the chest: the word "CAVALIERS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #860038 basketball shorts with a #FDBB30 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/CLE/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #860038 trim on the collar and armholes.
- Across the chest: the word "CAVALIERS" in simple bold athletic block letters, color #860038,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #860038 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## DAL: Dallas Mavericks

**Primary** → save as `assets-src/jerseys/DAL/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #00538C sleeveless basketball jersey with #B8C4CA trim on the collar and armholes.
- Across the chest: the word "MAVERICKS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #00538C basketball shorts with a #B8C4CA stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/DAL/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #00538C trim on the collar and armholes.
- Across the chest: the word "MAVERICKS" in simple bold athletic block letters, color #00538C,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #00538C stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## DEN: Denver Nuggets

**Primary** → save as `assets-src/jerseys/DEN/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #0E2240 sleeveless basketball jersey with #FEC524 trim on the collar and armholes.
- Across the chest: the word "NUGGETS" in simple bold athletic block letters, color #FEC524,
  with the number "26" centered below it in the same style.
- Shorts: #0E2240 basketball shorts with a #FEC524 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/DEN/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #0E2240 trim on the collar and armholes.
- Across the chest: the word "NUGGETS" in simple bold athletic block letters, color #0E2240,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #0E2240 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## DET: Detroit Pistons

**Primary** → save as `assets-src/jerseys/DET/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #C8102E sleeveless basketball jersey with #1D42BA trim on the collar and armholes.
- Across the chest: the word "PISTONS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #C8102E basketball shorts with a #1D42BA stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/DET/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #1D42BA trim on the collar and armholes.
- Across the chest: the word "PISTONS" in simple bold athletic block letters, color #C8102E,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #1D42BA stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## GSW: Golden State Warriors

**Primary** → save as `assets-src/jerseys/GSW/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #1D428A sleeveless basketball jersey with #FFC72C trim on the collar and armholes.
- Across the chest: the word "WARRIORS" in simple bold athletic block letters, color #FFC72C,
  with the number "26" centered below it in the same style.
- Shorts: #1D428A basketball shorts with a #FFC72C stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/GSW/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #1D428A trim on the collar and armholes.
- Across the chest: the word "WARRIORS" in simple bold athletic block letters, color #1D428A,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #1D428A stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## HOU: Houston Rockets

**Primary** → save as `assets-src/jerseys/HOU/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #CE1141 sleeveless basketball jersey with #000000 trim on the collar and armholes.
- Across the chest: the word "ROCKETS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #CE1141 basketball shorts with a #000000 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/HOU/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #CE1141 trim on the collar and armholes.
- Across the chest: the word "ROCKETS" in simple bold athletic block letters, color #CE1141,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #CE1141 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## IND: Indiana Pacers

**Primary** → save as `assets-src/jerseys/IND/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #002D62 sleeveless basketball jersey with #FDBB30 trim on the collar and armholes.
- Across the chest: the word "PACERS" in simple bold athletic block letters, color #FDBB30,
  with the number "26" centered below it in the same style.
- Shorts: #002D62 basketball shorts with a #FDBB30 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/IND/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #002D62 trim on the collar and armholes.
- Across the chest: the word "PACERS" in simple bold athletic block letters, color #002D62,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #002D62 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## LAC: Los Angeles Clippers

**Primary** → save as `assets-src/jerseys/LAC/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #1D428A sleeveless basketball jersey with #C8102E trim on the collar and armholes.
- Across the chest: the word "CLIPPERS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #1D428A basketball shorts with a #C8102E stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/LAC/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #1D428A trim on the collar and armholes.
- Across the chest: the word "CLIPPERS" in simple bold athletic block letters, color #C8102E,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #1D428A stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## LAL: Los Angeles Lakers

**Primary** → save as `assets-src/jerseys/LAL/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FDB927 sleeveless basketball jersey with #552583 trim on the collar and armholes.
- Across the chest: the word "LAKERS" in simple bold athletic block letters, color #552583,
  with the number "26" centered below it in the same style.
- Shorts: #FDB927 basketball shorts with a #552583 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/LAL/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #552583 sleeveless basketball jersey with #FDB927 trim on the collar and armholes.
- Across the chest: the word "LAKERS" in simple bold athletic block letters, color #FDB927,
  with the number "26" centered below it in the same style.
- Shorts: #552583 basketball shorts with a #FDB927 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## MEM: Memphis Grizzlies

**Primary** → save as `assets-src/jerseys/MEM/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #12173F sleeveless basketball jersey with #5D76A9 trim on the collar and armholes.
- Across the chest: the word "GRIZZLIES" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #12173F basketball shorts with a #5D76A9 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/MEM/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #12173F trim on the collar and armholes.
- Across the chest: the word "GRIZZLIES" in simple bold athletic block letters, color #12173F,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #12173F stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## MIA: Miami Heat

**Primary** → save as `assets-src/jerseys/MIA/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #000000 sleeveless basketball jersey with #98002E trim on the collar and armholes.
- Across the chest: the word "HEAT" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #000000 basketball shorts with a #98002E stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/MIA/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #98002E trim on the collar and armholes.
- Across the chest: the word "HEAT" in simple bold athletic block letters, color #000000,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #98002E stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## MIL: Milwaukee Bucks

**Primary** → save as `assets-src/jerseys/MIL/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #00471B sleeveless basketball jersey with #EEE1C6 trim on the collar and armholes.
- Across the chest: the word "BUCKS" in simple bold athletic block letters, color #EEE1C6,
  with the number "26" centered below it in the same style.
- Shorts: #00471B basketball shorts with a #EEE1C6 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/MIL/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #EEE1C6 sleeveless basketball jersey with #00471B trim on the collar and armholes.
- Across the chest: the word "BUCKS" in simple bold athletic block letters, color #00471B,
  with the number "26" centered below it in the same style.
- Shorts: #EEE1C6 basketball shorts with a #00471B stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## MIN: Minnesota Timberwolves

**Primary** → save as `assets-src/jerseys/MIN/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #0C2340 sleeveless basketball jersey with #78BE20 trim on the collar and armholes.
- Across the chest: the word "TIMBERWOLVES" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #0C2340 basketball shorts with a #78BE20 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/MIN/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #0C2340 trim on the collar and armholes.
- Across the chest: the word "TIMBERWOLVES" in simple bold athletic block letters, color #236192,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #0C2340 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## NOP: New Orleans Pelicans

**Primary** → save as `assets-src/jerseys/NOP/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #0C2340 sleeveless basketball jersey with #C8102E trim on the collar and armholes.
- Across the chest: the word "PELICANS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #0C2340 basketball shorts with a #C8102E stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/NOP/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #0C2340 trim on the collar and armholes.
- Across the chest: the word "PELICANS" in simple bold athletic block letters, color #0C2340,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #0C2340 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## NYK: New York Knicks

**Primary** → save as `assets-src/jerseys/NYK/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #006BB6 sleeveless basketball jersey with #F58426 trim on the collar and armholes.
- Across the chest: the word "KNICKS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #006BB6 basketball shorts with a #F58426 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/NYK/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #006BB6 trim on the collar and armholes.
- Across the chest: the word "KNICKS" in simple bold athletic block letters, color #006BB6,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #006BB6 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## OKC: Oklahoma City Thunder

**Primary** → save as `assets-src/jerseys/OKC/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #007AC1 sleeveless basketball jersey with #EF3B24 trim on the collar and armholes.
- Across the chest: the word "THUNDER" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #007AC1 basketball shorts with a #EF3B24 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/OKC/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #007AC1 trim on the collar and armholes.
- Across the chest: the word "THUNDER" in simple bold athletic block letters, color #002D62,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #007AC1 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## ORL: Orlando Magic

**Primary** → save as `assets-src/jerseys/ORL/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #0077C0 sleeveless basketball jersey with #000000 trim on the collar and armholes.
- Across the chest: the word "MAGIC" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #0077C0 basketball shorts with a #000000 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/ORL/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #0077C0 trim on the collar and armholes.
- Across the chest: the word "MAGIC" in simple bold athletic block letters, color #000000,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #0077C0 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## PHI: Philadelphia 76ers

**Primary** → save as `assets-src/jerseys/PHI/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #006BB6 sleeveless basketball jersey with #ED174C trim on the collar and armholes.
- Across the chest: the word "76ERS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #006BB6 basketball shorts with a #ED174C stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/PHI/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #006BB6 trim on the collar and armholes.
- Across the chest: the word "76ERS" in simple bold athletic block letters, color #006BB6,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #006BB6 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## PHX: Phoenix Suns

**Primary** → save as `assets-src/jerseys/PHX/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #1D1160 sleeveless basketball jersey with #E56020 trim on the collar and armholes.
- Across the chest: the word "SUNS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #1D1160 basketball shorts with a #E56020 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/PHX/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #E56020 trim on the collar and armholes.
- Across the chest: the word "SUNS" in simple bold athletic block letters, color #1D1160,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #E56020 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## POR: Portland Trail Blazers

**Primary** → save as `assets-src/jerseys/POR/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #000000 sleeveless basketball jersey with #E03A3E trim on the collar and armholes.
- Across the chest: the word "TRAIL BLAZERS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #000000 basketball shorts with a #E03A3E stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/POR/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #E03A3E trim on the collar and armholes.
- Across the chest: the word "TRAIL BLAZERS" in simple bold athletic block letters, color #000000,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #E03A3E stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## SAC: Sacramento Kings

**Primary** → save as `assets-src/jerseys/SAC/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #5A2D81 sleeveless basketball jersey with #63727A trim on the collar and armholes.
- Across the chest: the word "KINGS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #5A2D81 basketball shorts with a #63727A stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/SAC/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #5A2D81 trim on the collar and armholes.
- Across the chest: the word "KINGS" in simple bold athletic block letters, color #5A2D81,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #5A2D81 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## SAS: San Antonio Spurs

**Primary** → save as `assets-src/jerseys/SAS/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #000000 sleeveless basketball jersey with #C4CED4 trim on the collar and armholes.
- Across the chest: the word "SPURS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #000000 basketball shorts with a #C4CED4 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/SAS/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #000000 trim on the collar and armholes.
- Across the chest: the word "SPURS" in simple bold athletic block letters, color #000000,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #000000 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## TOR: Toronto Raptors

**Primary** → save as `assets-src/jerseys/TOR/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #CE1141 sleeveless basketball jersey with #000000 trim on the collar and armholes.
- Across the chest: the word "RAPTORS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #CE1141 basketball shorts with a #000000 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/TOR/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #CE1141 trim on the collar and armholes.
- Across the chest: the word "RAPTORS" in simple bold athletic block letters, color #000000,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #CE1141 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## UTA: Utah Jazz

**Primary** → save as `assets-src/jerseys/UTA/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #5B2B82 sleeveless basketball jersey with #6CAEDF trim on the collar and armholes.
- Across the chest: the word "JAZZ" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #5B2B82 basketball shorts with a #6CAEDF stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/UTA/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #5B2B82 trim on the collar and armholes.
- Across the chest: the word "JAZZ" in simple bold athletic block letters, color #5B2B82,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #5B2B82 stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

## WAS: Washington Wizards

**Primary** → save as `assets-src/jerseys/WAS/ref.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #E31837 sleeveless basketball jersey with #002B5C trim on the collar and armholes.
- Across the chest: the word "WIZARDS" in simple bold athletic block letters, color #FFFFFF,
  with the number "26" centered below it in the same style.
- Shorts: #E31837 basketball shorts with a #002B5C stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```

**Alternate** → save as `assets-src/jerseys/WAS/ref_alt.png`

```
Edit this image. Keep the exact same person, face, body, A-pose, framing, lighting,
sneakers and background. Change only the jersey and shorts:
- Jersey: #FFFFFF sleeveless basketball jersey with #002B5C trim on the collar and armholes.
- Across the chest: the word "WIZARDS" in simple bold athletic block letters, color #E31837,
  with the number "26" centered below it in the same style.
- Shorts: #FFFFFF basketball shorts with a #002B5C stripe down each side.
Realistic athletic mesh fabric with natural folds. No logos, no emblems, no
sponsor patches, no other text.
```
