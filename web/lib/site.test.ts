import { describe, expect, it } from "vitest";

import { absoluteUrl, pageMeta, SITE_URL } from "@/lib/site";

describe("site metadata", () => {
  it("builds absolute URLs without a trailing slash on the root", () => {
    expect(absoluteUrl("/")).toBe(SITE_URL);
    expect(absoluteUrl("/docs")).toBe(`${SITE_URL}/docs`);
    expect(SITE_URL.endsWith("/")).toBe(false);
  });

  it("gives every page a canonical URL, preview tags and a share image", () => {
    const m = pageMeta({ title: "T", description: "D", path: "/performance" });
    expect(m.alternates?.canonical).toBe("/performance");
    expect(m.openGraph).toMatchObject({ title: "T", description: "D", url: "/performance" });
    expect(JSON.stringify(m.openGraph)).toContain("/opengraph-image");
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: ["/opengraph-image"] });
  });

  it("lets a page bring its own share image", () => {
    const image = { url: "/game/0022600001/opengraph-image", width: 1200, height: 630, alt: "a" };
    const m = pageMeta({ title: "T", description: "D", path: "/game/0022600001", image });
    expect(m.twitter).toMatchObject({ images: [image.url] });
  });
});
