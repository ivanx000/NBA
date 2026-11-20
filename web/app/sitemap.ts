import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { getGradedSeasons } from "@/lib/db/queries";
import { DOC_PAGES } from "@/lib/docs";
import { absoluteUrl } from "@/lib/site";

/**
 * Every page worth indexing: the main pages, the docs, and a breakdown page for each graded game
 * (this season and last). Built per request from the cached graded-games query, so new results
 * appear without a deploy; if the database is unreachable it still lists the static pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/how-it-works"), changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/performance"), changeFrequency: "daily", priority: 0.8 },
    ...DOC_PAGES.map((d) => ({
      url: absoluteUrl(d.slug ? `/docs/${d.slug}` : "/docs"),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
  try {
    const seasons = await getGradedSeasons();
    for (const season of seasons) {
      for (const g of season.games) {
        pages.push({
          url: absoluteUrl(`/game/${g.gameId}`),
          lastModified: g.gameDate,
          changeFrequency: "yearly",
          priority: 0.3,
        });
      }
    }
  } catch (error) {
    console.error("sitemap: game pages left out", error);
  }
  return pages;
}
