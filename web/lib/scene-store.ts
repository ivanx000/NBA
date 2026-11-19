import { create } from "zustand";

/**
 * Scene state machine (docs/ARCHITECTURE.md section 5). The 3D scene's GSAP cinematic drives
 * revealing -> shooting -> results and returning -> idle; without it (2D fallback) the home page
 * advances them with short timers.
 */
export type Phase = "idle" | "revealing" | "shooting" | "results" | "returning";

export type SceneEvent =
  | { type: "predict" }
  | { type: "revealDone" }
  | { type: "shotDone" }
  | { type: "skip" }
  | { type: "back" }
  | { type: "returned" }
  | { type: "select"; gameId: string };

export interface SceneData {
  phase: Phase;
  gameId: string | null;
  /** Skip the cinematic (reduced motion or the user's choice). */
  instantResults: boolean;
}

export function transition(state: SceneData, event: SceneEvent): SceneData {
  switch (event.type) {
    case "predict":
      if (state.phase !== "idle" || !state.gameId) return state;
      return { ...state, phase: state.instantResults ? "results" : "revealing" };
    case "revealDone":
      return state.phase === "revealing" ? { ...state, phase: "shooting" } : state;
    case "shotDone":
      return state.phase === "shooting" ? { ...state, phase: "results" } : state;
    case "skip":
      return state.phase === "revealing" || state.phase === "shooting"
        ? { ...state, phase: "results" }
        : state;
    case "back":
      if (state.phase !== "results") return state;
      return { ...state, phase: state.instantResults ? "idle" : "returning" };
    case "returned":
      return state.phase === "returning" ? { ...state, phase: "idle" } : state;
    case "select":
      // Switching games is only allowed when nothing is animating.
      if (state.phase !== "idle" && state.phase !== "results") return state;
      return { ...state, gameId: event.gameId, phase: "idle" };
  }
}

interface SceneStore extends SceneData {
  /** True while the 3D cinematic is mounted and drives the phases. */
  cinematic: boolean;
  setCinematic: (value: boolean) => void;
  send: (event: SceneEvent) => void;
  setInstantResults: (value: boolean) => void;
  reset: (gameId: string | null) => void;
}

export const useScene = create<SceneStore>((set) => ({
  phase: "idle",
  gameId: null,
  instantResults: false,
  cinematic: false,
  setCinematic: (cinematic) => set({ cinematic }),
  send: (event) => set((s) => transition(s, event)),
  setInstantResults: (instantResults) => set({ instantResults }),
  reset: (gameId) => set({ gameId, phase: "idle" }),
}));
