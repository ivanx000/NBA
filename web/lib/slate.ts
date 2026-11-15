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

export interface Slate {
  /** The selected ET schedule day. */
  date: string;
  /** Today in ET when the slate was built. */
  today: string;
  games: SlateGame[];
  /** Filled only on days without games: the next 7 days and the previous 7. */
  upcoming: SlateGame[];
  recent: SlateGame[];
}

/** Every game the page can show, in rail order. */
export function allGames(slate: Slate): SlateGame[] {
  return slate.games.length ? slate.games : [...slate.upcoming, ...slate.recent];
}

/**
 * The game to feature: the requested one if it's on this page, otherwise a random game from the
 * day's slate, otherwise the next scheduled game, otherwise the most recent one.
 */
export function pickGame(
  slate: Slate,
  requested: string | null,
  random: () => number = Math.random,
): SlateGame | null {
  const requestedGame = requested ? allGames(slate).find((g) => g.gameId === requested) : undefined;
  if (requestedGame) return requestedGame;
  if (slate.games.length) return slate.games[Math.floor(random() * slate.games.length)];
  return slate.upcoming[0] ?? slate.recent[0] ?? null;
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
