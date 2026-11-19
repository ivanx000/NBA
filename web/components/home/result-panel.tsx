"use client";

import Link from "next/link";

import { shotOutcome } from "@/lib/shot-path";
import { actualWinner, predictedWinner, winProb, type SlateGame } from "@/lib/slate";
import { matchupJerseys, readableTeamColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

/** Minimal result until the full overlay (Phase 8): winner, probability split, final check. */
export function ResultPanel({ game, onBack }: { game: SlateGame; onBack: () => void }) {
  const side = predictedWinner(game);
  if (!side || !game.prediction) return null;
  const winner = game[side];
  const loserSide = side === "home" ? "away" : "home";
  const p = winProb(game, side) ?? 0;
  const wTeam = requireTeam(winner.teamId);
  const lTeam = requireTeam(game[loserSide].teamId);
  const actual = actualWinner(game);
  const pct = Math.round(p * 100);
  const homePct = Math.round((winProb(game, "home") ?? 0) * 100);
  // Jersey colors already resolve clashes (e.g. two red teams), so the two halves differ.
  const jerseys = matchupJerseys(requireTeam(game.home.teamId), requireTeam(game.away.teamId));

  return (
    <section
      aria-label="Prediction"
      className="holo-panel w-full max-w-md rounded-xl p-5"
    >
      <p className="sr-only" aria-live="polite">
        Prediction: {winner.city} {winner.name} win with {pct}% probability.
      </p>
      <div className="flex items-baseline justify-between gap-4">
        <h2
          className="font-display text-3xl leading-none font-extrabold uppercase sm:text-4xl"
          style={{ color: readableTeamColor(wTeam) }}
        >
          {winner.name} win
        </h2>
        <span className="font-display text-3xl font-extrabold tabular sm:text-4xl">{pct}%</span>
      </div>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full" aria-hidden>
        <div style={{ width: `${100 - homePct}%`, background: jerseys.away.base }} />
        <div className="w-0.5 bg-background" />
        <div style={{ width: `${homePct}%`, background: jerseys.home.base }} />
      </div>
      <p className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground uppercase tabular">
        <span>{game.away.abbr} {100 - homePct}%</span>
        <span>{game.home.abbr} {homePct}%</span>
      </p>
      {shotOutcome(p) === "rattle" && (
        <p className="mt-3 text-sm text-muted-foreground">Coin flip. The model barely leans this way.</p>
      )}
      {actual && (
        <p className={`mt-4 text-sm ${actual === side ? "text-good" : "text-bad"}`}>
          Final {game.away.abbr} {game.awayScore}–{game.homeScore} {game.home.abbr}.{" "}
          {actual === side ? "The model got it right." : `The model missed; ${lTeam.name} won.`}
        </p>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        {game.prediction.source === "backfill"
          ? "Walk-forward backtest: made by a model trained only on games before that week."
          : "Generated before tip-off from data available that morning."}
      </p>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Back to matchup
        </button>
        <Link
          href={`/game/${game.gameId}`}
          className="rounded-md px-3 py-2 text-sm text-blue-hi hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Full breakdown
        </Link>
      </div>
    </section>
  );
}
