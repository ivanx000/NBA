"use client";

import { Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";

import { Player } from "@/components/scene/player";
import { hologramColor } from "@/lib/team-colors";
import { teams } from "@/lib/teams";

const COLS = 10;

/** All 30 teams in a grid, standing still, in the site's hologram look (`?alt=1`: alternates). */
export default function AllJerseysScene() {
  const alt = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("alt");
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [0, 4.2, 15], fov: 40 }}>
      <color attach="background" args={["#02040a"]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[-3, 4, 5]} intensity={2.1} />
      <directionalLight position={[4, 2, 3]} intensity={0.55} />
      <Suspense fallback={null}>
        {teams.map((team, i) => {
          const jersey = alt ? team.jersey.alt : team.jersey.primary;
          const x = ((i % COLS) - (COLS - 1) / 2) * 1.25;
          const z = -Math.floor(i / COLS) * 2.6;
          return (
            <group key={team.abbr} position={[x, 0, z]}>
              <Player
                colors={jersey}
                chestText={team.jersey.chest_text}
                number={team.jersey.number}
                hologram={hologramColor(jersey)}
                paused
                idleVariety={false}
              />
              <Html position={[0, -0.25, 0]} center className="pointer-events-none font-mono text-[10px] text-white/70">
                {team.abbr}
              </Html>
            </group>
          );
        })}
      </Suspense>
      <OrbitControls target={[0, 1, -2.6]} />
    </Canvas>
  );
}
