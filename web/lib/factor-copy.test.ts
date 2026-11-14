import { describe, expect, it } from "vitest";

import { factorCopy, factorGroups } from "@/lib/factor-copy";

describe("factor copy", () => {
  it("has a template for every group", () => {
    expect(factorGroups.length).toBeGreaterThan(5);
    for (const g of factorGroups) {
      expect(g.template.includes("{team}") || g.template.includes("{opponent}")).toBe(true);
    }
  });

  it("fills in the favored team and opponent", () => {
    const names = { home: "Knicks", away: "Celtics" };
    const rest = factorCopy(
      { factor: "rest", label: "Rest and schedule", favors: "away", pp: -0.0412, logit: -0.17 },
      names,
    );
    expect(rest).toEqual({ text: "Celtics better rested", points: 4.1, favors: "away" });
    const travel = factorCopy(
      { factor: "travel", label: "Travel", favors: "home", pp: 0.012, logit: 0.05 },
      names,
    );
    expect(travel.text).toBe("Celtics on a tougher trip");
  });
});
