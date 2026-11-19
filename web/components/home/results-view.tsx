"use client";

import { type CSSProperties, useEffect, useRef } from "react";

import { tipoffET } from "@/lib/dates";
import { factorCopy } from "@/lib/factor-copy";
import type { Side } from "@/lib/scene-store";
import { winProb, type SlateGame, type SlateTeam, verdict } from "@/lib/slate";
import { matchupJerseys, readableTeamColor } from "@/lib/team-colors";
import type { TeamStats } from "@/lib/team-stats";
import { requireTeam } from "@/lib/teams";

import "./results-view.css";

const other = (side: Side): Side => (side === "home" ? "away" : "home");
const pct = (p: number) => `${Math.round(p * 100)}%`;
const wl = (r: { wins: number; losses: number }) => `${r.wins}-${r.losses}`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;

function restLabel(days: number | null) {
  if (days === null) return "Season opener";
  if (days === 0) return "Back-to-back";
  return `${days} day${days === 1 ? "" : "s"} off`;
}

function TeamNumbers({ stats }: { stats: TeamStats }) {
  const rows: [string, string][] = [
    ["Record", wl(stats.record)],
    ["Home", wl(stats.home)],
    ["Away", wl(stats.away)],
    ["Last 10", wl(stats.last10)],
    ["Streak", stats.streak ?? "—"],
    ["Rest", restLabel(stats.restDays)],
    ["Points", stats.pointsFor?.toFixed(1) ?? "—"],
    ["Allowed", stats.pointsAgainst?.toFixed(1) ?? "—"],
    ["Margin", stats.margin === null ? "—" : signed(stats.margin)],
  ];
  return (
    <dl className="results__stats">
      {rows.map(([label, value]) => (
        <div key={label} className="results__stat">
          <dt>{label}</dt>
          <dd className="tabular">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

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
  const jerseys = matchupJerseys(requireTeam(game.home.teamId), requireTeam(game.away.teamId));
  const homeP = winProb(game, "home");
  const pickP = winProb(game, pick);
  const names = { home: game.home.name, away: game.away.name };
  const factors = (game.prediction?.factors ?? []).slice(0, 4).map((f) => factorCopy(f, names));
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
        </div>

        <div className="results__game">
          <p className="eyebrow">The game</p>
          {homeP !== null && (
            <>
              <div className="results__bar" aria-hidden>
                <span style={{ width: `${(1 - homeP) * 100}%`, background: jerseys.away.base }} />
                <span style={{ width: `${homeP * 100}%`, background: jerseys.home.base }} />
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
          {factors.length > 0 && (
            <ul className="results__factors">
              {factors.map((f) => (
                <li key={f.text}>
                  <span>{f.text}</span>
                  <span className="tabular">+{f.points.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          )}
          <p className="results__muted results__small tabular">
            Season series: {game.away.abbr} {game.headToHead.away}–{game.headToHead.home} {game.home.abbr}
            {game.status === "scheduled" && tipoffET(game.tipoffUtc) ? ` · Tip-off ${tipoffET(game.tipoffUtc)}` : ""}
          </p>
        </div>
      </section>
    </div>
  );
}
