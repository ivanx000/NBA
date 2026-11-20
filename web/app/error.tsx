"use client";

import { useEffect } from "react";

import { StatusLink, StatusPage } from "@/components/status-page";

/**
 * Any page that fails to render (usually the database for a moment). The nav and footer stay;
 * "Try again" re-fetches and re-renders the page.
 */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <StatusPage
      label="Error"
      title="This page didn't load"
      actions={
        <>
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex cursor-pointer items-center rounded-full bg-nba-red px-5 py-3 font-bold text-white shadow-[0_0_24px_rgba(200,16,46,0.45)] transition-colors hover:bg-[#e0193a] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-blue-hi"
          >
            Try again
          </button>
          <StatusLink href="/docs">Read the docs meanwhile</StatusLink>
        </>
      }
    >
      <p>
        Something failed on our side, most often the database being briefly unreachable. Try again; if it keeps
        happening, check back in a few minutes.
      </p>
      {digest && <p className="mt-4 font-mono text-xs tracking-wide text-ink-faint">Reference: {digest}</p>}
    </StatusPage>
  );
}
