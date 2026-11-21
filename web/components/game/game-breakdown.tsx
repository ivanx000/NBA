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
import { AdvancedMatchup } from "./advanced-stats";
import { PlayerTable } from "./player-lines";
import { TeamNumbers } from "./team-numbers";
import "./game.css";

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Last 10, most recent first: W/L, opponent, score. Shared with the home page's results screen. */
export function Form({ games }: { games: RecentGame[] }) {
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
    <section className="breakdown__team" style={{ "--team": color } as CSSProperties} aria-label={team.name}>
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
  const { game, form, series, advanced } = detail;
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

      <section className="breakdown__chance" aria-labelledby="chance">
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

      {advanced && (
        <section className="breakdown__advanced" aria-labelledby="advanced">
          <h2 id="advanced" className="eyebrow">
            Advanced stats
          </h2>
          <AdvancedMatchup
            advanced={advanced}
            away={{ abbr: game.away.abbr, color: colors.away.color }}
            home={{ abbr: game.home.abbr, color: colors.home.color }}
          />
        </section>
      )}

      <section className="breakdown__series" aria-labelledby="series">
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

      <section className="breakdown__players" aria-labelledby="players">
        <h2 id="players" className="eyebrow">
          {game.status === "final" ? "Player lines: projected and real" : "Projected player lines"}
        </h2>
        {game.players.home.length + game.players.away.length === 0 ? (
          <p className="breakdown__muted">
            {game.status === "scheduled"
              ? "Projected lines are published with the prediction, around 9 AM ET on game day."
              : "No player lines were projected before this game."}
          </p>
        ) : (
          <>
            <div className="player-tables">
              {(["away", "home"] as const).map((side) =>
                game.players[side].length ? (
                  <PlayerTable
                    key={side}
                    lines={game.players[side]}
                    teamName={`${game[side].city} ${game[side].name}`}
                    color={readableTeamColor(requireTeam(game[side].teamId))}
                    advanced={advanced?.players}
                  />
                ) : null,
              )}
            </div>
            <p className="breakdown__muted breakdown__small">
              Each team&apos;s 8 players with the most projected minutes. Projections assume he plays; under each
              number is its 80% range, which should hold the real number 8 times in 10.
              {game.status === "final" && " Real numbers are marked ✓ inside the range, ✗ outside."}{" "}
              {game.players.source === "backfill"
                ? "These are a walk-forward backtest: models trained only on games before that week."
                : "Published before tip-off."}
            </p>
          </>
        )}
      </section>

      <Link href="/" className="breakdown__back">
        <span aria-hidden>←</span> Today&apos;s games
      </Link>
    </article>
  );
}
