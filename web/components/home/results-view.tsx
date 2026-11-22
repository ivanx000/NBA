"use client";

import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { FinalBadge } from "@/components/game/final-badge";
import { restLabel } from "@/components/game/team-numbers";
import { shortDate, tipoffET } from "@/lib/dates";
import type { Side } from "@/lib/scene-store";
import { type GameExtras, predictedWinner, type SlateGame, verdict, winProb } from "@/lib/slate";
import { hologramMatchup, readableTeamColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import {
  ChanceBalls,
  PlayerBoard,
  RankStrips,
  ReasonWaterfall,
  RecordDonuts,
  ScoreLines,
  ScoringDumbbell,
} from "./results-visuals";
import "./results-view.css";

const other = (side: Side): Side => (side === "home" ? "away" : "home");
const pct = (p: number) => `${Math.round(p * 100)}%`;

type Tab = "team" | "game" | "players";

/**
 * After a pick (DESIGN.md section 5): no panel. The camera is close on the viewed team's player
 * near one edge; everything else on the screen is the numbers, straight on the scene over a soft
 * shade. On top, the verdict beside the win chance as ten basketballs; under it, three tabs of
 * charts that answer the pointer, all about the viewed team: the team (record donuts, a scoring
 * dumbbell, the last 10 as score lines, league rank strips), the game (the reasons as a waterfall
 * toward its win chance, the season series), and its projected players as a box score. The other
 * team's numbers are only ever shown through the switch in the corner.
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
  const shownP = winProb(game, viewing);
  const model = predictedWinner(game);
  const elo = game.prediction?.eloHomeWinProb ?? null;
  const shownElo = elo === null ? null : viewing === "home" ? elo : 1 - elo;
  const hasPlayers = game.players[viewing].length > 0;
  const advanced = extras?.advanced ?? null;

  const tabs: [Tab, string][] = [
    ["team", shown.name],
    ["game", "The game"],
    ...(hasPlayers ? ([["players", "Players"]] as [Tab, string][]) : []),
  ];
  const [tab, setTab] = useState<Tab>("team");
  const current = tabs.some(([t]) => t === tab) ? tab : "team";

  const scroller = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  // A new team: back to the top, focus on its headline.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [viewing]);

  const choose = (t: Tab) => {
    setTab(t);
    // Keep the tabs in view when the panel was scrolled down (phones).
    const el = tabRefs.current[t];
    if (el && scroller.current && scroller.current.scrollTop > el.offsetTop) scroller.current.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = tabs.findIndex(([t]) => t === current);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : step ? (i + step + tabs.length) % tabs.length : -1;
    if (to < 0) return;
    e.preventDefault();
    const t = tabs[to][0];
    choose(t);
    tabRefs.current[t]?.focus();
  };

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
  const block = (extra?: CSSProperties) => ({ "--i": i++, ...extra }) as CSSProperties;

  return (
    <div
      className="results"
      data-side={viewing === "away" ? "right" : "left"}
      style={{ "--team": shownColor, "--glow": colors[viewing].color } as CSSProperties}
    >
      <div className="results__shade" aria-hidden />
      <button type="button" className="results__home" onClick={onHome}>
        <span aria-hidden>←</span> Home
      </button>

      <section ref={scroller} className="results__scroll" aria-labelledby="results-heading">
        <div key={viewing} className="results__content">
          <p className="sr-only" aria-live="polite">
            {`${shown.city} ${shown.name}. ${headline} ${detail}`}
          </p>

          <header className="results__top results__block" style={block()}>
            <div className="results__headline">
              <p className="eyebrow">
                {isPick ? `Your pick · ${shown.name}` : `If you'd picked the ${shown.name}`}
                {model === viewing && <span className="results__tag">Model&apos;s pick</span>}
              </p>
              <h2 id="results-heading" ref={heading} tabIndex={-1} className="results__verdict" data-right={v?.right}>
                {headline}
              </h2>
              {detail && <p className="results__detail">{detail}</p>}
              <div className="results__badge">
                <FinalBadge game={game} />
              </div>
            </div>
            {shownP !== null ? (
              <ChanceBalls
                p={shownP}
                elo={shownElo}
                color={colors[viewing].color}
                otherColor={colors[otherSide].color}
                abbr={shown.abbr}
                otherAbbr={otherTeam.abbr}
              />
            ) : (
              <p className="results__muted results__small results__no-pred">
                {game.status === "scheduled"
                  ? "The prediction is published around 9 AM ET on game day."
                  : "No prediction was made before this game."}
              </p>
            )}
          </header>

          <div className="results__tabs results__block" role="tablist" aria-label="Breakdown" style={block()}>
            {tabs.map(([t, label]) => (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[t] = el;
                }}
                type="button"
                role="tab"
                id={`results-tab-${t}`}
                aria-selected={current === t}
                aria-controls={`results-panel-${t}`}
                tabIndex={current === t ? 0 : -1}
                onClick={() => choose(t)}
                onKeyDown={onTabKey}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            key={current}
            role="tabpanel"
            id={`results-panel-${current}`}
            aria-labelledby={`results-tab-${current}`}
            className="results__panel"
          >
            {current === "team" && (
              <div className="results__grid">
                <div className="results__block" style={block()}>
                  <p className="eyebrow results__muted">
                    {shown.city} · {viewing === "home" ? "Home" : "Away"}
                  </p>
                  <h3 className="results__team-name">{shown.name}</h3>
                  <RecordDonuts stats={shown.stats} />
                  <div className="results__chips">
                    {shown.stats.streak && (
                      <span className="chip" data-tone={shown.stats.streak.startsWith("W") ? "good" : "bad"}>
                        <span className="viz-label">Streak</span> <b className="tabular">{shown.stats.streak}</b>
                      </span>
                    )}
                    <span className="chip" data-tone={shown.stats.restDays === 0 ? "bad" : undefined}>
                      <span className="viz-label">Rest</span> <b>{restLabel(shown.stats.restDays)}</b>
                    </span>
                  </div>
                </div>
                <div className="results__block" style={block()}>
                  <h4 className="results__h">Scoring</h4>
                  <ScoringDumbbell stats={shown.stats} />
                  {extras && (
                    <>
                      <h4 className="results__h results__h--gap">Last 10 · points scored and allowed</h4>
                      <ScoreLines games={extras.form[viewing]} color={colors[viewing].color} />
                    </>
                  )}
                </div>
                {advanced?.teams[viewing] && (
                  <div className="results__block results__wide" style={block()}>
                    <h4 className="results__h">Advanced · where they rank</h4>
                    <RankStrips stats={advanced.teams[viewing]} />
                  </div>
                )}
              </div>
            )}

            {current === "game" && (
              <div className="results__grid">
                <div className="results__block results__wide" style={block()}>
                  <h4 className="results__h">How the model got there</h4>
                  {game.prediction ? (
                    <ReasonWaterfall
                      game={game}
                      viewing={viewing}
                      colors={{ home: colors.home.color, away: colors.away.color }}
                    />
                  ) : (
                    <p className="results__muted results__small">No prediction for this game.</p>
                  )}
                  {game.prediction && (
                    <p className="results__muted results__small">
                      {game.prediction.source === "backfill"
                        ? "A walk-forward backtest: a model trained only on games before that week."
                        : "Published before tip-off from data available that morning."}{" "}
                      Step sizes are approximate.
                    </p>
                  )}
                </div>
                <div className="results__block" style={block()}>
                  <h4 className="results__h">
                    Season series · {game.away.abbr} {game.headToHead.away}–{game.headToHead.home} {game.home.abbr}
                  </h4>
                  {extras?.series.length ? (
                    <ul className="results__series tabular">
                      {extras.series.map((g) => {
                        const homeWon = g.homeScore > g.awayScore;
                        return (
                          <li key={g.gameDate}>
                            <span className="results__muted">{shortDate(g.gameDate)}</span>
                            <span>
                              <b data-won={!homeWon}>
                                {requireTeam(g.awayTeamId).abbr} {g.awayScore}
                              </b>{" "}
                              @{" "}
                              <b data-won={homeWon}>
                                {requireTeam(g.homeTeamId).abbr} {g.homeScore}
                              </b>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="results__muted results__small">First meeting this season.</p>
                  )}
                  {game.status === "scheduled" && tipoffET(game.tipoffUtc) && (
                    <p className="results__muted results__small">Tip-off {tipoffET(game.tipoffUtc)}.</p>
                  )}
                </div>
              </div>
            )}

            {current === "players" && hasPlayers && (
              <div className="results__block" style={block()}>
                <PlayerBoard lines={game.players[viewing]} color={colors[viewing].color} advanced={advanced?.players} />
                <p className="results__muted results__small">
                  If he plays. Each range should hold the real number 8 times in 10.
                </p>
              </div>
            )}
          </div>
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
