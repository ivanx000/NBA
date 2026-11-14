import factorsData from "../../shared/factors.json";

/** A factor as stored in `game_predictions.factors` by the ML pipeline. */
export interface StoredFactor {
  factor: string;
  label: string;
  favors: "home" | "away";
  /** Approximate effect on the home win probability, in probability points (0.04 = 4%). */
  pp: number;
  logit: number;
}

export interface FactorGroup {
  id: string;
  label: string;
  /** `{team}` = the team this factor favors, `{opponent}` = the other team. */
  template: string;
  features: string[];
}

interface FactorsFile {
  groups: FactorGroup[];
}

export const factorGroups: readonly FactorGroup[] = (factorsData as FactorsFile).groups;
const byId = new Map(factorGroups.map((g) => [g.id, g]));

export interface FactorCopy {
  text: string;
  /** Size of the effect in whole-ish percentage points, always positive. */
  points: number;
  favors: "home" | "away";
}

/**
 * Human copy for one factor, e.g. "Celtics better rested" with 4 points toward the Celtics.
 * Raw feature names never reach the UI.
 */
export function factorCopy(
  factor: StoredFactor,
  names: { home: string; away: string },
): FactorCopy {
  const group = byId.get(factor.factor);
  const team = factor.favors === "home" ? names.home : names.away;
  const opponent = factor.favors === "home" ? names.away : names.home;
  const template = group?.template ?? `${factor.label} favors {team}`;
  return {
    text: template.replaceAll("{team}", team).replaceAll("{opponent}", opponent),
    points: Math.round(Math.abs(factor.pp) * 1000) / 10,
    favors: factor.favors,
  };
}
