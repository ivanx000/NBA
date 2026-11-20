"use client";

/**
 * The court, after a real NBA home court (DESIGN.md section 1): light maple boards; the lanes,
 * the apron all around and the center circle painted in the home team's primary color; white
 * lines with every marking (lane blocks and hash marks, the restricted-area arc, free-throw
 * circles dashed inside the lane, the three-point line, the coaching boxes and the substitution
 * box on the far side); the home city and nickname lettered along the baselines; the home team's
 * official logo at center court (the site's own crest, lib/crests.ts, if it can't be loaded) and
 * two smaller marks on the wings; and courtside a scorer's table and both benches.
 *
 * The floor is drawn on a canvas in meters (canvas x = world x, canvas y = world z, so text
 * reads from the home camera). The center mark has its own sharper canvas. Both are unlit (flat,
 * full color): a glossy, lit floor mirrored the room's light as a white glare and looked faded.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { crestFor } from "@/lib/crests";
import { contrast } from "@/lib/team-colors";

import { drawCrest } from "./crest-art";
import { rng } from "./points";

/** Court: length along x, width along z, centered on the players (they stand in the center circle). */
export const COURT = { halfLength: 14.33, halfWidth: 7.62 };
/** Apron around the court lines, in meters. */
export const APRON = 2;
/** The baskets: rim centers at x = ±BASKET_X, z = 0 (1.575 m in from each baseline). */
export const BASKET_X = COURT.halfLength - 1.575;

export interface CourtTeam {
  /** Primary, secondary and tertiary brand colors (paint, then the candidates for trim). */
  paint: string;
  trim: string;
  tertiary?: string;
  name: string;
  city: string;
  abbr: string;
}

/** Solid white, just under the bloom threshold so the lines stay crisp rather than glowing. */
const LINE = "#d6d9e0";
const LINE_W = 0.052; // 2 inches

const archivo = () => getComputedStyle(document.documentElement).getPropertyValue("--font-archivo").trim() || "sans-serif";

/**
 * The trim: whichever of the team's other colors stands out most against its paint (white stays
 * the soft line white, which doesn't bloom); the line white if neither stands out.
 */
function trimFor(team: CourtTeam) {
  const options = [team.trim, team.tertiary].filter((c): c is string => !!c);
  const best = options.sort((a, b) => contrast(b, team.paint) - contrast(a, team.paint))[0];
  if (!best || contrast(best, team.paint) < 1.8) return LINE;
  return new THREE.Color(best).getHSL({ h: 0, s: 0, l: 0 }).l > 0.9 ? LINE : best;
}

/** Maple boards: light, each board its own tone, with grain and joints. */
function maple(ctx: CanvasRenderingContext2D, x0: number, z0: number, w: number, h: number, ppm: number) {
  const random = rng(31);
  const board = 0.1;
  for (let z = z0; z < z0 + h; z += board) {
    let x = x0;
    while (x < x0 + w) {
      const len = 1.4 + random() * 2.6;
      ctx.fillStyle = `hsl(${29 + random() * 6} ${62 + random() * 10}% ${52 + random() * 7}%)`;
      ctx.fillRect(x, z, Math.min(len, x0 + w - x), board);
      // Grain: a few faint streaks along the board.
      ctx.fillStyle = "rgba(120,70,30,0.08)";
      for (let g = 0; g < 3; g++) ctx.fillRect(x, z + random() * board, Math.min(len, x0 + w - x), 1 / ppm);
      ctx.fillStyle = "rgba(80,45,20,0.28)";
      ctx.fillRect(x, z, 1 / ppm, board); // end joint
      x += len;
    }
    ctx.fillStyle = "rgba(80,45,20,0.2)";
    ctx.fillRect(x0, z, w, 1 / ppm);
  }
}

