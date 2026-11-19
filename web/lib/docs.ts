import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import GithubSlugger from "github-slugger";
import { cacheLife } from "next/cache";

/** The /docs pages, in sidebar order. Each lives at content/docs/{slug}.mdx ("" = the overview). */
export const DOC_SECTIONS: { title: string; pages: { slug: string; title: string; description: string }[] }[] = [
  {
    title: "Start here",
    pages: [
      { slug: "", title: "Overview", description: "What Tip-Off predicts, how well, and how it fits together." },
      { slug: "architecture", title: "Architecture", description: "The pipeline, the database and the website, and why they're split this way." },
    ],
  },
  {
    title: "Data",
    pages: [
      { slug: "data-sources", title: "Data sources and limitations", description: "Where the numbers come from, how they're cached, and what they can't tell us." },
      { slug: "features", title: "Feature engineering", description: "The 56 numbers the model sees for every game." },
      { slug: "leakage", title: "Preventing leakage", description: "How every feature is limited to what was known before tip-off, and the test that enforces it." },
    ],
  },
  {
    title: "Model",
    pages: [
      { slug: "models", title: "Models and baselines", description: "What was tried, how the champion was picked, and how it scored." },
      { slug: "calibration", title: "Calibration", description: "Whether a 70% pick really wins about 70% of the time." },
      { slug: "explaining-predictions", title: "Explaining predictions", description: "Turning a probability into the reasons shown on the site." },
      { slug: "player-projections", title: "Player projections", description: "Points, rebounds and assists per player (coming next)." },
    ],
  },
  {
    title: "In production",
    pages: [
      { slug: "pipeline", title: "The daily pipeline", description: "How predictions get published every morning, and how they're kept honest." },
      { slug: "limitations", title: "Limitations and honest caveats", description: "What the model doesn't know, and where it falls short." },
    ],
  },
];

export const DOC_PAGES = DOC_SECTIONS.flatMap((s) => s.pages);

export function findDoc(slug: string) {
  return DOC_PAGES.find((p) => p.slug === slug) ?? null;
}

export interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

/** Plain text of a markdown heading, as rehype-slug sees it (no backticks, links or emphasis). */
function headingText(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .trim();
}

/**
 * The page's "On this page" list: its ## and ### headings, with the ids rehype-slug gives them
 * (both use github-slugger in document order, so duplicates get the same -1, -2 suffixes).
 */
export async function docToc(slug: string): Promise<TocEntry[]> {
  // The docs are files in the repo: cache for good so the pages prerender (a deploy brings new ones).
  "use cache";
  cacheLife("max");
  const source = await readFile(path.join(process.cwd(), "content/docs", `${slug || "index"}.mdx`), "utf8");
  const slugger = new GithubSlugger();
  const toc: TocEntry[] = [];
  let fenced = false;
  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = headingText(m[2]);
    const id = slugger.slug(text);
    if (m[1].length === 2 || m[1].length === 3) toc.push({ id, text, depth: m[1].length as 2 | 3 });
  }
  return toc;
}
