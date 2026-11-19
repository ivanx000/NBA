import { describe, expect, it } from "vitest";

import {
  bestAndWorst,
  calibration,
  type GradedGame,
  HOME_RATE,
  metrics,
  reportCard,
  rollingAccuracy,
  seasonSummary,
} from "@/lib/performance";

let id = 0;
function g(homeWinProb: number, homeWins: boolean, elo: number | null = 0.5, day = "2026-11-01"): GradedGame {
  id++;
  return {
    gameId: `g${id}`, gameDate: day, homeAbbr: "NYK", awayAbbr: "BOS",
    homeScore: homeWins ? 110 : 100, awayScore: homeWins ? 100 : 110,
    homeWinProb, eloHomeWinProb: elo, source: "live",
  }; // prettier-ignore
}

describe("metrics", () => {
  it("scores accuracy, log loss and Brier", () => {
    const m = metrics([0.8, 0.3, 0.6], [true, false, false]);
    expect(m.n).toBe(3);
    expect(m.accuracy).toBeCloseTo(2 / 3);
    expect(m.logLoss).toBeCloseTo(-(Math.log(0.8) + Math.log(0.7) + Math.log(0.4)) / 3);
    expect(m.brier).toBeCloseTo((0.04 + 0.09 + 0.36) / 3);
  });

  it("gives a coin flip its known scores and survives 0 and 1", () => {
    const flip = metrics([0.5, 0.5], [true, false]);
    expect(flip.logLoss).toBeCloseTo(Math.log(2));
    expect(flip.brier).toBeCloseTo(0.25);
    expect(Number.isFinite(metrics([1, 0], [false, true]).logLoss)).toBe(true);
    expect(metrics([], []).n).toBe(0);
  });
});

describe("reportCard", () => {
  it("compares the model, Elo and always-home on the same games", () => {
    const games = [g(0.7, true, 0.6), g(0.4, false, 0.55), g(0.6, false, null)];
    const card = reportCard(games);
    expect([card.model.n, card.elo.n, card.home.n]).toEqual([2, 2, 2]); // the game without Elo is left out
    expect(card.model.accuracy).toBe(1);
    expect(card.elo.accuracy).toBe(0.5);
    expect(card.home.accuracy).toBe(0.5);
    expect(card.home.brier).toBeCloseTo(((HOME_RATE - 1) ** 2 + HOME_RATE ** 2) / 2);
  });
});

describe("rollingAccuracy", () => {
  it("averages over a sliding window once it fills", () => {
    const games = [g(0.6, true), g(0.6, false), g(0.6, true), g(0.6, true)];
    const r = rollingAccuracy(games, 2);
    expect(r.map((p) => [p.game, p.model])).toEqual([
      [2, 0.5],
      [3, 0.5],
      [4, 1],
    ]);
    expect(r[0].elo).toBe(0.5); // Elo at 0.5 counts as picking home
  });
});

describe("calibration", () => {
  it("bins games by the favorite's probability and counts how often it won", () => {
    // Favorites at 55% (home wins), 45% home = 55% away (away wins), 75% (home loses).
    const bins = calibration([g(0.55, true), g(0.45, false), g(0.75, false)]);
    expect(bins.map((b) => [b.label, b.n, b.actual])).toEqual([
      ["50–60%", 2, 1],
      ["70–80%", 1, 0],
    ]);
    expect(bins[0].predicted).toBeCloseTo(0.55);
  });
});

describe("bestAndWorst", () => {
  it("lists the most confident hits and misses", () => {
    const { best, worst } = bestAndWorst([g(0.9, true), g(0.2, true), g(0.6, true), g(0.3, false)], 2);
    expect(best.map((c) => c.confidence)).toEqual([0.9, 0.7]);
    expect(worst.map((c) => +c.confidence.toFixed(2))).toEqual([0.8]);
  });
});

describe("seasonSummary", () => {
  it("packs a season for the page, recent picks newest first", () => {
    const games = [g(0.7, true, 0.6, "2026-11-01"), g(0.3, true, 0.4, "2026-11-02")];
    games[1].source = "backfill";
    const s = seasonSummary("2026-27", games);
    expect([s.live, s.backfill, s.from, s.to]).toEqual([1, 1, "2026-11-01", "2026-11-02"]);
    expect(s.recent.map((r) => [r.gameDate, r.pick, r.correct, r.eloPick, r.eloCorrect])).toEqual([
      ["2026-11-02", "BOS", false, "BOS", false],
      ["2026-11-01", "NYK", true, "NYK", true],
    ]);
    expect(s.worst[0].confidence).toBeCloseTo(0.7);
  });
});
