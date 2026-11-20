"use client";

/**
 * The background: a basketball arena on game night (DESIGN.md section 1). The two players stand
 * in the center circle of a dark hardwood court painted in the home team's color. Around them a
 * seating bowl full of faint lights in both teams' colors (the away team's fans on the left, the
 * home team's on the right), LED ribbon boards scrolling the matchup, a center-hung scoreboard,
 * searchlights sweeping the rafters and a colored haze behind it all.
 *
 * It reacts to the visitor: the searchlights lean toward the pointer, and hovering a player lights
 * up his team's side of the crowd and puts his team on the scoreboard.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { useScene } from "@/lib/scene-store";
import type { Side } from "@/lib/slate";

import { flashMaterial, geometryFrom, pointsMaterial, rng, tickPoints } from "./points";

/** Arena floor: the players stand on it (feet at y = 0). */
export const FLOOR_Y = 0;
/** Court: length along x, width along z, centered on the players (they stand in the center circle). */
const COURT = { halfLength: 14.33, halfWidth: 7.62 };
/** Apron around the court lines, in meters. */
const APRON = 2;

/** One team as the room shows it. */
export interface ArenaTeam {
  /** Glow color, readable on black. */
  glow: string;
  /** The team's primary brand color (the court's paint). */
  paint: string;
  name: string;
  city: string;
}
export interface ArenaTeams {
  away: ArenaTeam;
  home: ArenaTeam;
}

/** The room before a game is chosen (no games today). */
const NEUTRAL: ArenaTeams = {
  away: { glow: "#5b8cff", paint: "#1d428a", name: "Tip-Off", city: "" },
  home: { glow: "#ff4d5e", paint: "#c8102e", name: "Tip-Off", city: "" },
};

type Pts = { pos: number[]; col: number[]; size: number[] };
const pts = (): Pts => ({ pos: [], col: [], size: [] });

/** Mixes the two teams' colors across the room: away on the left, home on the right. */
function sideColor(teams: ArenaTeams, x: number, span: number) {
  const t = THREE.MathUtils.smoothstep(x, -span * 0.35, span * 0.35);
  return new THREE.Color(teams.away.glow).lerp(new THREE.Color(teams.home.glow), t);
}

/* --- The court --------------------------------------------------------------------------- */

