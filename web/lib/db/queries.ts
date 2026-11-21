import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { cacheLife } from "next/cache";

import { leagueAdvanced, type PlayerAdvanced, playerAdvanced, type PlayerTotals, type TeamTotals } from "@/lib/advanced-stats";
import { seasonFor } from "@/lib/dates";
import type { StoredFactor } from "@/lib/factor-copy";
import type { GradedGame } from "@/lib/performance";
import { type GamePlayers, NO_PLAYERS, type PlayerLine } from "@/lib/players";
import type { GameAdvanced, GameExtras, GameStatus, Slate, SlateGame, SlateTeam } from "@/lib/slate";
import { headToHead, type PastGame, type RecentGame, recentGames, seriesGames, teamStats } from "@/lib/team-stats";
import { requireTeam } from "@/lib/teams";

import type { Db } from "./client";
import { currentGamePredictions, currentPlayerProjections, games } from "./schema";

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

const n = (v: unknown) => Number(v ?? 0);

/** Every team's summed box scores (and its opponents') this season before ``day``. */
async function teamTotals(db: Db, day: string): Promise<TeamTotals[]> {
  const result = await db.execute(sql`
    select t.team_id, count(*) as games, sum(t.minutes) as minutes, sum(t.pts) as pts,
           sum(t.fgm) as fgm, sum(t.fga) as fga, sum(t.fg3m) as fg3m, sum(t.fta) as fta,
           sum(t.ftm) as ftm, sum(t.oreb) as oreb, sum(t.dreb) as dreb, sum(t.tov) as tov,
           sum(t.poss) as poss,
           sum(o.pts) as o_pts, sum(o.fgm) as o_fgm, sum(o.fga) as o_fga, sum(o.fg3m) as o_fg3m,
           sum(o.fta) as o_fta, sum(o.ftm) as o_ftm, sum(o.oreb) as o_oreb, sum(o.dreb) as o_dreb,
           sum(o.tov) as o_tov, sum(o.poss) as o_poss
      from team_game_stats t
      join team_game_stats o on o.game_id = t.game_id and o.team_id = t.opp_team_id
     where t.season = ${seasonFor(day)} and t.game_date < ${day}
     group by t.team_id`);
  return rows<Record<string, unknown>>(result).map((r) => ({
    teamId: n(r.team_id),
    games: n(r.games),
    minutes: n(r.minutes),
    pts: n(r.pts),
    fgm: n(r.fgm),
    fga: n(r.fga),
    fg3m: n(r.fg3m),
    fta: n(r.fta),
    ftm: n(r.ftm),
    oreb: n(r.oreb),
    dreb: n(r.dreb),
    tov: n(r.tov),
    poss: n(r.poss),
    opp: {
      pts: n(r.o_pts),
      fgm: n(r.o_fgm),
      fga: n(r.o_fga),
      fg3m: n(r.o_fg3m),
      fta: n(r.o_fta),
      ftm: n(r.o_ftm),
      oreb: n(r.o_oreb),
      dreb: n(r.o_dreb),
      tov: n(r.o_tov),
      poss: n(r.o_poss),
    },
  }));
}

/** ``ids``' summed box scores this season before ``day`` (games they played), with their teams'
 *  totals in those games (for usage) and their last 5 games. */
async function playerTotals(db: Db, day: string, ids: readonly number[]): Promise<PlayerTotals[]> {
  if (!ids.length) return [];
  const result = await db.execute(sql`
    with p as (
      select p.*, t.minutes as t_minutes, t.fga as t_fga, t.fta as t_fta, t.tov as t_tov,
             row_number() over (partition by p.player_id order by p.game_date desc) as recent
        from player_game_stats p
        join team_game_stats t on t.game_id = p.game_id and t.team_id = p.team_id
       where p.season = ${seasonFor(day)} and p.game_date < ${day} and p.minutes > 0
         and p.player_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    )
    select player_id, count(*) as games, sum(minutes) as minutes, sum(pts) as pts,
           sum(oreb + dreb) as reb, sum(ast) as ast, sum(fga) as fga, sum(fg3m) as fg3m,
           sum(fg3a) as fg3a, sum(fta) as fta, sum(tov) as tov,
           sum(t_minutes) as t_minutes, sum(t_fga) as t_fga, sum(t_fta) as t_fta, sum(t_tov) as t_tov,
           count(*) filter (where recent <= 5) as l5_games,
           sum(pts) filter (where recent <= 5) as l5_pts,
           sum(minutes) filter (where recent <= 5) as l5_minutes
      from p group by player_id`);
  return rows<Record<string, unknown>>(result).map((r) => ({
    playerId: n(r.player_id),
    games: n(r.games),
    minutes: n(r.minutes),
    pts: n(r.pts),
    reb: n(r.reb),
    ast: n(r.ast),
    fga: n(r.fga),
    fg3m: n(r.fg3m),
    fg3a: n(r.fg3a),
    fta: n(r.fta),
    tov: n(r.tov),
    team: { minutes: n(r.t_minutes), fga: n(r.t_fga), fta: n(r.t_fta), tov: n(r.t_tov) },
    last5: { games: n(r.l5_games), pts: n(r.l5_pts), minutes: n(r.l5_minutes) },
  }));
}