function stroke(ctx: CanvasRenderingContext2D, draw: () => void, dash: number[] = []) {
  ctx.setLineDash(dash);
  ctx.beginPath();
  draw();
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Text centered at (x, z), turned by ``angle`` (radians), fitted to ``maxW`` meters. */
function letter(ctx: CanvasRenderingContext2D, text: string, x: number, z: number, size: number, angle: number, maxW: number) {
  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(angle);
  ctx.font = `900 ${size}px ${archivo()}`;
  ctx.fillText(text, 0, 0, maxW);
  ctx.restore();
}

function courtTexture(team: CourtTeam, small: boolean): THREE.CanvasTexture {
  const { halfLength: L, halfWidth: W } = COURT;
  const AL = L + APRON;
  const AW = W + APRON;
  const ppm = small ? 34 : 64;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(2 * AL * ppm);
  canvas.height = Math.round(2 * AW * ppm);
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(ppm, ppm);
  const trim = trimFor(team);

  // Apron: the home color all round, flat and solid.
  ctx.fillStyle = team.paint;
  ctx.fillRect(-AL, -AW, 2 * AL, 2 * AW);

  maple(ctx, -L, -W, 2 * L, 2 * W, ppm);

  // Paint: both lanes and the center circle in the home color.
  ctx.fillStyle = team.paint;
  for (const s of [-1, 1]) ctx.fillRect(Math.min(s * L, s * (L - 5.8)), -2.44, 5.8, 4.88);
  ctx.beginPath();
  ctx.arc(0, 0, 1.83, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = LINE;
  ctx.fillStyle = LINE;
  ctx.lineWidth = LINE_W;
  ctx.lineCap = "butt";
  // Boundary, half-court line, center circles.
  ctx.strokeRect(-L, -W, 2 * L, 2 * W);
  stroke(ctx, () => (ctx.moveTo(0, -W), ctx.lineTo(0, W)));
  stroke(ctx, () => ctx.arc(0, 0, 1.83, 0, Math.PI * 2));
  stroke(ctx, () => ctx.arc(0, 0, 0.61, 0, Math.PI * 2));

  for (const s of [-1, 1]) {
    const base = s * L;
    const ft = s * (L - 5.8);
    const basket = s * BASKET_X;
    // The lane.
    ctx.strokeRect(Math.min(base, ft), -2.44, 5.8, 4.88);
    // Lane marks, measured from the baseline along both lane lines: the block, then hash marks.
    for (const side of [-1, 1]) {
      const z = side * 2.44;
      const out = side * 0.15;
      ctx.fillRect(base - s * 2.13 - (s > 0 ? 0.3 : 0), z + (side > 0 ? 0 : -0.15), 0.3, 0.15); // the block
      for (const d of [3.0, 3.96, 4.88]) {
        const x = base - s * d;
        ctx.fillRect(x - LINE_W / 2, z + (side > 0 ? 0 : out), LINE_W, 0.15);
      }
    }
    // Free-throw circle: solid outside the lane, dashed inside.
    const a0 = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    stroke(ctx, () => ctx.arc(ft, 0, 1.83, a0, a0 + Math.PI));
    stroke(ctx, () => ctx.arc(ft, 0, 1.83, a0 + Math.PI, a0 + 2 * Math.PI), [0.38, 0.3]);
    // Restricted area: a 1.22 m arc round the basket with short straight ends toward the baseline.
    // From the +z side round through the court side of the basket to the -z side.
    stroke(ctx, () => {
      ctx.moveTo(basket + s * 0.38, 1.22);
      ctx.lineTo(basket, 1.22);
      ctx.arc(basket, 0, 1.22, Math.PI / 2, s > 0 ? Math.PI * 1.5 : -Math.PI / 2, s < 0);
      ctx.lineTo(basket + s * 0.38, -1.22);
    });
    // Three-point line: straight in the corners, then the arc.
    const corner = 6.71;
    const reach = Math.sqrt(7.24 ** 2 - corner ** 2);
    stroke(ctx, () => {
      ctx.moveTo(base, -corner);
      ctx.lineTo(basket - s * reach, -corner);
      ctx.arc(basket, 0, 7.24, Math.atan2(-corner, -s * reach), Math.atan2(corner, -s * reach), s > 0);
      ctx.lineTo(base, corner);
    });
    // Coaching boxes: 28 ft from each baseline, out into the apron on both sidelines.
    for (const side of [-1, 1]) {
      const x = base - s * 8.53;
      stroke(ctx, () => (ctx.moveTo(x, side * W), ctx.lineTo(x, side * (W + 0.9))));
    }
    // Substitution box on the far (scorer's) side, 1.22 m either side of half court.
    stroke(ctx, () => (ctx.moveTo(s * 1.22, -W), ctx.lineTo(s * 1.22, -W - 1.22)));
  }

  // Lettering on the apron: the city along one baseline, the nickname along the other (reading
  // from the court), and the name along the far sideline.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LINE;
  const city = (team.city || team.name).toUpperCase();
  const name = team.name.toUpperCase();
  letter(ctx, city, -L - APRON / 2, 0, 1.0, -Math.PI / 2, 2 * W - 1);
  letter(ctx, name, L + APRON / 2, 0, 1.0, Math.PI / 2, 2 * W - 1);
  ctx.fillStyle = trim;
  letter(ctx, name.split("").join(" "), -L / 2, -W - APRON / 2, 0.85, 0, L - 2);
  letter(ctx, name.split("").join(" "), L / 2, -W - APRON / 2, 0.85, 0, L - 2);

  // Wing marks: the team's abbreviation in a ring, between the center circle and each arc.
  for (const s of [-1, 1]) {
    const x = s * 3.75;
    ctx.fillStyle = team.paint;
    ctx.beginPath();
    ctx.arc(x, 0, 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 0.07;
    stroke(ctx, () => ctx.arc(x, 0, 0.56, 0, Math.PI * 2));
    ctx.fillStyle = LINE;
    letter(ctx, team.abbr, x, 0.03, 0.42, 0, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Center court: the home team's official logo (web/public/logos, from NBA.com), drawn onto a
 * transparent canvas once it loads; the site's own crest (lib/crests.ts) if it can't be loaded.
 * The logo's whites are toned to the court's soft line white, so they don't bloom.
 */
function centerTexture(team: CourtTeam): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (!team.abbr) return tex; // the blank court before a game is chosen
  const crest = () => {
    ctx.clearRect(0, 0, size, size);
    drawCrest(ctx, size, crestFor(team.abbr), { field: team.paint, accent: trimFor(team), ink: LINE }, {
      city: team.city,
      name: team.name,
      abbr: team.abbr,
      font: archivo(),
    });
    tex.needsUpdate = true;
  };
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    const pad = size * 0.04;
    const draw = () => ctx.drawImage(img, pad, pad, size - 2 * pad, size - 2 * pad);
    ctx.clearRect(0, 0, size, size);
    draw();
    // Tone the whites down to the line white, then cut back to the logo's own shape.
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = LINE;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "destination-in";
    draw();
    ctx.globalCompositeOperation = "source-over";
    tex.needsUpdate = true;
  };
  img.onerror = crest;
  img.src = `/logos/${team.abbr}.svg`;
  return tex;
}

/** An LED strip along the scorer's table: the home nickname on its color. */
function tableTexture(team: CourtTeam): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = team.paint;
  ctx.fillRect(0, 0, 1024, 96);
  ctx.fillStyle = LINE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 58px ${archivo()}`;
  ctx.fillText(`${(team.city || "").toUpperCase()}  ${team.name.toUpperCase()}`, 512, 50, 980);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  for (let x = 0; x < 1024; x += 4) ctx.fillRect(x, 0, 1, 96);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Courtside on the far side: the scorer's table at half court and a bench of chairs for each team. */
function Courtside({ team }: { team: CourtTeam }) {
  const led = useMemo(() => tableTexture(team), [team]);
  useEffect(() => () => led.dispose(), [led]);
  const z = -COURT.halfWidth - 1.15;
  const chairs: [number, number][] = [];
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) chairs.push([s * (3.4 + i * 0.62), z - 0.2]);
  return (
    <group>
      {/* Scorer's table: dark body, a lit strip along its front. */}
      <mesh position={[0, 0.38, z]}>
        <boxGeometry args={[5.6, 0.76, 0.7]} />
        <meshStandardMaterial color="#10141f" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.42, z + 0.356]}>
        <planeGeometry args={[5.4, 0.5]} />
        <meshBasicMaterial map={led} color={[0.75, 0.75, 0.75]} toneMapped={false} />
      </mesh>
      {chairs.map(([x, cz], i) => (
        <group key={i} position={[x, 0, cz]}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.5, 0.08, 0.48]} />
            <meshStandardMaterial color="#1a1f2c" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.72, -0.22]}>
            <boxGeometry args={[0.46, 0.5, 0.06]} />
            <meshStandardMaterial color="#141925" roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Court({ team, small }: { team: CourtTeam; small: boolean }) {
  const map = useMemo(() => courtTexture(team, small), [team, small]);
  const center = useMemo(() => centerTexture(team), [team]);
  useEffect(() => () => void (map.dispose(), center.dispose()), [map, center]);
  return (
    <group>
      {/* Unlit: the floor shows its paint exactly, bold and solid, with no glare or reflection
          washing it out, and no fog fading the far end. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2 * (COURT.halfLength + APRON), 2 * (COURT.halfWidth + APRON)]} />
        <meshBasicMaterial map={map} fog={false} />
      </mesh>
      {/* The home team's logo, sharper than the floor's own texture, over the center circle. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <planeGeometry args={[3.5, 3.5]} />
        <meshBasicMaterial map={center} transparent depthWrite={false} fog={false} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      {/* The players' shadows land on this: an invisible layer over center court that only darkens
          where a shadow falls (the painted floor itself is unlit). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} receiveShadow renderOrder={1}>
        <planeGeometry args={[12, 9]} />
        <shadowMaterial transparent opacity={0.5} fog={false} depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
      </mesh>
      {/* The floor beyond the apron, under the stands. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.003, 0]}>
        <planeGeometry args={[140, 90]} />
        <meshStandardMaterial color="#060912" roughness={0.7} />
      </mesh>
      <Courtside team={team} />
    </group>
  );
}