/** Draws the hardwood, the paint and the lines onto a canvas, in meters (y on the canvas is world z). */
function courtTexture(teams: ArenaTeams, small: boolean): THREE.CanvasTexture {
  const L = COURT.halfLength + APRON;
  const W = COURT.halfWidth + APRON;
  const ppm = small ? 34 : 62; // pixels per meter
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(2 * L * ppm);
  canvas.height = Math.round(2 * W * ppm);
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(ppm, ppm);
  const random = rng(31);
  const { halfLength: cl, halfWidth: cw } = COURT;

  // Apron: the home team's color, stained dark.
  const apron = new THREE.Color(teams.home.paint).lerp(new THREE.Color("#05070d"), 0.62);
  ctx.fillStyle = `#${apron.getHexString()}`;
  ctx.fillRect(-L, -W, 2 * L, 2 * W);

  // Hardwood: boards running the length of the court, each a slightly different tone.
  const board = 0.16;
  for (let z = -cw; z < cw; z += board) {
    let x = -cl;
    while (x < cl) {
      const len = 1.2 + random() * 2.6;
      const light = 20 + random() * 7;
      ctx.fillStyle = `hsl(${24 + random() * 6} 46% ${light}%)`;
      ctx.fillRect(x, z, Math.min(len, cl - x), board);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x, z, 0.012, board); // the board's end joint
      x += len;
    }
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(-cl, z, 2 * cl, 0.01);
  }
  // A soft sheen toward the center, where the lights point.
  const sheen = ctx.createRadialGradient(0, 0, 0, 0, 0, cl);
  sheen.addColorStop(0, "rgba(255,214,170,0.16)");
  sheen.addColorStop(1, "rgba(255,214,170,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-cl, -cw, 2 * cl, 2 * cw);

  const paint = teams.home.paint;
  // The keys, in the home team's color.
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = paint;
  for (const s of [-1, 1]) {
    const ft = s * (cl - 5.8);
    ctx.fillRect(Math.min(s * cl, ft), -2.44, 5.8, 4.88);
  }
  // Center circle: both teams' colors meeting at the tip-off.
  const center = ctx.createLinearGradient(-1.83, 0, 1.83, 0);
  center.addColorStop(0, teams.away.paint);
  center.addColorStop(0.5, "rgba(10,14,28,0.9)");
  center.addColorStop(1, teams.home.paint);
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(0, 0, 1.83, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Lines.
  ctx.strokeStyle = "rgba(244,246,252,0.92)";
  ctx.lineWidth = 0.055;
  ctx.strokeRect(-cl, -cw, 2 * cl, 2 * cw);
  ctx.beginPath();
  ctx.moveTo(0, -cw);
  ctx.lineTo(0, cw);
  ctx.stroke();
  for (const r of [1.83, 0.61]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const s of [-1, 1]) {
    const ft = s * (cl - 5.8);
    ctx.strokeRect(Math.min(s * cl, ft), -2.44, 5.8, 4.88);
    ctx.beginPath();
    ctx.arc(ft, 0, 1.83, 0, Math.PI * 2);
    ctx.stroke();
    // Three-point line: corners, then the arc around the basket.
    const basket = s * (cl - 1.575);
    const corner = 6.71;
    const reach = Math.sqrt(7.24 ** 2 - corner ** 2);
    ctx.beginPath();
    ctx.moveTo(s * cl, -corner);
    ctx.lineTo(basket - s * reach, -corner);
    const a = Math.atan2(-corner, -s * reach);
    const b = Math.atan2(corner, -s * reach);
    ctx.arc(basket, 0, 7.24, a, b, s > 0);
    ctx.lineTo(s * cl, corner);
    ctx.stroke();
  }

  // The site's name in the center circle and the home team's name on the far apron.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(244,246,252,0.8)";
  ctx.font = `800 0.3px ${getComputedStyle(document.documentElement).getPropertyValue("--font-archivo") || "sans-serif"}`;
  ctx.fillText("TIP-OFF", 0, 0);
  const home = teams.home.name.toUpperCase();
  ctx.font = `800 1.25px ${getComputedStyle(document.documentElement).getPropertyValue("--font-archivo") || "sans-serif"}`;
  ctx.fillStyle = teams.home.glow;
  ctx.globalAlpha = 0.75;
  ctx.fillText(home.split("").join(" "), 0, -cw - APRON / 2);
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function Court({ teams, small }: { teams: ArenaTeams; small: boolean }) {
  const map = useMemo(() => courtTexture(teams, small), [teams, small]);
  useEffect(() => () => map.dispose(), [map]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]}>
        <planeGeometry args={[2 * (COURT.halfLength + APRON), 2 * (COURT.halfWidth + APRON)]} />
        <meshStandardMaterial map={map} roughness={0.42} metalness={0.05} envMapIntensity={0.9} />
      </mesh>
      {/* The floor beyond the court, under the stands. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.003, 0]}>
        <planeGeometry args={[140, 90]} />
        <meshStandardMaterial color="#060912" roughness={0.7} />
      </mesh>
    </group>
  );
}

/* --- The seating bowl ---------------------------------------------------------------------- */

const ROWS = 22;
const rowY = (row: number) => FLOOR_Y + 0.6 + row * 0.55;
/** How far behind the court's edge (apron included) a row sits. */
const rowOut = (row: number) => 0.6 + row * 0.85;
const FAR = -COURT.halfWidth - APRON;
const END = COURT.halfLength + APRON;

/** Front and back edges of the far stands' slope (y up, z back). */
const BOWL = { y0: FLOOR_Y + 0.25, z0: FAR - 0.45, y1: rowY(ROWS - 1) + 0.3, z1: FAR - rowOut(ROWS - 1) - 0.45 };
const SKIN = ["#3b2416", "#5a3823", "#7a4e33", "#9c6b4a", "#c08a64", "#e0b48f"];

/**
 * One half of the far stands as a painted crowd: rows of seats, nearly all taken, fans in their
 * team's colors (and white, black and grey), heads in a range of skin tones. From the court it
 * reads as a dense, colorful crowd rather than a wall.
 */
function crowdTexture(teams: ArenaTeams, side: Side, small: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = small ? 512 : 1024;
  canvas.height = small ? 352 : 704;
  const ctx = canvas.getContext("2d")!;
  const random = rng(side === "away" ? 41 : 43);
  const { width: w, height: h } = canvas;
  ctx.fillStyle = "#070a14";
  ctx.fillRect(0, 0, w, h);
  const rows = ROWS;
  const rowH = h / rows;
  const seat = rowH * 0.3;
  const span = END + rowOut(ROWS);
  for (let r = 0; r < rows; r++) {
    // Row 0 is the top of the texture: the back row.
    const y = r * rowH;
    // Seat backs: a slightly lighter band at the bottom of each row.
    ctx.fillStyle = "rgba(40,48,80,0.55)";
    ctx.fillRect(0, y + rowH * 0.8, w, rowH * 0.2);
    for (let x = random() * seat; x < w; x += seat * (0.95 + random() * 0.2)) {
      if (random() < 0.06) continue; // an empty seat
      // World x of this seat, to blend the two teams' colors toward the middle.
      const wx = side === "away" ? -span + (x / w) * span : (x / w) * span;
      const team = sideColor(teams, wx, span);
      const pick = random();
      const shirt =
        pick < 0.42
          ? team.clone().multiplyScalar(0.55 + random() * 0.45)
          : pick < 0.55
            ? new THREE.Color(side === "away" ? teams.away.paint : teams.home.paint)
            : pick < 0.75
              ? new THREE.Color(0.85, 0.86, 0.9)
              : new THREE.Color(0.08 + random() * 0.15, 0.08 + random() * 0.15, 0.1 + random() * 0.15);
      const bob = (random() - 0.5) * rowH * 0.12;
      ctx.fillStyle = `#${shirt.getHexString()}`;
      ctx.beginPath();
      ctx.ellipse(x, y + rowH * 0.64 + bob, seat * 0.4, rowH * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = SKIN[Math.floor(random() * SKIN.length)];
      ctx.beginPath();
      ctx.arc(x, y + rowH * 0.38 + bob, seat * 0.2, 0, Math.PI * 2);
      ctx.fill();
      // Now and then a raised arm or a foam finger in the team's color.
      if (random() < 0.05) {
        ctx.fillStyle = `#${team.getHexString()}`;
        ctx.fillRect(x + seat * 0.25, y + rowH * 0.02 + bob, seat * 0.14, rowH * 0.4);
      }
    }
  }
  // The court's lights spill onto the lower rows; the upper deck sits in the dark.
  const shade = ctx.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, "rgba(4,6,16,0.72)");
  shade.addColorStop(0.55, "rgba(4,6,16,0.35)");
  shade.addColorStop(1, "rgba(4,6,16,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The far stands, a slope of crowd in two halves (away team's fans left, home team's right). */
function Stands({ teams, small, cheer }: { teams: ArenaTeams; small: boolean; cheer: Side | null }) {
  const maps = useMemo(
    () => ({ away: crowdTexture(teams, "away", small), home: crowdTexture(teams, "home", small) }),
    [teams, small],
  );
  useEffect(() => () => void (maps.away.dispose(), maps.home.dispose()), [maps]);
  const mats = useRef<Record<Side, THREE.MeshBasicMaterial | null>>({ away: null, home: null });
  const span = END + rowOut(ROWS);
  const dy = BOWL.y1 - BOWL.y0;
  const dz = BOWL.z0 - BOWL.z1;
  const length = Math.hypot(dy, dz);
  const tilt = -Math.atan2(dz, dy);
  useFrame((_, dt) => {
    for (const side of ["away", "home"] as const) {
      const m = mats.current[side];
      if (!m) continue;
      // The hovered team's fans light up; the others settle a little.
      const target = cheer === side ? 0.85 : cheer ? 0.3 : 0.46;
      const k = m.color.r + (target - m.color.r) * Math.min(1, dt * 4);
      m.color.setScalar(k);
    }
  });
  return (
    <group position={[0, (BOWL.y0 + BOWL.y1) / 2, (BOWL.z0 + BOWL.z1) / 2]} rotation={[tilt, 0, 0]}>
      {(["away", "home"] as const).map((side) => (
        <mesh key={side} position={[side === "away" ? -span / 2 : span / 2, 0, 0]}>
          <planeGeometry args={[span, length]} />
          <meshBasicMaterial
            ref={(m) => void (mats.current[side] = m)}
            map={maps[side]}
            color={[0.46, 0.46, 0.46]}
          />
        </mesh>
      ))}
    </group>
  );
}

/** The crowd on one side of the room: rows of faint lights tinted toward that side's team. */
function crowd(teams: ArenaTeams, side: Side): Pts {
  const out = pts();
  const random = rng(side === "away" ? 17 : 19);
  const white = new THREE.Color("#ffffff");
  const span = END + rowOut(ROWS);
  const keep = (x: number) => (side === "away" ? x < 0 : x >= 0);
  const seat = (x: number, y: number, z: number) => {
    if (!keep(x)) return;
    // Just in front of the painted crowd, so they sparkle over it.
    out.pos.push(x + (random() - 0.5) * 0.25, y + 0.25, z + 0.35);
    const team = sideColor(teams, x, span);
    const pick = random();
    const c = (pick < 0.55 ? team : pick < 0.9 ? white : team.clone().offsetHSL(0, 0, 0.15))
      .clone()
      .multiplyScalar(0.3 + random() * 0.5);
    out.col.push(c.r, c.g, c.b);
    out.size.push(0.9 + random() * 1.2);
  };
  for (let row = 0; row < ROWS; row++) {
    const y = rowY(row);
    const o = rowOut(row);
    for (let x = -END - o; x <= END + o; x += 1.1) seat(x, y, FAR - o);
    for (let z = FAR - o; z <= -FAR; z += 0.5) {
      seat(-END - o, y, z);
      seat(END + o, y, z);
    }
  }
  return out;
}

/** Glowing lips along the front of every other tier, shading from one team's color to the other's. */
function tierLights(teams: ArenaTeams): Pts {
  const out = pts();
  const span = END + rowOut(ROWS);
  for (let row = 0; row < ROWS; row += 2) {
    const y = rowY(row) - 0.33;
    const o = rowOut(row);
    const n = Math.round((2 * (END + o)) / 0.16);
    for (let i = 0; i <= n; i++) {
      const x = -END - o + (i / n) * 2 * (END + o);
      const c = sideColor(teams, x, span).multiplyScalar(row === 0 ? 0.9 : 0.55);
      out.pos.push(x, y + 0.3, FAR - o + 0.3);
      out.col.push(c.r, c.g, c.b);
      out.size.push(1.4);
    }
  }
  return out;
}

/** Phone flashes and camera pops scattered through the crowd. */
function flashes(): Pts {
  const out = pts();
  const random = rng(29);
  for (let i = 0; i < 160; i++) {
    const row = Math.floor(random() * ROWS);
    const o = rowOut(row);
    const along = random();
    const end = random() < 0.25;
    const x = end ? (random() < 0.5 ? -1 : 1) * (END + o) : -END - o + along * 2 * (END + o);
    const z = end ? FAR - o + random() * (-FAR + o) : FAR - o + 0.4;
    out.pos.push(x, rowY(row) + 0.35, z);
    out.col.push(1, 0.97, 0.92);
    out.size.push(2.4 + random() * 2);
  }
  return out;
}

/** Rows of lights up in the rafters, low enough to show above the far stands. */
function rafters(): Pts {
  const out = pts();
  const random = rng(23);
  for (let i = 0; i < 4; i++) {
    const z = FAR - 14 - i * 5;
    for (let x = -26; x <= 26; x += 1.5) {
      const b = 0.55 + random() * 0.7;
      out.pos.push(x, 10.5 + i * 0.9, z);
      out.col.push(b, b * 0.97, b * 0.9);
      out.size.push(4 + random() * 3);
    }
  }
  return out;
}

/* --- Ribbon boards and the scoreboard ------------------------------------------------------ */

/** Texture updates, outside the components (three.js objects are mutable; React state isn't). */
function scrollTexture(tex: THREE.Texture, dx: number) {
  tex.offset.x = (tex.offset.x + dx) % 1;
}
function markDirty(tex: THREE.Texture) {
  tex.needsUpdate = true;
}

const font = () => getComputedStyle(document.documentElement).getPropertyValue("--font-archivo") || "sans-serif";

/** A strip of LED panels: the two teams' names on their colors, repeated; scrolled by the caller. */
function ribbonTexture(teams: ArenaTeams): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const panels = [
    { bg: teams.away.paint, fg: "#ffffff", text: teams.away.name },
    { bg: "#0a0f22", fg: teams.away.glow, text: "Who wins tonight?" },
    { bg: teams.home.paint, fg: "#ffffff", text: teams.home.name },
    { bg: "#0a0f22", fg: teams.home.glow, text: "Tip-Off" },
  ];
  const w = canvas.width / 8;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 8; i++) {
    const p = panels[i % panels.length];
    ctx.fillStyle = p.bg;
    ctx.fillRect(i * w, 0, w, 64);
    ctx.fillStyle = p.fg;
    ctx.font = `800 34px ${font()}`;
    ctx.fillText(p.text.toUpperCase(), i * w + w / 2, 34, w - 24);
  }
  // LED grid: thin dark lines between the "pixels".
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (let x = 0; x < canvas.width; x += 4) ctx.fillRect(x, 0, 1, 64);
  for (let y = 0; y < 64; y += 4) ctx.fillRect(0, y, canvas.width, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function Ribbon({
  teams,
  position,
  length,
  height,
  speed,
  still,
}: {
  teams: ArenaTeams;
  position: [number, number, number];
  length: number;
  height: number;
  speed: number;
  still: boolean;
}) {
  const map = useMemo(() => {
    const t = ribbonTexture(teams);
    t.repeat.set(length / 26, 1);
    return t;
  }, [teams, length]);
  useEffect(() => () => map.dispose(), [map]);
  useFrame((_, dt) => {
    if (!still) scrollTexture(map, dt * speed);
  });
  return (
    <mesh position={position}>
      <planeGeometry args={[length, height]} />
      <meshBasicMaterial map={map} color={[0.62, 0.62, 0.62]} toneMapped={false} fog={false} />
    </mesh>
  );
}

type Board = { kind: "idle"; step: number } | { kind: "team"; side: Side };

function drawBoard(ctx: CanvasRenderingContext2D, teams: ArenaTeams, board: Board) {
  const { width: w, height: h } = ctx.canvas;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (board.kind === "team") {
    const t = teams[board.side];
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, t.paint);
    g.addColorStop(1, "#05070d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 44px ${font()}`;
    ctx.fillText(t.city.toUpperCase(), w / 2, h * 0.3, w - 60);
    ctx.fillStyle = t.glow;
    ctx.font = `900 150px ${font()}`;
    ctx.fillText(t.name.toUpperCase(), w / 2, h * 0.62, w - 60);
  } else {
    ctx.fillStyle = "#070b1a";
    ctx.fillRect(0, 0, w, h);
    const half = ctx.createLinearGradient(0, 0, w, 0);
    half.addColorStop(0, teams.away.paint);
    half.addColorStop(0.45, "#070b1a");
    half.addColorStop(0.55, "#070b1a");
    half.addColorStop(1, teams.home.paint);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = half;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    if (board.step % 2 === 0) {
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 120px ${font()}`;
      ctx.fillText("WHO WINS?", w / 2, h / 2, w - 80);
    } else {
      ctx.font = `900 92px ${font()}`;
      ctx.fillStyle = teams.away.glow;
      ctx.fillText(teams.away.name.toUpperCase(), w * 0.27, h / 2, w * 0.42);
      ctx.fillStyle = teams.home.glow;
      ctx.fillText(teams.home.name.toUpperCase(), w * 0.73, h / 2, w * 0.42);
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 40px ${font()}`;
      ctx.fillText("VS", w / 2, h / 2);
    }
  }
  // LED grid.
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  for (let x = 0; x < w; x += 5) ctx.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 1);
}

/** The center-hung scoreboard. It cycles a prompt and the matchup, and shows the hovered team. */
function Scoreboard({ teams, still }: { teams: ArenaTeams; still: boolean }) {
  const hover = useScene((s) => s.hover);
  const phase = useScene((s) => s.phase);
  const { canvas, map } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, map: t };
  }, []);
  useEffect(() => () => map.dispose(), [map]);
  const step = useRef(0);
  const shown = hover && phase === "idle" ? hover : null;

  useEffect(() => {
    const ctx = canvas.getContext("2d")!;
    const draw = () => {
      drawBoard(ctx, teams, shown ? { kind: "team", side: shown } : { kind: "idle", step: step.current });
      markDirty(map);
    };
    draw();
    if (shown || still) return;
    const id = window.setInterval(() => {
      step.current++;
      draw();
    }, 2600);
    return () => window.clearInterval(id);
  }, [canvas, map, teams, shown, still]);

  const box = useRef<THREE.Group>(null);
  // Portrait screens see more height and less width: a smaller board, higher, above the heads.
  const portrait = useThree((s) => s.size.width < s.size.height);
  useFrame(({ clock }) => {
    if (box.current && !still) box.current.rotation.y = Math.sin(clock.elapsedTime * 0.25) * 0.05;
  });

  const W = 3.6;
  const H = 1.9;
  const screen = <meshBasicMaterial map={map} color={[0.8, 0.8, 0.8]} toneMapped={false} fog={false} />;
  return (
    // Hung over the far sideline, between the players' heads from the home camera.
    <group ref={box} position={[0, portrait ? 3.75 : 2.7, FAR - 3]} scale={portrait ? 0.6 : 1}>
      {/* Front and both sides show the screen; the frame is dark metal with light strips. */}
      <mesh position={[0, 0, W / 2 + 0.01]}>
        <planeGeometry args={[W, H]} />
        {screen}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W / 2 + 0.01), 0, 0]} rotation={[0, (s * Math.PI) / 2, 0]}>
          <planeGeometry args={[W, H]} />
          {screen}
        </mesh>
      ))}
      <mesh>
        <boxGeometry args={[W, H + 0.3, W]} />
        <meshStandardMaterial color="#0a0e1c" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Light strips along the front's top (home color) and bottom (away color). */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, s * (H / 2 + 0.09), W / 2 + 0.02]}>
          <planeGeometry args={[W, 0.07]} />
          <meshBasicMaterial
            color={new THREE.Color(s > 0 ? teams.home.glow : teams.away.glow).multiplyScalar(0.8)}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      ))}
      {/* Cables up into the dark. */}
      {[-1, 1].map((s) => (
        <mesh key={`c${s}`} position={[s * W * 0.35, H / 2 + 3, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 6, 6]} />
          <meshBasicMaterial color="#1a2238" />
        </mesh>
      ))}
    </group>
  );
}