/** Advanced stats for ``slate`` (games on ``day``): both teams with league ranks, and every
 *  projected player. Null for a game when nothing is stored for its season yet. */
async function advancedFor(db: Db, slate: readonly SlateGame[], day: string): Promise<Map<string, GameAdvanced | null>> {
  const ids = slate.flatMap((g) => [...g.players.home, ...g.players.away].map((p) => p.playerId));
  const [teams, players] = await Promise.all([teamTotals(db, day), playerTotals(db, day, [...new Set(ids)])]);
  const league = leagueAdvanced(teams);
  const byPlayer = new Map<number, PlayerAdvanced>();
  for (const t of players) {
    const a = playerAdvanced(t);
    if (a) byPlayer.set(t.playerId, a);
  }
  return new Map(
    slate.map((g) => {
      const home = league.get(g.home.teamId) ?? null;
      const away = league.get(g.away.teamId) ?? null;
      if (!home && !away && !byPlayer.size) return [g.gameId, null];
      const mine = [...g.players.home, ...g.players.away].filter((p) => byPlayer.has(p.playerId));
      return [g.gameId, { teams: { home, away }, players: Object.fromEntries(mine.map((p) => [p.playerId, byPlayer.get(p.playerId)!])) }];
    }),
  );
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

type ProjectionRow = typeof currentPlayerProjections.$inferSelect;

function playerLine(r: ProjectionRow): PlayerLine {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
  const opt = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v));
  return {
    playerId: Number(r.playerId),
    teamId: Number(r.teamId),
    name: r.playerName ?? "",
    number: r.jerseyNumber ?? null,
    minutes: n(r.projMinutes),
    proj: { pts: n(r.pts), reb: n(r.reb), ast: n(r.ast) },
    range: {
      pts: [n(r.ptsLo), n(r.ptsHi)],
      reb: [n(r.rebLo), n(r.rebHi)],
      ast: [n(r.astLo), n(r.astHi)],
    },
    actual:
      r.actualMinutes === null || r.actualMinutes === undefined
        ? null
        : { minutes: Number(r.actualMinutes), pts: opt(r.actualPts), reb: opt(r.actualReb), ast: opt(r.actualAst) },
  };
}

/** Each game's current projection set (one set per game: live beats backfill), by game id. */
async function playersFor(db: Db, rowsIn: GameRow[]): Promise<Map<string, GamePlayers>> {
  const ids = rowsIn.map((r) => r.gameId);
  const out = new Map<string, GamePlayers>();
  if (!ids.length) return out;
  const found = await db
    .select()
    .from(currentPlayerProjections)
    .where(inArray(currentPlayerProjections.gameId, ids))
    .orderBy(desc(currentPlayerProjections.projMinutes));
  const homeOf = new Map(rowsIn.map((r) => [r.gameId, r.homeTeamId]));
  for (const r of found) {
    const gameId = r.gameId ?? "";
    const entry = out.get(gameId) ?? { home: [], away: [], source: r.source === "live" ? "live" : "backfill" };
    (r.teamId === homeOf.get(gameId) ? entry.home : entry.away).push(playerLine(r));
    out.set(gameId, entry);
  }
  return out;
}

function toSlateGame(row: GameRow, past: PastGame[], day: string, players: GamePlayers = NO_PLAYERS): SlateGame {
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
    players,
  };
}

