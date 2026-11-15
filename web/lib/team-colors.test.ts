import { describe, expect, it } from "vitest";

import { contrast, matchupJerseys, readableTeamColor } from "@/lib/team-colors";
import { requireTeam, teams } from "@/lib/teams";

describe("team colors", () => {
  it("always returns a color readable on the dark background", () => {
    for (const t of teams) {
      expect(contrast(readableTeamColor(t), "#0A0A0C")).toBeGreaterThanOrEqual(3);
    }
  });

  it("puts the away team in its alternate when primaries clash", () => {
    const chi = requireTeam("CHI");
    const hou = requireTeam("HOU");
    expect(matchupJerseys(chi, hou).away).toEqual(hou.jersey.alt);
    const bos = requireTeam("BOS");
    const lal = requireTeam("LAL");
    expect(matchupJerseys(bos, lal).away).toEqual(lal.jersey.primary);
  });
});
