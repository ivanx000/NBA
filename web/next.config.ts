import path from "node:path";

import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The repo root (one level up) holds shared/teams.json, which web/ imports directly.
// Both roots must include it so dev, build and Vercel's file tracing can resolve it.
const repoRoot = path.resolve(__dirname, "..");

// Secrets live in the repo-root .env (shared with ml/); Vercel sets env vars directly. Next has
// already loaded (and cached) web/'s env files by now, so force a reload that reads the root.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
