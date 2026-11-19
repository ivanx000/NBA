"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { geometryFrom, glowTexture, pointsMaterial, rng, tickPoints } from "./points";

/** The pad a hologram stands on: rings of light points in the team's glow color. */
export function Pad({ color, intensity, still }: { color: string; intensity: number; still: boolean }) {
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
