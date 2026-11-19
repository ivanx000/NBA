import { describe, expect, it } from "vitest";

import factors from "../../shared/factors.json";
import {
  EXAMPLE_BASE,
  EXAMPLE_PREDICTION,
  EXAMPLE_REASONS,
  FACTOR_COUNT,
  LEARNED_GAMES,
  runningTotals,
  stage,
  TEST_GAMES,
} from "@/lib/story";

describe("story numbers", () => {
  it("counts the same games as the model docs", () => {
    expect(LEARNED_GAMES).toBe(11_979); // 2015-16 to 2024-25, the champion's refit
    expect(TEST_GAMES).toBe(1_230);
  });

  it("adds the example's reasons up to its prediction", () => {
    expect(EXAMPLE_PREDICTION).toBeCloseTo(0.63, 6);
    const totals = runningTotals();
    expect(totals[0].from).toBe(EXAMPLE_BASE);
    expect(totals.at(-1)!.to).toBeCloseTo(EXAMPLE_PREDICTION, 9);
  });

  it("uses the factor names and copy from shared/factors.json", () => {
    expect(factors.groups).toHaveLength(FACTOR_COUNT);
    for (const r of EXAMPLE_REASONS.slice(0, -1)) {
      const group = factors.groups.find((g) => g.label === r.factor);
      expect(group, r.factor).toBeDefined();
      const [team, opponent] = r.points > 0 ? ["Knicks", "Celtics"] : ["Celtics", "Knicks"];
      expect(r.copy).toBe(group!.template.replace("{team}", team).replace("{opponent}", opponent));
    }
  });
});

describe("stage", () => {
  it("maps progress onto a step", () => {
    expect(stage(0.1, 0.2, 0.6)).toBe(0);
    expect(stage(0.4, 0.2, 0.6)).toBeCloseTo(0.5);
    expect(stage(0.9, 0.2, 0.6)).toBe(1);
  });
});
