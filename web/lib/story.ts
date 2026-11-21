/**
 * Content for /how-it-works: one example game (Celtics at Knicks) followed through all five
 * chapters, plus the real counts and test-season numbers. The example's numbers are made up but
 * consistent: the reasons add up to the prediction, the way the real ones do.
 */

/** Regular-season games per season (2019-20 was cut short, 2020-21 shortened). */
export const SEASON_GAMES: readonly { season: string; games: number; test?: boolean }[] = [
  { season: "2015-16", games: 1230 },
  { season: "2016-17", games: 1230 },
  { season: "2017-18", games: 1230 },
  { season: "2018-19", games: 1230 },
  { season: "2019-20", games: 1059 },
  { season: "2020-21", games: 1080 },
  { season: "2021-22", games: 1230 },
  { season: "2022-23", games: 1230 },
  { season: "2023-24", games: 1230 },
  { season: "2024-25", games: 1230 },
  { season: "2025-26", games: 1230, test: true },
];

export const LEARNED_GAMES = SEASON_GAMES.filter((s) => !s.test).reduce((n, s) => n + s.games, 0);
export const TEST_GAMES = SEASON_GAMES.filter((s) => s.test).reduce((n, s) => n + s.games, 0);
export const FEATURE_COUNT = 57;
/** Model v3 (Elo-anchored) adjusts Elo with this many of the features (`ANCHOR_FEATURES` in ml/src/tipoff/features/columns.py). */
export const ADJUSTED_FEATURE_COUNT = 35;
export const FACTOR_COUNT = 12;

export const EXAMPLE = { home: "NYK", away: "BOS" } as const;

/** One input for the example game, home (Knicks) vs away (Celtics). */
export interface ExampleFeature {
  label: string;
  home: string;
  away: string;
  /** Which team it favors and how strongly, -1 (Celtics) to 1 (Knicks). */
  lean: number;
}

export const EXAMPLE_FEATURES: readonly ExampleFeature[] = [
  { label: "Team rating (Elo, with home court)", home: "1,637", away: "1,605", lean: 0.55 },
  { label: "Net rating, last 10 games", home: "+1.8", away: "+6.4", lean: -0.7 },
  { label: "Days of rest", home: "2", away: "0 (back-to-back)", lean: 0.8 },
  { label: "Shooting, last 10 (eFG%)", home: "55.9%", away: "54.6%", lean: 0.4 },
  { label: "Rotation minutes missing", home: "0%", away: "14%", lean: 0.6 },
  { label: "Miles traveled", home: "0", away: "190", lean: 0.15 },
];

/** The model's starting point: its prediction for an average game (home court included). */
export const EXAMPLE_BASE = 0.57;

/** One reason, in win-probability points for the Knicks (negative: for the Celtics). */
export interface ExampleReason {
  factor: string;
  copy: string;
  points: number;
}

export const EXAMPLE_REASONS: readonly ExampleReason[] = [
  { factor: "Team rating", copy: "Knicks rated higher overall (Elo)", points: 4.0 },
  { factor: "Rest and schedule", copy: "Knicks better rested", points: 2.6 },
  { factor: "Missing players", copy: "Celtics missing key players", points: 1.8 },
  { factor: "Recent form", copy: "Celtics in better recent form", points: -3.0 },
  { factor: "Shooting", copy: "Knicks have the shooting edge", points: 1.1 },
  { factor: "Travel", copy: "Celtics on a tougher trip", points: 0.4 },
  { factor: "Everything else", copy: "Six smaller factors", points: -0.9 },
];

/** The base plus every reason: the Knicks' win chance. */
export const EXAMPLE_PREDICTION = EXAMPLE_REASONS.reduce((p, r) => p + r.points / 100, EXAMPLE_BASE);

/** The running total after each reason, starting from the base. */
export function runningTotals(base = EXAMPLE_BASE, reasons = EXAMPLE_REASONS): { from: number; to: number }[] {
  let at = base;
  return reasons.map((r) => {
    const from = at;
    at += r.points / 100;
    return { from, to: at };
  });
}

/** The 2025-26 season, scored once after every choice was made (ml/reports/test_2025-26.json). */
export const TEST_SEASON = {
  season: "2025-26",
  games: 1230,
  accuracy: { model: 0.6797, elo: 0.6919, home: 0.5545 },
} as const;

/**
 * Maps a chapter's scroll progress onto one step of its animation: 0 before ``start``, 1 after
 * ``end``, linear between.
 */
export function stage(progress: number, start: number, end: number): number {
  if (end <= start) return progress >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (progress - start) / (end - start)));
}
