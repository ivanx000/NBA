import { describe, expect, it } from "vitest";

import { transition, type SceneData } from "@/lib/scene-store";

const idle: SceneData = { phase: "idle", gameId: "g1", instantResults: false };

describe("scene state machine", () => {
  it("runs idle -> revealing -> shooting -> results -> returning -> idle", () => {
    let s = transition(idle, { type: "predict" });
    expect(s.phase).toBe("revealing");
    s = transition(s, { type: "revealDone" });
    expect(s.phase).toBe("shooting");
    s = transition(s, { type: "shotDone" });
    expect(s.phase).toBe("results");
    s = transition(s, { type: "back" });
    expect(s.phase).toBe("returning");
    expect(transition(s, { type: "returned" }).phase).toBe("idle");
  });

  it("skips straight to results", () => {
    const s = transition(transition(idle, { type: "predict" }), { type: "skip" });
    expect(s.phase).toBe("results");
  });

  it("goes straight to results and back with instant results (reduced motion)", () => {
    const instant = { ...idle, instantResults: true };
    const s = transition(instant, { type: "predict" });
    expect(s.phase).toBe("results");
    expect(transition(s, { type: "back" }).phase).toBe("idle");
  });

  it("only switches games when nothing is animating", () => {
    const revealing = transition(idle, { type: "predict" });
    expect(transition(revealing, { type: "select", gameId: "g2" }).gameId).toBe("g1");
    const results = { ...idle, phase: "results" as const };
    expect(transition(results, { type: "select", gameId: "g2" })).toMatchObject({
      gameId: "g2",
      phase: "idle",
    });
  });

  it("ignores Predict without a game", () => {
    expect(transition({ ...idle, gameId: null }, { type: "predict" }).phase).toBe("idle");
  });
});
