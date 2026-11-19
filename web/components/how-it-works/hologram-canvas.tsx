"use client";

import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useEffect } from "react";

import { Platform } from "@/components/scene/platform";
import { Player } from "@/components/scene/player";
import { CLIPS } from "@/lib/scene-config";
import type { HologramSide } from "@/lib/team-colors";
import type { Team } from "@/lib/teams";

/** Mounts once everything in its Suspense boundary has loaded. */
function Ready({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return null;
}

/** One hologram player on his platform: the home page's player, small, for chapter 5. */
export default function HologramCanvas({
  team,
  side,
  shooting,
  still,
  onReady,
}: {
  team: Team;
  side: HologramSide;
  /** Play the jump shot (it blends back into the idle when done). */
  shooting: boolean;
  /** Reduced motion: hold still. */
  still: boolean;
  /** Called when the player has loaded. */
  onReady: () => void;
}) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.3, 5.4], fov: 34, near: 0.1, far: 40 }}
      gl={{ antialias: false, powerPreference: "low-power" }}
      onCreated={({ camera }) => camera.lookAt(0, 1.25, 0)}
      aria-hidden
    >
      <color attach="background" args={["#040815"]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[-3, 4, 5]} intensity={2} color="#fff6ee" />
      <directionalLight position={[0, 3, -4]} intensity={1.1} color="#cfdcff" />
      <Suspense fallback={null}>
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
        />
        <Platform color={side.color} intensity={1} still={still} radius={0.75} />
        <Ready onReady={onReady} />
      </Suspense>
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={1} luminanceThreshold={0.66} luminanceSmoothing={0.12} radius={0.7} />
      </EffectComposer>
    </Canvas>
  );
}