/* --- Searchlights and haze ------------------------------------------------------------------ */

/** A cone of light from the rafters: brightest at the lamp, fading toward the floor and at its core. */
function beamMaterial(color: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: 0.16 } },
    vertexShader: /* glsl */ `
      varying float vH;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vH;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float core = pow(abs(dot(vN, vV)), 1.4);
        // Brightest at the lamp, but never gone: the lower cone is what shows above the crowd.
        float fade = 0.3 + 0.7 * pow(vH, 1.3);
        gl_FragColor = vec4(uColor * uStrength * fade * core, 1.0);
      }`,
  });
}

/** Over the far sideline, in front of the stands (their cones never reach the players). */
const BEAMS = [
  { x: -13, z: -9, tilt: 0.42, speed: 0.21, phase: 0, side: "away" },
  { x: -5, z: -11, tilt: 0.3, speed: 0.17, phase: 2.1, side: null },
  { x: 5, z: -11, tilt: -0.3, speed: 0.19, phase: 4.2, side: null },
  { x: 13, z: -9, tilt: -0.42, speed: 0.23, phase: 1.3, side: "home" },
] as const;

function Searchlights({ teams, still }: { teams: ArenaTeams; still: boolean }) {
  const hover = useScene((s) => s.hover);
  const mats = useMemo(
    () => BEAMS.map((b, i) => beamMaterial(b.side ? teams[b.side].glow : i === 1 ? "#7f6bff" : "#4fd1ff")),
    [teams],
  );
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const lean = useRef(0);
  useFrame(({ clock, pointer }, dt) => {
    lean.current += ((still ? 0 : pointer.x) - lean.current) * Math.min(1, dt * 1.5);
    const t = clock.elapsedTime;
    BEAMS.forEach((b, i) => {
      const g = groups.current[i];
      if (!g) return;
      const sweep = still ? 0 : Math.sin(t * b.speed + b.phase) * 0.28;
      g.rotation.z = b.tilt + sweep - lean.current * 0.22;
      // Leaning back toward the stands, so the cones fall on the crowd.
      g.rotation.x = -0.32 + (still ? 0 : Math.sin(t * b.speed * 0.7 + b.phase) * 0.1);
      // The hovered team's searchlight flares.
      const boost = b.side && hover === b.side ? 2.4 : 1;
      const u = mats[i].uniforms.uStrength;
      u.value += (0.16 * boost - u.value) * Math.min(1, dt * 5);
    });
  });
  const LEN = 17;
  return (
    <group>
      {BEAMS.map((b, i) => (
        <group key={i} ref={(g) => void (groups.current[i] = g)} position={[b.x, 12, b.z]}>
          {/* The cone hangs from the lamp (its top at the group's origin). */}
          <mesh position={[0, -LEN / 2, 0]} material={mats[i]}>
            <cylinderGeometry args={[0.18, 2.6, LEN, 24, 1, true]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

let hazeCache: { key: string; tex: THREE.Texture } | null = null;
/** The far wall's haze: the away team's color on the left, the home team's on the right, violet between. */
function hazeTexture(teams: ArenaTeams) {
  const key = `${teams.away.glow}${teams.home.glow}`;
  if (hazeCache?.key === key) return hazeCache.tex;
  hazeCache?.tex.dispose();
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const blob = (x: number, y: number, rx: number, ry: number, color: string, alpha: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx / ry, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
    const c = new THREE.Color(color);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-ry, -ry, 2 * ry, 2 * ry);
    ctx.restore();
  };
  ctx.globalCompositeOperation = "lighter";
  blob(256, 150, 260, 110, "#3a2a9a", 0.9);
  blob(110, 140, 170, 100, teams.away.glow, 0.55);
  blob(402, 140, 170, 100, teams.home.glow, 0.55);
  blob(256, 230, 300, 60, "#1b3a8f", 0.7);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  hazeCache = { key, tex };
  return tex;
}

/* --- Layers ---------------------------------------------------------------------------------- */

function Layer({
  make,
  size,
  twinkle,
  opacity = 1,
}: {
  make: () => Pts;
  size: number;
  twinkle: number;
  /** Eased toward each frame (the crowd brightens when its team is hovered). */
  opacity?: number;
}) {
  const { geometry, material } = useMemo(() => {
    const p = make();
    return { geometry: geometryFrom(p.pos, p.col, p.size), material: pointsMaterial(size, twinkle) };
  }, [make, size, twinkle]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const ref = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock, viewport }, dt) => {
    const m = ref.current;
    tickPoints(m, viewport.dpr, twinkle ? clock.elapsedTime : null);
    if (m) m.uniforms.uOpacity.value += (opacity - m.uniforms.uOpacity.value) * Math.min(1, dt * 4);
  });
  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={ref} args={[material]} />
    </points>
  );
}

function Flashes({ still }: { still: boolean }) {
  const { geometry, material } = useMemo(() => {
    const p = flashes();
    return { geometry: geometryFrom(p.pos, p.col, p.size), material: flashMaterial(42) };
  }, []);
  const ref = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock, viewport }) => tickPoints(ref.current, viewport.dpr, still ? null : clock.elapsedTime));
  if (still) return null;
  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={ref} args={[material]} />
    </points>
  );
}

