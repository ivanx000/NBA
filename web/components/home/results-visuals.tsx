"use client";

import { type CSSProperties, Fragment, type ReactNode, useId, useState } from "react";

import { CountUp } from "@/components/count-up";
import { ordinal, type PlayerAdvanced, showStat, TEAM_STATS, type TeamAdvanced, type TeamStatKey } from "@/lib/advanced-stats";
import { shortDate } from "@/lib/dates";
import { factorCopy } from "@/lib/factor-copy";
import { didNotPlay, inRange, type PlayerLine, rangeText, round, shortName, STAT_LABEL, STATS, type Stat } from "@/lib/players";
import type { Side, SlateGame } from "@/lib/slate";
import type { RecentGame, TeamStats } from "@/lib/team-stats";
import { requireTeam } from "@/lib/teams";

/*
 * The results screen's charts (DESIGN.md section 5). Each one answers the pointer (and focus, and
 * a tap): pointing at a part fills a caption line with its details, so the numbers stay out of the
 * way until asked for.
 */

const pct = (p: number) => `${Math.round(p * 100)}%`;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;
const wl = (r: { wins: number; losses: number }) => `${r.wins}-${r.losses}`;
const share = (r: { wins: number; losses: number }) => (r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0);
/** An id usable inside url(#...) (React's ids carry punctuation). */
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

/** A team's place in the league: 1 for the best rank, 0 for the worst. */
const standing = (rank: number, of: number) => (of > 1 ? (of - rank) / (of - 1) : 0.5);

function tier(rank: number, of: number): "top" | "mid" | "low" {
  if (rank <= Math.ceil(of / 3)) return "top";
  if (rank > of - Math.ceil(of / 3)) return "low";
  return "mid";
}

/** The caption under a chart: what the pointer is on, else the chart's summary. */
function Caption({ children }: { children: ReactNode }) {
  return (
    <p className="viz-caption tabular" aria-live="polite">
      {children}
    </p>
  );
}

/** Pointer, focus and tap handlers that set one active item (and clear it on leave/blur). */
function point<T>(set: (v: T | null) => void, v: T) {
  return {
    onPointerEnter: () => set(v),
    onFocus: () => set(v),
    onBlur: () => set(null),
    onClick: () => set(v),
  };
}

/* --- Win chance ------------------------------------------------------------------------------ */

function Ball() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" />
      <path d="M1.5 12h21M12 1.5v21M4.6 4.6c3.2 3.4 3.2 11.4 0 14.8M19.4 4.6c-3.2 3.4-3.2 11.4 0 14.8" />
    </svg>
  );
}

/**
 * The viewed team's win chance as ten basketballs: "play this game 10 times" and the lit ones
 * are its wins (the rest, in the opponent's color, are the opponent's). The exact number counts
 * up above; the Elo baseline sits in the caption.
 */
export function ChanceBalls({
  p,
  elo,
  color,
  otherColor,
  abbr,
  otherAbbr,
}: {
  p: number;
  elo: number | null;
  color: string;
  otherColor: string;
  abbr: string;
  otherAbbr: string;
}) {
  const wins = Math.round(p * 10);
  return (
    <figure className="chance" style={{ "--c": color, "--o": otherColor } as CSSProperties}>
      <p className="chance__top">
        <CountUp value={p} format={pct} className="chance__value tabular" />
        <span className="viz-label">{abbr} win chance</span>
      </p>
      <ol className="chance__balls" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <li key={i} data-on={i < wins || undefined} style={{ "--d": `${0.5 + i * 0.07}s` } as CSSProperties}>
            <Ball />
          </li>
        ))}
      </ol>
      <figcaption className="viz-caption tabular">
        Play it 10 times: {abbr} {wins}, {otherAbbr} {10 - wins}
        {elo !== null && ` · Elo ${pct(elo)}`}
      </figcaption>
    </figure>
  );
}

/* --- One team ------------------------------------------------------------------------------- */

