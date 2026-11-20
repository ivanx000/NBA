"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { glowTexture } from "./points";

let shadowCache: THREE.Texture | null = null;
/** A soft dark blot: the player's contact shadow on the floor (shared, never disposed). */
function shadowTexture() {
  if (shadowCache) return shadowCache;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,0.75)");
  g.addColorStop(0.45, "rgba(0,0,0,0.4)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return (shadowCache = new THREE.CanvasTexture(canvas));
}

/**
 * What's on the floor under a player: his shadow, and when he's hovered a ring in his team's color
 * that pulses outward with a soft pool of light inside it (the "this one?" highlight).
 */
export function FloorMark({ color, active, still }: { color: string; active: boolean; still: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const pulseMat = useRef<THREE.MeshBasicMaterial>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const poolMat = useRef<THREE.MeshBasicMaterial>(null);
  const shown = useRef(0);
  const tint = useMemo(() => new THREE.Color(color).multiplyScalar(1.6), [color]);

  useFrame(({ clock }, dt) => {
    shown.current += ((active ? 1 : 0) - shown.current) * Math.min(1, dt * 8);
    const k = shown.current;
    if (ring.current) ring.current.scale.setScalar(0.8 + 0.2 * k);
    if (ringMat.current) ringMat.current.opacity = k;
    if (poolMat.current) poolMat.current.opacity = 0.55 * k;
    // A second ring that keeps spreading out and fading while hovered.
    const t = still ? 0.5 : (clock.elapsedTime * 0.9) % 1;
    if (pulse.current) pulse.current.scale.setScalar(1 + t * 0.9);
    if (pulseMat.current) pulseMat.current.opacity = k * (1 - t) * 0.8;
  });

  const glow = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const;
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
      <mesh renderOrder={-2}>
        <planeGeometry args={[1.5, 1.1]} />
        <meshBasicMaterial map={shadowTexture()} transparent depthWrite={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.6, 48]} />
        <meshBasicMaterial ref={poolMat} map={glowTexture()} color={tint} opacity={0} {...glow} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.56, 0.6, 64]} />
        <meshBasicMaterial ref={ringMat} color={tint} opacity={0} {...glow} />
      </mesh>
      <mesh ref={pulse}>
        <ringGeometry args={[0.58, 0.6, 64]} />
        <meshBasicMaterial ref={pulseMat} color={tint} opacity={0} {...glow} />
      </mesh>
    </group>
  );
}
