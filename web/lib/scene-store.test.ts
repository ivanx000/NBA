import { describe, expect, it } from "vitest";

import { transition, type SceneData } from "@/lib/scene-store";

const idle: SceneData = { phase: "idle", gameId: "g1", pick: null, viewing: null, instantResults: false };

describe("scene state machine", () => {
  it("runs idle -> revealing -> shooting -> results -> returning -> idle", () => {
    let s = transition(idle, { type: "predict", pick: "away" });
    expect(s.phase).toBe("revealing");
    s = transition(s, { type: "revealDone" });
    expect(s.phase).toBe("shooting");
    s = transition(s, { type: "shotDone" });
    expect(s.phase).toBe("results");
    s = transition(s, { type: "back" });
    expect(s.phase).toBe("returning");
    expect(transition(s, { type: "returned" }).phase).toBe("idle");
  });

  it("remembers the pick, lets the results screen switch teams, and forgets it at idle", () => {
    let s = transition(idle, { type: "predict", pick: "home" });
    expect([s.pick, s.viewing]).toEqual(["home", "home"]);
    expect(transition(s, { type: "view", side: "away" }).viewing).toBe("home"); // not on results yet
    s = transition(transition(s, { type: "skip" }), { type: "view", side: "away" });
    expect([s.pick, s.viewing]).toEqual(["home", "away"]);
    s = transition(transition(s, { type: "back" }), { type: "returned" });
    expect([s.phase, s.pick, s.viewing]).toEqual(["idle", null, null]);
  });

  it("skips straight to results", () => {
    const s = transition(transition(idle, { type: "predict", pick: "away" }), { type: "skip" });
    expect(s.phase).toBe("results");
  });

  it("goes straight to results and back with instant results (reduced motion)", () => {
    const instant = { ...idle, instantResults: true };
    const s = transition(instant, { type: "predict", pick: "away" });
    expect(s.phase).toBe("results");
    expect(transition(s, { type: "back" }).phase).toBe("idle");
  });

  it("only switches games when nothing is animating", () => {
    const revealing = transition(idle, { type: "predict", pick: "away" });
    expect(transition(revealing, { type: "select", gameId: "g2" }).gameId).toBe("g1");
    const results = { ...idle, phase: "results" as const };
    expect(transition(results, { type: "select", gameId: "g2" })).toMatchObject({
      gameId: "g2",
      phase: "idle",
    });
  });

  it("ignores Predict without a game", () => {
    expect(transition({ ...idle, gameId: null }, { type: "predict", pick: "away" }).phase).toBe("idle");
  });
});