/** Season, home, away and last-10 records as small donuts, the share won in the team's color. */
export function RecordDonuts({ stats }: { stats: TeamStats }) {
  const records: [string, { wins: number; losses: number }][] = [
    ["Season", stats.record],
    ["Home", stats.home],
    ["Away", stats.away],
    ["Last 10", stats.last10],
  ];
  return (
    <ul className="donuts">
      {records.map(([label, r], i) => (
        <li key={label} title={`${label}: ${wl(r)}${r.wins + r.losses ? `, ${pct(share(r))} won` : ""}`}>
          <span className="donuts__chart" data-empty={r.wins === 0 || undefined} style={{ "--p": share(r) * 100, "--d": `${0.3 + i * 0.08}s` } as CSSProperties}>
            <svg viewBox="0 0 48 48" aria-hidden>
              <circle className="donuts__rest" cx="24" cy="24" r="19" pathLength={100} />
              <circle className="donuts__arc" cx="24" cy="24" r="19" pathLength={100} />
            </svg>
            <b className="tabular">{wl(r)}</b>
          </span>
          <span className="viz-label">{label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Points scored and allowed per game as a dumbbell on a 95–130 scale: the line between the two
 * dots is the margin, green when they outscore opponents and red when they don't.
 */
export function ScoringDumbbell({ stats }: { stats: TeamStats }) {
  if (stats.pointsFor === null || stats.pointsAgainst === null) return null;
  const lo = 95;
  const hi = 130;
  const x = (v: number) => `${clamp01((v - lo) / (hi - lo)) * 100}%`;
  const good = stats.pointsFor >= stats.pointsAgainst;
  const [left, right] = [Math.min(stats.pointsFor, stats.pointsAgainst), Math.max(stats.pointsFor, stats.pointsAgainst)];
  return (
    <div className="dumbbell" data-good={good}>
      <div className="dumbbell__plot">
        <span className="dumbbell__axis" aria-hidden />
        {[100, 110, 120, 130].map((t) => (
          <span key={t} className="dumbbell__tick tabular" style={{ left: x(t) }} aria-hidden>
            {t}
          </span>
        ))}
        <span className="dumbbell__bar" style={{ left: x(left), width: `calc(${x(right)} - ${x(left)})` }} aria-hidden />
        <span className="dumbbell__dot" data-kind="for" data-pos={good ? "right" : "left"} style={{ left: x(stats.pointsFor) }}>
          <span className="dumbbell__label tabular">
            <b>{stats.pointsFor.toFixed(1)}</b> scored
          </span>
        </span>
        <span className="dumbbell__dot" data-kind="against" data-pos={good ? "left" : "right"} style={{ left: x(stats.pointsAgainst) }}>
          <span className="dumbbell__label tabular">
            <b>{stats.pointsAgainst.toFixed(1)}</b> allowed
          </span>
        </span>
      </div>
      {stats.margin !== null && (
        <p className="viz-caption tabular">
          Points per game · margin <b data-won={good}>{signed(stats.margin)}</b>
        </p>
      )}
    </div>
  );
}

/**
 * The last 10 as two lines, points scored (team color) and allowed (white, dashed), oldest on the
 * left, the gap between them shaded green where they won and red where they lost. Pointing at a
 * game names the opponent and the score.
 */
export function ScoreLines({ games, color }: { games: RecentGame[]; color: string }) {
  const [active, setActive] = useState<number | null>(null);
  const uid = safeId(useId());
  if (!games.length) return <p className="viz-empty">No games yet this season.</p>;
  const ordered = [...games].reverse();
  const W = 320;
  const H = 150;
  const pad = { l: 26, r: 10, t: 12, b: 22 };
  const all = ordered.flatMap((g) => [g.pointsFor, g.pointsAgainst]);
  const lo = Math.floor((Math.min(...all) - 4) / 10) * 10;
  const hi = Math.ceil((Math.max(...all) + 4) / 10) * 10;
  const x = (i: number) => pad.l + (ordered.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (ordered.length - 1));
  const y = (v: number) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo);
  const line = (key: "pointsFor" | "pointsAgainst") => ordered.map((g, i) => `${x(i)},${y(g[key])}`).join(" ");
  const bottom = H - pad.b;
  const top = pad.t;
  const first = x(0);
  const last = x(ordered.length - 1);
  const below = (key: "pointsFor" | "pointsAgainst") => `${line(key)} ${last},${bottom} ${first},${bottom}`;
  const above = (key: "pointsFor" | "pointsAgainst") => `${line(key)} ${last},${top} ${first},${top}`;
  const ticks = Array.from({ length: (hi - lo) / 10 + 1 }, (_, i) => lo + i * 10);
  const g = active === null ? null : ordered[active];
  const wins = ordered.filter((o) => o.won).length;
  const step = ordered.length > 1 ? (W - pad.l - pad.r) / (ordered.length - 1) : W;

  return (
    <div className="lines" style={{ "--c": color } as CSSProperties}>
      <svg viewBox={`0 0 ${W} ${H}`} className="lines__svg" aria-hidden onPointerLeave={() => setActive(null)}>
        <defs>
          <clipPath id={`${uid}-a`}>
            <polygon points={above("pointsAgainst")} />
          </clipPath>
          <clipPath id={`${uid}-f`}>
            <polygon points={above("pointsFor")} />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t} className="lines__grid">
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        <g className="lines__draw">
          {/* Won: under the scored line and over the allowed one. Lost: the other way round. */}
          <polygon className="lines__gap" data-won="true" points={below("pointsFor")} clipPath={`url(#${uid}-a)`} />
          <polygon className="lines__gap" data-won="false" points={below("pointsAgainst")} clipPath={`url(#${uid}-f)`} />
          <polyline className="lines__against" points={line("pointsAgainst")} />
          <polyline className="lines__for" points={line("pointsFor")} />
        </g>
        {ordered.map((o, i) => (
          <g key={o.gameDate} className="lines__game" data-active={active === i || undefined}>
            <line className="lines__guide" x1={x(i)} x2={x(i)} y1={top} y2={bottom} />
            <circle className="lines__pt" data-kind="against" cx={x(i)} cy={y(o.pointsAgainst)} r={2.6} />
            <circle className="lines__pt" data-kind="for" cx={x(i)} cy={y(o.pointsFor)} r={3} />
            <text className="lines__opp" x={x(i)} y={H - 6} textAnchor="middle">
              {requireTeam(o.opponentId).abbr}
            </text>
            <rect
              className="lines__hit"
              x={x(i) - step / 2}
              y={0}
              width={step}
              height={H}
              onPointerEnter={() => setActive(i)}
              onClick={() => setActive(i)}
            />
          </g>
        ))}
      </svg>
      <ol className="sr-only" aria-label="Last 10 games, oldest first">
        {ordered.map((o, i) => (
          <li key={o.gameDate}>
            <button type="button" {...point(setActive, i)}>
              {`${shortDate(o.gameDate)}, ${o.atHome ? "versus" : "at"} ${requireTeam(o.opponentId).abbr}: ${o.won ? "won" : "lost"} ${o.pointsFor} to ${o.pointsAgainst}`}
            </button>
          </li>
        ))}
      </ol>
      <Caption>
        {g ? (
          <>
            {shortDate(g.gameDate)} · {g.atHome ? "vs" : "@"} {requireTeam(g.opponentId).abbr} ·{" "}
            <b data-won={g.won}>{g.won ? "W" : "L"}</b> {g.pointsFor}–{g.pointsAgainst}
          </>
        ) : (
          <>
            <span className="lines__key" data-kind="for" /> scored <span className="lines__key" data-kind="against" /> allowed ·{" "}
            {wins}–{ordered.length - wins}
          </>
        )}
      </Caption>
    </div>
  );
}


/**
 * Every advanced number as a rank strip: a rail of every team in the league (worst on the left,
 * 1st on the right) with this team's dot on it, green in the top third and red in the bottom
 * third. Pointing at one explains the stat.
 */
export function RankStrips({ stats }: { stats: TeamAdvanced }) {
  const [active, setActive] = useState<TeamStatKey | null>(null);
  const def = active ? TEAM_STATS.find((s) => s.key === active)! : null;
  return (
    <div className="strips" style={{ "--of": stats.of } as CSSProperties}>
      <p className="strips__scale viz-label" aria-hidden>
        <span>{ordinal(stats.of)}</span>
        <span>1st</span>
      </p>
      <ul onPointerLeave={() => setActive(null)}>
        {TEAM_STATS.map((d, i) => {
          const key = d.key;
          const rank = stats.ranks[key];
          return (
            <li
              key={key}
              tabIndex={0}
              data-tier={key === "pace" ? "mid" : tier(rank, stats.of)}
              data-active={active === key || undefined}
              {...point(setActive, key)}
              style={{ "--x": `${standing(rank, stats.of) * 100}%`, "--d": `${0.25 + i * 0.05}s` } as CSSProperties}
            >
              <span className="viz-label">{d.short}</span>
              <span className="strips__rail" aria-hidden>
                <span className="strips__dot" />
              </span>
              <b className="tabular">{showStat(key, stats.values[key], d.kind)}</b>
              <span className="strips__rank tabular">{ordinal(rank)}</span>
              <span className="sr-only">{`${d.label}: ${ordinal(rank)} of ${stats.of}. ${d.note}.`}</span>
            </li>
          );
        })}
      </ul>
      <Caption>
        {def ? (
          <>
            <b>{def.label}</b> · {def.note}
          </>
        ) : (
          `Each rail is the league, ${stats.of} teams; 1st on the right.`
        )}
      </Caption>
    </div>
  );
}

/* --- The game ------------------------------------------------------------------------------- */

/**
 * The model's reasons as a waterfall, in the viewed team's terms: from an even game (50%), each
 * reason steps the chance toward the team it favors (in that team's color), then everything the
 * model weighs beyond its top reasons, landing on its prediction.
 */
export function ReasonWaterfall({
  game,
  viewing,
  colors,
  limit = 6,
}: {
  game: SlateGame;
  viewing: Side;
  colors: { home: string; away: string };
  limit?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const prediction = game.prediction;
  if (!prediction) return null;
  const final = viewing === "home" ? prediction.homeWinProb : 1 - prediction.homeWinProb;
  const names = { home: game.home.name, away: game.away.name };
  let at = 0.5;
  const steps: { label: string; favors: Side | null; from: number; to: number; delta: number }[] = [];
  for (const f of prediction.factors.slice(0, limit)) {
    const copy = factorCopy(f, names);
    const delta = ((copy.favors === viewing ? 1 : -1) * copy.points) / 100;
    steps.push({ label: copy.text, favors: copy.favors, from: at, to: at + delta, delta });
    at += delta;
  }
  const rest = { label: "Everything else the model weighs", favors: null, from: at, to: final, delta: final - at };
  const rows = [...steps, rest];
  const values = [0.5, final, ...rows.flatMap((r) => [r.from, r.to])];
  const lo = Math.max(0, Math.floor((Math.min(...values) - 0.04) * 20) / 20);
  const hi = Math.min(1, Math.ceil((Math.max(...values) + 0.04) * 20) / 20);
  const x = (v: number) => `${((clamp01(v) - lo) / (hi - lo)) * 100}%`;
  const abbr = game[viewing].abbr;
  const r = active === null ? null : rows[active];

  return (
    <div className="fall" style={{ "--home": colors.home, "--away": colors.away, "--even": x(0.5) } as CSSProperties}>
      <ol onPointerLeave={() => setActive(null)}>
        <li className="fall__row" data-kind="start">
          <span className="fall__label">Even game</span>
          <span className="fall__track">
            <span className="fall__mark" style={{ left: x(0.5) }} />
          </span>
          <span className="fall__value tabular">50%</span>
        </li>
        {rows.map((row, i) => (
          <li
            key={row.label}
            className="fall__row"
            tabIndex={0}
            data-favors={row.favors ?? "none"}
            data-active={active === i || undefined}
            {...point(setActive, i)}
            style={{ "--d": `${0.3 + i * 0.09}s` } as CSSProperties}
          >
            <span className="fall__label">{row.label}</span>
            <span className="fall__track">
              <span
                className="fall__bar"
                data-dir={row.delta >= 0 ? "up" : "down"}
                style={{ left: x(Math.min(row.from, row.to)), width: `calc(${x(Math.max(row.from, row.to))} - ${x(Math.min(row.from, row.to))})` }}
              />
              <span className="fall__link" style={{ left: x(row.to) }} />
            </span>
            <span className="fall__value tabular">{signed(row.delta * 100)}</span>
          </li>
        ))}
        <li className="fall__row" data-kind="end">
          <span className="fall__label">
            <b>The model: {abbr}</b>
          </span>
          <span className="fall__track">
            <span className="fall__total" style={{ width: x(final) }} />
            <span className="fall__mark" style={{ left: x(final) }} />
          </span>
          <span className="fall__value tabular">
            <b>{pct(final)}</b>
          </span>
        </li>
      </ol>
      <p className="fall__axis tabular viz-label" aria-hidden>
        <span />
        <span className="fall__ticks">
          <span>{pct(lo)}</span>
          <span>{abbr} win chance</span>
          <span>{pct(hi)}</span>
        </span>
        <span />
      </p>
      <Caption>
        {r ? (
          <>
            <b>{r.label}</b> · {pct(r.from)} → {pct(r.to)} for {abbr}
          </>
        ) : (
          "Each step is a reason, in the color of the team it helps."
        )}
      </Caption>
    </div>
  );
}

/* --- Players -------------------------------------------------------------------------------- */

type SortKey = "minutes" | Stat | "ts" | "usage";
const fmtPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const LEADER_LABEL: Record<Stat, string> = { pts: "Scoring", reb: "Rebounding", ast: "Playmaking" };

/**
 * One stat's projection as a whisker on the column's shared scale: the 80% range as a line with
 * caps, the projection as a dot, and once final the real number as a tick (green inside the
 * range, red outside).
 */
function Whisker({ line, stat, top }: { line: PlayerLine; stat: Stat; top: number }) {
  const [lo, hi] = line.range[stat];
  const x = (v: number) => `${clamp01(v / top) * 100}%`;
  const real = didNotPlay(line) ? null : (line.actual?.[stat] ?? null);
  const hit = inRange(line, stat);
  return (
    <span className="whisker" aria-hidden>
      <span className="whisker__range" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
      <span className="whisker__dot" style={{ left: x(line.proj[stat]) }} />
      {real !== null && <span className="whisker__real" data-hit={hit ?? undefined} style={{ left: x(real) }} />}
    </span>
  );
}

/**
 * The viewed team's projected players as a box score: the three stat leaders on top, then a
 * sortable table (click a heading) where minutes are a bar out of 48 and points, rebounds and
 * assists each carry a whisker of the 80% range, with the real numbers once the game is final.
 */
export function PlayerBoard({
  lines,
  color,
  advanced,
}: {
  lines: PlayerLine[];
  color: string;
  advanced?: Record<number, PlayerAdvanced>;
}) {
  const [sort, setSort] = useState<SortKey>("minutes");
  const [active, setActive] = useState<number | null>(null);
  const showAdv = Boolean(advanced && lines.some((l) => advanced[l.playerId]));
  const final = lines.some((l) => l.actual !== null);
  // One scale per stat column, rounded up to a multiple of 5.
  const top = Object.fromEntries(
    STATS.map((s) => [s, Math.max(5, Math.ceil(Math.max(...lines.map((l) => Math.max(l.range[s][1], l.actual?.[s] ?? 0))) / 5) * 5)]),
  ) as Record<Stat, number>;
  const key = (l: PlayerLine) =>
    sort === "minutes"
      ? l.minutes
      : sort === "ts"
        ? (advanced?.[l.playerId]?.ts ?? -1)
        : sort === "usage"
          ? (advanced?.[l.playerId]?.usage ?? -1)
          : l.proj[sort];
  const sorted = [...lines].sort((a, b) => key(b) - key(a));
  const leaders = STATS.map((s) => ({ stat: s, line: [...lines].sort((a, b) => b.proj[s] - a.proj[s])[0] }));
  const head = (k: SortKey, label: string, title?: string) => (
    <th scope="col" aria-sort={sort === k ? "descending" : "none"} title={title}>
      <button type="button" onClick={() => setSort(k)} data-on={sort === k || undefined}>
        {label}
        <span aria-hidden>{sort === k ? " ↓" : ""}</span>
      </button>
    </th>
  );

  return (
    <div className="board" style={{ "--team": color } as CSSProperties}>
      <ul className="board__leaders">
        {leaders.map(({ stat, line }, i) => {
          const real = didNotPlay(line) ? null : (line.actual?.[stat] ?? null);
          const hit = inRange(line, stat);
          return (
            <li
              key={stat}
              style={{ "--d": `${0.2 + i * 0.08}s` } as CSSProperties}
              data-active={active === line.playerId || undefined}
              onPointerEnter={() => setActive(line.playerId)}
              onPointerLeave={() => setActive(null)}
            >
              <span className="viz-label">{LEADER_LABEL[stat]}</span>
              <span className="board__big tabular">
                <CountUp value={line.proj[stat]} format={(n) => String(Math.round(n))} />
                <small>{STAT_LABEL[stat]}</small>
              </span>
              <span className="board__who">
                {line.number && <span className="board__num tabular">#{line.number}</span>}
                {shortName(line.name)}
              </span>
              <span className="board__range tabular">
                80% range {rangeText(line.range[stat])}
                {real !== null && (
                  <b data-hit={hit ?? undefined}>
                    {" "}
                    · real {real} {hit ? "✓" : "✗"}
                  </b>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="board__scroll">
        <table className="board__table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              {head("minutes", "Min", "Projected minutes, out of 48")}
              {STATS.map((s) => (
                <Fragment key={s}>{head(s, STAT_LABEL[s])}</Fragment>
              ))}
              {showAdv && (
                <>
                  {head("ts", "TS%", "True shooting this season")}
                  {head("usage", "USG%", "Usage rate this season")}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((line, i) => {
              const adv = advanced?.[line.playerId];
              const dnp = didNotPlay(line);
              return (
                <tr
                  key={line.playerId}
                  data-dnp={dnp || undefined}
                  data-active={active === line.playerId || undefined}
                  onPointerEnter={() => setActive(line.playerId)}
                  onPointerLeave={() => setActive(null)}
                  style={{ "--d": `${0.15 + i * 0.04}s` } as CSSProperties}
                >
                  <th scope="row">
                    <span className="board__name">
                      {line.number && <span className="board__num tabular">{line.number}</span>}
                      {shortName(line.name)}
                    </span>
                    {line.status && line.status !== "Available" && <span className="board__status">{line.status}</span>}
                    {dnp && <span className="board__status">Didn&apos;t play</span>}
                  </th>
                  <td className="tabular">
                    <span className="board__min">
                      <b>{round(line.minutes)}</b>
                      <span className="board__minbar" aria-hidden>
                        <span style={{ width: `${clamp01(line.minutes / 48) * 100}%` }} />
                      </span>
                    </span>
                  </td>
                  {STATS.map((s) => {
                    const real = dnp ? null : (line.actual?.[s] ?? null);
                    const hit = inRange(line, s);
                    return (
                      <td key={s} className="tabular" data-sorted={sort === s || undefined}>
                        <span className="board__stat">
                          <b>{round(line.proj[s])}</b>
                          <Whisker line={line} stat={s} top={top[s]} />
                        </span>
                        <span className="board__sub">
                          {rangeText(line.range[s])}
                          {real !== null && (
                            <span data-hit={hit ?? undefined}>
                              {" "}
                              {real} {hit ? "✓" : "✗"}
                            </span>
                          )}
                        </span>
                        <span className="sr-only">
                          {`80% range ${rangeText(line.range[s])}${real !== null ? `; real ${real}, ${hit ? "inside" : "outside"} the range` : ""}.`}
                        </span>
                      </td>
                    );
                  })}
                  {showAdv && (
                    <>
                      <td className="tabular board__adv">{fmtPct(adv?.ts ?? null)}</td>
                      <td className="tabular board__adv">{fmtPct(adv?.usage ?? null)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="viz-caption board__key">
        <span className="board__keydot" aria-hidden /> projection <span className="board__keyrange" aria-hidden /> 80% range
        {final && (
          <>
            {" "}
            <span className="board__keyreal" aria-hidden /> real
          </>
        )}
        <span> · click a heading to sort</span>
      </p>
    </div>
  );
}
