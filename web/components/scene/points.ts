import * as THREE from "three";

/** Glowing points shared by the room, the pads, the hoop and the sparks. */

/** Random but the same on every load (no flashing layout between renders). */
export function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/**
 * Glowing points: size in px at 1 m, additive, optional twinkle. Returns the material's
 * parameters; JSX builds the material (`<shaderMaterial args={[...]}>`) and code changes its
 * uniforms through a ref.
 */
export function pointsMaterial(size: number, twinkle: number): THREE.ShaderMaterialParameters {
  return {
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: size },
      uTwinkle: { value: twinkle },
      uOpacity: { value: 1 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aSeed;
      attribute vec3 color;
      uniform float uTime, uSize, uTwinkle, uPixelRatio;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 2.2) + aSeed * 40.0));
        gl_PointSize = uSize * aSize * uPixelRatio / max(-mv.z, 0.5);
        vColor = color * tw;
        vFade = 1.0 - smoothstep(14.0, 40.0, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(vColor * a * uOpacity * vFade, 1.0);
      }`,
  };
}

/** Keep a points material's pixel ratio and time current (call from useFrame). */
export function tickPoints(material: THREE.ShaderMaterial | null, dpr: number, time: number | null) {
  if (!material) return;
  material.uniforms.uPixelRatio.value = dpr;
  if (time !== null) material.uniforms.uTime.value = time;
}

export function geometryFrom(positions: number[], colors: number[], sizes: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
  const random = rng(7);
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(sizes.map(() => random()), 1));
  return g;
}

let glowCache: THREE.Texture | null = null;
/** A soft white radial glow, tinted per pad (shared, never disposed). */
export function glowTexture() {
  if (glowCache) return glowCache;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.55, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return (glowCache = new THREE.CanvasTexture(canvas));
}
