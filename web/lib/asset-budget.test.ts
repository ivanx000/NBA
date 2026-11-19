import { statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Size budgets for the 3D assets the site downloads (docs/ASSET_PIPELINE.md section 7). Runs in
 * CI with the other web tests, so a regenerated model can't quietly bloat the home page.
 */
const KB = 1024;
const MB = 1024 * KB;
const BUDGETS: [file: string, maxBytes: number][] = [
  ["public/models/player.glb", 4 * MB], // loaded by the home page
  ["public/textures/player/uniform_mask.webp", 64 * KB], // loaded by the home page
  ["public/models/motion-library.glb", 5 * MB], // dev lab only
];

describe("asset size budgets", () => {
  for (const [file, max] of BUDGETS) {
    it(`${file} is at most ${(max / MB).toFixed(2)} MB`, () => {
      const size = statSync(path.join(process.cwd(), file)).size;
      expect(size).toBeLessThanOrEqual(max);
    });
  }
});
