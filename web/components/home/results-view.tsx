"use client";

import { type CSSProperties, useEffect, useRef } from "react";

import { CountUp } from "@/components/count-up";
import { FactorBars } from "@/components/game/factor-bars";
import { FinalBadge } from "@/components/game/final-badge";
import { Form } from "@/components/game/game-breakdown";
import { PlayerList, PlayerTable } from "@/components/game/player-lines";
import { TeamNumbers } from "@/components/game/team-numbers";
import { shortDate, tipoffET } from "@/lib/dates";
import type { Side } from "@/lib/scene-store";
import { type GameExtras, predictedWinner, type SlateGame, verdict, winProb } from "@/lib/slate";
import { hologramMatchup, readableTeamColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import "./results-view.css";

const other = (side: Side): Side => (side === "home" ? "away" : "home");
const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * After a pick (DESIGN.md section 5): no panel. The camera is close on the viewed team's player
 * on one half of the screen; on the other half the numbers sit straight on the scene, over a soft
 * shade, in a column that scrolls from the verdict down through the whole breakdown: the viewed
 * team's numbers, form and players, then the game (win chance, the model's reasons, the season
 * series), the other team, and every projected player line for both teams.
 *
 * A corner button switches to the other team: its player takes the stage and every number
 * changes, as if it had been the pick (the headline then says what that pick would have been).
 */
