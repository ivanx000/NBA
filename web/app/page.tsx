import { connection } from "next/server";
import { Suspense } from "react";

import { HomeExperience } from "@/components/home/home-experience";
import { parseDay, todayET } from "@/lib/dates";
import { getSlate } from "@/lib/db/queries";
import { pickGame } from "@/lib/slate";

function HomeShell() {
  return (
    <main id="main" className="grid h-svh min-h-[600px] place-items-center" aria-busy>
      <span className="basketball-loader" aria-hidden />
      <span className="sr-only">Loading tonight&apos;s games</span>
    </main>
  );
}

async function Home({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  // "Today" and the random default game are per request, never part of a prerender.
  await connection();
  const params = await searchParams;
  const today = todayET();
  const date = parseDay(params.date) ?? today;
  const slate = await getSlate(date, today);
  const requested = typeof params.game === "string" ? params.game : null;
  // A random game when none is requested (PRD 3.1); the client then writes it into the URL.
  const featured = pickGame(slate, requested);
  return (
    <HomeExperience
      key={date}
      slate={slate}
      initialGameId={featured?.gameId ?? null}
      syncUrl={featured !== null && featured.gameId !== requested}
    />
  );
}

export default function Page({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<HomeShell />}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}
