import * as THREE from "three";

import type { JerseyColorway } from "@/lib/teams";

/**
 * Approach B: recolor the base player's white uniform in the shader.
 *
 * - The channel mask (UV space, baked by `pnpm assets:mask`) marks the uniform (red), collar and
 *   armhole trim (green) and the shorts' side stripes (blue).
 * - Bind-pose position (the vertex position before skinning, converted to meters) splits jersey
 *   from shorts and places the lettering. Bind-pose coordinates move with the skin, so the
 *   lettering follows every animation.
 * - Fabric shading comes from the base texture's brightness, so folds and shadows stay.
 */

export interface TintOptions {
  colors: JerseyColorway;
  chestText: string;
  number: string;
  mask: THREE.Texture;
  /** Bind-pose bounding box of the geometry, in the attribute's own units. */
  bounds: THREE.Box3;
  heightM: number;
  /** Paint the mask channels instead of the uniform (dev only). */
  debugMask?: boolean;
  /**
   * Draw the player as a hologram in this color: unlit and additive, brightness from the
   * tinted uniform and skin (so lettering and the face still read), a rim glow, screen
   * scanlines, a band sweeping up the body and a slight flicker.
   */
  hologram?: string | null;
  /** Color the lettering glows in (the jersey's text color as a hologram). */
  hologramInk?: string | null;
}

/**
 * Regions in meters, for the 1.98 m model (feet at 0, facing +z). Trim and side stripes are baked
 * into the mask's green and blue channels by `pnpm assets:mask`, which uses the same waist.
 */
const REGION = {
  waist: 1.06, // below: shorts
  chest: { x: 0.17, y0: 1.18, y1: 1.52 }, // lettering box on the front
  back: { x: 0.15, y0: 1.2, y1: 1.5 }, // number on the back
};

