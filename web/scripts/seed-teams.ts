/** Upsert the 30 teams from shared/teams.json. Usage: pnpm db:seed (uses DATABASE_URL). */
import { existsSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { teams as teamRows } from "../lib/teams";
import { teams } from "../lib/db/schema";

const rootEnv = path.resolve(__dirname, "../../.env");
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const values = teamRows.map((t) => ({
    teamId: t.team_id,
    abbr: t.abbr,
    city: t.city,
    name: t.name,
    conference: t.conference,
    division: t.division,
  }));
  await db
    .insert(teams)
    .values(values)
    .onConflictDoUpdate({
      target: teams.teamId,
      set: {
        abbr: sql`excluded.abbr`,
        city: sql`excluded.city`,
        name: sql`excluded.name`,
        conference: sql`excluded.conference`,
        division: sql`excluded.division`,
      },
    });
  console.log(`seeded ${values.length} teams`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
