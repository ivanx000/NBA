"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { frameCamera } from "@/lib/scene-framing";
import type { Phase } from "@/lib/scene-store";
import type { Side, SlateGame } from "@/lib/slate";

import { cameraOverride } from "./camera-override";
import { Arena } from "./arena";
import { Matchup } from "./matchup";
import { geometryFrom, pointsMaterial, rng, tickPoints } from "./points";

export interface ArenaSceneProps {
  /** Null: the room alone (no games to show). */
  game: SlateGame | null;
  phase: Phase;
  /** The team the user picked (its player shoots). */
  pick: Side | null;
  /** Whose numbers the results screen shows (the camera frames that player). */
  viewing: Side | null;
  /** Clicking a player picks its team. */
  pickable: boolean;
  reducedMotion: boolean;
}

const FOV = 35;
const BG = "#02040a";
/** NBA blue and red, brightened for light (DESIGN.md section 1). */
const BLUE = "#5b8cff";
const RED = "#ff4d5e";

/** Dust in the arena's light: faint motes around and behind the players, twinkling slowly. */
function StarField({ still }: { still: boolean }) {
  const { geometry, material } = useMemo(() => {
    const random = rng(42);
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const tint = [new THREE.Color("#ffffff"), new THREE.Color(BLUE), new THREE.Color(RED)];
    for (let i = 0; i < 900; i++) {
      const z = -1 - random() * 18;
      pos.push((random() - 0.5) * 26, random() * 9, z);
      const pick = random();
      const c = tint[pick < 0.8 ? 0 : pick < 0.9 ? 1 : 2].clone().multiplyScalar(0.15 + random() * 0.45);
      col.push(c.r, c.g, c.b);
      size.push(0.8 + random() * 1.6);
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
  const size = useThree((s) => s.size);
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
  const home = useRef({ position: new THREE.Vector3(), target: new THREE.Vector3() });
  useFrame(({ clock, camera: sceneCamera }, dt) => {
    const camera = sceneCamera as THREE.PerspectiveCamera;
    const k = Math.min(1, dt * 2.5);
    eased.current.x += ((parallax ? pointer.current.x : 0) - eased.current.x) * k;
    eased.current.y += ((parallax ? pointer.current.y : 0) - eased.current.y) * k;
    const { distance, x, y } = framing;
    // Move the camera a little with the pointer but keep looking at the same spot, so the
    // players shift against the stars: that's what reads as depth.
    const h = home.current;
    h.position.set(x + eased.current.x * 0.3, y + 0.12 - eased.current.y * 0.12, distance);
    h.target.set(x, y, 0);
    // The cinematic takes over by blending toward its shot (camera-override.ts).
    const o = cameraOverride;
    const w = o.weight;
    camera.position.lerpVectors(h.position, o.position, w);
    const target = h.target.lerp(o.target, w);
    if (o.shake > 0) {
      const t = clock.elapsedTime * 60;
      camera.position.x += Math.sin(t * 1.7) * 0.025 * o.shake;
      camera.position.y += Math.sin(t * 2.3) * 0.02 * o.shake;
    }
    camera.lookAt(target);
    const fov = FOV + (o.fov - FOV) * w;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

function Stage({ game, phase, pick, viewing, pickable, reducedMotion, lowPower }: ArenaSceneProps & { lowPower: boolean }) {
  const size = useThree((s) => s.size);
  const framing = useMemo(() => frameCamera({ width: size.width, height: size.height }, FOV), [size]);

  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 16, 60]} />
      <Reflections />
      {/* Key from the upper left in front, a cooler fill from the right, a back light for the outline. */}
      <ambientLight intensity={0.25} />
      <directionalLight position={[-3, 4, 5]} intensity={2.1} color="#fff6ee" />
      <directionalLight position={[4, 2, 3]} intensity={0.55} color="#dbe6ff" />
      <directionalLight position={[0, 3, -4]} intensity={1.2} color="#cfdcff" />
      <CameraRig parallax={!reducedMotion} />
      <Arena still={reducedMotion} />
      <StarField still={reducedMotion} />

      <Suspense fallback={null}>
        {game && (
          <Matchup
            game={game}
            phase={phase}
            pick={pick}
            viewing={viewing}
            pickable={pickable}
            reducedMotion={reducedMotion}
            playerX={framing.playerX}
          />
        )}
      </Suspense>

      {/* Slow devices drop the post-processing (PerformanceMonitor below). */}
      {!lowPower && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={1.05} luminanceThreshold={0.66} luminanceSmoothing={0.12} radius={0.72} />
          <Vignette offset={0.3} darkness={0.7} />
        </EffectComposer>
      )}
    </>
  );
}

export default function ArenaScene(props: ArenaSceneProps) {
  // Start a little under the screen's density and adapt: up on fast devices, down to 1 on slow
  // ones, and without bloom if it keeps struggling.
  const [dpr, setDpr] = useState(1.5);
  const [lowPower, setLowPower] = useState(false);
  return (
    <Canvas
      dpr={dpr}
      camera={{ position: [0, 1.4, 6], fov: FOV, near: 0.1, far: 80 }}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      aria-hidden
    >
      <PerformanceMonitor
        flipflops={3}
        onIncline={() => setDpr(Math.min(1.75, window.devicePixelRatio))}
        onDecline={() => setDpr(1)}
        onFallback={() => {
          setDpr(1);
          setLowPower(true);
        }}
      />
      <Stage {...props} lowPower={lowPower} />
    </Canvas>
  );
}
