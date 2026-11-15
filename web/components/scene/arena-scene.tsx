"use client";

import { MeshReflectorMaterial } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import type { Phase } from "@/lib/scene-store";
import type { Side, SlateGame } from "@/lib/slate";
import { matchupJerseys, spotlightColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import { PlaceholderPlayer } from "./placeholder-player";

export interface ArenaSceneProps {
  game: SlateGame;
  phase: Phase;
  winner: Side | null;
  reducedMotion: boolean;
}

const FOV = 38;

function TeamSpotlight({ x, color, intensity }: { x: number; color: string; intensity: number }) {
  const light = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(x, 0.9, 0);
    return o;
  }, [x]);
  const current = useRef(intensity);
  useFrame((_, dt) => {
    if (!light.current) return;
    // Ease toward the target intensity (fades on game swap and on reveal).
    current.current += (intensity - current.current) * Math.min(1, dt * 6);
    light.current.intensity = current.current;
  });
  return (
    <>
      <primitive object={target} />
      <spotLight
        ref={light}
        position={[x * 1.3, 6.5, 2.5]}
        target={target}
        color={color}
        angle={0.42}
        penumbra={0.7}
        decay={1.6}
        distance={18}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
    </>
  );
}

/** Camera distance that keeps both players (half-width ``halfWidth`` m) in frame. */
function cameraRadius(aspect: number, halfWidth: number): number {
  const hHalfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect);
  return Math.max(7.2, (halfWidth / Math.tan(hHalfFov)) * 1.08);
}

function CameraRig({ drift, offsetX, radius }: { drift: boolean; offsetX: number; radius: number }) {
  const { camera } = useThree();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const angle = drift ? Math.sin((t / 12) * Math.PI * 2) * THREE.MathUtils.degToRad(2) : 0;
    camera.position.set(offsetX + Math.sin(angle) * radius, 1.55, Math.cos(angle) * radius);
    camera.lookAt(offsetX, 1.15, 0);
  });
  return null;
}

function Stage({ game, phase, winner, reducedMotion }: ArenaSceneProps) {
  const { size } = useThree();
  const home = requireTeam(game.home.teamId);
  const away = requireTeam(game.away.teamId);
  const jerseys = matchupJerseys(home, away);
  // Desktop: the game rail covers the right ~330px, so center the players in what's left.
  // Phones: players closer together and the camera pulled back (DESIGN.md section 2).
  const desktop = size.width >= 1024;
  const narrow = size.width < 768;
  const playerX = narrow ? 0.72 : 1.25;
  const visibleWidth = desktop ? size.width - 330 : size.width;
  const radius = cameraRadius(visibleWidth / size.height, playerX + 0.5);
  const offsetX = desktop ? (330 / size.width) * radius * 0.36 : 0;
  const revealing = phase !== "idle" && phase !== "returning" && winner !== null;
  const base = 55;
  const level = (side: Side) => (!revealing ? base : side === winner ? base * 1.8 : base * 0.2);

  return (
    <>
      <color attach="background" args={["#0A0A0C"]} />
      <fog attach="fog" args={["#0A0A0C", 8, 20]} />
      <ambientLight intensity={0.12} />
      <directionalLight position={[0, 4, -6]} intensity={0.6} color="#9aa4b5" />
      <TeamSpotlight x={-playerX} color={spotlightColor(away)} intensity={level("away")} />
      <TeamSpotlight x={playerX} color={spotlightColor(home)} intensity={level("home")} />
      <CameraRig drift={!reducedMotion} offsetX={offsetX} radius={radius} />

      <PlaceholderPlayer
        position={[-playerX, 0, 0]}
        rotationY={0.32}
        jersey={jerseys.away}
        chestText={away.jersey.chest_text}
        number={away.jersey.number}
        phaseOffset={0}
        animate={!reducedMotion}
        dimmed={revealing && winner !== "away"}
      />
      <PlaceholderPlayer
        position={[playerX, 0, 0]}
        rotationY={-0.32}
        jersey={jerseys.home}
        chestText={home.jersey.chest_text}
        number={home.jersey.number}
        phaseOffset={2.7}
        animate={!reducedMotion}
        dimmed={revealing && winner !== "home"}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <MeshReflectorMaterial
          blur={[300, 80]}
          resolution={512}
          mixBlur={1}
          mixStrength={18}
          roughness={0.9}
          depthScale={1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#17110c"
          metalness={0.4}
          mirror={0.5}
        />
      </mesh>
    </>
  );
}

export default function ArenaScene(props: ArenaSceneProps) {
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.55, 7.2], fov: 38, near: 0.1, far: 60 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      aria-hidden
    >
      <Stage {...props} />
    </Canvas>
  );
}
