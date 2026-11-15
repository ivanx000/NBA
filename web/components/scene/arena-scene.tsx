"use client";

import { MeshReflectorMaterial } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { frameCamera } from "@/lib/scene-framing";
import type { Phase } from "@/lib/scene-store";
import type { Side, SlateGame } from "@/lib/slate";
import { hologramMatchup } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import { Player } from "./player";

export interface ArenaSceneProps {
  game: SlateGame;
  phase: Phase;
  winner: Side | null;
  reducedMotion: boolean;
}

const FOV = 35;
const BG = "#030407";

/** Room size in meters: the players stand near the front of a long, dark chamber. */
const ROOM = { halfWidth: 9, back: -14, front: 8, height: 7 };

/** A faint glowing grid, fading with distance (walls and ceiling of the hologram chamber). */
function gridMaterial(color: string, cells: [number, number], strength: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uCells: { value: new THREE.Vector2(...cells) },
      uStrength: { value: strength },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec2 uCells;
      uniform float uStrength;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vec2 g = vUv * uCells;
        vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);
        float line = 1.0 - min(min(d.x, d.y), 1.0);
        float fade = 1.0 - smoothstep(6.0, 24.0, vDepth);
        gl_FragColor = vec4(uColor * line * uStrength * fade, 1.0);
      }`,
  });
}

/** The hologram chamber: glossy black floor, faint grid walls and ceiling fading into the dark. */
function Room() {
  const { halfWidth: hw, back, front, height } = ROOM;
  const depth = front - back;
  const midZ = (front + back) / 2;
  const wall = useMemo(() => gridMaterial("#5b8cff", [depth, height], 0.22), [depth, height]);
  const backWall = useMemo(() => gridMaterial("#5b8cff", [hw * 2, height], 0.26), [hw, height]);
  const ceiling = useMemo(() => gridMaterial("#5b8cff", [hw * 2, depth], 0.12), [hw, depth]);
  useEffect(() => () => [wall, backWall, ceiling].forEach((m) => m.dispose()), [wall, backWall, ceiling]);
  return (
    <group>
      {/* Mirror-like black floor that reflects the holograms (like the reference image). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, midZ]}>
        <planeGeometry args={[hw * 2, depth]} />
        <MeshReflectorMaterial
          blur={[180, 60]}
          resolution={1024}
          mixBlur={0.8}
          mixStrength={42}
          roughness={0.55}
          depthScale={0.6}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#050608"
          metalness={0.6}
          mirror={0.8}
        />
      </mesh>
      <mesh position={[0, height / 2, back]} material={backWall}>
        <planeGeometry args={[hw * 2, height]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * hw, height / 2, midZ]} rotation={[0, -side * (Math.PI / 2), 0]} material={wall}>
          <planeGeometry args={[depth, height]} />
        </mesh>
      ))}
      <mesh position={[0, height, midZ]} rotation={[Math.PI / 2, 0, 0]} material={ceiling}>
        <planeGeometry args={[hw * 2, depth]} />
      </mesh>
      {/* A soft glow line where the back wall meets the floor, for depth. */}
      <mesh position={[0, 0.02, back + 0.05]}>
        <planeGeometry args={[hw * 2, 0.04]} />
        <meshBasicMaterial color="#2a3f66" />
      </mesh>
    </group>
  );
}

function ringTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const glow = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  glow.addColorStop(0, "rgba(255,255,255,0.35)");
  glow.addColorStop(0.5, "rgba(255,255,255,0.08)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 512);
  // Concentric rings, brightest at the rim, like a projector pad.
  ctx.strokeStyle = "white";
  for (const [r, a, w] of [[240, 0.9, 3], [215, 0.35, 1.5], [180, 0.5, 2], [140, 0.25, 1.5], [96, 0.35, 1.5], [52, 0.2, 1]]) {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Dashed outer ring.
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([6, 10]);
  ctx.beginPath();
  ctx.arc(256, 256, 252, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

/** The pad a hologram is projected from. */
function ProjectorDisc({ color, intensity, spin }: { color: string; intensity: number; spin: boolean }) {
  const texture = useMemo(() => (typeof document === "undefined" ? null : ringTexture()), []);
  useEffect(() => () => texture?.dispose(), [texture]);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    if (material.current) {
      material.current.opacity += (intensity - material.current.opacity) * Math.min(1, dt * 6);
    }
    if (ring.current && spin) ring.current.rotation.z = clock.elapsedTime * 0.15;
  });
  return (
    <>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <circleGeometry args={[0.6, 64]} />
        <meshBasicMaterial
          ref={material}
          map={texture}
          color={color}
          transparent
          opacity={intensity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Colored light from the pad onto the floor around it. */}
      <pointLight position={[0, 0.3, 0.2]} color={color} intensity={2.2 * intensity} distance={3} decay={2} />
    </>
  );
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
    // Move the camera a little with the pointer but keep looking at the same spot, so near
    // things (players) shift against far ones (walls): that's what reads as depth.
    camera.position.set(x + eased.current.x * 0.45, y + 0.25 - eased.current.y * 0.18, distance);
    camera.lookAt(x, y, 0);
  });
  return null;
}

function Stage({ game, phase, winner, reducedMotion }: ArenaSceneProps) {
  const { size } = useThree();
  const framing = useMemo(() => frameCamera({ width: size.width, height: size.height }, FOV), [size]);
  const home = requireTeam(game.home.teamId);
  const away = requireTeam(game.away.teamId);
  const holo = hologramMatchup(home, away);
  const revealing = phase !== "idle" && phase !== "returning" && winner !== null;

  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 10, 26]} />
      <ambientLight intensity={0.15} />
      <CameraRig parallax={!reducedMotion} />
      <Room />

      <Suspense fallback={null}>
        {([
          ["away", away, holo.away, -framing.playerX, 0.28, 0],
          ["home", home, holo.home, framing.playerX, -0.28, 2.7],
        ] as const).map(([side, team, { jersey, color, ink }, x, rotationY, offset]) => {
          const dimmed = revealing && winner !== side;
          return (
            <group key={side} position={[x, 0, 0]}>
              <Player
                rotation={[0, rotationY, 0]}
                colors={jersey}
                chestText={team.jersey.chest_text}
                number={team.jersey.number}
                hologram={color}
                hologramInk={ink}
                intensity={dimmed ? 0.25 : 1}
                paused={reducedMotion}
                timeOffset={offset}
              />
              <ProjectorDisc color={color} intensity={dimmed ? 0.25 : 1} spin={!reducedMotion} />
            </group>
          );
        })}
      </Suspense>

      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.22} luminanceSmoothing={0.25} radius={0.7} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </>
  );
}

export default function ArenaScene(props: ArenaSceneProps) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.4, 6], fov: FOV, near: 0.1, far: 60 }}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      aria-hidden
    >
      <Stage {...props} />
    </Canvas>
  );
}
