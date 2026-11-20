"use client";

import { useEffect, useRef, useState } from "react";

import { SceneHost } from "@/components/scene/scene-host";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useScene } from "@/lib/scene-store";
import { dayLabel } from "@/lib/dates";
import { defaultGame, pickBlocker, type Slate } from "@/lib/slate";

import { GameDrawer } from "./game-drawer";
import { MatchupHeader } from "./matchup-header";
import { ResultsView } from "./results-view";
import { TeamLabel } from "./team-label";
import "./home.css";

// Phase timings for the 2D fallback, which has no cinematic.
const REVEAL_MS = 700;
const SHOT_MS = 900;
const RETURN_MS = 400;

/** "Wednesday, November 19" */
function longDate(day: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`)); // prettier-ignore
}

function urlFor(gameId: string) {
  return `/?game=${gameId}`;
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
  const reducedMotion = useReducedMotion();
  const { phase, gameId, pick, viewing, send, reset, setInstantResults, cinematic } = useScene();
  // No games today: the visitor can ask for the next game day instead.
  const [showNext, setShowNext] = useState(false);
  const day = showNext && slate.next ? slate.next.day : slate.today;
  const shown = showNext && slate.next ? slate.next.games : slate.games;
  const selectedId = gameId ?? initialGameId;
  const game = shown.find((g) => g.gameId === selectedId) ?? null;

  // First load: select the server's pick and make the URL shareable.
  useEffect(() => {
    reset(initialGameId);
    if (syncUrl && initialGameId) window.history.replaceState(null, "", urlFor(initialGameId));
  }, [initialGameId, syncUrl, reset]);

  useEffect(() => setInstantResults(reducedMotion), [reducedMotion, setInstantResults]);

  // Without the 3D cinematic (2D fallback), advance the state machine on short timers.
  useEffect(() => {
    if (cinematic) return;
    const next = { revealing: ["revealDone", REVEAL_MS], shooting: ["shotDone", SHOT_MS],
                   returning: ["returned", RETURN_MS] } as const;  // prettier-ignore
    if (!(phase in next)) return;
    const [type, ms] = next[phase as keyof typeof next];
    const id = window.setTimeout(() => send({ type }), ms);
    return () => window.clearTimeout(id);
  }, [phase, send, cinematic]);

  // Back from the results (Home): return keyboard focus to the pick button of the team that was
  // picked, rather than dropping it on the page body. The labels are hidden until idle, so wait.
  const returningFrom = useRef<"home" | "away" | null>(null);
  useEffect(() => {
    if (phase === "returning" && pick) returningFrom.current = pick;
    if (phase !== "idle" || !returningFrom.current) return;
    const side = returningFrom.current;
    returningFrom.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>(`[data-pick-side="${side}"]`)?.focus({ preventScroll: true });
  }, [phase, pick]);

  // Esc skips to results (DESIGN.md section 4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && send({ type: "skip" });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  // Read out a new matchup to screen readers when the visitor switches games (not on first load).
  const [announcement, setAnnouncement] = useState("");
  const announce = (id: string | null, games = shown) => {
    const g = games.find((x) => x.gameId === id);
    if (g) setAnnouncement(`Now showing the ${g.away.city} ${g.away.name} at the ${g.home.city} ${g.home.name}.`);
  };

  const selectGame = (id: string) => {
    send({ type: "select", gameId: id });
    window.history.replaceState(null, "", urlFor(id));
    announce(id);
  };

  const showNextDay = () => {
    if (!slate.next) return;
    setShowNext(true);
    const first = defaultGame(slate.next.games, null);
    reset(first?.gameId ?? null);
    announce(first?.gameId ?? null, slate.next.games);
    if (first) window.history.replaceState(null, "", urlFor(first.gameId));
  };

  const blocker = game ? pickBlocker(game) : null;
  const animating = phase === "revealing" || phase === "shooting";
  const dayName = dayLabel(day, slate.today);
  const heading = dayName === "Tonight" ? "Today's games" : `${dayName} games`;
  const onPick = blocker ? undefined : (side: "home" | "away") => send({ type: "predict", pick: side });

  return (
    <main id="main" className="relative h-svh min-h-[560px] overflow-hidden bg-background">
      <div className="absolute inset-0">
        <SceneHost
          game={game}
          phase={phase}
          pick={pick}
          viewing={viewing}
          pickable={Boolean(onPick) && phase === "idle"}
          reducedMotion={reducedMotion}
        />
      </div>

      {game ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col pt-14 pb-5">
          {/* The names fade as the camera moves in and come back with the home shot. */}
          <div className={`transition-opacity duration-500 ${phase === "idle" ? "" : "opacity-0 delay-300"}`}>
            <MatchupHeader game={game} today={slate.today} />
          </div>
          {/* Team names over each player (centered, so the columns are too). They're also the
              keyboard and touch way to pick: focusing one highlights its player. */}
          <div
            className={`mx-auto mt-2 grid w-full max-w-[1100px] grid-cols-2 gap-4 px-4 transition-opacity duration-500 sm:px-10 ${
              phase === "idle" ? "" : "invisible opacity-0 delay-300"
            }`}
          >
            <TeamLabel team={game.away} side="away" neutral={game.isNeutral} onPick={onPick} />
            <TeamLabel team={game.home} side="home" neutral={game.isNeutral} onPick={onPick} />
          </div>
          <div className="flex-1" />
          <div className="flex flex-col items-center gap-2 px-4">
            {animating ? (
              <div className="cinematic-progress" role="progressbar" aria-label="Playing your pick" />
            ) : phase === "idle" ? (
              <p className="pick-hint">
                {blocker ?? (
                  <>
                    <span className="pick-hint__mouse">Click a player to pick who wins</span>
                    <span className="pick-hint__touch">Tap a player to pick who wins</span>
                  </>
                )}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center px-6">
          <div className="max-w-md text-center">
            <p className="eyebrow">{longDate(slate.today)}</p>
            <h1 className="mt-3 font-display text-4xl leading-none font-extrabold uppercase sm:text-6xl">
              No games today.
            </h1>
            {slate.next && !showNext ? (
              <>
                <p className="mt-4 text-muted-foreground">
                  The next games are {dayLabel(slate.next.day, slate.today).replace("Tomorrow", "tomorrow")}.
                </p>
                <button type="button" onClick={showNextDay} className="predict-button mt-6 whitespace-nowrap">
                  Show {dayLabel(slate.next.day, slate.today)}
                </button>
              </>
            ) : (
              <p className="mt-4 text-muted-foreground">No upcoming games are scheduled yet.</p>
            )}
          </div>
        </div>
      )}

      {game && pick && viewing && phase === "results" && (
        <ResultsView
          game={game}
          pick={pick}
          viewing={viewing}
          onView={(side) => send({ type: "view", side })}
          onHome={() => send({ type: "back" })}
        />
      )}

      {animating && (
        <button
          type="button"
          onClick={() => send({ type: "skip" })}
          className="holo-panel absolute right-4 bottom-6 rounded-md px-3 py-1.5 font-mono text-xs uppercase"
        >
          Skip
        </button>
      )}

      {shown.length > 0 && phase !== "results" && (
        <GameDrawer
          games={shown}
          heading={heading}
          selectedId={selectedId}
          onSelect={selectGame}
          disabled={animating}
        />
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <p className="pointer-events-none absolute right-3 bottom-1.5 z-20 font-mono text-[10px] tracking-wide text-white/55 uppercase">
        Unofficial fan project. Not affiliated with the NBA.
      </p>
    </main>
  );
}
