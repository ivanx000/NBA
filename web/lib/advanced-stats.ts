/**
 * Advanced stats from box-score totals (docs/DESIGN.md section 5): team ratings, pace and the
 * Four Factors with league ranks, and player shooting, usage and per-36 numbers. The database
 * sums the box scores of games before the day (lib/db/queries.ts); everything here is pure math,
 * so a game's own box score never counts toward its numbers.
 */

/** A team's summed box scores over its games, with its opponents' sums in those same games. */
export interface TeamTotals {
  teamId: number;
  games: number;
  minutes: number;
  pts: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fta: number;
  ftm: number;
  oreb: number;
  dreb: number;
  tov: number;
  poss: number;
  opp: { pts: number; fgm: number; fga: number; fg3m: number; fta: number; ftm: number; oreb: number; dreb: number; tov: number; poss: number };
}

export type TeamStatKey =
  | "offRating"
  | "defRating"
  | "netRating"
  | "pace"
  | "ts"
  | "efg"
  | "tovPct"
  | "orebPct"
  | "ftRate"
  | "oppEfg"
  | "oppTovPct"
  | "drebPct"
  | "oppFtRate";

export interface TeamAdvanced {
  games: number;
  values: Record<TeamStatKey, number>;
  /** 1 = best in the league (for pace, 1 = fastest). */
  ranks: Record<TeamStatKey, number>;
  /** Teams ranked (those with at least one game). */
  of: number;
}

/** How each stat reads: its label, format, and whether a lower number is better. */
export const TEAM_STATS: readonly { key: TeamStatKey; label: string; short: string; kind: "rating" | "pct" | "rate"; lowerIsBetter?: boolean; note: string }[] = [
  { key: "offRating", label: "Offensive rating", short: "Off rtg", kind: "rating", note: "Points scored per 100 possessions" },
  { key: "defRating", label: "Defensive rating", short: "Def rtg", kind: "rating", lowerIsBetter: true, note: "Points allowed per 100 possessions" },
  { key: "netRating", label: "Net rating", short: "Net rtg", kind: "rating", note: "Offensive minus defensive rating" },
  { key: "pace", label: "Pace", short: "Pace", kind: "rating", note: "Possessions per 48 minutes (rank 1 = fastest)" },
  { key: "ts", label: "True shooting", short: "TS%", kind: "pct", note: "Points per shot, free throws included" },
  { key: "efg", label: "Effective FG%", short: "eFG%", kind: "pct", note: "Field goals with threes worth 1.5" },
  { key: "tovPct", label: "Turnover rate", short: "TOV%", kind: "pct", lowerIsBetter: true, note: "Turnovers per 100 plays" },
  { key: "orebPct", label: "Offensive rebounding", short: "OREB%", kind: "pct", note: "Share of their own misses they get back" },
  { key: "ftRate", label: "Free-throw rate", short: "FT rate", kind: "rate", note: "Free throws made per shot attempt" },
  { key: "oppEfg", label: "Opponent eFG%", short: "Opp eFG%", kind: "pct", lowerIsBetter: true, note: "Opponents' shooting" },
  { key: "oppTovPct", label: "Forced turnovers", short: "Opp TOV%", kind: "pct", note: "Opponents' turnovers per 100 plays" },
  { key: "drebPct", label: "Defensive rebounding", short: "DREB%", kind: "pct", note: "Share of opponents' misses they grab" },
  { key: "oppFtRate", label: "Opponent FT rate", short: "Opp FT rate", kind: "rate", lowerIsBetter: true, note: "Free throws allowed per opponent shot" },
];

const efg = (fgm: number, fg3m: number, fga: number) => (fga ? (fgm + 0.5 * fg3m) / fga : 0);
const tovPct = (tov: number, fga: number, fta: number) => {
  const plays = fga + 0.44 * fta + tov;
  return plays ? tov / plays : 0;
};
const share = (a: number, b: number) => (a + b ? a / (a + b) : 0);

