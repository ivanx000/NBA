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

import { fetchGameDetail, fetchSlate } from "./queries";
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