export function ResultsView({
  game,
  pick,
  viewing,
  extras,
  onView,
  onHome,
}: {
  game: SlateGame;
  pick: Side;
  viewing: Side;
  /** Each team's last 10 and the season series (from the slate); the sections hide without it. */
  extras: GameExtras | null;
  onView: (side: Side) => void;
  onHome: () => void;
}) {
  const shown = game[viewing];
  const otherSide = other(viewing);
  const otherTeam = game[otherSide];
  const isPick = viewing === pick;
  const v = verdict(game, viewing);
  const shownColor = readableTeamColor(requireTeam(shown.teamId));
  const otherColor = readableTeamColor(requireTeam(otherTeam.teamId));
  // The teams' glow colors: bright on the dark background, and never alike.
  const colors = hologramMatchup(requireTeam(game.home.teamId), requireTeam(game.away.teamId));
  const homeP = winProb(game, "home");
  const shownP = winProb(game, viewing);
  const model = predictedWinner(game);
  const elo = game.prediction?.eloHomeWinProb ?? null;

  const scroller = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // A new team: back to the top, focus on its headline.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [viewing]);

  const headline = v
    ? isPick
      ? v.right
        ? "You're right."
        : "Not this time."
      : v.right
        ? "That one wins."
        : "Not that one."
    : isPick
      ? "Pick made."
      : "The other side.";
  const detail =
    v?.judgedBy === "final"
      ? `Final: ${game.away.abbr} ${game.awayScore}–${game.homeScore} ${game.home.abbr}.${
          shownP !== null ? ` The model gave the ${shown.name} ${pct(shownP)}.` : ""
        }`
      : shownP !== null
        ? `The model gives the ${shown.name} a ${pct(shownP)} chance${v?.right ? "" : `, and likes the ${otherTeam.name}`}.`
        : "";
  // Staggered entrance: each block rises in a beat after the one above.
  let i = 0;
  const block = () => ({ "--i": i++ }) as CSSProperties;

  return (
    <div className="results" data-side={viewing === "away" ? "right" : "left"} style={{ "--team": shownColor } as CSSProperties}>
      <div className="results__shade" aria-hidden />
      <button type="button" className="results__home" onClick={onHome}>
        <span aria-hidden>←</span> Home
      </button>

      <section ref={scroller} className="results__scroll" aria-labelledby="results-heading">
        <div key={viewing} className="results__content">
          <p className="sr-only" aria-live="polite">
            {`${shown.city} ${shown.name}. ${headline} ${detail}`}
          </p>

          <header className="results__block" style={block()}>
            <p className="eyebrow">{isPick ? `Your pick · ${shown.name}` : `If you'd picked the ${shown.name}`}</p>
            <h2 id="results-heading" ref={heading} tabIndex={-1} className="results__verdict" data-right={v?.right}>
              {headline}
            </h2>
            {detail && <p className="results__detail">{detail}</p>}
            <div className="results__badge">
              <FinalBadge game={game} />
            </div>
          </header>

          <div className="results__block" style={block()}>
            <p className="eyebrow results__muted">
              {shown.city} · {viewing === "home" ? "Home" : "Away"}
              {model === viewing && " · Model's pick"}
            </p>
            <h3 className="results__team-name">{shown.name}</h3>
            <TeamNumbers stats={shown.stats} />
          </div>

          {extras && (
            <div className="results__block" style={block()}>
              <h4 className="results__h">Last 10</h4>
              <Form games={extras.form[viewing]} />
            </div>
          )}

          {game.players[viewing].length > 0 && (
            <div className="results__block" style={block()}>
              <h4 className="results__h">Projected lines</h4>
              <PlayerList lines={game.players[viewing]} color={shownColor} limit={8} />
              <p className="results__muted results__small">
                If he plays. Each range should hold the real number 8 times in 10.
              </p>
            </div>
          )}

          <p className="results__more results__block" style={block()} aria-hidden>
            Scroll for the full breakdown <span>↓</span>
          </p>

          <div className="results__block results__section" style={block()}>
            <h4 className="results__h">The game</h4>
            {homeP === null ? (
              <p className="results__muted">
                {game.status === "scheduled"
                  ? "The prediction is published around 9 AM ET on game day."
                  : "No prediction was made before this game."}
              </p>
            ) : (
              <>
                <div className="results__split tabular">
                  <span>
                    <CountUp value={1 - homeP} format={pct} className="results__big" /> {game.away.abbr}
                  </span>
                  <span>
                    {game.home.abbr} <CountUp value={homeP} format={pct} className="results__big" />
                  </span>
                </div>
                <div className="results__bar" aria-hidden>
                  <span style={{ width: `${(1 - homeP) * 100}%`, background: colors.away.color }} />
                  <span style={{ width: `${homeP * 100}%`, background: colors.home.color }} />
                </div>
                <p className="results__muted results__small">
                  The model&apos;s win chance.
                  {elo !== null && ` Simple Elo baseline: ${game.away.abbr} ${pct(1 - elo)} · ${game.home.abbr} ${pct(elo)}.`}{" "}
                  {game.prediction?.source === "backfill"
                    ? "A walk-forward backtest: a model trained only on games before that week."
                    : "Published before tip-off from data available that morning."}
                </p>
                <h4 className="results__h">Why</h4>
                <FactorBars game={game} limit={6} />
              </>
            )}
          </div>

          <div className="results__block results__section" style={block()}>
            <h4 className="results__h">
              Season series · {game.away.abbr} {game.headToHead.away}–{game.headToHead.home} {game.home.abbr}
            </h4>
            {extras?.series.length ? (
              <ul className="results__series tabular">
                {extras.series.map((g) => (
                  <li key={g.gameDate}>
                    <span className="results__muted">{shortDate(g.gameDate)}</span>
                    <span>
                      {requireTeam(g.awayTeamId).abbr} {g.awayScore} @ {requireTeam(g.homeTeamId).abbr} {g.homeScore}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="results__muted results__small">First meeting this season.</p>
            )}
            {game.status === "scheduled" && tipoffET(game.tipoffUtc) && (
              <p className="results__muted results__small">Tip-off {tipoffET(game.tipoffUtc)}.</p>
            )}
          </div>

          <div className="results__block results__section" style={{ ...block(), "--team": otherColor } as CSSProperties}>
            <p className="eyebrow results__muted">
              The opponent · {otherTeam.city}
              {model === otherSide && " · Model's pick"}
            </p>
            <h3 className="results__team-name">{otherTeam.name}</h3>
            <TeamNumbers stats={otherTeam.stats} />
            {extras && (
              <>
                <h4 className="results__h">Last 10</h4>
                <Form games={extras.form[otherSide]} />
              </>
            )}
          </div>

          {game.players.home.length + game.players.away.length > 0 && (
            <div className="results__block results__section" style={block()}>
              <h4 className="results__h">
                {game.status === "final" ? "Every player: projected and real" : "Every projected player"}
              </h4>
              <div className="results__tables">
                {([viewing, otherSide] as const).map((side) =>
                  game.players[side].length ? (
                    <PlayerTable
                      key={side}
                      lines={game.players[side]}
                      teamName={`${game[side].city} ${game[side].name}`}
                      color={readableTeamColor(requireTeam(game[side].teamId))}
                    />
                  ) : null,
                )}
              </div>
              <p className="results__muted results__small">
                Each team&apos;s 8 players with the most projected minutes; under each number, its 80% range.
                {game.status === "final" && " Real numbers are marked ✓ inside the range, ✗ outside."}
              </p>
            </div>
          )}
        </div>
      </section>

      <button
        type="button"
        className="results__switch"
        onClick={() => onView(otherSide)}
        style={{ "--other": otherColor } as CSSProperties}
      >
        <span className="results__switch-label">See the</span> {otherTeam.name} <span aria-hidden>→</span>
      </button>
    </div>
  );
}
