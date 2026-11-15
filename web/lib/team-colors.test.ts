import { describe, expect, it } from "vitest";

import {
  contrast,
  hologramColor,
  hologramMatchup,
  hologramsClash,
  matchupJerseys,
  readableTeamColor,
} from "@/lib/team-colors";
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

describe("hologramColor", () => {
  const hex = /^#[0-9A-F]{6}$/;
  it("keeps a dark team's hue but brightens it", () => {
    const bos = hologramColor(requireTeam("BOS").jersey.primary); // #007A33 green
    expect(bos).toMatch(hex);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(bos.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(150);
  });
  it("gives every team a valid color", () => {
    for (const t of teams) {
      expect(hologramColor(t.jersey.primary)).toMatch(hex);
      expect(hologramColor(t.jersey.alt)).toMatch(hex);
    }
  });
});

describe("hologramMatchup", () => {
  it("switches one team to its alternate when both holograms would be blue", () => {
    const m = hologramMatchup(requireTeam("PHI"), requireTeam("IND"));
    expect(hologramsClash(m.home.color, m.away.color)).toBe(false);
    expect(m.away.jersey).toEqual(requireTeam("IND").jersey.alt);
  });

  it("keeps primaries when the holograms already differ", () => {
    const m = hologramMatchup(requireTeam("BOS"), requireTeam("LAL"));
    expect(m.home.jersey).toEqual(requireTeam("BOS").jersey.primary);
    expect(m.away.jersey).toEqual(requireTeam("LAL").jersey.primary);
  });

  it("gives every matchup two distinguishable holograms", () => {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        const m = hologramMatchup(home, away);
        expect(hologramsClash(m.home.color, m.away.color), `${away.abbr} @ ${home.abbr}`).toBe(false);
      }
    }
  });
});
