import type { Metadata } from "next";

/**
 * Site identity for metadata, the sitemap and robots.txt. `NEXT_PUBLIC_SITE_URL` overrides the URL
 * (set it in Vercel when a custom domain is connected); otherwise it's the production vercel.app URL.
 */
/** The site has no brand name (the user's decision, Nov 2026); this is its title. */
export const SITE_NAME = "NBA Game Predictor";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://nba-alpha-olive.vercel.app").replace(/\/$/, "");
export const SITE_DESCRIPTION =
  "Who wins tonight? Pick the winner of every NBA game and see what the model thinks: win chances, the reasons behind them, projected player lines and an honest report card.";

/** Absolute URL for a site path ("/docs" -> "https://…/docs"). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === "/" ? "" : path}`;
}

/** The default share image (app/opengraph-image.tsx). */
const DEFAULT_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "NBA Game Predictor: who wins tonight? NBA game predictions in 3D.",
};

/**
 * A page's metadata: title, description, canonical URL and the link-preview tags. Next merges
 * `openGraph` and `twitter` shallowly, so a page's object replaces the layout's, images included:
 * every page sets them here, with the default share image unless it passes its own (the game
 * pages pass their `opengraph-image` route, which an explicit image would otherwise override).
 */
export function pageMeta({
  title,
  description,
  path,
  image = DEFAULT_IMAGE,
}: {
  title: string;
  description: string;
  path: string;
  image?: { url: string; width: number; height: number; alt: string };
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title,
      description,
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
