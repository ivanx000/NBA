import type { StoredFactor } from "@/lib/factor-copy";
import type { TeamStats } from "@/lib/team-stats";

export type GameStatus = "scheduled" | "live" | "final" | "postponed";

export interface SlateTeam {
  teamId: number;
  abbr: string;
  city: string;
  name: string;
  wins: number;
  losses: number;
  /** Season numbers before this game (lib/team-stats.ts). */
  stats: TeamStats;
}

export interface SlatePrediction {
  homeWinProb: number;
  eloHomeWinProb: number | null;
  factors: StoredFactor[];
  /** live = published before tip-off; backfill = walk-forward backtest. */
  source: "live" | "backfill";
  modelVersion: string;
  generatedAt: string;
}

export interface SlateGame {
  gameId: string;
  gameDate: string;
  seasonType: string;
  tipoffUtc: string | null;
  status: GameStatus;
  home: SlateTeam;
  away: SlateTeam;
  homeScore: number | null;
  awayScore: number | null;
  isNeutral: boolean;
  gameLabel: string | null;
  /** Season series before this game. */
  headToHead: { home: number; away: number };
  prediction: SlatePrediction | null;
}

/** The home page's games: today only, plus the next game day when today has none. */
export interface Slate {
  /** Today in ET when the slate was built. */
  today: string;
  /** Today's games, in tip-off order. */
  games: SlateGame[];
  /** Only when today has no games: the closest later day with games, and its games. */
  next: { day: string; games: SlateGame[] } | null;
}

/**
 * The game to feature from ``games``: the requested one if it's there, otherwise the next game
 * that hasn't started, otherwise the last one.
 */
export function defaultGame(games: SlateGame[], requested: string | null): SlateGame | null {
  const requestedGame = requested ? games.find((g) => g.gameId === requested) : undefined;
  return requestedGame ?? games.find((g) => g.status === "scheduled") ?? games.at(-1) ?? null;
}

export type Side = "home" | "away";

export function predictedWinner(game: SlateGame): Side | null {
  if (!game.prediction) return null;
  return game.prediction.homeWinProb >= 0.5 ? "home" : "away";
}

export function winProb(game: SlateGame, side: Side): number | null {
  if (!game.prediction) return null;
  return side === "home" ? game.prediction.homeWinProb : 1 - game.prediction.homeWinProb;
}

export function actualWinner(game: SlateGame): Side | null {
  if (game.status !== "final" || game.homeScore === null || game.awayScore === null) return null;
  return game.homeScore > game.awayScore ? "home" : "away";
}

/** Why the user can't pick a winner for a game, or null when they can. */
export function pickBlocker(game: SlateGame): string | null {
  if (game.status === "postponed") return "This game was postponed.";
  if (game.prediction || actualWinner(game)) return null;
  if (game.status !== "scheduled") return "No prediction was made before tip-off.";
  if (game.seasonType !== "regular") return "Predictions cover regular-season games only.";
  return "Prediction pending. Predictions are published around 9 AM ET on game day.";
}

export interface Verdict {
  right: boolean;
  /** What the pick was judged against: the final score, or the model before the game ends. */
  judgedBy: "final" | "model";
}

/** Was the user's pick right? Against the final score once the game is over, else the model. */
export function verdict(game: SlateGame, pick: Side): Verdict | null {
  const actual = actualWinner(game);
  if (actual) return { right: actual === pick, judgedBy: "final" };
  const model = predictedWinner(game);
  return model ? { right: model === pick, judgedBy: "model" } : null;
}
