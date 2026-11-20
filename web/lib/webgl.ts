/**
 * Whether to try the 3D scene. A cheap check: creating a throwaway WebGL context just to test
 * costs tens of milliseconds on a phone, and the real canvas then creates its own. If the real
 * context still fails (a blocklisted GPU), R3F's Canvas rethrows the error in render and the
 * error boundaries around it show the 2D version (scene-host.tsx, hologram-stage.tsx).
 * `?webgl=0` forces the 2D version, for checking it on any device.
 */
let support: boolean | undefined;

export function detectWebGL(): boolean {
  if (support === undefined) {
    const forced = new URLSearchParams(window.location.search).get("webgl") === "0";
    support = !forced && (typeof window.WebGL2RenderingContext === "function" || typeof window.WebGLRenderingContext === "function");
  }
  return support;
}
