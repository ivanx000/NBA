import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GameBreakdown } from "@/components/game/game-breakdown";
import { shortDate } from "@/lib/dates";
import { getGameDetail } from "@/lib/db/queries";

export async function generateMetadata({ params }: PageProps<"/game/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getGameDetail(id);
  if (!detail) return { title: "Game not found · Tip-Off" };
  const { game } = detail;
  const title = `${game.away.name} at ${game.home.name}, ${shortDate(game.gameDate)} · Tip-Off`;
  return {
    title,
    description: `Who wins ${game.away.city} at ${game.home.city}: the model's win chance, the reasons behind it, both teams' form and the season series. Unofficial fan project.`,
  };
}

async function Breakdown({ id }: { id: string }) {
  const detail = await getGameDetail(id);
  if (!detail) notFound();
  return <GameBreakdown detail={detail} />;
}

function Loading() {
  return (
    <div className="grid min-h-[40vh] place-items-center" role="status" aria-label="Loading the game">
      <span className="basketball-loader" aria-hidden />
    </div>
  );
}

/** Full breakdown of one game (any day). The game is runtime data, so it streams in. */
export default function Page({ params }: PageProps<"/game/[id]">) {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-28 pb-20 sm:px-6">
      <Suspense fallback={<Loading />}>{params.then(({ id }) => <Breakdown id={id} />)}</Suspense>
    </main>
  );
}
