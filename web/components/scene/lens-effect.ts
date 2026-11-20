import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import * as THREE from "three";

/**
 * The cursor lens, after the lions-share site: inside a small circle round the cursor the picture
 * magnifies a little, ripples outward and splits into red and blue at its edge, fading to nothing
 * at the rim. Move over the crowd and the fans swim under it. Strength 0 turns it off.
 */
const fragment = /* glsl */ `
uniform vec2 uMouse;     // the cursor, in uv
uniform vec2 uRes;       // the render size in device px
uniform float uRadius;   // device px
uniform float uStrength; // 0..1
uniform float uClock;

float lensK(vec2 uv) {
  float r = length((uv - uMouse) * uRes) / uRadius;
  float k = uStrength * (1.0 - smoothstep(0.0, 1.0, r));
  return k * k * (3.0 - 2.0 * k);
}

// Everything happens where the picture is sampled: magnify toward the cursor, ripple outward,
// and split red and blue apart (one effect can't both move uvs and sample its input).
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float k = lensK(uv);
  if (k < 0.001) {
    outputColor = inputColor;
    return;
  }
  vec2 d = (uv - uMouse) * uRes;
  float r = length(d) / uRadius;
  vec2 p = uMouse * uRes + d / mix(1.0, 1.14, k);
  p += normalize(d + 1e-5) * sin(r * 9.0 - uClock * 3.0) * 0.035 * uRadius * k;
  vec2 at = p / uRes;
  vec2 off = normalize(d + 1e-5) * 2.2 * k * (uRes.y / 900.0) / uRes;
  outputColor = vec4(
    texture2D(inputBuffer, at + off).r,
    texture2D(inputBuffer, at).g,
    texture2D(inputBuffer, at - off).b,
    inputColor.a
  );
}
`;

export class LensEffect extends Effect {
  constructor() {
    super("LensEffect", fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ["uMouse", new THREE.Uniform(new THREE.Vector2(-1, -1))],
        ["uRes", new THREE.Uniform(new THREE.Vector2(1, 1))],
        ["uRadius", new THREE.Uniform(60)],
        ["uStrength", new THREE.Uniform(0)],
        ["uClock", new THREE.Uniform(0)],
      ]),
    });
  }
}
