import Link from "next/link";
import { type CSSProperties } from "react";

import type { GameDetail } from "@/lib/db/queries";
import { shortDate, tipoffET } from "@/lib/dates";
import { predictedWinner, type Side, type SlateTeam, winProb } from "@/lib/slate";
import { hologramMatchup, readableTeamColor } from "@/lib/team-colors";
import type { RecentGame } from "@/lib/team-stats";
import { requireTeam } from "@/lib/teams";

import { FactorBars } from "./factor-bars";
import { FinalBadge } from "./final-badge";
import { TeamNumbers } from "./team-numbers";
import "./game.css";

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Last 10 as chips, most recent first: W/L, opponent, score. */
function Form({ games }: { games: RecentGame[] }) {
  if (!games.length) return <p className="breakdown__muted">No games yet this season.</p>;
  return (
    <ol className="form-strip" aria-label="Last 10 games, most recent first">
      {games.map((g) => {
        const opp = requireTeam(g.opponentId).abbr;
        return (
          <li key={g.gameDate} data-won={g.won} title={`${shortDate(g.gameDate)}: ${g.atHome ? "vs" : "@"} ${opp}`}>
            <span className="form-strip__wl">{g.won ? "W" : "L"}</span>
            <span className="form-strip__opp">
              {g.atHome ? "" : "@"}
              {opp}
            </span>
            <span className="form-strip__score tabular">
              {g.pointsFor}–{g.pointsAgainst}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TeamColumn({ team, side, form, picked }: { team: SlateTeam; side: Side; form: RecentGame[]; picked: boolean }) {
  const color = readableTeamColor(requireTeam(team.teamId));
  return (
    <section className="breakdown__team holo-panel" style={{ "--team": color } as CSSProperties} aria-label={team.name}>
      <p className="eyebrow breakdown__muted">
        {team.city} · {side === "home" ? "Home" : "Away"}
        {picked && " · Model's pick"}
      </p>
      <h2 className="breakdown__team-name">{team.name}</h2>
      <TeamNumbers stats={team.stats} />
      <h3 className="breakdown__h3">Last 10</h3>
      <Form games={form} />
    </section>
  );
}

/** Everything about one game: verdict, win chances, reasons, both teams, form and the series. */
export function GameBreakdown({ detail }: { detail: GameDetail }) {
  const { game, form, series } = detail;
  const homeP = winProb(game, "home");
  const model = predictedWinner(game);
  // The teams' glow colors: bright on the dark background, and never alike.
  const colors = hologramMatchup(requireTeam(game.home.teamId), requireTeam(game.away.teamId));
  const when =
    game.status === "final"
      ? `${shortDate(game.gameDate)} · Final`
      : game.status === "live"
        ? `${shortDate(game.gameDate)} · Live ${game.awayScore}–${game.homeScore}`
        : game.status === "postponed"
          ? `${shortDate(game.gameDate)} · Postponed`
          : `${shortDate(game.gameDate)} · ${tipoffET(game.tipoffUtc) ?? "Time TBD"}`;
  const elo = game.prediction?.eloHomeWinProb ?? null;

  return (
    <article className="breakdown">
      <p className="eyebrow">
        {when}
        {game.gameLabel && ` · ${game.gameLabel}`}
        {game.isNeutral && " · Neutral site"}
      </p>
      <h1 className="breakdown__title">
        {game.away.name} <span className="breakdown__at">at</span> {game.home.name}
      </h1>
      <div className="breakdown__badge">
        <FinalBadge game={game} />
      </div>

      <section className="breakdown__chance holo-panel" aria-labelledby="chance">
        <h2 id="chance" className="eyebrow">
          Win chance
        </h2>
        {homeP === null ? (
          <p className="breakdown__muted">
            {game.status === "scheduled"
              ? "The prediction is published around 9 AM ET on game day."
              : "No prediction was made before this game."}
          </p>
        ) : (
          <>
            <div className="breakdown__split tabular">
              <span>
                <b>{pct(1 - homeP)}</b> {game.away.abbr}
              </span>
              <span>
                {game.home.abbr} <b>{pct(homeP)}</b>
              </span>
            </div>
            <div className="breakdown__bar" aria-hidden>
              <span style={{ width: `${(1 - homeP) * 100}%`, background: colors.away.color }} />
              <span style={{ width: `${homeP * 100}%`, background: colors.home.color }} />
            </div>
            <p className="breakdown__muted breakdown__small">
              The model favors the {model ? game[model].name : "home team"}.
              {elo !== null &&
                ` Simple Elo baseline: ${game.away.abbr} ${pct(1 - elo)} · ${game.home.abbr} ${pct(elo)}.`}{" "}
              {game.prediction?.source === "backfill"
                ? "This is a walk-forward backtest: a model trained only on games before that week."
                : "Published before tip-off from data available that morning."}
            </p>
            <h3 className="breakdown__h3">Why</h3>
            <FactorBars game={game} limit={5} />
          </>
        )}
      </section>

      <div className="breakdown__teams">
        <TeamColumn team={game.away} side="away" form={form.away} picked={model === "away"} />
        <TeamColumn team={game.home} side="home" form={form.home} picked={model === "home"} />
      </div>

      <section className="breakdown__series holo-panel" aria-labelledby="series">
        <h2 id="series" className="eyebrow">
          Season series · {game.away.abbr} {game.headToHead.away}–{game.headToHead.home} {game.home.abbr}
        </h2>
        {series.length ? (
          <ul className="breakdown__series-list tabular">
            {series.map((g) => {
              const home = requireTeam(g.homeTeamId).abbr;
              const away = requireTeam(g.awayTeamId).abbr;
              return (
                <li key={g.gameDate}>
                  <span className="breakdown__muted">{shortDate(g.gameDate)}</span>
                  <span>
                    {away} {g.awayScore} @ {home} {g.homeScore}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="breakdown__muted">First meeting this season.</p>
        )}
      </section>

      <section className="breakdown__players holo-panel" aria-labelledby="players">
        <h2 id="players" className="eyebrow">
          Projected player lines
        </h2>
        <p className="breakdown__muted">Points, rebounds and assists for each team&apos;s rotation are coming soon.</p>
      </section>

      <Link href="/" className="breakdown__back">
        <span aria-hidden>←</span> Today&apos;s games
      </Link>
    </article>
  );
}
