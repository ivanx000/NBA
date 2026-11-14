import { describe, expect, it } from "vitest";

import { getTeam, requireTeam, teamFullName, teams } from "@/lib/teams";

describe("teams", () => {
  it("has 30 teams with unique ids and abbreviations", () => {
    expect(teams).toHaveLength(30);
    expect(new Set(teams.map((t) => t.team_id)).size).toBe(30);
    expect(new Set(teams.map((t) => t.abbr)).size).toBe(30);
  });

  it("uses valid hex colors for team and jersey colors", () => {
    const hex = /^#[0-9A-Fa-f]{6}$/;
    for (const t of teams) {
      expect(t.colors.primary).toMatch(hex);
      expect(t.colors.secondary).toMatch(hex);
      for (const way of [t.jersey.primary, t.jersey.alt]) {
        for (const c of Object.values(way)) expect(c).toMatch(hex);
      }
    }
  });

  it("looks teams up by abbreviation and id", () => {
    const bos = requireTeam("bos");
    expect(teamFullName(bos)).toBe("Boston Celtics");
    expect(getTeam(bos.team_id)).toBe(bos);
    expect(getTeam("XXX")).toBeUndefined();
    expect(() => requireTeam("XXX")).toThrow();
  });
});
