"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { type ReactNode, Suspense, useEffect, useRef } from "react";
import type * as THREE from "three";

import { FloorMark } from "@/components/scene/floor-mark";
import { Player } from "@/components/scene/player";
import { CLIPS } from "@/lib/scene-config";
import type { HologramSide } from "@/lib/team-colors";
import type { Team } from "@/lib/teams";

/** Mounts once everything in its Suspense boundary has loaded. */
function Ready({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return null;
}

/** Eases its children toward a popped-out pose (bigger, a step forward) while ``on``. */
function Pop({ on, children }: { on: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const k = useRef(0);
  useFrame((_, dt) => {
    k.current += ((on ? 1 : 0) - k.current) * Math.min(1, dt * 9);
    const g = ref.current;
    if (!g) return;
    g.scale.setScalar(1 + 0.08 * k.current);
    g.position.z = 0.35 * k.current;
  });
  return <group ref={ref}>{children}</group>;
}

/** One hologram player on a pool of floor: the home page's player, small, for chapter 5. */
export default function HologramCanvas({
  team,
  side,
  shooting,
  still,
  hovered,
  onReady,
}: {
  team: Team;
  side: HologramSide;
  /** Play the jump shot (it blends back into the idle when done). */
  shooting: boolean;
  /** Reduced motion: hold still. */
  still: boolean;
  /** The pointer is over him: he pops out and lights up, as on the home page. */
  hovered: boolean;
  /** Called when the player has loaded. */
  onReady: () => void;
}) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.2, 4.6], fov: 34, near: 0.1, far: 40 }}
      gl={{ antialias: false, powerPreference: "low-power" }}
      onCreated={({ camera }) => camera.lookAt(0, 1.05, 0)}
      aria-hidden
    >
      <ambientLight intensity={0.3} />
      <directionalLight position={[-3, 4, 5]} intensity={2} color="#fff6ee" />
      <directionalLight position={[0, 3, -4]} intensity={1.1} color="#cfdcff" />
      <Suspense fallback={null}>
        <Pop on={hovered && !still}>
          <Player
            rotation={[0, -0.35, 0]}
            colors={side.jersey}
            chestText={team.jersey.chest_text}
            number={team.jersey.number}
            hologram={side.color}
            paused={still}
            clip={shooting ? CLIPS.shot : "Idle"}
            idleVariety={!shooting}
            lookAt={!still}
            highlight={hovered ? 1 : 0}
          />
          <FloorMark color={side.color} active still={still} />
        </Pop>
        <Ready onReady={onReady} />
      </Suspense>
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={1} luminanceThreshold={0.66} luminanceSmoothing={0.12} radius={0.7} />
      </EffectComposer>
    </Canvas>
  );
}
