"use client";

/**
 * The props of the prediction cinematic (DESIGN.md section 4): a hoop drawn in light, a real
 * basketball with a glowing trail, the flash at the rim and the burst of sparks. Each exposes a
 * small handle; the cinematic (matchup.tsx) drives them.
 */
import { useFrame } from "@react-three/fiber";
import { type Ref, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";

import type { Vec3 } from "@/lib/shot-path";

import { geometryFrom, glowTexture, pointsMaterial, tickPoints } from "./points";

/** Regulation hoop, meters, relative to the rim's center. */
export const RIM_HEIGHT_M = 3.05;
const RIM_R = 0.2286;
const BOARD_OFFSET = 0.38; // rim center to backboard
export const BALL_RADIUS_M = 0.12;

// --- Hoop -----------------------------------------------------------------------------------

export interface HoopHandle {
  /** 0: hidden, 1: fully lit. */
  setOpacity(value: number): void;
  /** The net swings when the ball drops through. */
  wobble(): void;
}

function circle(r: number, y: number, n: number, phase = 0): THREE.Vector3[] {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  });
}

function segments(pairs: [THREE.Vector3, THREE.Vector3][]) {
  const g = new THREE.BufferGeometry();
  g.setFromPoints(pairs.flat());
  return g;
}

/** The hoop in glowing lines: backboard outline and target square, arm, pole, rim and a diamond net. */
export function Hoop({ color, ref }: { color: string; ref?: Ref<HoopHandle> }) {
  const { frame, rim, net } = useMemo(() => {
    const z = -BOARD_OFFSET;
    const v = (x: number, y: number, zz = z) => new THREE.Vector3(x, y, zz);
    const rect = (x: number, y0: number, y1: number): [THREE.Vector3, THREE.Vector3][] => [
      [v(-x, y0), v(x, y0)],
      [v(x, y0), v(x, y1)],
      [v(x, y1), v(-x, y1)],
      [v(-x, y1), v(-x, y0)],
    ];
    const frameLines: [THREE.Vector3, THREE.Vector3][] = [
      ...rect(0.915, -0.15, 0.92),
      ...rect(0.295, 0, 0.45),
      // Arm from the board to the back of the rim, and the pole behind the board.
      [v(0, 0, z), v(0, 0, -RIM_R)],
      [v(0, -0.05, z), v(0, -0.05, z - 0.85)],
      [v(0, -0.05, z - 0.85), v(0, -RIM_HEIGHT_M, z - 0.85)],
    ];
    const ring = circle(RIM_R, 0, 64);
    const rimLines = ring.map((p, i) => [p, ring[(i + 1) % ring.length]] as [THREE.Vector3, THREE.Vector3]);
    // Diamond mesh net: 4 levels of 12 loops, each tied to the two nearest below.
    const levels = [
      [RIM_R, 0],
      [0.2, -0.14],
      [0.165, -0.28],
      [0.13, -0.42],
    ].map(([r, y], i) => circle(r, y, 12, (i % 2) * (Math.PI / 12)));
    const netLines: [THREE.Vector3, THREE.Vector3][] = [];
    for (let l = 0; l < levels.length - 1; l++) {
      for (let i = 0; i < 12; i++) {
        const a = levels[l][i];
        const next = levels[l + 1];
        const j = l % 2 === 0 ? i : (i + 1) % 12;
        netLines.push([a, next[j]], [a, next[(j + 11) % 12]]);
      }
    }
    return { frame: segments(frameLines), rim: segments(rimLines), net: segments(netLines) };
  }, []);
  const tint = useMemo(() => {
    const team = new THREE.Color(color);
    return {
      frame: new THREE.Color("#ffffff").lerp(team, 0.3).multiplyScalar(1.5),
      rim: team.clone().lerp(new THREE.Color("#ffffff"), 0.25).multiplyScalar(2.2),
      net: new THREE.Color("#ffffff").multiplyScalar(1.3),
    };
  }, [color]);
  const group = useRef<THREE.Group>(null);
  const netGroup = useRef<THREE.Group>(null);
  const frameMat = useRef<THREE.LineBasicMaterial>(null);
  const rimMat = useRef<THREE.LineBasicMaterial>(null);
  const netMat = useRef<THREE.LineBasicMaterial>(null);
  const swing = useRef(0);

  useImperativeHandle(ref, () => ({
    setOpacity(value) {
      for (const m of [frameMat.current, rimMat.current, netMat.current]) if (m) m.opacity = value;
      if (group.current) group.current.visible = value > 0.001;
    },
    wobble() {
      swing.current = 1;
    },
  }));

  useFrame(({ clock }, dt) => {
    const net = netGroup.current;
    if (!net) return;
    swing.current = Math.max(0, swing.current - dt * 1.4);
    const s = swing.current;
    // Stretch down and swing a little, settling over about 0.7 s.
    net.scale.set(1 - 0.12 * s, 1 + 0.35 * s * Math.abs(Math.sin(clock.elapsedTime * 14)), 1 - 0.12 * s);
    net.rotation.z = 0.12 * s * Math.sin(clock.elapsedTime * 11);
  });

  const lineProps = { transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
  return (
    <group ref={group} visible={false}>
      <lineSegments geometry={frame}>
        <lineBasicMaterial ref={frameMat} color={tint.frame} {...lineProps} />
      </lineSegments>
      <lineSegments geometry={rim}>
        <lineBasicMaterial ref={rimMat} color={tint.rim} {...lineProps} />
      </lineSegments>
      <group ref={netGroup}>
        <lineSegments geometry={net}>
          <lineBasicMaterial ref={netMat} color={tint.net} {...lineProps} />
        </lineSegments>
      </group>
    </group>
  );
}

// --- Ball -----------------------------------------------------------------------------------

let ballTexture: THREE.Texture | null = null;
/** An orange basketball with black seams (equirectangular, generated once). */
function basketballTexture() {
  if (ballTexture) return ballTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c8581c";
  ctx.fillRect(0, 0, 512, 256);
  // Pebbled leather.
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.08)" : "rgba(255,190,140,0.07)";
    ctx.fillRect(Math.random() * 512, Math.random() * 256, 1.5, 1.5);
  }
  ctx.strokeStyle = "#140c08";
  ctx.lineWidth = 5;
  const line = (pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  line([[0, 128], [512, 128]]); // equator
  line([[128, 0], [128, 256]]); // meridians
  line([[384, 0], [384, 256]]);
  // The two curved seams.
  for (const cx of [0, 256, 512]) {
    line(Array.from({ length: 33 }, (_, i) => [cx + 70 * Math.sin((i / 32) * Math.PI), (i / 32) * 256] as [number, number]));
    line(Array.from({ length: 33 }, (_, i) => [cx - 70 * Math.sin((i / 32) * Math.PI), (i / 32) * 256] as [number, number]));
  }
  ballTexture = new THREE.CanvasTexture(canvas);
  ballTexture.colorSpace = THREE.SRGBColorSpace;
  ballTexture.anisotropy = 4;
  return ballTexture;
}

