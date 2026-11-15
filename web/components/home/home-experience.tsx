"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { SceneHost } from "@/components/scene/scene-host";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useScene } from "@/lib/scene-store";
import { allGames, predictBlocker, predictedWinner, type Slate } from "@/lib/slate";

import { GameRail } from "./game-rail";
import { MatchupHeader } from "./matchup-header";
import { ResultPanel } from "./result-panel";
import { TeamLabel } from "./team-label";

// Placeholder timings until the GSAP cinematic (Phase 7).
const REVEAL_MS = 700;
const SHOT_MS = 900;
const RETURN_MS = 400;

function urlFor(date: string, gameId: string) {
  return `/?date=${date}&game=${gameId}`;
}

export function HomeExperience({
  slate,
  initialGameId,
  syncUrl,
}: {
  slate: Slate;
  initialGameId: string | null;
  syncUrl: boolean;
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { phase, gameId, send, reset, setInstantResults } = useScene();
  const selectedId = gameId ?? initialGameId;
  const game = allGames(slate).find((g) => g.gameId === selectedId) ?? null;
  const winner = game ? predictedWinner(game) : null;
  const predictRef = useRef<HTMLButtonElement>(null);

  // New slate (date change) or first load: select the server's pick and make the URL shareable.
  useEffect(() => {
    reset(initialGameId);
    if (syncUrl && initialGameId) window.history.replaceState(null, "", urlFor(slate.date, initialGameId));
  }, [initialGameId, slate.date, syncUrl, reset]);

  useEffect(() => setInstantResults(reducedMotion), [reducedMotion, setInstantResults]);

  // Placeholder cinematic: advance the state machine on timers.
  useEffect(() => {
    const next = { revealing: ["revealDone", REVEAL_MS], shooting: ["shotDone", SHOT_MS],
                   returning: ["returned", RETURN_MS] } as const;  // prettier-ignore
    if (!(phase in next)) return;
    const [type, ms] = next[phase as keyof typeof next];
    const id = window.setTimeout(() => send({ type }), ms);
    return () => window.clearTimeout(id);
  }, [phase, send]);

  // Esc skips to results (DESIGN.md section 4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && send({ type: "skip" });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  // Return focus to Predict after going back.
  useEffect(() => {
    if (phase === "idle") predictRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const selectGame = (id: string) => {
    send({ type: "select", gameId: id });
    window.history.replaceState(null, "", urlFor(slate.date, id));
  };
  const changeDate = (day: string) => router.push(`/?date=${day}`, { scroll: false });

  const blocker = game ? predictBlocker(game) : null;
  const animating = phase === "revealing" || phase === "shooting";

  return (
    <main id="main" className="relative h-svh min-h-[600px] overflow-hidden">
      <div className="absolute inset-0">
        {game ? (
          <SceneHost game={game} phase={phase} winner={winner} reducedMotion={reducedMotion} />
        ) : (
          <div className="h-full bg-background" />
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col pt-16 pb-[13.5rem] lg:pr-[340px] lg:pb-10">
        {game ? (
          <>
            <div className={`transition-opacity duration-300 ${animating ? "opacity-30" : ""}`}>
              <MatchupHeader game={game} slate={slate} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 px-4 sm:mt-8 sm:px-10">
              <TeamLabel team={game.away} side="away" neutral={game.isNeutral}
                         dimmed={phase !== "idle" && winner === "home"} />
              <TeamLabel team={game.home} side="home" neutral={game.isNeutral}
                         dimmed={phase !== "idle" && winner === "away"} />
            </div>
            <div className="flex-1" />
            <div className="pointer-events-auto flex flex-col items-center gap-2 px-4">
              {phase === "results" || phase === "returning" ? (
                <ResultPanel game={game} onBack={() => send({ type: "back" })} />
              ) : (
                <>
                  <button
                    ref={predictRef}
                    type="button"
                    disabled={Boolean(blocker) || animating}
                    aria-describedby={blocker ? "predict-blocker" : undefined}
                    onClick={() => send({ type: "predict" })}
                    className="rounded-full bg-primary px-10 py-4 font-display text-xl font-semibold tracking-wider text-primary-foreground uppercase shadow-[0_0_40px_-8px] shadow-primary/60 transition hover:brightness-110 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:text-2xl"
                  >
                    Predict who wins
                  </button>
                  {blocker && (
                    <p id="predict-blocker" className="text-center text-sm text-muted-foreground">
                      {blocker}
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="pointer-events-auto m-auto max-w-sm px-6 text-center text-muted-foreground">
            No games are scheduled around this date. Pick another day.
          </div>
        )}
      </div>

      {animating && (
        <button
          type="button"
          onClick={() => send({ type: "skip" })}
          className="absolute right-4 bottom-[13.5rem] rounded-md border border-white/15 bg-black/50 px-3 py-1.5 text-sm backdrop-blur lg:right-[356px] lg:bottom-6"
        >
          Skip
        </button>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 p-3 transition-opacity duration-300 lg:inset-x-auto lg:top-16 lg:right-4 lg:bottom-4 lg:w-[320px] lg:p-0 ${
          animating ? "pointer-events-none opacity-30" : ""
        }`}
      >
        <GameRail slate={slate} selectedId={selectedId} onSelect={selectGame} onDateChange={changeDate} />
      </div>
    </main>
  );
}
