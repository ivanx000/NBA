"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { JerseyColorway } from "@/lib/teams";

const SKIN = "#7c818a"; // neutral mannequin: no real likenesses (CLAUDE.md, Brand and IP)

function chestTexture(text: string, number: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const family =
    getComputedStyle(document.documentElement).getPropertyValue("--font-oswald").trim() ||
    "Impact, sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 96;
  ctx.font = `700 ${size}px ${family}`;
  while (ctx.measureText(text).width > 440 && size > 40) {
    size -= 4;
    ctx.font = `700 ${size}px ${family}`;
  }
  ctx.fillText(text, 256, 120);
  ctx.font = `700 260px ${family}`;
  ctx.fillText(number, 256, 330);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A stand-in player built from primitives, until the rigged model lands (Phase 6). */
export function PlaceholderPlayer({
  position,
  rotationY,
  jersey,
  chestText,
  number,
  phaseOffset,
  animate,
  dimmed,
}: {
  position: [number, number, number];
  rotationY: number;
  jersey: JerseyColorway;
  chestText: string;
  number: string;
  phaseOffset: number;
  animate: boolean;
  dimmed: boolean;
}) {
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Mesh>(null);
  const texture = useMemo(
    () => (typeof document === "undefined" ? null : chestTexture(chestText, number, jersey.text)),
    [chestText, number, jersey.text],
  );
  useEffect(() => () => texture?.dispose(), [texture]);

  useFrame(({ clock }) => {
    if (!animate || !body.current || !head.current) return;
    const t = clock.elapsedTime + phaseOffset;
    // Idle: a slow weight shift, a light bounce and a look around, each on its own period.
    body.current.position.y = Math.sin(t * 2.1) * 0.012;
    body.current.rotation.z = Math.sin(t * 0.55) * 0.025;
    head.current.rotation.y = Math.sin(t * 0.33) * 0.3;
  });

  const skin = <meshStandardMaterial color={SKIN} roughness={0.75} />;
  const kit = (c: string) => <meshStandardMaterial color={c} roughness={0.6} />;
  const opacity = dimmed ? 0.35 : 1;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <group ref={body}>
        {/* legs */}
        {[-0.11, 0.11].map((x) => (
          <mesh key={x} position={[x, 0.48, 0]} castShadow>
            <capsuleGeometry args={[0.075, 0.78, 6, 12]} />
            {skin}
          </mesh>
        ))}
        {/* shorts */}
        <mesh position={[0, 0.98, 0]} castShadow>
          <cylinderGeometry args={[0.23, 0.26, 0.36, 20]} />
          {kit(jersey.shorts)}
        </mesh>
        {/* torso (jersey) */}
        <mesh position={[0, 1.38, 0]} castShadow>
          <capsuleGeometry args={[0.21, 0.42, 8, 20]} />
          {kit(jersey.base)}
        </mesh>
        {/* collar trim */}
        <mesh position={[0, 1.66, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.1, 0.018, 8, 24]} />
          {kit(jersey.trim)}
        </mesh>
        {texture && (
          <mesh position={[0, 1.42, 0.215]}>
            <planeGeometry args={[0.34, 0.34]} />
            <meshStandardMaterial map={texture} transparent roughness={0.6} />
          </mesh>
        )}
        {/* arms */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.31, 1.3, 0]} rotation={[0, 0, s * 0.18]} castShadow>
            <capsuleGeometry args={[0.06, 0.62, 6, 12]} />
            {skin}
          </mesh>
        ))}
        {/* head */}
        <mesh ref={head} position={[0, 1.86, 0]} castShadow>
          <sphereGeometry args={[0.13, 24, 24]} />
          {skin}
        </mesh>
      </group>
      {/* soft contact shadow so they don't float */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[0.38, 32]} />
        <meshBasicMaterial color="black" transparent opacity={0.35 * opacity} />
      </mesh>
    </group>
  );
}
