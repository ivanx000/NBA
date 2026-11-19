"use client";

import { type CSSProperties, useEffect, useRef } from "react";

import Link from "next/link";

import { FactorBars } from "@/components/game/factor-bars";
import { FinalBadge } from "@/components/game/final-badge";
import { PlayerList } from "@/components/game/player-lines";
import { TeamNumbers } from "@/components/game/team-numbers";
import { tipoffET } from "@/lib/dates";
import type { Side } from "@/lib/scene-store";
import { winProb, type SlateGame, type SlateTeam, verdict } from "@/lib/slate";
import { hologramMatchup, readableTeamColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import "./results-view.css";

const other = (side: Side): Side => (side === "home" ? "away" : "home");
const pct = (p: number) => `${Math.round(p * 100)}%`;
/**
 * After a pick: whether it was right, the viewed team's numbers, and the game as a whole (win
 * probabilities, the model's reasons, the season series). A corner button switches to the other
 * team; Home goes back to the matchup.
 */
export function ResultsView({
  game,
  pick,
  viewing,
  onView,
  onHome,
}: {
  game: SlateGame;
  pick: Side;
  viewing: Side;
  onView: (side: Side) => void;
  onHome: () => void;
}) {
  const v = verdict(game, pick);
  const picked = game[pick];
  const shown: SlateTeam = game[viewing];
  const otherTeam = game[other(viewing)];
  const shownColor = readableTeamColor(requireTeam(shown.teamId));
  // The teams' glow colors: bright on the dark background, and never alike.
  const colors = hologramMatchup(requireTeam(game.home.teamId), requireTeam(game.away.teamId));
  const homeP = winProb(game, "home");
  const pickP = winProb(game, pick);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  const detail =
    v?.judgedBy === "final"
      ? `Final: ${game.away.abbr} ${game.awayScore}–${game.homeScore} ${game.home.abbr}.${
          pickP !== null ? ` The model gave the ${picked.name} ${pct(pickP)}.` : ""
        }`
      : pickP !== null
        ? `The model gives the ${picked.name} a ${pct(pickP)} chance${v?.right ? "" : `, and likes the ${game[other(pick)].name}`}.`
        : "";

  return (
    <div
      className="results"
      data-side={viewing === "away" ? "right" : "left"}
      style={{ "--team": shownColor } as CSSProperties}
    >
      <button type="button" className="results__home" onClick={onHome}>
        <span aria-hidden>←</span> Home
      </button>

      <section className="results__panel holo-panel" aria-labelledby="results-heading">
        <p className="sr-only" aria-live="polite">
          {v ? `${v.right ? "Right" : "Wrong"}. ${detail}` : ""}
        </p>
        <p className="eyebrow">Your pick · {picked.name}</p>
        <h2 id="results-heading" ref={heading} tabIndex={-1} className="results__verdict" data-right={v?.right}>
          {v ? (v.right ? "You're right." : "Not this time.") : "Pick made."}
        </h2>
        {detail && <p className="results__detail">{detail}</p>}
        <div className="results__badge">
          <FinalBadge game={game} />
        </div>

        <div className="results__team">
          <div className="results__team-head">
            <div>
              <p className="eyebrow results__muted">{shown.city}</p>
              <h3 className="results__team-name">{shown.name}</h3>
            </div>
            <button type="button" className="results__switch" onClick={() => onView(other(viewing))}>
              {otherTeam.abbr} stats <span aria-hidden>→</span>
            </button>
          </div>
          <TeamNumbers stats={shown.stats} />
          {game.players[viewing].length > 0 && (
            <div className="results__players">
              <p className="eyebrow results__muted">Projected lines</p>
              <PlayerList lines={game.players[viewing]} color={shownColor} limit={5} />
              <p className="results__muted results__small">
                If he plays. Each range should hold the real number 8 times in 10.
              </p>
            </div>
          )}
        </div>

        <div className="results__game">
          <p className="eyebrow">The game</p>
          {homeP !== null && (
            <>
              <div className="results__bar" aria-hidden>
                <span style={{ width: `${(1 - homeP) * 100}%`, background: colors.away.color }} />
                <span style={{ width: `${homeP * 100}%`, background: colors.home.color }} />
              </div>
              <p className="results__bar-labels tabular">
                <span>
                  {game.away.abbr} {pct(1 - homeP)}
                </span>
                <span>Model win chance</span>
                <span>
                  {game.home.abbr} {pct(homeP)}
                </span>
              </p>
            </>
          )}
          {game.prediction?.eloHomeWinProb != null && (
            <p className="results__muted results__small tabular">
              Simple Elo baseline: {game.away.abbr} {pct(1 - game.prediction.eloHomeWinProb)} · {game.home.abbr}{" "}
              {pct(game.prediction.eloHomeWinProb)}
            </p>
          )}
          <div className="results__factors">
            <FactorBars game={game} />
          </div>
          <p className="results__muted results__small tabular">
            Season series: {game.away.abbr} {game.headToHead.away}–{game.headToHead.home} {game.home.abbr}
            {game.status === "scheduled" && tipoffET(game.tipoffUtc) ? ` · Tip-off ${tipoffET(game.tipoffUtc)}` : ""}
          </p>
          <Link href={`/game/${game.gameId}`} className="results__more">
            Full breakdown <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
