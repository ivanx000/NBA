/**
 * Team numbers for the results screen, worked out from the season's finished games (no extra
 * tables or pipeline work): records, recent form, scoring, rest and the season series.
 * Only regular-season games before the game's day count, so nothing leaks from the game itself.
 */

export interface PastGame {
  gameDate: string;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
}

export interface Record {
  wins: number;
  losses: number;
}

export interface TeamStats {
  games: number;
  record: Record;
  home: Record;
  away: Record;
  last10: Record;
  /** "W3" or "L2"; null before the first game. */
  streak: string | null;
  /** Points scored and allowed per game, and the average margin (null before the first game). */
  pointsFor: number | null;
  pointsAgainst: number | null;
  margin: number | null;
  /** Full days off before this game (0 = second night of a back-to-back); null before the first game. */
  restDays: number | null;
}

const MS_PER_DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** ``teamId``'s numbers from ``past`` (finished games before ``day``, any order). */
export function teamStats(past: readonly PastGame[], teamId: number, day: string): TeamStats {
  const games = past
    .filter((g) => (g.homeTeamId === teamId || g.awayTeamId === teamId) && g.gameDate < day)
    .sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  const record: Record = { wins: 0, losses: 0 };
  const home: Record = { wins: 0, losses: 0 };
  const away: Record = { wins: 0, losses: 0 };
  let scored = 0;
  let allowed = 0;
  const results: boolean[] = [];
  for (const g of games) {
    const atHome = g.homeTeamId === teamId;
    const mine = atHome ? g.homeScore : g.awayScore;
    const theirs = atHome ? g.awayScore : g.homeScore;
    const won = mine > theirs;
    results.push(won);
    scored += mine;
    allowed += theirs;
    const bucket = atHome ? home : away;
    if (won) {
      record.wins++;
      bucket.wins++;
    } else {
      record.losses++;
      bucket.losses++;
    }
  }
  const recent = results.slice(-10);
  const last10 = { wins: recent.filter(Boolean).length, losses: recent.filter((w) => !w).length };
  let streak: string | null = null;
  if (results.length) {
    const last = results.at(-1)!;
    let n = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
    streak = `${last ? "W" : "L"}${n}`;
  }
  const n = games.length;
  const lastDay = games.at(-1)?.gameDate;
  const restDays = lastDay
    ? Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${lastDay}T00:00:00Z`)) / MS_PER_DAY) - 1
    : null;
  return {
    games: n,
    record,
    home,
    away,
    last10,
    streak,
    pointsFor: n ? round1(scored / n) : null,
    pointsAgainst: n ? round1(allowed / n) : null,
    margin: n ? round1((scored - allowed) / n) : null,
    restDays,
  };
}

/** Season series before ``day``: wins for each side of the matchup. */
export function headToHead(past: readonly PastGame[], homeId: number, awayId: number, day: string) {
  let home = 0;
  let away = 0;
  for (const g of past) {
    if (g.gameDate >= day) continue;
    const pair = new Set([g.homeTeamId, g.awayTeamId]);
    if (!pair.has(homeId) || !pair.has(awayId)) continue;
    const winner = g.homeScore > g.awayScore ? g.homeTeamId : g.awayTeamId;
    if (winner === homeId) home++;
    else away++;
  }
  return { home, away };
}