function lettering(text: string, number: string, color: string, withText: boolean) {
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
  if (withText) {
    let size = 120;
    ctx.font = `700 ${size}px ${family}`;
    while (ctx.measureText(text).width > 400 && size > 40) {
      size -= 4;
      ctx.font = `700 ${size}px ${family}`;
    }
    ctx.fillText(text, 256, 110);
    ctx.font = `700 280px ${family}`;
    ctx.fillText(number, 256, 345);
  } else {
    ctx.font = `700 400px ${family}`;
    ctx.fillText(number, 256, 270);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function holoGain(color: string | null | undefined): number {
  if (!color) return 1;
  const c = new THREE.Color(color);
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear
  return luma > 0.5 ? 0.6 : 1;
}

/** Clone ``source`` into a tinted material. Dispose the returned textures with the material. */
export function makeTintMaterial(source: THREE.MeshStandardMaterial, opts: TintOptions) {
  const material = source.clone();
  const front = lettering(opts.chestText, opts.number, opts.colors.text, true);
  const back = lettering(opts.chestText, opts.number, opts.colors.text, false);
  const size = opts.bounds.getSize(new THREE.Vector3());
  const center = opts.bounds.getCenter(new THREE.Vector3());

  const uniforms = {
    uMask: { value: opts.mask },
    uFront: { value: front },
    uBack: { value: back },
    uJersey: { value: new THREE.Color(opts.colors.base) },
    uTrim: { value: new THREE.Color(opts.colors.trim) },
    uShorts: { value: new THREE.Color(opts.colors.shorts) },
    uOrigin: { value: new THREE.Vector3(center.x, opts.bounds.min.y, center.z) },
    uScale: { value: opts.heightM / size.y },
    uHolo: { value: new THREE.Color(opts.hologram ?? "#ffffff") },
    uInk: { value: new THREE.Color(opts.hologramInk ?? "#ffffff") },
    // Bright (white-ish) holograms bloom much more: bring them down to match colored ones.
    uGain: { value: holoGain(opts.hologram) },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
  };
  if (opts.hologram) {
    material.defines = { ...material.defines, TIPOFF_HOLO: "" };
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
  }

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBind = position;");
    const r = REGION;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vBind;
uniform sampler2D uMask, uFront, uBack;
uniform vec3 uJersey, uTrim, uShorts, uOrigin;
uniform float uScale, uTime, uIntensity;
uniform vec3 uHolo, uInk;
uniform float uGain;
float gUniform = 0.0; // jersey or shorts
float gTrim = 0.0;    // collar, armholes, side stripes
float gInk = 0.0;     // lettering
float gLum = 0.0;     // brightness of the tinted surface
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float boxCoord(float v, float a, float b) { return (v - a) / (b - a); }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  vec3 p = (vBind - uOrigin) * uScale; // meters
  vec3 mask = texture2D(uMask, vMapUv).rgb; // r uniform, g trim, b side stripe (baked)
  float m = mask.r;
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  // Keep the folds but tame the highlight creases painted into the white base texture.
  float shade = clamp(0.45 + 0.6 * lum / 0.72, 0.4, 1.05);
  bool shorts = p.y < ${r.waist.toFixed(3)};
  vec3 kit = shorts ? uShorts : uJersey;
  kit = mix(kit, uTrim, max(mask.g, mask.b));
  vec4 ink = vec4(0.0);
  if (!shorts && p.z > 0.0 && abs(p.x) < ${r.chest.x.toFixed(3)}) {
    vec2 uv = vec2(boxCoord(p.x, -${r.chest.x.toFixed(3)}, ${r.chest.x.toFixed(3)}),
                   boxCoord(p.y, ${r.chest.y0.toFixed(3)}, ${r.chest.y1.toFixed(3)}));
    if (uv.y > 0.0 && uv.y < 1.0) ink = texture2D(uFront, uv);
  } else if (!shorts && p.z < 0.0 && abs(p.x) < ${r.back.x.toFixed(3)}) {
    vec2 uv = vec2(boxCoord(-p.x, -${r.back.x.toFixed(3)}, ${r.back.x.toFixed(3)}),
                   boxCoord(p.y, ${r.back.y0.toFixed(3)}, ${r.back.y1.toFixed(3)}));
    if (uv.y > 0.0 && uv.y < 1.0) ink = texture2D(uBack, uv);
  }
  kit = mix(kit, ink.rgb, ink.a);
  diffuseColor.rgb = mix(diffuseColor.rgb, kit * shade, m);
  gUniform = m;
  gTrim = m * max(mask.g, mask.b);
  gInk = m * ink.a;
  gLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  ${opts.debugMask ? "diffuseColor.rgb = mask;" : ""}
}`,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
#ifdef TIPOFF_HOLO
{
  // A projected hologram (DESIGN.md section 1): fine contour lines that follow the body, a
  // glowing outline, twinkling points, a sweep band; the uniform is filled more solidly than the
  // skin so it reads as clothing, and the lettering is bright and solid.
  vec3 p = (vBind - uOrigin) * uScale; // bind-pose meters
  float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
  float ly = p.y * 55.0;
  float line = 1.0 - min(abs(fract(ly) - 0.5) / max(fwidth(ly), 1e-4), 1.0);
  vec3 cell = floor(p * 30.0);
  float h = hash13(cell);
  float dotShape = smoothstep(0.32, 0.0, length(fract(p * 30.0) - 0.5));
  float sparkle = step(0.94, h) * dotShape * (0.55 + 0.45 * sin(uTime * (2.0 + 3.0 * h) + h * 50.0));
  float band = pow(0.5 + 0.5 * sin(p.y * 2.6 - uTime * 1.4), 18.0);
  float flicker = 0.95 + 0.05 * sin(uTime * 21.0) * sin(uTime * 6.7);

  float fill = mix(0.03, 0.13, gUniform) + 0.12 * gLum; // dark core: the glow comes from lines
  float glow = fill + line * mix(0.42, 0.55, gUniform) + rim * 1.7 + band * 0.3 + gTrim * 0.9;
  vec3 col = uHolo * glow;
  col += mix(uHolo, vec3(1.0), 0.75) * sparkle * 2.2;
  // Lettering: solid, in the jersey's text color, drawn over the body glow so it reads.
  col = mix(col, uInk * 1.9, gInk);
  gl_FragColor = linearToOutputTexel(vec4(col * flicker * uIntensity * uGain, 1.0));
}
#endif`,
      );
  };
  const variant = `${opts.debugMask ? "-debug" : ""}${opts.hologram ? "-holo" : ""}`; // same program for every color
  material.customProgramCacheKey = () => `tipoff-tint-v3${variant}`;
  return {
    material,
    textures: [front, back],
    /** Advance time-based effects (hologram sweep and flicker) and set hologram brightness. */
    tick: (seconds: number, intensity = 1) => {
      uniforms.uTime.value = seconds;
      uniforms.uIntensity.value = intensity;
    },
  };
}
