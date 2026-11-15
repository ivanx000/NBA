import { connection } from "next/server";
import { Suspense } from "react";

import { HomeExperience } from "@/components/home/home-experience";
import { todayET } from "@/lib/dates";
import { getWheel } from "@/lib/db/queries";
import { defaultGame } from "@/lib/slate";

function HomeShell() {
  return (
    <main id="main" className="grid h-svh min-h-[600px] place-items-center" aria-busy>
      <span className="basketball-loader" aria-hidden />
      <span className="sr-only">Loading tonight&apos;s games</span>
    </main>
  );
}

async function Home({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  // "Today" is per request, never part of a prerender.
  await connection();
  const params = await searchParams;
  const today = todayET();
  const wheel = await getWheel(today);
  const requested = typeof params.game === "string" ? params.game : null;
  // Today's next game unless one is requested; the client then writes it into the URL.
  const featured = defaultGame(wheel, requested);
  return (
    <HomeExperience
      wheel={wheel}
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
