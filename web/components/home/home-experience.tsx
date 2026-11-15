"use client";

import { useEffect, useRef } from "react";

import { SceneHost } from "@/components/scene/scene-host";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useScene } from "@/lib/scene-store";
import { predictBlocker, predictedWinner, type Wheel } from "@/lib/slate";

import { GameWheel } from "./game-wheel";
import { MatchupHeader } from "./matchup-header";
import { ResultPanel } from "./result-panel";
import { TeamLabel } from "./team-label";

// Placeholder timings until the GSAP cinematic (Phase 7).
const REVEAL_MS = 700;
const SHOT_MS = 900;
const RETURN_MS = 400;

function urlFor(gameId: string) {
  return `/?game=${gameId}`;
}

export function HomeExperience({
  wheel,
  initialGameId,
  syncUrl,
}: {
  wheel: Wheel;
  initialGameId: string | null;
  syncUrl: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const { phase, gameId, send, reset, setInstantResults } = useScene();
  const selectedId = gameId ?? initialGameId;
  const game = wheel.games.find((g) => g.gameId === selectedId) ?? null;
  const winner = game ? predictedWinner(game) : null;
  const predictRef = useRef<HTMLButtonElement>(null);

  // First load: select the server's pick and make the URL shareable.
  useEffect(() => {
    reset(initialGameId);
    if (syncUrl && initialGameId) window.history.replaceState(null, "", urlFor(initialGameId));
  }, [initialGameId, syncUrl, reset]);

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
    window.history.replaceState(null, "", urlFor(id));
  };

  const blocker = game ? predictBlocker(game) : null;
  const animating = phase === "revealing" || phase === "shooting";

  const predictArea =
    game && (phase === "results" || phase === "returning") ? (
      <ResultPanel game={game} onBack={() => send({ type: "back" })} />
    ) : game ? (
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
    ) : null;

  return (
    <main id="main" className="relative h-svh min-h-[600px] overflow-hidden bg-background">
      <div className="absolute inset-0">
        {game ? (
          <SceneHost game={game} phase={phase} winner={winner} reducedMotion={reducedMotion} />
        ) : (
          <div className="h-full bg-background" />
        )}
      </div>

      {/* Players' area: everything right of the wheel on desktop, above it on phones. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col pt-14 pb-[17rem] lg:pb-10 lg:pl-[380px]">
        {game ? (
          <>
            <div className={`transition-opacity duration-300 ${animating ? "opacity-30" : ""}`}>
              <MatchupHeader game={game} today={wheel.today} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 px-4 sm:mt-6 sm:px-10 lg:px-[8%]">
              <TeamLabel team={game.away} side="away" neutral={game.isNeutral}
                         dimmed={phase !== "idle" && winner === "home"} />
              <TeamLabel team={game.home} side="home" neutral={game.isNeutral}
                         dimmed={phase !== "idle" && winner === "away"} />
            </div>
            <div className="flex-1" />
            <div className="pointer-events-auto flex flex-col items-center gap-2 px-4">
              {predictArea}
              {/* Why Predict is off, for screen readers; the disabled button says it visually. */}
              {blocker && <p id="predict-blocker" className="sr-only">{blocker}</p>}
            </div>
          </>
        ) : (
          <div className="pointer-events-auto m-auto max-w-sm px-6 text-center text-muted-foreground">
            No games to show yet.
          </div>
        )}
      </div>

      {animating && (
        <button
          type="button"
          onClick={() => send({ type: "skip" })}
          className="absolute right-4 bottom-[17rem] rounded-md border border-white/15 bg-black/50 px-3 py-1.5 text-sm backdrop-blur lg:bottom-6"
        >
          Skip
        </button>
      )}

      {wheel.games.length > 0 && (
        <div
          className={`absolute inset-x-0 bottom-3 flex justify-center transition-opacity duration-300 lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-10 lg:-translate-y-1/2 ${
            animating ? "pointer-events-none opacity-30" : ""
          }`}
        >
          <GameWheel
            games={wheel.games}
            today={wheel.today}
            selectedId={selectedId}
            onSelect={selectGame}
            reducedMotion={reducedMotion}
            disabled={animating}
          />
        </div>
      )}

      <p className="pointer-events-none absolute top-5 left-4 z-50 text-[10px] text-white/35 lg:top-auto lg:right-3 lg:bottom-1.5 lg:left-auto">
        Unofficial fan project. Not affiliated with the NBA.
      </p>
    </main>
  );
}
