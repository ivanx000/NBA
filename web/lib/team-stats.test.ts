import { describe, expect, it } from "vitest";

import { headToHead, type PastGame, recentGames, seriesGames, teamStats } from "@/lib/team-stats";

const BOS = 1;
const NYK = 2;
const LAL = 3;
const g = (gameDate: string, homeTeamId: number, awayTeamId: number, homeScore: number, awayScore: number): PastGame => ({
  gameDate, homeTeamId, awayTeamId, homeScore, awayScore,
}); // prettier-ignore

const past = [
  g("2026-11-01", BOS, NYK, 110, 100), // BOS W (home)
  g("2026-11-03", LAL, BOS, 120, 100), // BOS L (away)
  g("2026-11-05", NYK, BOS, 99, 101), // BOS W (away)
  g("2026-11-06", BOS, LAL, 105, 95), // BOS W (home)
  g("2026-11-20", BOS, LAL, 90, 80), // after the game day: ignored
];

describe("teamStats", () => {
  it("works out records, form, scoring and rest from games before the day", () => {
    const s = teamStats(past, BOS, "2026-11-07");
    expect(s.games).toBe(4);
    expect(s.record).toEqual({ wins: 3, losses: 1 });
    expect(s.home).toEqual({ wins: 2, losses: 0 });
    expect(s.away).toEqual({ wins: 1, losses: 1 });
    expect(s.last10).toEqual({ wins: 3, losses: 1 });
    expect(s.streak).toBe("W2");
    expect(s.pointsFor).toBe(104); // (110+100+101+105)/4
    expect(s.pointsAgainst).toBe(103.5); // (100+120+99+95)/4
    expect(s.margin).toBe(0.5);
    expect(s.restDays).toBe(0); // played yesterday: back-to-back
  });

  it("counts full days off and handles a team with no games yet", () => {
    expect(teamStats(past, NYK, "2026-11-09").restDays).toBe(3);
    const none = teamStats(past, 99, "2026-11-09");
    expect(none).toMatchObject({ games: 0, streak: null, pointsFor: null, margin: null, restDays: null });
  });

  it("keeps only the last ten for recent form", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      g(`2026-11-${String(i + 1).padStart(2, "0")}`, BOS, NYK, i < 4 ? 90 : 110, 100),
    );
    const s = teamStats(many, BOS, "2026-11-20");
    expect(s.record).toEqual({ wins: 10, losses: 4 });
    expect(s.last10).toEqual({ wins: 10, losses: 0 });
    expect(s.streak).toBe("W10");
  });
});

describe("headToHead", () => {
  it("counts the season series before the day", () => {
    expect(headToHead(past, BOS, NYK, "2026-11-07")).toEqual({ home: 2, away: 0 });
    expect(headToHead(past, LAL, BOS, "2026-11-07")).toEqual({ home: 1, away: 1 });
    expect(headToHead(past, BOS, LAL, "2026-11-30")).toEqual({ home: 2, away: 1 });
  });
});

describe("recentGames and seriesGames", () => {
  it("lists a team's latest results first, from its side", () => {
    const r = recentGames(past, BOS, "2026-11-07", 3);
    expect(r.map((x) => [x.gameDate, x.opponentId, x.atHome, x.pointsFor, x.won])).toEqual([
      ["2026-11-06", LAL, true, 105, true],
      ["2026-11-05", NYK, false, 101, true],
      ["2026-11-03", LAL, false, 100, false],
    ]);
  });

  it("lists earlier meetings of the two teams, oldest first", () => {
    expect(seriesGames(past, LAL, BOS, "2026-11-30").map((x) => x.gameDate)).toEqual([
      "2026-11-03",
      "2026-11-06",
      "2026-11-20",
    ]);
    expect(seriesGames(past, LAL, BOS, "2026-11-05").map((x) => x.gameDate)).toEqual(["2026-11-03"]);
  });
});
