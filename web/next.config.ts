import path from "node:path";

import { loadEnvConfig } from "@next/env";
import createMDX from "@next/mdx";
import type { NextConfig } from "next";

// The repo root (one level up) holds shared/teams.json, which web/ imports directly.
// Both roots must include it so dev, build and Vercel's file tracing can resolve it.
const repoRoot = path.resolve(__dirname, "..");

// Secrets live in the repo-root .env (shared with ml/); Vercel sets env vars directly. Next has
// already loaded (and cached) web/'s env files by now, so force a reload that reads the root.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  // The /docs pages are MDX in content/docs, imported by app/docs/[[...slug]].
  pageExtensions: ["ts", "tsx", "mdx"],
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

// Plugins are named by string so Turbopack can load them (options must be plain data).
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
    rehypePlugins: ["rehype-slug", ["rehype-pretty-code", { theme: "github-dark-dimmed", keepBackground: false }]],
  },
});

export default withMDX(nextConfig);
