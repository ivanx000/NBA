import type { Metadata } from "next";
import { Inter, Oswald } from "next/font/google";
import { Suspense } from "react";

import { HideOnHome } from "@/components/hide-on-home";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav, SiteNavFallback } from "@/components/site-nav";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tip-Off: who wins tonight?",
  description:
    "An NBA game outcome and player stat forecaster with a 3D prediction experience. Unofficial fan project.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${oswald.variable} h-full antialiased`}>
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
        <div className="flex flex-1 flex-col">{children}</div>
        {/* The home page shows a one-line disclaimer inside the room instead (CLAUDE.md). */}
        <Suspense fallback={null}>
          <HideOnHome>
            <SiteFooter />
          </HideOnHome>
        </Suspense>
      </body>
    </html>
  );
}
