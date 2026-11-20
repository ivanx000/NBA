import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";

/** Everything is public except the development tools under /dev. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/dev/" },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
