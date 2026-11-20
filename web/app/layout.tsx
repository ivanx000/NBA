import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Archivo, JetBrains_Mono, Oswald } from "next/font/google";
import { Suspense } from "react";

import { HideOnHome } from "@/components/hide-on-home";
import { Interactions } from "@/components/interactions";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav, SiteNavFallback } from "@/components/site-nav";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

import "./globals.css";

// Archivo's width axis gives the wide, heavy headings (font-stretch: 125%).
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

// Jersey lettering only (drawn onto the 3D uniforms), not page text. Not preloaded: no page text
// uses it, and the 3D player waits for it before lettering a jersey (jerseyFontReady).
const jersey = Oswald({
  variable: "--font-jersey",
  subsets: ["latin"],
  weight: "700",
  preload: false,
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

// Site-wide defaults; each page sets its own title, description, canonical URL and preview tags
// (lib/site.ts pageMeta). The share image is app/opengraph-image.tsx unless a page has its own.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: "Tip-Off: who wins tonight?",
  description: SITE_DESCRIPTION,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${archivo.variable} ${jetbrains.variable} ${jersey.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <Suspense fallback={<SiteNavFallback />}>
          <SiteNav />
        </Suspense>
        <Interactions />
        {/* Above the pointer glow (components/interactions.tsx), which sits at z-index 0. */}
        <div className="relative z-[1] flex flex-1 flex-col">{children}</div>
        {/* The home page shows a one-line disclaimer inside the room instead (CLAUDE.md). */}
        <Suspense fallback={null}>
          <HideOnHome>
            <SiteFooter />
          </HideOnHome>
        </Suspense>
        {/* Vercel Web Analytics (cookieless page views) and Speed Insights (real-user Core Web
            Vitals). They read the route, so they sit in Suspense; both are inert outside Vercel. */}
        <Suspense fallback={null}>
          <Analytics />
          <SpeedInsights />
        </Suspense>
      </body>
    </html>
  );
}
