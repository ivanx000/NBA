import { describe, expect, it } from "vitest";

import { pickGame, predictBlocker, predictedWinner, type Slate, type SlateGame } from "@/lib/slate";

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

const slate = (over: Partial<Slate> = {}): Slate => ({
  date: "2026-11-14", today: "2026-11-14", games: [], upcoming: [], recent: [], ...over,
});

describe("pickGame", () => {
  it("honours a requested game on the page", () => {
    const s = slate({ games: [game("a"), game("b")] });
    expect(pickGame(s, "b")?.gameId).toBe("b");
  });

  it("picks a random game from the day when none is requested", () => {
    const s = slate({ games: [game("a"), game("b"), game("c")] });
    expect(pickGame(s, null, () => 0.99)?.gameId).toBe("c");
    expect(pickGame(s, "missing", () => 0)?.gameId).toBe("a");
  });

  it("falls back to the next game, then the latest one, on days without games", () => {
    expect(pickGame(slate({ upcoming: [game("n")], recent: [game("r")] }), null)?.gameId).toBe("n");
    expect(pickGame(slate({ recent: [game("r")] }), null)?.gameId).toBe("r");
    expect(pickGame(slate(), null)).toBeNull();
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
