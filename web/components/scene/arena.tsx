"use client";

/**
 * The background: a basketball arena drawn in glowing points (DESIGN.md section 1). Court lines on
 * the floor around the players, stands rising behind and to the sides, a big screen on the far
 * wall and lights in the rafters, all fading into the dark.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { PLATFORM_HEIGHT_M } from "./platform";
import { geometryFrom, pointsMaterial, rng, tickPoints } from "./points";

/** Arena floor (the platforms stand on it). */
export const FLOOR_Y = -PLATFORM_HEIGHT_M;
/** Court: length along x, width along z, centered a little behind the players. */
const COURT = { halfLength: 14.33, halfWidth: 7.62, z: -2.2 };
const STEP = 0.11; // spacing of points along a line

type Pts = { pos: number[]; col: number[]; size: number[] };

function linePoints(out: Pts, a: THREE.Vector3, b: THREE.Vector3, color: THREE.Color, size: number) {
  const n = Math.max(1, Math.round(a.distanceTo(b) / STEP));
  for (let i = 0; i <= n; i++) {
    const p = a.clone().lerp(b, i / n);
    out.pos.push(p.x, p.y, p.z);
    out.col.push(color.r, color.g, color.b);
    out.size.push(size);
  }
}

function arcPoints(
  out: Pts,
  center: THREE.Vector3,
  r: number,
  from: number,
  to: number,
  color: THREE.Color,
  size: number,
) {
  const n = Math.max(2, Math.round((Math.abs(to - from) * r) / STEP));
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    out.pos.push(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r);
    out.col.push(color.r, color.g, color.b);
    out.size.push(size);
  }
}

function court(): Pts {
  const out: Pts = { pos: [], col: [], size: [] };
  const { halfLength: L, halfWidth: W, z } = COURT;
  const y = FLOOR_Y + 0.005;
  const v = (x: number, zz: number) => new THREE.Vector3(x, y, z + zz);
  const line = new THREE.Color("#c9d6ff").multiplyScalar(0.9);
  const paint = new THREE.Color("#5b8cff").multiplyScalar(0.9);
  // Boundary and half-court line.
  linePoints(out, v(-L, -W), v(L, -W), line, 2);
  linePoints(out, v(-L, W), v(L, W), line, 2);
  linePoints(out, v(-L, -W), v(-L, W), line, 2);
  linePoints(out, v(L, -W), v(L, W), line, 2);
  linePoints(out, v(0, -W), v(0, W), line, 2);
  arcPoints(out, v(0, 0), 1.83, 0, Math.PI * 2, line, 2);
  arcPoints(out, v(0, 0), 0.61, 0, Math.PI * 2, paint, 2);
  for (const s of [-1, 1]) {
    const basket = v(s * (L - 1.575), 0);
    // The key, the free-throw circle and the three-point line.
    const ft = s * (L - 5.8);
    linePoints(out, v(s * L, -2.44), v(ft, -2.44), paint, 2);
    linePoints(out, v(s * L, 2.44), v(ft, 2.44), paint, 2);
    linePoints(out, v(ft, -2.44), v(ft, 2.44), paint, 2);
    arcPoints(out, v(ft, 0), 1.83, 0, Math.PI * 2, line, 1.6);
    const corner = 6.71;
    const reach = Math.sqrt(7.24 ** 2 - corner ** 2);
    linePoints(out, v(s * L, -corner), v(basket.x - s * reach, -corner), line, 2);
    linePoints(out, v(s * L, corner), v(basket.x - s * reach, corner), line, 2);
    const start = Math.atan2(-corner, -s * reach);
    const end = Math.atan2(corner, -s * reach);
    const [a, b] = s > 0 ? [start, end] : [end, start + Math.PI * 2];
    arcPoints(out, basket, 7.24, Math.min(a, b), Math.max(a, b), line, 2);
  }
  return out;
}

/** Tiered seating: rows of points rising away from the court, like a crowd of faint lights. */
function stands(): Pts {
  const out: Pts = { pos: [], col: [], size: [] };
  const random = rng(17);
  const white = new THREE.Color("#ffffff");
  const blue = new THREE.Color("#5b8cff");
  const red = new THREE.Color("#ff4d5e");
  const seat = (x: number, y: number, z: number) => {
    out.pos.push(x + (random() - 0.5) * 0.25, y, z + (random() - 0.5) * 0.2);
    const pick = random();
    const c = (pick < 0.82 ? white : pick < 0.92 ? blue : red).clone().multiplyScalar(0.25 + random() * 0.55);
    out.col.push(c.r, c.g, c.b);
    out.size.push(1.2 + random() * 1.4);
  };
  const { halfLength: L, halfWidth: W, z } = COURT;
  for (let row = 0; row < 22; row++) {
    const y = FLOOR_Y + 0.6 + row * 0.55;
    const out_ = 2.2 + row * 0.85; // how far behind the court edge
    // Far side, behind the court.
    for (let x = -L - out_; x <= L + out_; x += 0.55) seat(x, y, z - W - out_);
    // Both ends.
    for (let zz = z - W - out_; zz <= z + W; zz += 0.55) {
      seat(-L - out_, y, zz);
      seat(L + out_, y, zz);
    }
  }
  return out;
}

