"use client";

import { useEffect, useRef } from "react";

import { drawCrest } from "@/components/scene/crest-art";
import { crestFor } from "@/lib/crests";
import { contrast } from "@/lib/team-colors";
import { type Team, teams } from "@/lib/teams";

const INK = "#d6d9e0";

/** The trim the court uses (components/scene/court.tsx trimFor), repeated here for the sheet. */
function accent(t: Team) {
  const options = [t.colors.secondary, t.colors.tertiary].filter((c): c is NonNullable<typeof c> => !!c);
  const best = options.sort((a, b) => contrast(b, t.colors.primary) - contrast(a, t.colors.primary))[0];
  if (!best || contrast(best, t.colors.primary) < 1.8 || best.toLowerCase() === "#ffffff") return INK;
  return best;
}

function One({ team }: { team: Team }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-archivo").trim() || "sans-serif";
    drawCrest(canvas.getContext("2d")!, 512, crestFor(team.abbr), { field: team.colors.primary, accent: accent(team), ink: INK }, {
      city: team.city,
      name: team.name,
      abbr: team.abbr,
      font,
    });
  }, [team]);
  const c = crestFor(team.abbr);
  return (
    <figure className="grid justify-items-center gap-1">
      <canvas ref={ref} width={512} height={512} className="h-auto w-full max-w-[220px]" />
      <figcaption className="font-mono text-[11px] text-muted-foreground">
        {team.abbr} · {c.shape} · {c.layout} · {c.motif}
      </figcaption>
    </figure>
  );
}

export function CrestSheet() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-4 pt-24 pb-16">
      <h1 className="font-display text-3xl font-extrabold uppercase">Center-court crests</h1>
      <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4 lg:grid-cols-6">
        {teams.map((t) => (
          <One key={t.abbr} team={t} />
        ))}
      </div>
    </main>
  );
}
