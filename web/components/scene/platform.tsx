"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { glowTexture } from "./points";

/** The platform's top is the floor the players stand on (y = 0); it rises this far above the arena floor. */
export const PLATFORM_HEIGHT_M = 0.16;
/** Largest platform radius; narrow screens (players closer together) get smaller ones. */
const MAX_RADIUS = 0.62;

/** A soft column of light rising from the platform, fading upward (additive, in the team color). */
function beamMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uStrength: { value: 0.07 } },
    vertexShader: /* glsl */ `
      varying float vH;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vH;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        // Brightest at the base and at the beam's edges (seen side-on), gone by the top.
        float edge = pow(1.0 - abs(dot(vN, vV)), 1.5);
        float fade = pow(1.0 - vH, 2.2);
        gl_FragColor = vec4(uColor * uStrength * fade * (0.35 + edge), 1.0);
      }`,
  });
}

/** Motes of light drifting up the beam, in the team color, fading near the top. */
function motesMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uTime: { value: 0 }, uStrength: { value: 1 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uPixelRatio;
      varying float vLife;
      void main() {
        vec3 p = position;
        float h = mod(aSeed * 2.3 + uTime * (0.22 + aSeed * 0.18), 2.3);
        p.y = h;
        vLife = (1.0 - h / 2.3) * smoothstep(0.0, 0.25, h);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (3.0 + 4.0 * aSeed) * uPixelRatio / max(-mv.z, 0.5);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor * 1.6 * a * a * vLife * uStrength, 1.0);
      }`,
  });
}

function motesGeometry() {
  const g = new THREE.BufferGeometry();
  const n = 46;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * 7.3;
    const r = 0.18 + ((i * 37) % 11) / 11 * 0.3;
    pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3);
    seed[i] = ((i * 53) % 97) / 97;
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  return g;
}

/**
 * The raised hexagonal platform a hologram stands on: a dark, glossy plinth with glowing edges
 * and a target inlay in the team's color, and a faint column of light rising from it. It holds
 * still (only faint motes drift up its light); it brightens when the player is hovered and dims
 * when another player is in focus.
 */
export function Platform({
  color,
  intensity,
  still,
  radius: wanted = MAX_RADIUS,
}: {
  color: string;
  intensity: number;
  still: boolean;
  /** Radius in meters (capped at the largest size). */
  radius?: number;
}) {
  const RADIUS = Math.min(MAX_RADIUS, wanted);
  const motes = useMemo(() => ({ geometry: motesGeometry(), material: motesMaterial(new THREE.Color(color)) }), [color]);
  const motesMat = useRef<THREE.ShaderMaterial>(null);
  const { edges, inlay, tint, beam } = useMemo(() => {
    const prism = new THREE.CylinderGeometry(RADIUS, RADIUS + 0.06, PLATFORM_HEIGHT_M, 6, 1);
    const edgeGeometry = new THREE.EdgesGeometry(prism);
    prism.dispose();
    // An inner hexagon and a ring on the top face.
    const pts: THREE.Vector3[] = [];
    const hex = (r: number) => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = ((i + 1) / 6) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Vector3(Math.cos(b) * r, 0, Math.sin(b) * r));
      }
    };
    hex(RADIUS * 0.78);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const b = ((i + 1) / 48) * Math.PI * 2;
      if (i % 4 === 3) continue; // a dashed ring
      const r = RADIUS * 0.5;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Vector3(Math.cos(b) * r, 0, Math.sin(b) * r));
    }
    const team = new THREE.Color(color);
    return {
      edges: edgeGeometry,
      inlay: new THREE.BufferGeometry().setFromPoints(pts),
      tint: {
        edge: team.clone().lerp(new THREE.Color("#ffffff"), 0.3).multiplyScalar(1.9),
        inlay: team.clone().multiplyScalar(1.2),
      },
      beam: beamMaterial(team.clone()),
    };
  }, [color, RADIUS]);

  const edgeMat = useRef<THREE.LineBasicMaterial>(null);
  const inlayMat = useRef<THREE.LineBasicMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const beamMat = useRef<THREE.ShaderMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const shown = useRef(intensity);
  useFrame(({ clock, viewport }, dt) => {
    shown.current += (intensity - shown.current) * Math.min(1, dt * 6);
    const m = motesMat.current;
    if (m) {
      m.uniforms.uPixelRatio.value = viewport.dpr;
      m.uniforms.uStrength.value = Math.min(1.4, shown.current);
      if (!still) m.uniforms.uTime.value = clock.elapsedTime;
    }
    const k = shown.current;
    if (edgeMat.current) edgeMat.current.opacity = Math.min(1, k);
    if (inlayMat.current) inlayMat.current.opacity = 0.7 * Math.min(1, k);
    if (glowMat.current) glowMat.current.opacity = 0.55 * k;
    if (beamMat.current) beamMat.current.uniforms.uStrength.value = 0.07 * k;
    if (light.current) light.current.intensity = 1.8 * k;
  });

  const line = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
  return (
    // A flat side faces the camera.
    <group rotation={[0, Math.PI / 6, 0]}>
      <mesh position={[0, -PLATFORM_HEIGHT_M / 2, 0]}>
        <cylinderGeometry args={[RADIUS, RADIUS + 0.06, PLATFORM_HEIGHT_M, 6, 1]} />
        <meshStandardMaterial color="#070b18" metalness={0.75} roughness={0.32} envMapIntensity={0.7} />
      </mesh>
      <lineSegments geometry={edges} position={[0, -PLATFORM_HEIGHT_M / 2, 0]}>
        <lineBasicMaterial ref={edgeMat} color={tint.edge} {...line} />
      </lineSegments>
      <lineSegments geometry={inlay} position={[0, 0.004, 0]}>
        <lineBasicMaterial ref={inlayMat} color={tint.inlay} {...line} />
      </lineSegments>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[RADIUS * 0.75, 48]} />
        <meshBasicMaterial ref={glowMat} map={glowTexture()} color={color} {...line} />
      </mesh>
      <mesh position={[0, 1.25, 0]}>
        <cylinderGeometry args={[RADIUS * 0.55, RADIUS * 0.8, 2.5, 6, 1, true]} />
        <primitive ref={beamMat} object={beam} attach="material" />
      </mesh>
      <points geometry={motes.geometry} frustumCulled={false}>
        <primitive ref={motesMat} object={motes.material} attach="material" />
      </points>
      <pointLight ref={light} position={[0, 0.3, 0.35]} color={color} intensity={1.8} distance={2.6} decay={2} />
    </group>
  );
}
