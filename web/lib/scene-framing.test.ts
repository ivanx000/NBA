import { describe, expect, it } from "vitest";

import { frameCamera, freeRegion, labelOffset } from "@/lib/scene-framing";

const FOV = 35;

/** Where world point (x, y, 0) lands on screen, in CSS px. */
function project(f: ReturnType<typeof frameCamera>, vp: { width: number; height: number }, x: number, y: number) {
  const t = Math.tan(((FOV / 2) * Math.PI) / 180);
  const ndcX = (x - f.x) / (f.distance * t * (vp.width / vp.height));
  const ndcY = (y - f.y) / (f.distance * t);
  return { left: ((ndcX + 1) / 2) * vp.width, top: ((1 - ndcY) / 2) * vp.height };
}

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
];

describe("frameCamera", () => {
  for (const vp of VIEWPORTS) {
    it(`keeps both players fully visible and centered at ${vp.width}x${vp.height}`, () => {
      const f = frameCamera(vp, FOV);
      const r = freeRegion(vp);
      const head = project(f, vp, 0, 2.05);
      const feet = project(f, vp, 0, -0.2); // the floor under the feet
      expect(head.top).toBeGreaterThanOrEqual(r.top - 1);
      expect(feet.top).toBeLessThanOrEqual(vp.height - r.bottom + 1);
      expect(project(f, vp, -f.playerX - 0.4, 1).left).toBeGreaterThanOrEqual(r.side - 1);
      expect(project(f, vp, f.playerX + 0.4, 1).left).toBeLessThanOrEqual(vp.width - r.side + 1);
      // Symmetric about the screen's center, each player under its team name.
      expect(project(f, vp, 0, 1).left).toBeCloseTo(vp.width / 2, 3);
      expect(project(f, vp, f.playerX, 1).left).toBeCloseTo(vp.width / 2 + labelOffset(vp.width), 3);
    });
  }

  it("makes the players fill most of the screen's height on desktop", () => {
    for (const vp of VIEWPORTS.slice(0, 3)) {
      const f = frameCamera(vp, FOV);
      const height = project(f, vp, 0, 0).top - project(f, vp, 0, 1.98).top;
      expect(height / vp.height).toBeGreaterThan(0.65);
    }
  });
});
