"use client";

import { useEffect } from "react";

import "./globals.css";

/**
 * Last resort: the root layout itself failed. It replaces the whole document, so it brings its own
 * <html>, <body>, title and the disclaimer (the footer isn't rendered).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>Something went wrong · NBA Game Predictor</title>
        <main className="mx-auto grid w-full max-w-3xl flex-1 content-center px-4 py-24 sm:px-6">
          <p className="eyebrow">NBA Game Predictor</p>
          <h1 className="mt-3 text-5xl leading-[0.95] font-extrabold uppercase sm:text-7xl">The site didn&apos;t load</h1>
          <p className="mt-6 max-w-prose text-lg text-muted-foreground">
            Something failed on our side. Try again in a moment.
          </p>
          <div className="mt-8">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex cursor-pointer items-center rounded-full bg-nba-red px-5 py-3 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-blue-hi"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