/** A real basketball (lit, not a hologram). The parent places, spins and shows it. */
export function Ball({ ref }: { ref?: Ref<THREE.Mesh> }) {
  const map = basketballTexture();
  return (
    <mesh ref={ref} visible={false}>
      <sphereGeometry args={[BALL_RADIUS_M, 40, 24]} />
      <meshStandardMaterial map={map} roughness={0.75} metalness={0} envMapIntensity={0.4} />
    </mesh>
  );
}

// --- Trail ----------------------------------------------------------------------------------

const TRAIL = 22;

export interface TrailHandle {
  push(p: Vec3): void;
  clear(): void;
}

/** A short glowing trail of points behind the ball, in the team color. */
export function Trail({ color, ref }: { color: string; ref?: Ref<TrailHandle> }) {
  const { geometry, material } = useMemo(() => {
    const c = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.2);
    const col: number[] = [];
    const size: number[] = [];
    for (let i = 0; i < TRAIL; i++) {
      const k = 1 - i / TRAIL;
      col.push(c.r * k * 1.8, c.g * k * 1.8, c.b * k * 1.8);
      size.push(5 * k + 1);
    }
    return { geometry: geometryFrom(new Array(TRAIL * 3).fill(0), col, size), material: pointsMaterial(12, 0) };
  }, [color]);
  const points = useRef<THREE.Points>(null);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const count = useRef(0);

  useImperativeHandle(ref, () => ({
    push(p) {
      const attr = points.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!attr) return;
      const a = attr.array as Float32Array;
      a.copyWithin(3, 0, (TRAIL - 1) * 3);
      a[0] = p.x;
      a[1] = p.y;
      a[2] = p.z;
      // Until the trail fills up, park the unused points on the newest one.
      count.current = Math.min(TRAIL, count.current + 1);
      for (let i = count.current; i < TRAIL; i++) a.set([p.x, p.y, p.z], i * 3);
      attr.needsUpdate = true;
      if (points.current) points.current.visible = true;
    },
    clear() {
      count.current = 0;
      if (points.current) points.current.visible = false;
    },
  }));
  useFrame(({ viewport }) => tickPoints(mat.current, viewport.dpr, null));

  return (
    <points ref={points} geometry={geometry} visible={false} frustumCulled={false}>
      <shaderMaterial ref={mat} args={[material]} />
    </points>
  );
}