/** The big screen on the far wall: an outlined frame and a grid of lit cells in NBA blue and red. */
function bigScreen(): Pts {
  const out: Pts = { pos: [], col: [], size: [] };
  const random = rng(5);
  const cx = 0;
  // Low on the far wall, between the players' heads, clear of the page's header.
  const cy = 4.6;
  const zz = COURT.z - COURT.halfWidth - 12;
  const w = 7;
  const h = 2.8;
  const frame = new THREE.Color("#c9d6ff").multiplyScalar(0.9);
  const v = (x: number, y: number) => new THREE.Vector3(cx + x, cy + y, zz);
  linePoints(out, v(-w / 2, -h / 2), v(w / 2, -h / 2), frame, 3);
  linePoints(out, v(-w / 2, h / 2), v(w / 2, h / 2), frame, 3);
  linePoints(out, v(-w / 2, -h / 2), v(-w / 2, h / 2), frame, 3);
  linePoints(out, v(w / 2, -h / 2), v(w / 2, h / 2), frame, 3);
  const blue = new THREE.Color("#5b8cff");
  const red = new THREE.Color("#ff4d5e");
  for (let x = -w / 2 + 0.3; x < w / 2 - 0.2; x += 0.3) {
    for (let y = -h / 2 + 0.3; y < h / 2 - 0.2; y += 0.3) {
      // Left half blue, right half red, with a few brighter cells.
      const c = (x < 0 ? blue : red).clone().multiplyScalar(0.25 + random() * (random() < 0.08 ? 1.4 : 0.35));
      out.pos.push(cx + x, cy + y, zz);
      out.col.push(c.r, c.g, c.b);
      out.size.push(3.2);
    }
  }
  return out;
}

/** Rows of lights up in the rafters. */
function rafters(): Pts {
  const out: Pts = { pos: [], col: [], size: [] };
  const random = rng(23);
  for (let i = 0; i < 4; i++) {
    const z = COURT.z - 4 - i * 6;
    for (let x = -22; x <= 22; x += 1.6) {
      const b = 0.5 + random() * 0.7;
      out.pos.push(x, 13 + i * 0.6, z);
      out.col.push(b, b * 0.97, b * 0.9);
      out.size.push(4 + random() * 3);
    }
  }
  return out;
}

let backGlowCache: THREE.Texture | null = null;
/** A wide, soft ellipse of light that fades to nothing at the edges (no hard horizon). */
function backGlow() {
  if (backGlowCache) return backGlowCache;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 0.5, 0, 0); // squash a circle into an ellipse
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.45, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return (backGlowCache = new THREE.CanvasTexture(canvas));
}

function Layer({ make, size, twinkle }: { make: () => Pts; size: number; twinkle: number }) {
  const { geometry, material } = useMemo(() => {
    const p = make();
    return { geometry: geometryFrom(p.pos, p.col, p.size), material: pointsMaterial(size, twinkle) };
  }, [make, size, twinkle]);
  const ref = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock, viewport }) => tickPoints(ref.current, viewport.dpr, twinkle ? clock.elapsedTime : null));
  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={ref} args={[material]} />
    </points>
  );
}

/** The whole arena. ``still`` stops the crowd twinkle (reduced motion). */
export function Arena({ still }: { still: boolean }) {
  return (
    <group>
      <Layer make={court} size={13} twinkle={0} />
      <Layer make={stands} size={38} twinkle={still ? 0 : 0.5} />
      <Layer make={bigScreen} size={40} twinkle={still ? 0 : 0.25} />
      <Layer make={rafters} size={40} twinkle={0} />
      {/* A soft glow behind the far stands, so the room has a back wall; it fades out at its edges. */}
      <mesh position={[0, 5, COURT.z - COURT.halfWidth - 26]}>
        <planeGeometry args={[110, 40]} />
        <meshBasicMaterial
          map={backGlow()}
          color="#1a3a8a"
          transparent
          opacity={0.75}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
