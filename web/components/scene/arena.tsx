"use client";

/**
 * The background: a basketball arena on game night, in real-life colors (DESIGN.md section 1). The
 * two players stand in the center circle of a hardwood court painted in the home team's color.
 * Around it the stands rise in tiers of seats, all one color, with the fans sitting in them: each
 * fan a head and shoulders drawn in fine dust, all in one soft light, lit from above and fading
 * row by row into the dark (the look of the audience in the lions-share hologram site). Rows of
 * lights in the rafters, a dim haze, camera flashes now and then.
 *
 * It reacts to the visitor: hovering a player lights up the fans on his team's side.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { useScene } from "@/lib/scene-store";
import type { Side } from "@/lib/slate";

import { APRON, BASKET_X, COURT, Court } from "./court";
import { fanMaterial, flashMaterial, geometryFrom, pointsMaterial, rng, tickPoints } from "./points";

export { BASKET_X };

/** Arena floor: the players stand on it (feet at y = 0). */
export const FLOOR_Y = 0;

/** One team as the room shows it. */
export interface ArenaTeam {
  /** Glow color, readable on black. */
  glow: string;
  /** The team's primary and secondary brand colors (the court's paint and trim). */
  paint: string;
  trim: string;
  tertiary?: string;
  abbr: string;
  name: string;
  city: string;
}
export interface ArenaTeams {
  away: ArenaTeam;
  home: ArenaTeam;
}

/** The room before a game is chosen (no games today). */
const NEUTRAL: ArenaTeams = {
  // No team, no name: a blank court (no lettering, no center logo).
  away: { glow: "#5b8cff", paint: "#1d428a", trim: "#ffffff", abbr: "", name: "", city: "" },
  home: { glow: "#ff4d5e", paint: "#1d428a", trim: "#c8102e", abbr: "", name: "", city: "" },
};

type Pts = { pos: number[]; col: number[]; size: number[] };
const pts = (): Pts => ({ pos: [], col: [], size: [] });

/* --- The stands ----------------------------------------------------------------------------- */

const ROWS = 18;
/** Height of a row's tread (where the seats stand), and how far it sits behind the court's apron. */
const rowY = (row: number) => FLOOR_Y + 0.45 + row * 0.42;
const rowOut = (row: number) => 0.7 + row * 0.82;
const TREAD = 0.82;
const FAR = -COURT.halfWidth - APRON;
const END = COURT.halfLength + APRON;
/** The ends run from the far stands to the near sideline. */
const NEAR = COURT.halfWidth + APRON;
/** Seat spacing along a row. */
const SEAT = 0.52;
/** All the seats, one color: dark slate. The stands are unlit (the lights are on the court), so the
 * seats and tiers are flat dark shapes and the fans are what catches the light. */
const SEAT_COLOR = "#121928";
const TIER_COLOR = "#05070d";

/** One seat in the stands: where it is and which way the row runs (fans face the court). */
interface SeatSpot {
  x: number;
  y: number;
  z: number;
  /** Unit vector along the row. */
  tx: number;
  tz: number;
  /** Unit vector toward the court. */
  nx: number;
  nz: number;
  row: number;
  side: Side;
}

/** Every seat: the far side (behind the players) and both ends, row by row. */
function seats(): SeatSpot[] {
  const out: SeatSpot[] = [];
  for (let row = 0; row < ROWS; row++) {
    const o = rowOut(row);
    const y = rowY(row);
    // The seat sits toward the back of its tread.
    const back = o + TREAD * 0.62;
    const half = END + o;
    for (let x = -half + SEAT / 2; x <= half - SEAT / 2; x += SEAT)
      out.push({ x, y, z: FAR - back, tx: 1, tz: 0, nx: 0, nz: 1, row, side: x < 0 ? "away" : "home" });
    for (const s of [-1, 1]) {
      for (let z = FAR - o + SEAT / 2; z <= NEAR - SEAT / 2; z += SEAT)
        out.push({ x: s * (END + back), y, z, tx: 0, tz: 1, nx: -s, nz: 0, row, side: s < 0 ? "away" : "home" });
    }
  }
  return out;
}

