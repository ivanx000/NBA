/**
 * Projected player lines (Phase 9): minutes, points, rebounds and assists with 80% ranges, and the
 * real line once the game is final. Projections mean "if he plays".
 * Players are shown by name, number (when we have it) and initials: no photos (CLAUDE.md).
 */

export const STATS = ["pts", "reb", "ast"] as const;
export type Stat = (typeof STATS)[number];

export const STAT_LABEL: Record<Stat, string> = { pts: "PTS", reb: "REB", ast: "AST" };

export interface PlayerLine {
  playerId: number;
  teamId: number;
  name: string;
  number: string | null;
  /** Projected minutes. */
  minutes: number;
  proj: Record<Stat, number>;
  /** 80% ranges, [low, high]. */
  range: Record<Stat, [number, number]>;
  /** The real line once final; minutes 0 means he didn't play (stats null). */
  actual: { minutes: number; pts: number | null; reb: number | null; ast: number | null } | null;
  /** His status on the official injury report when projected ("Questionable", ...), or null. */
  status?: string | null;
}

/** Each side's projected players, most projected minutes first, and where they came from. */
export interface GamePlayers {
  home: PlayerLine[];
  away: PlayerLine[];
  /** live = published before tip-off; backfill = walk-forward backtest; null = none. */
  source: "live" | "backfill" | null;
}

export const NO_PLAYERS: GamePlayers = { home: [], away: [], source: null };

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/** "Cameron Boozer" -> "CB"; "Jaren Jackson Jr." -> "JJ"; "Nikola Jokić" -> "NJ". */
export function initials(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter((p) => p && !SUFFIXES.has(p.toLowerCase()));
  if (!parts.length) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** "Cameron Boozer" -> "C. Boozer" (for tight spaces); single names stay as they are. */
export function shortName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name;
  const rest = parts.slice(1).join(" ");
  return `${parts[0][0]}. ${rest}`;
}

/** Rounded projection, e.g. 17.3 -> "17". */
export const round = (v: number) => String(Math.round(v));

/** "9–25" */
export function rangeText([lo, hi]: [number, number]): string {
  return `${Math.round(lo)}–${Math.round(hi)}`;
}

/** Whether the real number landed in the 80% range (null until final, or if he didn't play). */
export function inRange(line: PlayerLine, stat: Stat): boolean | null {
  const v = line.actual?.[stat];
  if (v === null || v === undefined || !line.actual?.minutes) return null;
  const [lo, hi] = line.range[stat];
  return v >= Math.round(lo) && v <= Math.round(hi);
}

/** Players who didn't play in a final game. */
export function didNotPlay(line: PlayerLine): boolean {
  return line.actual !== null && line.actual.minutes === 0;
}
