import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { cacheLife } from "next/cache";

import { seasonFor } from "@/lib/dates";
import type { StoredFactor } from "@/lib/factor-copy";
import type { GameStatus, Slate, SlateGame, SlateTeam } from "@/lib/slate";
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

async function withRecords(db: Db, rowsIn: GameRow[], day: string): Promise<SlateGame[]> {
  // Records (W-L) are as of the games' day.
  const records = await recordsBefore(db, day);
  return rowsIn.map((r) => toSlateGame(r, records));
}

/**
 * The home page's games: today's only (ET). When today has none, also the closest later day
 * that has games, so the page can offer it. Past days are never shown. Uncached.
 */
export async function fetchSlate(db: Db, today: string): Promise<Slate> {
  const todays = await gamesBetween(db, today, today);
  if (todays.length) return { today, games: await withRecords(db, todays, today), next: null };
  const result = await db.execute(sql`select min(game_date)::text as day from games where game_date > ${today}`);
  const day = rows<{ day: string | null }>(result)[0]?.day ?? null;
  if (!day) return { today, games: [], next: null };
  return { today, games: [], next: { day, games: await withRecords(db, await gamesBetween(db, day, day), day) } };
}

/** Cached slate (predictions change about once a day; scores every few minutes). */
export async function getSlate(today: string): Promise<Slate> {
  "use cache";
  cacheLife("minutes");
  const { getDb } = await import("./client");
  return fetchSlate(getDb(), today);
}
