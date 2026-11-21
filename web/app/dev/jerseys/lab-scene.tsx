"use client";

import { OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";

import { Player } from "@/components/scene/player";
import { NO_POSTURE, type Posture } from "@/components/scene/posture";
import { MOTION_LIBRARY_URL } from "@/lib/scene-config";
import { hologramColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

interface LabProps {
  clip: string;
  runId: number;
  teams: [string, string];
  alt: boolean;
  speed: number;
  holo: boolean;
  debugMask: boolean;
  posture: Posture;
  /** The left player without the posture correction, to compare. */
  compare: boolean;
}

function LabPlayers({ teams, alt, clip, runId, speed, holo, debugMask, posture, compare }: LabProps) {
  // Motion library clips target the same bones as player.glb, so they play on the same skeleton.
  const library = useGLTF(MOTION_LIBRARY_URL).animations;
  return (
    <>
      {teams.map((abbr, i) => {
        const team = requireTeam(abbr);
        const jersey = alt ? team.jersey.alt : team.jersey.primary;
        return (
          <Player
            key={`${i}-${runId}`}
            position={[i === 0 ? -0.6 : 0.6, 0, 0]}
            colors={jersey}
            chestText={team.jersey.chest_text}
            number={team.jersey.number}
            debugMask={debugMask}
            hologram={holo ? hologramColor(jersey) : null}
            clip={clip}
            extraClips={library}
            speed={speed}
            idleVariety={false}
            posture={compare && i === 0 ? NO_POSTURE : posture}
          />
        );
      })}
    </>
  );
}

export default function LabScene({
  look,
  pixel,
  ...props
}: Omit<LabProps, "holo" | "debugMask"> & {
  look: "real" | "holo";
  /** Size of a rendered pixel in CSS pixels (0: full resolution). */
  pixel: number;
}) {
  const holo = look === "holo";
  // `?mask=1` paints the uniform mask channels (red uniform, green trim, blue side stripes).
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const debugMask = Boolean(params?.has("mask"));
  // `?close=1` frames the upper bodies (posture, collar and shoulders).
  const close = Boolean(params?.has("close"));
  // `?side=1` looks from his right side (the shot's profile).
  const side = Boolean(params?.has("side"));
  return (
    <Canvas
      key={pixel}
      shadows
      dpr={pixel ? 1 / pixel : [1, 2]}
      gl={{ antialias: !pixel }}
      camera={{ position: side ? [-4.2, 1.5, 0.4] : close ? [0, 1.55, 1.9] : [0, 1.45, 3.6], fov: 40 }}
      className={`absolute! inset-0 ${pixel ? "[&_canvas]:[image-rendering:pixelated]" : ""}`}
    >
      <color attach="background" args={[holo ? "#05070a" : "#1a1b1f"]} />
      <hemisphereLight args={["#ffffff", "#3a3026", 1.1]} />
      <directionalLight position={[3, 6, 5]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-4, 3, -4]} intensity={0.8} />
      <Suspense fallback={null}>
        <LabPlayers {...props} holo={holo} debugMask={debugMask} />
      </Suspense>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color={holo ? "#0b0f14" : "#2b2520"} roughness={0.9} />
      </mesh>
      <OrbitControls target={[0, close ? 1.45 : 1.25, 0]} />
    </Canvas>
  );
}