/** The whole arena. ``still`` holds every light still (reduced motion). */
export function Arena({ teams: given, still }: { teams: ArenaTeams | null; still: boolean }) {
  const teams = given ?? NEUTRAL;
  const hover = useScene((s) => s.hover);
  const phase = useScene((s) => s.phase);
  const cheer = phase === "idle" ? hover : null;
  // Phones get a lighter court texture. This module only loads in the browser.
  const [small] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const makers = useMemo(
    () => ({
      away: () => crowd(teams, "away"),
      home: () => crowd(teams, "home"),
      tiers: () => tierLights(teams),
    }),
    [teams],
  );
  const haze = hazeTexture(teams);
  const end = END + rowOut(ROWS);
  return (
    <group>
      <Court teams={teams} small={small} />
      <Stands teams={teams} small={small} cheer={cheer} />
      <Layer make={makers.away} size={34} twinkle={still ? 0 : 0.45} opacity={cheer === "away" ? 1.9 : cheer ? 0.7 : 1} />
      <Layer make={makers.home} size={34} twinkle={still ? 0 : 0.45} opacity={cheer === "home" ? 1.9 : cheer ? 0.7 : 1} />
      <Layer make={makers.tiers} size={22} twinkle={0} />
      <Layer make={rafters} size={40} twinkle={0} />
      <Flashes still={still} />
      {/* The ribbon board courtside, along the far side. */}
      <Ribbon teams={teams} position={[0, FLOOR_Y + 0.27, FAR - 0.2]} length={2 * END} height={0.42} speed={0.018} still={still} />
      <Scoreboard teams={teams} still={still} />
      <Searchlights teams={teams} still={still} />
      {/* The far wall's colored haze; it fades out at its edges, so there's no hard horizon. */}
      <mesh position={[0, BOWL.y1 + 4, BOWL.z1 - 3]}>
        <planeGeometry args={[2 * end + 40, 22]} />
        <meshBasicMaterial map={haze} transparent opacity={0.85} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

