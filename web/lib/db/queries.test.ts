/**
 * fetchSlate against real Postgres with the real migrations (web/drizzle/*.sql).
 * Locally: `docker compose up -d db` (database tipoff_web_test). CI: a Postgres service.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { teams } from "@/lib/teams";

import { fetchGameDetail, fetchGradedSeasons, fetchSlate } from "./queries";
import * as schema from "./schema";

const URL =
  process.env.TEST_WEB_DATABASE_URL ?? "postgresql://tipoff:tipoff@localhost:5433/tipoff_web_test";
const BOS = 1610612738;
const NYK = 1610612752;
const LAL = 1610612747;

let pool: Pool;
let available = true;

beforeAll(async () => {
  pool = new Pool({ connectionString: URL, max: 2 });
  try {
    await pool.query("select 1");
  } catch {
    available = false;
    return;
  }
  await pool.query("drop schema public cascade; create schema public");
  const dir = path.resolve(__dirname, "../../drizzle");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pool.query(stmt);
    }
  }
  for (const t of teams) {
    await pool.query("insert into teams values ($1,$2,$3,$4,$5,$6)", [
      t.team_id, t.abbr, t.city, t.name, t.conference, t.division,
    ]);
  }
  const game = (id: string, day: string, home: number, away: number, status: string,
                hs: number | null, as: number | null) =>
    pool.query(
      `insert into games (game_id, season, season_type, game_date, tipoff_utc, home_team_id,
        away_team_id, status, home_score, away_score) values ($1,'2026-27','regular',$2,$3,$4,$5,$6,$7,$8)`,
      [id, day, `${day}T23:30:00Z`, home, away, status, hs, as],
    );
  await game("0022600001", "2026-11-10", BOS, NYK, "final", 110, 100);
  await game("0022600002", "2026-11-12", NYK, BOS, "final", 99, 101);
  await game("0022600003", "2026-11-14", NYK, BOS, "scheduled", null, null);
  await game("0022600004", "2026-11-14", LAL, BOS, "scheduled", null, null);
  await game("0022600005", "2026-11-20", LAL, NYK, "scheduled", null, null);
  await pool.query(
    `insert into model_versions values ('game-v2','game',now(),null,null,null),
                                       ('game-v2-wf','game',now(),null,null,null)`,
  );
  const factors = JSON.stringify([{ factor: "rest", label: "Rest and schedule", favors: "home",
                                    pp: 0.03, logit: 0.12 }]);
  await pool.query(
    `insert into game_predictions values
      ('0022600003','game-v2-wf','2026-11-13T00:00:00Z',0.40,$1,'h',true,'backfill',0.5),
      ('0022600003','game-v2','2026-11-14T14:00:00Z',0.64,$1,'h',true,'live',0.58)`,
    [factors],
  );
});

async function addProjections() {
  await pool.query(
    `insert into model_versions values ('player-v1','player',now(),null,null,null),
                                       ('player-v1-wf','player',now(),null,null,null)`,
  );
  const proj = (player: number, team: number, name: string, minutes: number, version: string, source: string) =>
    pool.query(
      `insert into player_projections (game_id, player_id, team_id, player_name, model_version, proj_minutes,
         pts, reb, ast, pts_lo, pts_hi, reb_lo, reb_hi, ast_lo, ast_hi, generated_at, source)
       values ('0022600003',$1,$2,$3,$4,$5,20,6,4,12,28,2,10,1,7,$6,$7)`,
      [player, team, name, version, minutes, source === "live" ? "2026-11-14T14:00:00Z" : "2026-11-13T00:00:00Z", source],
    );
  await proj(1, NYK, "Jalen Brunson", 34, "player-v1", "live");
  await proj(2, NYK, "Josh Hart", 36, "player-v1", "live");
  await proj(3, BOS, "Jayson Tatum", 35, "player-v1", "live");
  await proj(9, NYK, "Backtest Only", 40, "player-v1-wf", "backfill");
}

afterAll(async () => {
  await pool?.end();
});

describe("fetchSlate", () => {
  it("returns today's games only, with records as of today", async () => {
    if (!available) return;
    const db = drizzle(pool, { schema });
    const slate = await fetchSlate(db, "2026-11-14");
    expect(slate.games.map((g) => g.gameId)).toEqual(["0022600003", "0022600004"]);
    expect(slate.next).toBeNull();
    const [nov14] = slate.games;
    expect([nov14.away.abbr, nov14.away.wins, nov14.away.losses]).toEqual(["BOS", 2, 0]);
    expect(nov14.prediction?.source).toBe("live");
  });

  it("offers the closest later day with games when today has none, never a past day", async () => {
    if (!available) return;
    const db = drizzle(pool, { schema });
    const slate = await fetchSlate(db, "2026-11-15");
    expect(slate.games).toEqual([]);
    expect(slate.next?.day).toBe("2026-11-20");
    expect(slate.next?.games.map((g) => g.gameId)).toEqual(["0022600005"]);
    const after = await fetchSlate(db, "2026-11-21");
    expect([after.games, after.next]).toEqual([[], null]);
  });
});

describe("player projections", () => {
  it("attach one whole set per game (live beats backfill), split by team, most minutes first", async () => {
    if (!available) return;
    await addProjections();
    const db = drizzle(pool, { schema });
    const [game] = (await fetchSlate(db, "2026-11-14")).games;
    expect(game.players.source).toBe("live");
    expect(game.players.home.map((p) => p.name)).toEqual(["Josh Hart", "Jalen Brunson"]);
    expect(game.players.away.map((p) => p.name)).toEqual(["Jayson Tatum"]);
    expect(game.players.home[0].range.pts).toEqual([12, 28]);
    expect(game.players.home[0].actual).toBeNull();
    const detail = await fetchGameDetail(db, "0022600003");
    expect(detail?.game.players.home).toHaveLength(2);
    // A game without projections gets empty lists.
    expect((await fetchGameDetail(db, "0022600004"))?.game.players).toEqual({ home: [], away: [], source: null });
  });
});

describe("fetchGameDetail", () => {
  it("returns one game with each team's recent form and the season series", async () => {
    if (!available) return;
    const db = drizzle(pool, { schema });
    const detail = await fetchGameDetail(db, "0022600003");
    expect(detail?.game.gameId).toBe("0022600003");
    expect(detail?.game.prediction?.source).toBe("live");
    // BOS beat NYK on 11-10 (home) and 11-12 (away) before this 11-14 game.
    expect(detail?.series.map((g) => g.gameDate)).toEqual(["2026-11-10", "2026-11-12"]);
    expect(detail?.form.away.map((g) => g.won)).toEqual([true, true]);
    expect(await fetchGameDetail(db, "nope")).toBeNull();
  });
});

describe("fetchGradedSeasons", () => {
  it("returns finished games with their pregame prediction, by season", async () => {
    if (!available) return;
    const db = drizzle(pool, { schema });
    // Only 0022600003 has a prediction, and it isn't final yet: nothing to grade.
    expect(await fetchGradedSeasons(db)).toEqual([]);
    await pool.query("update games set status = 'final', home_score = 100, away_score = 90 where game_id = '0022600003'");
    try {
      const [season] = await fetchGradedSeasons(db);
      expect(season.season).toBe("2026-27");
      // The live prediction (0.64) wins over the backfill one (0.40).
      expect(season.games).toEqual([
        expect.objectContaining({ gameId: "0022600003", homeAbbr: "NYK", awayAbbr: "BOS", homeWinProb: expect.closeTo(0.64, 5),
                                  eloHomeWinProb: expect.closeTo(0.58, 5), source: "live" }), // prettier-ignore
      ]);
    } finally {
      await pool.query("update games set status = 'scheduled', home_score = null, away_score = null where game_id = '0022600003'");
    }
  });
});
