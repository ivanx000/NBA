import { describe, expect, it } from "vitest";

import { teamStats } from "@/lib/team-stats";

import { defaultGame, pickBlocker, predictedWinner, type SlateGame, verdict } from "@/lib/slate";

const team = (abbr: string) => ({
  teamId: 1, abbr, city: abbr, name: abbr, wins: 0, losses: 0,
  stats: teamStats([], 1, "2026-11-14"),
}); // prettier-ignore

function game(id: string, over: Partial<SlateGame> = {}): SlateGame {
  return {
    gameId: id, gameDate: "2026-11-14", seasonType: "regular", tipoffUtc: null,
    status: "scheduled", home: team("NYK"), away: team("BOS"), homeScore: null, awayScore: null,
    isNeutral: false, gameLabel: null, headToHead: { home: 0, away: 0 },
    prediction: { homeWinProb: 0.64, eloHomeWinProb: 0.6, factors: [], source: "live",
                  modelVersion: "game-v2", generatedAt: "" },
    ...over,
  };
}

describe("defaultGame", () => {
  const started = game("s", { status: "live" });
  const next = game("n");
  const later = game("l");

  it("honours a requested game", () => {
    expect(defaultGame([started, next], "s")?.gameId).toBe("s");
  });

  it("picks the next game that hasn't started", () => {
    expect(defaultGame([started, next, later], null)?.gameId).toBe("n");
    expect(defaultGame([started, next], "missing")?.gameId).toBe("n");
  });

  it("falls back to the last game", () => {
    const done = game("d", { status: "final", homeScore: 100, awayScore: 90 });
    expect(defaultGame([done, started], null)?.gameId).toBe("s");
    expect(defaultGame([], null)).toBeNull();
  });
});

describe("picking a winner", () => {
  it("explains why picking is unavailable", () => {
    expect(pickBlocker(game("a"))).toBeNull();
    expect(pickBlocker(game("a", { status: "postponed" }))).toMatch(/postponed/);
    expect(pickBlocker(game("a", { prediction: null }))).toMatch(/pending/);
    expect(pickBlocker(game("a", { prediction: null, status: "live" }))).toMatch(/before tip-off/);
    expect(pickBlocker(game("a", { prediction: null, seasonType: "playoffs" }))).toMatch(/regular-season/);
    // A finished game can always be picked: the final score judges it.
    expect(pickBlocker(game("a", { prediction: null, status: "final", homeScore: 90, awayScore: 99 }))).toBeNull();
  });

  it("judges a pick against the model before the game and the final score after", () => {
    expect(verdict(game("a"), "home")).toEqual({ right: true, judgedBy: "model" }); // model: home 64%
    expect(verdict(game("a"), "away")).toEqual({ right: false, judgedBy: "model" });
    const final = game("a", { status: "final", homeScore: 90, awayScore: 99 });
    expect(verdict(final, "away")).toEqual({ right: true, judgedBy: "final" }); // the model missed
    expect(verdict(game("a", { prediction: null }), "home")).toBeNull();
  });

  it("names the predicted winner", () => {
    expect(predictedWinner(game("a"))).toBe("home");
    const away = game("a");
    away.prediction!.homeWinProb = 0.3;
    expect(predictedWinner(away)).toBe("away");
  });
});