// --- Flash and sparks -----------------------------------------------------------------------

export interface BurstHandle {
  /** A flash of light and a burst of sparks at ``at`` in the given colors. */
  burst(at: Vec3, colors: string[]): void;
  clear(): void;
}

const SPARKS = 280;
const SPARK_LIFE_S = 1.5;

/** The make: a flash of team-color light at the rim and sparks that drift down and fade. */
export function Burst({ ref }: { ref?: Ref<BurstHandle> }) {
  const geometry = useMemo(
    () => geometryFrom(new Array(SPARKS * 3).fill(0), new Array(SPARKS * 3).fill(0), new Array(SPARKS).fill(0)),
    [],
  );
  const material = useMemo(() => pointsMaterial(16, 0.25), []);
  const points = useRef<THREE.Points>(null);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const glow = useRef<THREE.Sprite>(null);
  const glowMat = useRef<THREE.SpriteMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const state = useRef<{ vel: Float32Array; base: Float32Array; life: number; flash: number } | null>(null);

  useImperativeHandle(ref, () => ({
    burst(at, colors) {
      const p = points.current;
      if (!p) return;
      const pos = p.geometry.getAttribute("position") as THREE.BufferAttribute;
      const size = p.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const vel = new Float32Array(SPARKS * 3);
      const base = new Float32Array(SPARKS * 3);
      const palette = [...colors.map((c) => new THREE.Color(c)), new THREE.Color("#ffffff")];
      for (let i = 0; i < SPARKS; i++) {
        // Out and up from the rim, mostly sideways, like light spraying off it.
        const a = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 3.2;
        const lift = 0.6 + Math.random() * 2.6;
        vel.set([Math.cos(a) * speed, lift, Math.sin(a) * speed], i * 3);
        (pos.array as Float32Array).set([at.x, at.y, at.z], i * 3);
        const c = palette[i % palette.length].clone().multiplyScalar(1.6 + Math.random() * 1.6);
        base.set([c.r, c.g, c.b], i * 3);
        (size.array as Float32Array)[i] = 1.5 + Math.random() * 3.5;
      }
      pos.needsUpdate = true;
      size.needsUpdate = true;
      state.current = { vel, base, life: 1, flash: 1 };
      p.visible = true;
      if (glow.current) glow.current.position.set(at.x, at.y, at.z);
      if (glowMat.current) glowMat.current.color.set(colors[0] ?? "#ffffff");
      if (light.current) {
        light.current.position.set(at.x, at.y, at.z + 0.4);
        light.current.color.set(colors[0] ?? "#ffffff");
      }
    },
    clear() {
      state.current = null;
      if (points.current) points.current.visible = false;
      if (glowMat.current) glowMat.current.opacity = 0;
      if (light.current) light.current.intensity = 0;
    },
  }));

  useFrame(({ viewport }, dt) => {
    tickPoints(mat.current, viewport.dpr, null);
    const s = state.current;
    const p = points.current;
    if (!s || !p) return;
    const step = Math.min(dt, 1 / 30);
    s.life = Math.max(0, s.life - step / SPARK_LIFE_S);
    s.flash = Math.max(0, s.flash - step * 2.2);
    const pos = p.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = p.geometry.getAttribute("color") as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const c = col.array as Float32Array;
    const fade = s.life * s.life;
    for (let i = 0; i < SPARKS * 3; i += 3) {
      s.vel[i + 1] -= 3.2 * step; // gentle gravity
      for (let k = 0; k < 3; k++) {
        s.vel[i + k] *= 1 - 1.4 * step; // air drag
        a[i + k] += s.vel[i + k] * step;
        c[i + k] = s.base[i + k] * fade;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (glowMat.current) glowMat.current.opacity = s.flash;
    if (glow.current) glow.current.scale.setScalar(1.2 + 2.2 * (1 - s.flash));
    if (light.current) light.current.intensity = 14 * s.flash;
    if (s.life === 0) {
      state.current = null;
      p.visible = false;
    }
  });

  return (
    <>
      <points ref={points} geometry={geometry} visible={false} frustumCulled={false}>
        <shaderMaterial ref={mat} args={[material]} />
      </points>
      <sprite ref={glow}>
        <spriteMaterial
          ref={glowMat}
          map={glowTexture()}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <pointLight ref={light} intensity={0} distance={6} decay={2} />
    </>
  );
}