/** The tiers under the seats: a step per row on the far side and at both ends. One merged mesh. */
function tierGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let row = 0; row < ROWS; row++) {
    const o = rowOut(row);
    const top = rowY(row);
    const far = new THREE.BoxGeometry(2 * (END + o + TREAD), top - FLOOR_Y, TREAD);
    far.translate(0, (top + FLOOR_Y) / 2, FAR - o - TREAD / 2);
    parts.push(far);
    for (const s of [-1, 1]) {
      const end = new THREE.BoxGeometry(TREAD, top - FLOOR_Y, NEAR - FAR + o);
      end.translate(s * (END + o + TREAD / 2), (top + FLOOR_Y) / 2, (NEAR + FAR - o) / 2);
      parts.push(end);
    }
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

/** One seat back and its seat pan, as one small geometry (instanced for every seat). */
function seatGeometry() {
  const back = new THREE.BoxGeometry(SEAT * 0.86, 0.46, 0.05);
  back.translate(0, 0.62, -0.18);
  const pan = new THREE.BoxGeometry(SEAT * 0.86, 0.05, 0.36);
  pan.translate(0, 0.42, 0);
  const merged = mergeGeometries([back, pan])!;
  back.dispose();
  pan.dispose();
  return merged;
}

/** Places every seat (rotated to face the court) in an instanced mesh. */
function placeSeats(mesh: THREE.InstancedMesh, spots: SeatSpot[]) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    q.setFromAxisAngle(up, Math.atan2(s.nx, s.nz));
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function Seating({ spots }: { spots: SeatSpot[] }) {
  const tiers = useMemo(() => tierGeometry(), []);
  const seat = useMemo(() => seatGeometry(), []);
  useEffect(() => () => void (tiers.dispose(), seat.dispose()), [tiers, seat]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (ref.current) placeSeats(ref.current, spots);
  }, [spots]);
  return (
    <group>
      <mesh geometry={tiers}>
        <meshBasicMaterial color={TIER_COLOR} />
      </mesh>
      <instancedMesh ref={ref} args={[seat, undefined, spots.length]} frustumCulled={false}>
        <meshBasicMaterial color={SEAT_COLOR} />
      </instancedMesh>
    </group>
  );
}

/**
 * The fans on one side, sitting in their seats: each a head and shoulders of fine points on a
 * shell, so it reads as a shape, lit from above. The front rows catch the court's light; the
 * upper rows fade into the dark. About one seat in eight is empty.
 */
function fans(spots: SeatSpot[], side: Side, density: number, tint: string): Pts & { fan: number[] } {
  const out = { ...pts(), fan: [] as number[] };
  // One color per side: the team's glow color, softened a little toward white.
  const FAN_COLOR = new THREE.Color(tint).lerp(new THREE.Color("#ffffff"), 0.25);
  const random = rng(side === "away" ? 303 : 307);
  const dir = new THREE.Vector3();
  const headN = Math.round(26 * density);
  const bodyN = Math.round(44 * density);
  for (const s of spots) {
    if (s.side !== side) continue;
    if (random() < 0.13) continue;
    // Sitting: hips on the seat pan, shoulders above the seat back, a little in front of it.
    const lean = 0.06 + random() * 0.06;
    const cx = s.x + s.nx * lean + s.tx * (random() - 0.5) * 0.06;
    const cz = s.z + s.nz * lean + s.tz * (random() - 0.5) * 0.06;
    const tall = 0.92 + random() * 0.14;
    const shoulders = s.y + 0.98 * tall;
    const head = s.y + 1.22 * tall;
    const light = 0.3 + 0.85 * Math.exp(-(s.row * s.row) / (2 * 6.5 * 6.5));
    const seed = random();
    const add = (x: number, y: number, z: number, lit: number, size: number) => {
      out.pos.push(x, y, z);
      const k = light * lit;
      out.col.push(FAN_COLOR.r * k, FAN_COLOR.g * k, FAN_COLOR.b * k);
      out.size.push(size);
      out.fan.push(seed);
    };
    for (let k = 0; k < headN; k++) {
      dir.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
      add(cx + dir.x * 0.095, head + dir.y * 0.115, cz + dir.z * 0.095, 0.45 + 0.55 * Math.max(0, dir.y), 0.9 + random() * 0.6);
    }
    for (let k = 0; k < bodyN; k++) {
      dir.set(random() * 2 - 1, random() * 1.2 - 0.25, random() * 2 - 1).normalize();
      // Wide across the shoulders (along the row), shallow front to back.
      const wide = dir.x * 0.24;
      const deep = dir.z * 0.12;
      add(
        cx + s.tx * wide + s.nx * deep,
        shoulders - 0.16 + dir.y * 0.22,
        cz + s.tz * wide + s.nz * deep,
        (0.3 + 0.7 * Math.max(0, dir.y)) * 0.85,
        0.9 + random() * 0.7,
      );
    }
  }
  return out;
}

