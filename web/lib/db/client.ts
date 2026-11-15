import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

type Db = ReturnType<typeof drizzleNeon<typeof schema>> | ReturnType<typeof drizzlePg<typeof schema>>;

let cached: { url: string; db: Db } | undefined;

/** Neon's HTTP driver for Neon URLs; node-postgres for anything else (local Docker, CI). */
export function dbFor(url: string): Db {
  const host = new URL(url).hostname;
  if (host.endsWith(".neon.tech")) return drizzleNeon(neon(url), { schema });
  return drizzlePg(new Pool({ connectionString: url, max: 3 }), { schema });
}

/** Server-only database handle from DATABASE_URL. */
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!cached || cached.url !== url) cached = { url, db: dbFor(url) };
  return cached.db;
}

export type { Db };
