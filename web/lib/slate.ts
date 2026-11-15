import type { StoredFactor } from "@/lib/factor-copy";

export type GameStatus = "scheduled" | "live" | "final" | "postponed";

export interface SlateTeam {
  teamId: number;
  abbr: string;
  city: string;
  name: string;
  wins: number;
  losses: number;
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
  prediction: SlatePrediction | null;
}

/** The games on the home page's wheel: today and the two days before, oldest first. */
export interface Wheel {
  /** Today in ET when the wheel was built. */
  today: string;
  games: SlateGame[];
}

/**
 * The game to put at the front of the wheel: the requested one if it's on the wheel, otherwise
 * today's next game that hasn't started, otherwise today's last game, otherwise the most recent.
 */
export function defaultGame(wheel: Wheel, requested: string | null): SlateGame | null {
  const { games, today } = wheel;
  const requestedGame = requested ? games.find((g) => g.gameId === requested) : undefined;
  if (requestedGame) return requestedGame;
  const todays = games.filter((g) => g.gameDate === today);
  return todays.find((g) => g.status === "scheduled") ?? todays.at(-1) ?? games.at(-1) ?? null;
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

/** Why Predict is unavailable for a game, or null when it can be used. */
export function predictBlocker(game: SlateGame): string | null {
  if (game.status === "postponed") return "This game was postponed.";
  if (game.prediction) return null;
  if (game.status !== "scheduled") return "No prediction was made before tip-off.";
  if (game.seasonType !== "regular") return "Predictions cover regular-season games only.";
  return "Prediction pending. Predictions are published around 9 AM ET.";
}
