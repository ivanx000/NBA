import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageStub } from "@/components/page-stub";

export const metadata: Metadata = { title: "Game breakdown · Tip-Off" };

async function GameId({ params }: { params: PageProps<"/game/[id]">["params"] }) {
  const { id } = await params;
  return <span className="font-mono text-foreground">{id}</span>;
}

export default function Page({ params }: PageProps<"/game/[id]">) {
  return (
    <PageStub title="Game breakdown">
      The full breakdown for game{" "}
      <Suspense fallback={<span>…</span>}>
        <GameId params={params} />
      </Suspense>{" "}
      is coming soon.{" "}
      <Link href="/" className="text-brand-accent underline-offset-4 hover:underline">
        Back to predictions
      </Link>
    </PageStub>
  );
}
