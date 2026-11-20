import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GameBreakdown } from "@/components/game/game-breakdown";
import { GameSkeleton } from "@/components/skeleton";
import { shortDate } from "@/lib/dates";
import { getGameDetail } from "@/lib/db/queries";
import { pageMeta } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/game/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getGameDetail(id);
  if (!detail) return { title: "Game not found · NBA Game Predictor" };
  const { game } = detail;
  const title = `${game.away.name} at ${game.home.name}, ${shortDate(game.gameDate)} · NBA Game Predictor`;
  return pageMeta({
    title,
    description: `Who wins ${game.away.city} at ${game.home.city}: the model's win chance, the reasons behind it, both teams' form, the season series and projected player lines.`,
    path: `/game/${game.gameId}`,
    image: {
      url: `/game/${game.gameId}/opengraph-image`,
      width: 1200,
      height: 630,
      alt: `${game.away.name} at ${game.home.name}: the model's win chance`,
    },
  });
}

async function Breakdown({ id }: { id: string }) {
  const detail = await getGameDetail(id);
  if (!detail) notFound();
  return <GameBreakdown detail={detail} />;
}

/** Full breakdown of one game (any day). The game is runtime data, so it streams in. */
export default function Page({ params }: PageProps<"/game/[id]">) {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-28 pb-20 sm:px-6">
      <Suspense fallback={<GameSkeleton />}>{params.then(({ id }) => <Breakdown id={id} />)}</Suspense>
    </main>
  );
}