async function withRecords(
  db: Db,
  rowsIn: GameRow[],
  day: string,
): Promise<{ games: SlateGame[]; details: Record<string, GameExtras> }> {
  // Records and stats are as of the games' day (games before it only).
  const [past, players] = await Promise.all([pastGames(db, day), playersFor(db, rowsIn)]);
  const games = rowsIn.map((r) => toSlateGame(r, past, day, players.get(r.gameId)));
  const advanced = await advancedFor(db, games, day);
  // Each game's last 10s, season series and advanced stats, for the results screen's breakdown.
  const details = Object.fromEntries(
    games.map((g) => [
      g.gameId,
      {
        form: { home: recentGames(past, g.home.teamId, day), away: recentGames(past, g.away.teamId, day) },
        series: seriesGames(past, g.home.teamId, g.away.teamId, day),
        advanced: advanced.get(g.gameId) ?? null,
      },
    ]),
  );
  return { games, details };
}

/**
 * The home page's games: today's only (ET). When today has none, also the closest later day
 * that has games, so the page can offer it. Past days are never shown. Uncached.
 */
export async function fetchSlate(db: Db, today: string): Promise<Slate> {
  const todays = await gamesBetween(db, today, today);
  if (todays.length) {
    const { games: g, details } = await withRecords(db, todays, today);
    return { today, games: g, next: null, details };
  }
  const result = await db.execute(sql`select min(game_date)::text as day from games where game_date > ${today}`);
  const day = rows<{ day: string | null }>(result)[0]?.day ?? null;
  if (!day) return { today, games: [], next: null };
  const { games: g, details } = await withRecords(db, await gamesBetween(db, day, day), day);
  return { today, games: [], next: { day, games: g }, details };
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
  advanced: GameAdvanced | null;
}

/** ``gameId``'s breakdown, or null if there's no such game. Any day (past games included). Uncached. */
export async function fetchGameDetail(db: Db, gameId: string): Promise<GameDetail | null> {
  const [row] = await selectGames(db).where(eq(games.gameId, gameId)).limit(1);
  if (!row) return null;
  const day = String(row.gameDate);
  const [past, players] = await Promise.all([pastGames(db, day), playersFor(db, [row])]);
  const game = toSlateGame(row, past, day, players.get(gameId));
  const advanced = (await advancedFor(db, [game], day)).get(gameId) ?? null;
  return {
    game,
    advanced,
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

export interface SeasonGrades {
  /** e.g. "2026-27" */
  season: string;
  /** Finished regular-season games with a pregame prediction, in date order. */
  games: GradedGame[];
}

/**
 * Every graded game (finished, regular season, pregame prediction; live beats backfill), grouped
 * by season, newest season first. Uncached.
 */
export async function fetchGradedSeasons(db: Db): Promise<SeasonGrades[]> {
  const result = await db.execute(sql`
    select g.season, g.game_id, g.game_date::text as game_date, h.abbr as home_abbr, a.abbr as away_abbr,
           g.home_score, g.away_score, p.home_win_prob, p.elo_home_win_prob, p.source
      from games g
      join current_game_predictions p on p.game_id = g.game_id
      join teams h on h.team_id = g.home_team_id
      join teams a on a.team_id = g.away_team_id
     where g.status = 'final' and g.season_type = 'regular'
       and g.home_score is not null and g.away_score is not null
     order by g.game_date, g.tipoff_utc, g.game_id`);
  const bySeason = new Map<string, GradedGame[]>();
  for (const r of rows<{
    season: string; game_id: string; game_date: string; home_abbr: string; away_abbr: string;
    home_score: number; away_score: number; home_win_prob: number; elo_home_win_prob: number | null; source: string;
  }>(result)) { // prettier-ignore
    const list = bySeason.get(r.season) ?? [];
    list.push({
      gameId: r.game_id,
      gameDate: String(r.game_date),
      homeAbbr: r.home_abbr,
      awayAbbr: r.away_abbr,
      homeScore: Number(r.home_score),
      awayScore: Number(r.away_score),
      homeWinProb: Number(r.home_win_prob),
      eloHomeWinProb: r.elo_home_win_prob === null ? null : Number(r.elo_home_win_prob),
      source: r.source === "live" ? "live" : "backfill",
    });
    bySeason.set(r.season, list);
  }
  return [...bySeason.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([season, games]) => ({ season, games }));
}

/** Cached graded games (results and predictions change a few times a day). */
export async function getGradedSeasons(): Promise<SeasonGrades[]> {
  "use cache";
  cacheLife("hours");
  const { getDb } = await import("./client");
  return fetchGradedSeasons(getDb());
}
