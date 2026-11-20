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
   * Draw the player as a hologram with this glow color (DESIGN.md section 1): lit in his real
   * colors, with dark see-through scan lines drifting up, a rim glow, a brighter band sweeping up
   * now and then, and a slight flicker. Null: plain shading.
   */
  hologram?: string | null;
}

/** Hologram look; one place to tune it. */
export const HOLO = {
  /** Brightest the lit surface gets (linear), under the bloom threshold so skin and jersey stay crisp. */
  ceiling: 0.62,
  /** Opacity of the darkest parts (lit parts and the rim go solid). */
  alpha: 0.5,
  /** How see-through the gaps between scan lines are, and how dark. */
  gap: 0.38,
  bandDepth: 0.4,
  /** Scan lines per meter of height, and how fast they drift up (m/s). */
  bands: 95,
  bandSpeed: 0.06,
  /** Rim glow strength and tightness (higher = tighter). Above the bloom threshold, so it glows. */
  rim: 0.95,
  rimPower: 2.4,
  /** A thin bright outline right at the silhouette, for a crisp edge. */
  edge: 0.7,
  /** How strongly a glitch slice flashes (0 to 1); glitches come every 10 seconds or so. */
  glitch: 0.8,
  sweep: 0.16,
  /** Hover highlight: extra rim glow and a lift of the whole body at full highlight. */
  highlightRim: 1.3,
  highlightLift: 0.25,
} as const;

/**
 * Regions in meters, for the 1.98 m model (feet at 0, facing +z). Trim and side stripes are baked
 * into the mask's green and blue channels by `pnpm assets:mask`, which uses the same waist.
 */
const REGION = {
  waist: 1.06, // below: shorts
  chest: { x: 0.17, y0: 1.18, y1: 1.52 }, // lettering box on the front
  back: { x: 0.15, y0: 1.2, y1: 1.5 }, // number on the back
};

function jerseyFamily(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--font-jersey").trim();
}

let fontReady: Promise<void> | undefined;

/**
 * Resolves once the jersey font (Oswald) has loaded. A canvas doesn't wait for web fonts: lettering
 * drawn before it arrives comes out in the fallback face, so the player suspends on this first.
 */
export function jerseyFontReady(): Promise<void> {
  fontReady ??= (async () => {
    const family = jerseyFamily();
    if (family) await document.fonts.load(`700 100px ${family}`);
  })().catch(() => {}); // fall back to Impact rather than fail the scene
  return fontReady;
}

function lettering(text: string, number: string, color: string, withText: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const family = jerseyFamily() || "Impact, sans-serif";
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

/** A float literal for GLSL. */
const f = (n: number) => n.toFixed(4);

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
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uHighlight: { value: 0 },
  };
  if (opts.hologram) {
    material.defines = { ...material.defines, TIPOFF_HOLO: "" };
    // Translucent, drawn over the player's own depth pre-pass so only the nearest surface shows.
    material.transparent = true;
    material.depthWrite = false;
    material.depthFunc = THREE.LessEqualDepth;
    material.envMapIntensity = 0.35;
  }

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBind;")
      .replace("#include <common>", "#include <common>\nvarying float vWorldY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBind = position;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;");
    const r = REGION;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vBind;
uniform sampler2D uMask, uFront, uBack;
uniform vec3 uJersey, uTrim, uShorts, uOrigin;
uniform float uScale, uTime, uIntensity, uHighlight;
uniform vec3 uHolo;
varying float vWorldY;
float holoHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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
  ${opts.debugMask ? "diffuseColor.rgb = mask;" : ""}
}`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#ifdef TIPOFF_HOLO
{
  // The hologram (DESIGN.md section 1), after the lit color: his real colors under dark,
  // see-through scan lines drifting up and a rim glow.
  vec3 col = outgoingLight;
  // Soft ceiling under the bloom threshold: the lit surface never blooms, only the rim does.
  float top = max(col.r, max(col.g, col.b));
  float knee = ${f(HOLO.ceiling * 0.7)};
  if (top > knee) col *= (knee + ${f(HOLO.ceiling * 0.3)} * (1.0 - exp(-(top - knee) / ${f(HOLO.ceiling * 0.3)}))) / top;
  float lit = pow(clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)) / ${f(HOLO.ceiling)}, 0.0, 1.0), 0.65);
  float ndv = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
  float fres = pow(1.0 - ndv, ${f(HOLO.rimPower)});
  float y = vWorldY;

  float band = fract((y - uTime * ${f(HOLO.bandSpeed)}) * ${f(HOLO.bands)});
  float bright = smoothstep(0.0, 0.22, band) * smoothstep(1.0, 0.6, band);
  col *= 1.0 - ${f(HOLO.bandDepth)} * (1.0 - bright);
  float alpha = mix(${f(HOLO.alpha)}, 1.0, lit) * (1.0 - ${f(HOLO.gap)} * (1.0 - bright));
  alpha = clamp(alpha + fres * 0.6, 0.0, 1.0);

  float sweepY = mix(-0.3, 2.3, fract(uTime * 0.11));
  col += uHolo * ${f(HOLO.sweep)} * exp(-pow((y - sweepY) * 8.0, 2.0));
  col += uHolo * fres * ${f(HOLO.rim)};
  col += mix(uHolo, vec3(1.0), 0.6) * pow(1.0 - ndv, 6.0) * ${f(HOLO.edge)};
  // Hovered: a brighter, wider rim in the team color and a lift, so he pops off the room.
  col *= 1.0 + ${f(HOLO.highlightLift)} * uHighlight;
  col += mix(uHolo, vec3(1.0), 0.35) * pow(1.0 - ndv, 1.6) * ${f(HOLO.highlightRim)} * uHighlight;
  alpha = mix(alpha, 1.0, 0.35 * uHighlight);

  // Glitch: now and then a few thin slices flash and tint, like a signal dropping for a frame or
  // two. Done here, not by moving vertices: the surface must match its depth pre-pass exactly.
  float when = step(0.985, fract(sin(floor(uTime * 6.0) * 91.7) * 4375.85));
  float slice = floor(y * 14.0 + floor(uTime * 24.0) * 3.1);
  float hit = when * step(0.72, fract(sin(slice * 12.9898) * 43758.5453));
  col = mix(col, uHolo * 1.6 + col * 0.4, hit * ${f(HOLO.glitch)});
  alpha = mix(alpha, 0.35, hit * 0.6);

  // Flicker: a quick dip every few seconds, with a little line noise.
  float beat = step(0.985, fract(sin(floor(uTime * 3.0) * 91.7) * 4375.85));
  col *= 1.0 - beat * (0.35 + 0.65 * holoHash(vec2(floor(y * 70.0), floor(uTime * 40.0)))) * 0.3;

  outgoingLight = col * uIntensity;
  diffuseColor.a = alpha * mix(0.35, 1.0, uIntensity);
}
#endif
#include <opaque_fragment>`,
      );
  };
  const variant = `${opts.debugMask ? "-debug" : ""}${opts.hologram ? "-holo" : ""}`; // same program for every color
  material.customProgramCacheKey = () => `tipoff-tint-v8${variant}`;
  return {
    material,
    textures: [front, back],
    /** Advance time-based effects (hologram sweep and flicker) and set hologram brightness and highlight. */
    tick: (seconds: number, intensity = 1, highlight = 0) => {
      uniforms.uTime.value = seconds;
      uniforms.uIntensity.value = intensity;
      uniforms.uHighlight.value = highlight;
    },
  };
}
