import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { cacheLife } from "next/cache";

import { addDays, seasonFor } from "@/lib/dates";
import type { StoredFactor } from "@/lib/factor-copy";
import type { GameStatus, SlateGame, SlateTeam, Wheel } from "@/lib/slate";
import { requireTeam } from "@/lib/teams";

import type { Db } from "./client";
import { currentGamePredictions, games } from "./schema";

type Records = Map<number, { wins: number; losses: number }>;

function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

/** Regular-season wins/losses for every team, counting final games before ``day``. */
async function recordsBefore(db: Db, day: string): Promise<Records> {
  const season = seasonFor(day);
  const result = await db.execute(sql`
    select team_id, sum(won)::int as wins, sum(1 - won)::int as losses from (
      select home_team_id as team_id, (home_score > away_score)::int as won from games
        where season = ${season} and season_type = 'regular' and status = 'final'
          and game_date < ${day}
      union all
      select away_team_id, (away_score > home_score)::int from games
        where season = ${season} and season_type = 'regular' and status = 'final'
          and game_date < ${day}
    ) t group by team_id`);
  const map: Records = new Map();
  for (const r of rows<{ team_id: number; wins: number; losses: number }>(result)) {
    map.set(Number(r.team_id), { wins: Number(r.wins), losses: Number(r.losses) });
  }
  return map;
}

async function gamesBetween(db: Db, from: string, to: string) {
  return db
    .select({
      gameId: games.gameId,
      gameDate: games.gameDate,
      seasonType: games.seasonType,
      tipoffUtc: games.tipoffUtc,
      status: games.status,
      homeTeamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      isNeutral: games.isNeutral,
      gameLabel: games.gameLabel,
      homeWinProb: currentGamePredictions.homeWinProb,
      eloHomeWinProb: currentGamePredictions.eloHomeWinProb,
      factors: currentGamePredictions.factors,
      source: currentGamePredictions.source,
      modelVersion: currentGamePredictions.modelVersion,
      generatedAt: currentGamePredictions.generatedAt,
    })
    .from(games)
    .leftJoin(currentGamePredictions, eq(games.gameId, currentGamePredictions.gameId))
    .where(and(gte(games.gameDate, from), lte(games.gameDate, to)))
    .orderBy(asc(games.gameDate), asc(games.tipoffUtc), asc(games.gameId));
}

type GameRow = Awaited<ReturnType<typeof gamesBetween>>[number];

function team(teamId: number | null, records: Records): SlateTeam {
  const t = requireTeam(teamId ?? -1);
  const r = records.get(t.team_id) ?? { wins: 0, losses: 0 };
  return { teamId: t.team_id, abbr: t.abbr, city: t.city, name: t.name, ...r };
}

function toSlateGame(row: GameRow, records: Records): SlateGame {
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return {
    gameId: row.gameId,
    gameDate: String(row.gameDate),
    seasonType: row.seasonType,
    tipoffUtc: iso(row.tipoffUtc),
    status: row.status as GameStatus,
    home: team(row.homeTeamId, records),
    away: team(row.awayTeamId, records),
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    isNeutral: row.isNeutral,
    // The schedule carries sponsor names ("Emirates NBA Cup"); show the event name only.
    gameLabel: row.gameLabel?.replace(/^Emirates\s+/, "") || null,
    prediction:
      row.homeWinProb === null || row.homeWinProb === undefined
        ? null
        : {
            homeWinProb: row.homeWinProb,
            eloHomeWinProb: row.eloHomeWinProb ?? null,
            factors: (row.factors ?? []) as StoredFactor[],
            source: row.source === "backfill" ? "backfill" : "live",
            modelVersion: row.modelVersion ?? "",
            generatedAt: iso(row.generatedAt) ?? "",
          },
  };
}

/** Days the game wheel covers: today and up to this many days before it. */
export const WHEEL_PAST_DAYS = 2;

/**
 * Games for the home page's wheel, oldest first: today and the previous ``WHEEL_PAST_DAYS``
 * days. When that window has no games (off-season, All-Star break), the most recent earlier day
 * that has games. Uncached.
 */
export async function fetchWheel(db: Db, today: string): Promise<Wheel> {
  let rowsIn = await gamesBetween(db, addDays(today, -WHEEL_PAST_DAYS), today);
  if (!rowsIn.length) {
    const result = await db.execute(
      sql`select max(game_date)::text as day from games where game_date < ${addDays(today, -WHEEL_PAST_DAYS)}`,
    );
    const day = rows<{ day: string | null }>(result)[0]?.day;
    if (day) rowsIn = await gamesBetween(db, day, day);
  }
  // Records (W-L) are as of each game's day.
  const days = [...new Set(rowsIn.map((r) => String(r.gameDate)))];
  const records = new Map(await Promise.all(days.map(async (d) => [d, await recordsBefore(db, d)] as const)));
  return {
    today,
    games: rowsIn.map((r) => toSlateGame(r, records.get(String(r.gameDate))!)),
  };
}

/** Cached wheel (predictions change about once a day; scores every few minutes). */
export async function getWheel(today: string): Promise<Wheel> {
  "use cache";
  cacheLife("minutes");
  const { getDb } = await import("./client");
  return fetchWheel(getDb(), today);
}