/** Phone flashes and camera pops scattered through the crowd (white, as they are). */
function flashes(spots: SeatSpot[]): Pts {
  const out = pts();
  const random = rng(29);
  for (let i = 0; i < 160; i++) {
    const s = spots[Math.floor(random() * spots.length)];
    out.pos.push(s.x + s.nx * 0.25, s.y + 1.05, s.z + s.nz * 0.25);
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
    const z = FAR - 12 - i * 4.5;
    for (let x = -26; x <= 26; x += 1.5) {
      const b = 0.55 + random() * 0.6;
      out.pos.push(x, rowY(ROWS - 1) + 2.4 + i * 0.7, z);
      out.col.push(b, b * 0.97, b * 0.9);
      out.size.push(4 + random() * 3);
    }
  }
  return out;
}

let hazeCache: THREE.Texture | null = null;
/** A wide, soft ellipse of dim blue light behind the upper stands (no hard horizon). */
function hazeTexture() {
  if (hazeCache) return hazeCache;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 0.5, 0, 0);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,0.8)");
  g.addColorStop(0.5, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return (hazeCache = new THREE.CanvasTexture(canvas));
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
  /** Eased toward each frame (the fans brighten when their team is hovered). */
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

/** One side's fans; ``cheer`` brightens them all (their team is hovered), the cursor makes the nearest hop. */
function Fans({ make, size, still, opacity }: { make: () => Pts & { fan: number[] }; size: number; still: boolean; opacity: number }) {
  const { geometry, material } = useMemo(() => {
    const p = make();
    const g = geometryFrom(p.pos, p.col, p.size);
    g.setAttribute("aFan", new THREE.Float32BufferAttribute(p.fan, 1));
    return { geometry: g, material: fanMaterial(size, still ? 0 : 0.12) };
  }, [make, size, still]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const ref = useRef<THREE.ShaderMaterial>(null);
  const seen = useRef({ x: 9, y: 9, at: -10 });
  useFrame(({ clock, viewport, pointer, size: px }, dt) => {
    const m = ref.current;
    if (!m) return;
    tickPoints(m, viewport.dpr, clock.elapsedTime);
    const u = m.uniforms;
    u.uOpacity.value += (opacity - u.uOpacity.value) * Math.min(1, dt * 4);
    // The cursor stirs them while it's moving over the scene; they settle a second after it stops.
    const p = seen.current;
    if (pointer.x !== p.x || pointer.y !== p.y) Object.assign(p, { x: pointer.x, y: pointer.y, at: clock.elapsedTime });
    const live = !still && clock.elapsedTime - p.at < 1.2 && Math.abs(pointer.x) < 1 && Math.abs(pointer.y) < 1;
    u.uActive.value += ((live ? 1 : 0) - u.uActive.value) * Math.min(1, dt * 5);
    u.uPointer.value.set(pointer.x, pointer.y);
    u.uAspect.value = px.width / px.height;
  });
  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={ref} args={[material]} />
    </points>
  );
}

function Flashes({ spots, still }: { spots: SeatSpot[]; still: boolean }) {
  const { geometry, material } = useMemo(() => {
    const p = flashes(spots);
    return { geometry: geometryFrom(p.pos, p.col, p.size), material: flashMaterial(42) };
  }, [spots]);
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
  // Phones get a lighter court texture and thinner fans. This module only loads in the browser.
  const [small] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const spots = useMemo(() => seats(), []);
  const makers = useMemo(
    () => ({
      away: () => fans(spots, "away", small ? 0.5 : 1, teams.away.glow),
      home: () => fans(spots, "home", small ? 0.5 : 1, teams.home.glow),
    }),
    [spots, small, teams],
  );
  const fanSize = small ? 60 : 44;
  return (
    <group>
      <Court team={teams.home} small={small} />
      <Seating spots={spots} />
      <Fans make={makers.away} size={fanSize} still={still} opacity={cheer === "away" ? 1.8 : cheer ? 0.75 : 1} />
      <Fans make={makers.home} size={fanSize} still={still} opacity={cheer === "home" ? 1.8 : cheer ? 0.75 : 1} />
      <Layer make={rafters} size={40} twinkle={0} />
      <Flashes spots={spots} still={still} />
      {/* A dim haze behind the upper stands; it fades out at its edges, so there's no hard horizon. */}
      <mesh position={[0, rowY(ROWS - 1) + 2, FAR - rowOut(ROWS - 1) - 6]}>
        <planeGeometry args={[2 * END + 60, 26]} />
        <meshBasicMaterial map={hazeTexture()} color="#1d3170" transparent opacity={0.7} depthWrite={false} fog={false} />
      </mesh>
    </group>
  );
}
