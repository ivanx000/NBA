import { describe, expect, it } from "vitest";

import { defaultGame, predictBlocker, predictedWinner, type SlateGame } from "@/lib/slate";

const team = (abbr: string) => ({ teamId: 1, abbr, city: abbr, name: abbr, wins: 0, losses: 0 });

function game(id: string, over: Partial<SlateGame> = {}): SlateGame {
  return {
    gameId: id, gameDate: "2026-11-14", seasonType: "regular", tipoffUtc: null,
    status: "scheduled", home: team("NYK"), away: team("BOS"), homeScore: null, awayScore: null,
    isNeutral: false, gameLabel: null,
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

describe("predict availability", () => {
  it("explains why Predict is disabled", () => {
    expect(predictBlocker(game("a"))).toBeNull();
    expect(predictBlocker(game("a", { status: "postponed" }))).toMatch(/postponed/);
    expect(predictBlocker(game("a", { prediction: null }))).toMatch(/pending/);
    expect(predictBlocker(game("a", { prediction: null, status: "live" }))).toMatch(/before tip-off/);
    expect(predictBlocker(game("a", { prediction: null, seasonType: "playoffs" }))).toMatch(
      /regular-season/,
    );
  });

  it("names the predicted winner", () => {
    expect(predictedWinner(game("a"))).toBe("home");
    const away = game("a");
    away.prediction!.homeWinProb = 0.3;
    expect(predictedWinner(away)).toBe("away");
  });
});
