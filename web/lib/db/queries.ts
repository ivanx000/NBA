import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { cacheLife } from "next/cache";

import { seasonFor } from "@/lib/dates";
import type { StoredFactor } from "@/lib/factor-copy";
import type { GameStatus, Slate, SlateGame, SlateTeam } from "@/lib/slate";
import { headToHead, type PastGame, type RecentGame, recentGames, seriesGames, teamStats } from "@/lib/team-stats";
import { requireTeam } from "@/lib/teams";

import type { Db } from "./client";
import { currentGamePredictions, games } from "./schema";

function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

/** The season's finished regular-season games before ``day`` (team stats are built from these). */
async function pastGames(db: Db, day: string): Promise<PastGame[]> {
  const result = await db.execute(sql`
    select game_date::text as game_date, home_team_id, away_team_id, home_score, away_score from games
      where season = ${seasonFor(day)} and season_type = 'regular' and status = 'final'
        and game_date < ${day} and home_score is not null and away_score is not null`);
  return rows<{ game_date: string; home_team_id: number; away_team_id: number; home_score: number; away_score: number }>(
    result,
  ).map((r) => ({
    gameDate: String(r.game_date),
    homeTeamId: Number(r.home_team_id),
    awayTeamId: Number(r.away_team_id),
    homeScore: Number(r.home_score),
    awayScore: Number(r.away_score),
  }));
}

function selectGames(db: Db) {
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
    .leftJoin(currentGamePredictions, eq(games.gameId, currentGamePredictions.gameId));
}

function gamesBetween(db: Db, from: string, to: string) {
  return selectGames(db)
    .where(and(gte(games.gameDate, from), lte(games.gameDate, to)))
    .orderBy(asc(games.gameDate), asc(games.tipoffUtc), asc(games.gameId));
}

type GameRow = Awaited<ReturnType<typeof gamesBetween>>[number];

function team(teamId: number | null, past: PastGame[], day: string): SlateTeam {
  const t = requireTeam(teamId ?? -1);
  const stats = teamStats(past, t.team_id, day);
  return { teamId: t.team_id, abbr: t.abbr, city: t.city, name: t.name, ...stats.record, stats };
}

function toSlateGame(row: GameRow, past: PastGame[], day: string): SlateGame {
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return {
    gameId: row.gameId,
    gameDate: String(row.gameDate),
    seasonType: row.seasonType,
    tipoffUtc: iso(row.tipoffUtc),
    status: row.status as GameStatus,
    home: team(row.homeTeamId, past, day),
    away: team(row.awayTeamId, past, day),
    headToHead: headToHead(past, row.homeTeamId ?? -1, row.awayTeamId ?? -1, day),
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
  // Records and stats are as of the games' day (games before it only).
  const past = await pastGames(db, day);
  return rowsIn.map((r) => toSlateGame(r, past, day));
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

/** One game in full for its breakdown page: the game, each team's last 10, the season series. */
export interface GameDetail {
  game: SlateGame;
  form: { home: RecentGame[]; away: RecentGame[] };
  series: PastGame[];
}

/** ``gameId``'s breakdown, or null if there's no such game. Any day (past games included). Uncached. */
export async function fetchGameDetail(db: Db, gameId: string): Promise<GameDetail | null> {
  const [row] = await selectGames(db).where(eq(games.gameId, gameId)).limit(1);
  if (!row) return null;
  const day = String(row.gameDate);
  const past = await pastGames(db, day);
  const game = toSlateGame(row, past, day);
  return {
    game,
    form: {
      home: recentGames(past, game.home.teamId, day),
      away: recentGames(past, game.away.teamId, day),
    },
    series: seriesGames(past, game.home.teamId, game.away.teamId, day),
  };
}

/** Cached breakdown (scores and predictions change at most every few minutes). */
export async function getGameDetail(gameId: string): Promise<GameDetail | null> {
  "use cache";
  cacheLife("minutes");
  const { getDb } = await import("./client");
  return fetchGameDetail(getDb(), gameId);
}
