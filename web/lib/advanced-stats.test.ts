import { describe, expect, it } from "vitest";

import { formatStat, leagueAdvanced, showStat, ordinal, playerAdvanced, type PlayerTotals, type TeamTotals, teamValues } from "@/lib/advanced-stats";

const opp = { pts: 100, fgm: 38, fga: 85, fg3m: 12, fta: 20, ftm: 16, oreb: 10, dreb: 33, tov: 14, poss: 100 };
const team = (teamId: number, pts: number, extra: Partial<TeamTotals> = {}): TeamTotals => ({
  teamId, games: 1, minutes: 240, pts, fgm: 40, fga: 88, fg3m: 14, fta: 22, ftm: 18, oreb: 11, dreb: 34, tov: 12, poss: 100, opp, ...extra,
}); // prettier-ignore

describe("team advanced stats", () => {
  it("computes ratings, pace and the four factors", () => {
    const v = teamValues(team(1, 110));
    expect(v.offRating).toBeCloseTo(110);
    expect(v.defRating).toBeCloseTo(100);
    expect(v.netRating).toBeCloseTo(10);
    expect(v.pace).toBeCloseTo(100); // 100 possessions in 48 minutes
    expect(v.efg).toBeCloseTo((40 + 7) / 88);
    expect(v.tovPct).toBeCloseTo(12 / (88 + 0.44 * 22 + 12));
    expect(v.orebPct).toBeCloseTo(11 / (11 + 33));
    expect(v.drebPct).toBeCloseTo(34 / (34 + 10));
    expect(v.ts).toBeCloseTo(110 / (2 * (88 + 0.44 * 22)));
    expect(v.oppEfg).toBeCloseTo((38 + 6) / 85);
  });

  it("ranks the league, lower-is-better stats included", () => {
    const league = leagueAdvanced([team(1, 110), team(2, 120, { tov: 20 }), team(3, 100), team(4, 0, { games: 0 })]);
    expect(league.size).toBe(3); // a team without games isn't ranked
    expect(league.get(2)!.ranks.offRating).toBe(1);
    expect(league.get(3)!.ranks.offRating).toBe(3);
    expect(league.get(2)!.ranks.tovPct).toBe(3); // most turnovers = worst
    expect(league.get(1)!.ranks.defRating).toBe(1); // all allow 100: tied for first
    expect(league.get(1)!.of).toBe(3);
  });
});

describe("player advanced stats", () => {
  const p: PlayerTotals = {
    playerId: 7, games: 10, minutes: 340, pts: 250, reb: 60, ast: 50, fga: 180, fg3m: 25, fg3a: 70, fta: 60, tov: 25,
    team: { minutes: 2400, fga: 880, fta: 220, tov: 130 }, last5: { games: 5, pts: 140, minutes: 170 },
  }; // prettier-ignore

  it("computes shooting, usage and per-36", () => {
    const a = playerAdvanced(p)!;
    expect(a.ts).toBeCloseTo(250 / (2 * (180 + 0.44 * 60)));
    expect(a.usage).toBeCloseTo(((180 + 0.44 * 60 + 25) * (2400 / 5)) / (340 * (880 + 0.44 * 220 + 130)));
    expect(a.per36.pts).toBeCloseTo((36 * 250) / 340);
    expect(a.threePct).toBeCloseTo(25 / 70);
    expect(a.last5Pts).toBe(28);
    expect(a.seasonPts).toBe(25);
  });

  it("hides noisy rates and handles no games", () => {
    const short = playerAdvanced({ ...p, minutes: 40, fg3a: 5 })!;
    expect(short.ts).toBeNull();
    expect(short.usage).toBeNull();
    expect(short.threePct).toBeNull();
    expect(playerAdvanced({ ...p, games: 0, minutes: 0 })).toBeNull();
  });
});

describe("formatting", () => {
  it("formats by kind and ordinals", () => {
    expect(formatStat(112.44, "rating")).toBe("112.4");
    expect(formatStat(0.5412, "pct")).toBe("54.1%");
    expect(formatStat(0.231, "rate")).toBe(".231");
    expect(showStat("netRating", -10.71, "rating")).toBe("−10.7");
    expect(showStat("netRating", 1.94, "rating")).toBe("+1.9");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 30].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "30th"]);
  });
});
