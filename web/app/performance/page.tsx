import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { PerformanceView } from "@/components/performance/performance-view";
import { getGradedSeasons } from "@/lib/db/queries";
import { seasonSummary } from "@/lib/performance";

export const metadata: Metadata = {
  title: "Model performance · Tip-Off",
  description:
    "How often the Tip-Off model calls NBA games right, next to Elo and the home team: accuracy, log loss, calibration and every recent pick. Unofficial fan project.",
};

async function Report() {
  // Results land through the day; read at request time (the query itself is cached).
  await connection();
  const seasons = await getGradedSeasons();
  return <PerformanceView seasons={seasons.slice(0, 2).map((s) => seasonSummary(s.season, s.games))} />;
}

function Loading() {
  return (
    <div className="grid min-h-[40vh] place-items-center" role="status" aria-label="Loading the report card">
      <span className="basketball-loader" aria-hidden />
    </div>
  );
}

export default function Page() {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-28 pb-20 sm:px-6">
      <p className="eyebrow">Report card</p>
      <h1 className="mt-3 font-display text-5xl leading-[0.95] font-extrabold uppercase sm:text-7xl">
        Model performance
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
        Every prediction is graded once the game ends, next to two simple baselines: Elo ratings and
        always picking the home team.
      </p>
      <Suspense fallback={<Loading />}>
        <Report />
      </Suspense>
    </main>
  );
}
