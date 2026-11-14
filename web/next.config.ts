import path from "node:path";

import type { NextConfig } from "next";

// The repo root (one level up) holds shared/teams.json, which web/ imports directly.
// Both roots must include it so dev, build and Vercel's file tracing can resolve it.
const repoRoot = path.resolve(__dirname, "..");

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
