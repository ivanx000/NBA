import { describe, expect, it } from "vitest";

import { frameCamera, freeRegion } from "@/lib/scene-framing";

const FOV = 35;

/** Where world point (x, y, 0) lands on screen, in CSS px. */
function project(f: ReturnType<typeof frameCamera>, vp: { width: number; height: number }, x: number, y: number) {
  const t = Math.tan(((FOV / 2) * Math.PI) / 180);
  const ndcX = (x - f.x) / (f.distance * t * (vp.width / vp.height));
  const ndcY = (y - f.y) / (f.distance * t);
  return { left: ((ndcX + 1) / 2) * vp.width, top: ((1 - ndcY) / 2) * vp.height };
}

describe("frameCamera", () => {
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
  ]) {
    it(`keeps both players inside the free region at ${vp.width}x${vp.height}`, () => {
      const f = frameCamera(vp, FOV);
      const r = freeRegion(vp);
      const head = project(f, vp, 0, 2.25);
      const feet = project(f, vp, 0, -0.05);
      const leftEdge = project(f, vp, -f.playerX - 0.4, 1);
      const rightEdge = project(f, vp, f.playerX + 0.4, 1);
      expect(head.top).toBeGreaterThanOrEqual(r.top - 1);
      expect(feet.top).toBeLessThanOrEqual(vp.height - r.bottom + 1);
      expect(leftEdge.left).toBeGreaterThanOrEqual(r.left - 1);
      expect(rightEdge.left).toBeLessThanOrEqual(vp.width + 1);
    });
  }

  it("makes the players fill most of the region's height on desktop", () => {
    const vp = { width: 1440, height: 900 };
    const f = frameCamera(vp, FOV);
    const r = freeRegion(vp);
    const height = project(f, vp, 0, 0).top - project(f, vp, 0, 2).top;
    expect(height / (vp.height - r.top - r.bottom)).toBeGreaterThan(0.8);
  });
});