/** One team's advanced numbers from its totals (no ranks). */
export function teamValues(t: TeamTotals): Record<TeamStatKey, number> {
  // Possessions: the average of both teams' estimates (they play the same game).
  const poss = (t.poss + t.opp.poss) / 2;
  const offRating = poss ? (100 * t.pts) / poss : 0;
  const defRating = poss ? (100 * t.opp.pts) / poss : 0;
  return {
    offRating,
    defRating,
    netRating: offRating - defRating,
    pace: t.minutes ? (48 * poss) / (t.minutes / 5) : 0,
    ts: t.fga + 0.44 * t.fta ? t.pts / (2 * (t.fga + 0.44 * t.fta)) : 0,
    efg: efg(t.fgm, t.fg3m, t.fga),
    tovPct: tovPct(t.tov, t.fga, t.fta),
    orebPct: share(t.oreb, t.opp.dreb),
    ftRate: t.fga ? t.ftm / t.fga : 0,
    oppEfg: efg(t.opp.fgm, t.opp.fg3m, t.opp.fga),
    oppTovPct: tovPct(t.opp.tov, t.opp.fga, t.opp.fta),
    drebPct: share(t.dreb, t.opp.oreb),
    oppFtRate: t.opp.fga ? t.opp.ftm / t.opp.fga : 0,
  };
}

/** Every team's advanced numbers with league ranks (ties share the better rank). */
export function leagueAdvanced(totals: readonly TeamTotals[]): Map<number, TeamAdvanced> {
  const played = totals.filter((t) => t.games > 0);
  const values = new Map(played.map((t) => [t.teamId, teamValues(t)]));
  const out = new Map<number, TeamAdvanced>();
  for (const t of played) {
    const mine = values.get(t.teamId)!;
    const ranks = {} as Record<TeamStatKey, number>;
    for (const { key, lowerIsBetter } of TEAM_STATS) {
      const better = [...values.values()].filter((v) => (lowerIsBetter ? v[key] < mine[key] : v[key] > mine[key]));
      ranks[key] = better.length + 1;
    }
    out.set(t.teamId, { games: t.games, values: mine, ranks, of: played.length });
  }
  return out;
}

/** A player's summed box scores over his games, with his teams' totals in those same games. */
export interface PlayerTotals {
  playerId: number;
  games: number;
  minutes: number;
  pts: number;
  reb: number;
  ast: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  fta: number;
  tov: number;
  team: { minutes: number; fga: number; fta: number; tov: number };
  /** His last 5 games: games counted (up to 5) and their points and minutes. */
  last5: { games: number; pts: number; minutes: number };
}

export interface PlayerAdvanced {
  games: number;
  minutesPerGame: number;
  /** True shooting: points per two shot attempts, free throws included (0..1). */
  ts: number | null;
  /** Usage rate: share of his team's plays he finishes while on the floor (0..1). */
  usage: number | null;
  per36: { pts: number; reb: number; ast: number };
  threePct: number | null;
  /** Points per game over his last 5 games, and over the season. */
  last5Pts: number | null;
  seasonPts: number;
}

/** Below this many minutes the rates are too noisy to show. */
export const MIN_MINUTES = 60;

export function playerAdvanced(p: PlayerTotals): PlayerAdvanced | null {
  if (p.games === 0 || p.minutes <= 0) return null;
  const enough = p.minutes >= MIN_MINUTES;
  const shots = p.fga + 0.44 * p.fta;
  const teamPlays = p.team.fga + 0.44 * p.team.fta + p.team.tov;
  const per36 = (n: number) => (36 * n) / p.minutes;
  return {
    games: p.games,
    minutesPerGame: p.minutes / p.games,
    ts: enough && shots > 0 ? p.pts / (2 * shots) : null,
    usage: enough && teamPlays > 0 ? ((shots + p.tov) * (p.team.minutes / 5)) / (p.minutes * teamPlays) : null,
    per36: { pts: per36(p.pts), reb: per36(p.reb), ast: per36(p.ast) },
    threePct: p.fg3a >= 10 ? p.fg3m / p.fg3a : null,
    last5Pts: p.last5.games ? p.last5.pts / p.last5.games : null,
    seasonPts: p.pts / p.games,
  };
}

/** "112.4", "54.1%", "0.231" style formatting by kind. */
export function formatStat(value: number, kind: "rating" | "pct" | "rate"): string {
  if (kind === "pct") return `${(value * 100).toFixed(1)}%`;
  if (kind === "rate") return value.toFixed(3).replace(/^0/, "");
  return value.toFixed(1);
}

/** A stat as shown: net rating carries its sign ("+1.9", "−10.7"). */
export function showStat(key: TeamStatKey, value: number, kind: "rating" | "pct" | "rate"): string {
  const text = formatStat(Math.abs(value), kind);
  if (key === "netRating") return `${value > 0 ? "+" : value < 0 ? "−" : ""}${text}`;
  return formatStat(value, kind);
}

/** 1 -> "1st", 22 -> "22nd". */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}
