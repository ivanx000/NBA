"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { frameCamera } from "@/lib/scene-framing";
import type { Phase } from "@/lib/scene-store";
import type { Side, SlateGame } from "@/lib/slate";
import { hologramMatchup } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import { Player } from "./player";

export interface ArenaSceneProps {
  /** Null: the room alone (no games to show). */
  game: SlateGame | null;
  phase: Phase;
  winner: Side | null;
  reducedMotion: boolean;
}

const FOV = 35;
const BG = "#02040a";
/** NBA blue and red, brightened for light (DESIGN.md section 1). */
const BLUE = "#5b8cff";
const RED = "#ff4d5e";

/** Random but the same on every load (no flashing layout between renders). */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/**
 * Glowing points: size in px at 1 m, additive, optional twinkle. Returns the material's
 * parameters; JSX builds the material (`<shaderMaterial args={[...]}>`) and code changes its
 * uniforms through a ref.
 */
function pointsMaterial(size: number, twinkle: number): THREE.ShaderMaterialParameters {
  return {
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: size },
      uTwinkle: { value: twinkle },
      uOpacity: { value: 1 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aSeed;
      attribute vec3 color;
      uniform float uTime, uSize, uTwinkle, uPixelRatio;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 2.2) + aSeed * 40.0));
        gl_PointSize = uSize * aSize * uPixelRatio / max(-mv.z, 0.5);
        vColor = color * tw;
        vFade = 1.0 - smoothstep(14.0, 40.0, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(vColor * a * uOpacity * vFade, 1.0);
      }`,
  };
}

/** Keep a points material's pixel ratio and time current (call from useFrame). */
function tickPoints(material: THREE.ShaderMaterial | null, dpr: number, time: number | null) {
  if (!material) return;
  material.uniforms.uPixelRatio.value = dpr;
  if (time !== null) material.uniforms.uTime.value = time;
}

function geometryFrom(positions: number[], colors: number[], sizes: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
  const random = rng(7);
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(sizes.map(() => random()), 1));
  return g;
}

/** Stars behind the players: mostly white, some NBA blue and red. */
function StarField({ still }: { still: boolean }) {
  const { geometry, material } = useMemo(() => {
    const random = rng(42);
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const tint = [new THREE.Color("#ffffff"), new THREE.Color(BLUE), new THREE.Color(RED)];
    for (let i = 0; i < 2600; i++) {
      const z = -4 - random() * 34;
      const spread = 6 + -z * 0.9;
      pos.push((random() - 0.5) * spread * 2.2, -1 + random() * spread * 1.2, z);
      const pick = random();
      const c = tint[pick < 0.78 ? 0 : pick < 0.9 ? 1 : 2].clone().multiplyScalar(0.6 + random() * 1.4);
      col.push(c.r, c.g, c.b);
      size.push(random() < 0.04 ? 5 + random() * 4 : 1.2 + random() * 2.4);
    }
    return { geometry: geometryFrom(pos, col, size), material: pointsMaterial(14, 0.55) };
  }, []);
  const ref = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock, viewport }) => tickPoints(ref.current, viewport.dpr, still ? null : clock.elapsedTime));
  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={ref} args={[material]} />
    </points>
  );
}

/** A floor of faint points, receding into the dark. */
function FloorPoints() {
  const { geometry, material } = useMemo(() => {
    const random = rng(9);
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    for (let x = -12; x <= 12; x += 0.42) {
      for (let z = -16; z <= 5; z += 0.42) {
        pos.push(x + (random() - 0.5) * 0.08, 0, z + (random() - 0.5) * 0.08);
        const b = 0.12 + random() * 0.12;
        col.push(b * 0.8, b * 0.9, b * 1.3);
        size.push(1.6);
      }
    }
    return { geometry: geometryFrom(pos, col, size), material: pointsMaterial(10, 0) };
  }, []);
  const ref = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ viewport }) => tickPoints(ref.current, viewport.dpr, null));
  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={ref} args={[material]} />
    </points>
  );
}

let glowCache: THREE.Texture | null = null;
/** A soft white radial glow, tinted per pad (shared, never disposed). */
function glowTexture() {
  if (glowCache) return glowCache;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.55, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return (glowCache = new THREE.CanvasTexture(canvas));
}

/** The pad a hologram stands on: rings of light points in the team's glow color. */
function Pad({ color, intensity, still }: { color: string; intensity: number; still: boolean }) {
  const glow = glowTexture();
  const { geometry, material } = useMemo(() => {
    const random = rng(3);
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const team = new THREE.Color(color);
    const white = new THREE.Color("#ffffff");
    for (const [radius, count, bright, s] of [
      [0.72, 150, 2.4, 2.6],
      [0.6, 90, 1.2, 1.8],
      [0.46, 60, 0.9, 1.6],
      [0.84, 70, 0.8, 1.4],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + random() * 0.02;
        const r = radius + (random() - 0.5) * 0.015;
        pos.push(Math.cos(a) * r, 0.01, Math.sin(a) * r);
        const c = white.clone().lerp(team, 0.35 + random() * 0.4).multiplyScalar(bright * (0.6 + random() * 0.6));
        col.push(c.r, c.g, c.b);
        size.push(s);
      }
    }
    // Dust inside the ring.
    for (let i = 0; i < 120; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * 0.42;
      pos.push(Math.cos(a) * r, 0.01, Math.sin(a) * r);
      const c = team.clone().multiplyScalar(0.4 + random() * 0.6);
      col.push(c.r, c.g, c.b);
      size.push(1.2);
    }
    return { geometry: geometryFrom(pos, col, size), material: pointsMaterial(13, 0.3) };
  }, [color]);
  const ring = useRef<THREE.Points>(null);
  const ringMat = useRef<THREE.ShaderMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock, viewport }, dt) => {
    const mat = ringMat.current;
    if (!mat) return;
    tickPoints(mat, viewport.dpr, still ? null : clock.elapsedTime);
    const o = mat.uniforms.uOpacity;
    o.value += (intensity - o.value) * Math.min(1, dt * 6);
    if (glowMat.current) glowMat.current.opacity = o.value;
    if (!still && ring.current) ring.current.rotation.y = clock.elapsedTime * 0.12;
  });
  return (
    <>
      <points ref={ring} geometry={geometry} frustumCulled={false}>
        <shaderMaterial ref={ringMat} args={[material]} />
      </points>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[1.05, 48]} />
        <meshBasicMaterial
          ref={glowMat}
          map={glow}
          color={color}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight position={[0, 0.25, 0.3]} color={color} intensity={1.6 * intensity} distance={2.5} decay={2} />
    </>
  );
}

/** A soft room reflected in the players' surfaces (no network fetch, unlike drei's presets). */
function Reflections() {
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return texture;
  }, [gl]);
  // Attached to the scene; R3F disposes it on unmount.
  return <primitive object={env} attach="environment" />;
}

/** Frames the players and drifts the camera slightly with the pointer (parallax). */
function CameraRig({ parallax }: { parallax: boolean }) {
  const { camera, size } = useThree();
  const framing = useMemo(() => frameCamera({ width: size.width, height: size.height }, FOV), [size]);
  const pointer = useRef({ x: 0, y: 0 });
  const eased = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!parallax) return;
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: (e.clientX / window.innerWidth) * 2 - 1, y: (e.clientY / window.innerHeight) * 2 - 1 };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [parallax]);
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 2.5);
    eased.current.x += ((parallax ? pointer.current.x : 0) - eased.current.x) * k;
    eased.current.y += ((parallax ? pointer.current.y : 0) - eased.current.y) * k;
    const { distance, x, y } = framing;
    // Move the camera a little with the pointer but keep looking at the same spot, so the
    // players shift against the stars: that's what reads as depth.
    camera.position.set(x + eased.current.x * 0.3, y + 0.12 - eased.current.y * 0.12, distance);
    camera.lookAt(x, y, 0);
  });
  return null;
}

function Stage({ game, phase, winner, reducedMotion }: ArenaSceneProps) {
  const { size } = useThree();
  const framing = useMemo(() => frameCamera({ width: size.width, height: size.height }, FOV), [size]);
  const revealing = phase !== "idle" && phase !== "returning" && winner !== null;
  const sides = useMemo(() => {
    if (!game) return [];
    const home = requireTeam(game.home.teamId);
    const away = requireTeam(game.away.teamId);
    const holo = hologramMatchup(home, away);
    return [
      { side: "away", team: away, ...holo.away, x: -1, turn: 0.22, offset: 0 },
      { side: "home", team: home, ...holo.home, x: 1, turn: -0.22, offset: 2.7 },
    ] as const;
  }, [game]);

  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 12, 40]} />
      <Reflections />
      {/* Key from the upper left in front, a cooler fill from the right, a back light for the outline. */}
      <ambientLight intensity={0.25} />
      <directionalLight position={[-3, 4, 5]} intensity={2.1} color="#fff6ee" />
      <directionalLight position={[4, 2, 3]} intensity={0.55} color="#dbe6ff" />
      <directionalLight position={[0, 3, -4]} intensity={1.2} color="#cfdcff" />
      <CameraRig parallax={!reducedMotion} />
      <StarField still={reducedMotion} />
      <FloorPoints />

      <Suspense fallback={null}>
        {sides.map(({ side, team, jersey, color, x, turn, offset }) => {
          const dimmed = revealing && winner !== side;
          return (
            <group key={side} position={[x * framing.playerX, 0, 0]}>
              <Player
                rotation={[0, turn, 0]}
                colors={jersey}
                chestText={team.jersey.chest_text}
                number={team.jersey.number}
                hologram={color}
                intensity={dimmed ? 0.3 : 1}
                paused={reducedMotion}
                timeOffset={offset}
              />
              <Pad color={color} intensity={dimmed ? 0.3 : 1} still={reducedMotion} />
            </group>
          );
        })}
      </Suspense>

      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={1.05} luminanceThreshold={0.66} luminanceSmoothing={0.12} radius={0.72} />
        <Vignette offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

export default function ArenaScene(props: ArenaSceneProps) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.4, 6], fov: FOV, near: 0.1, far: 80 }}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      aria-hidden
    >
      <Stage {...props} />
    </Canvas>
  );
}
