import { create } from "zustand";

/**
 * Scene state machine (docs/ARCHITECTURE.md section 5). The 3D scene's GSAP cinematic drives
 * revealing -> shooting -> results and returning -> idle; without it (2D fallback) the home page
 * advances them with short timers.
 */
export type Phase = "idle" | "revealing" | "shooting" | "results" | "returning";
export type Side = "home" | "away";

export type SceneEvent =
  /** The user picks a team to win by clicking its player. */
  | { type: "predict"; pick: Side }
  /** On the results screen, show the other team's numbers. */
  | { type: "view"; side: Side }
  | { type: "revealDone" }
  | { type: "shotDone" }
  | { type: "skip" }
  | { type: "back" }
  | { type: "returned" }
  | { type: "select"; gameId: string };

export interface SceneData {
  phase: Phase;
  gameId: string | null;
  /** The team the user picked (set from Predict until back at idle). */
  pick: Side | null;
  /** Whose numbers the results screen shows (starts at the pick). */
  viewing: Side | null;
  /** Skip the cinematic (reduced motion or the user's choice). */
  instantResults: boolean;
}

export function transition(state: SceneData, event: SceneEvent): SceneData {
  switch (event.type) {
    case "predict":
      if (state.phase !== "idle" || !state.gameId) return state;
      return {
        ...state,
        pick: event.pick,
        viewing: event.pick,
        phase: state.instantResults ? "results" : "revealing",
      };
    case "view":
      return state.phase === "results" ? { ...state, viewing: event.side } : state;
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
      return state.instantResults
        ? { ...state, phase: "idle", pick: null, viewing: null }
        : { ...state, phase: "returning" };
    case "returned":
      return state.phase === "returning" ? { ...state, phase: "idle", pick: null, viewing: null } : state;
    case "select":
      // Switching games is only allowed when nothing is animating.
      if (state.phase !== "idle" && state.phase !== "results") return state;
      return { ...state, gameId: event.gameId, phase: "idle", pick: null, viewing: null };
  }
}

interface SceneStore extends SceneData {
  /** The player under the pointer or the focused team button (highlight only, not in the machine). */
  hover: Side | null;
  setHover: (side: Side | null) => void;
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
  pick: null,
  viewing: null,
  instantResults: false,
  hover: null,
  setHover: (hover) => set({ hover }),
  cinematic: false,
  setCinematic: (cinematic) => set({ cinematic }),
  send: (event) => set((s) => transition(s, event)),
  setInstantResults: (instantResults) => set({ instantResults }),
  reset: (gameId) => set({ gameId, phase: "idle", pick: null, viewing: null }),
}));
