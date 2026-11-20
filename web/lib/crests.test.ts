import { describe, expect, it } from "vitest";

import { CRESTS } from "@/lib/crests";
import { teams } from "@/lib/teams";

describe("center-court crests", () => {
  it("has one for every team and none for unknown teams", () => {
    expect(Object.keys(CRESTS).sort()).toEqual(teams.map((t) => t.abbr).sort());
  });

  it("gives every team its own symbol", () => {
    const motifs = Object.values(CRESTS).map((c) => c.motif);
    expect(new Set(motifs).size).toBe(motifs.length);
  });

  it("never repeats a shape and layout pair beyond what 30 teams need", () => {
    const pairs = Object.values(CRESTS).map((c) => `${c.shape}/${c.layout}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
