import { describe, expect, it } from "vitest";

import { APEX_ABOVE_M, FLIGHT_S, shotOutcome, shotPath, type Vec3 } from "@/lib/shot-path";

const release: Vec3 = { x: 0.6, y: 2.6, z: -0.2 };
const rim: Vec3 = { x: 0.6, y: 3.05, z: -6.8 };
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("shotOutcome", () => {
  it("ties the shot to the model's confidence", () => {
    expect(shotOutcome(0.81)).toBe("swish");
    expect(shotOutcome(0.7)).toBe("swish");
    expect(shotOutcome(0.69)).toBe("backIron");
    expect(shotOutcome(0.58)).toBe("backIron");
    expect(shotOutcome(0.57)).toBe("rattle");
    expect(shotOutcome(0.5)).toBe("rattle");
  });
});

describe("shotPath", () => {
  for (const outcome of ["swish", "backIron", "rattle"] as const) {
    it(`${outcome}: starts in the hand, goes in, ends under the rim`, () => {
      const path = shotPath(release, rim, outcome);
      expect(dist(path.at(0), release)).toBeLessThan(1e-9);
      // Through the rim at makeAt: inside the ring, at rim height.
      const make = path.at(path.makeAt);
      expect(Math.hypot(make.x - rim.x, make.z - rim.z)).toBeLessThan(0.23);
      expect(Math.abs(make.y - rim.y)).toBeLessThan(0.1);
      const end = path.at(path.duration);
      expect(end.y).toBeLessThan(rim.y - 0.5);
      expect(Math.hypot(end.x - rim.x, end.z - rim.z)).toBeLessThan(0.23);
      expect(path.makeAt).toBeGreaterThanOrEqual(FLIGHT_S);
      expect(path.at(path.duration + 5)).toEqual(end);
    });

    it(`${outcome}: moves smoothly (no jumps between samples)`, () => {
      const path = shotPath(release, rim, outcome);
      let prev = path.at(0);
      for (let t = 0.01; t <= path.duration; t += 0.01) {
        const p = path.at(t);
        expect(dist(p, prev)).toBeLessThan(0.25);
        prev = p;
      }
    });
  }

  it("arcs about 2.5 m over the higher end", () => {
    const path = shotPath(release, rim, "swish");
    let top = -Infinity;
    for (let t = 0; t <= FLIGHT_S; t += 0.005) top = Math.max(top, path.at(t).y);
    expect(top).toBeCloseTo(rim.y + 0.02 + APEX_ABOVE_M, 1);
  });

  it("takes longer to go in the closer the game is", () => {
    const [a, b, c] = (["swish", "backIron", "rattle"] as const).map((o) => shotPath(release, rim, o).makeAt);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});
