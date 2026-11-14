import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "drizzle-kit";

// Secrets live in the repo-root .env (see .env.example). An explicit env var wins.
const rootEnv = path.resolve(__dirname, "../.env");
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
