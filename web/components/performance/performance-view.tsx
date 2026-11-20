"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { CountUp } from "@/components/count-up";
import { tiltHandlers } from "@/lib/tilt";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { shortDate } from "@/lib/dates";
import { HOME_RATE, type Metrics, type PickRow, type SeasonSummary } from "@/lib/performance";

import "./performance.css";

const pct = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`;
const BLUE = "#5b8cff";
const MUTED = "rgba(243, 246, 252, 0.55)";
const GRID = "rgba(243, 246, 252, 0.08)";

function seasonLabel(i: number, season: string) {
  return i === 0 ? `This season · ${season}` : `Last season · ${season}`;
}

/** One headline number with the two baselines under it. Lower is better for log loss and Brier. */
function Tile({
  label,
  model,
  elo,
  home,
  format,
  lowerIsBetter,
  note,
}: {
  label: string;
  model: number;
  elo: number;
  home: number;
  format: (n: number) => string;
  lowerIsBetter?: boolean;
  note: string;
}) {
  const beatsElo = lowerIsBetter ? model < elo : model > elo;
  return (
    <div className="perf-tile holo-panel" data-tilt {...tiltHandlers()}>
      <p className="perf-tile__label">{label}</p>
      <p className="perf-tile__value tabular">
        <CountUp value={model} format={format} />
      </p>
      <dl className="perf-tile__base tabular">
        <div data-beaten={beatsElo || undefined}>
          <dt>Elo</dt>
          <dd>{format(elo)}</dd>
        </div>
        <div>
          <dt>Home team</dt>
          <dd>{format(home)}</dd>
        </div>
      </dl>
      <p className="perf-tile__note">{note}</p>
    </div>
  );
}

function verdict(model: Metrics, elo: Metrics) {
  const diff = (model.accuracy - elo.accuracy) * 100;
  if (Math.abs(diff) < 0.5) return "about even with Elo";
  return diff > 0 ? `${diff.toFixed(1)} points ahead of Elo` : `${Math.abs(diff).toFixed(1)} points behind Elo`;
}

function CallList({ title, rows }: { title: string; rows: PickRow[] }) {
  return (
    <div className="perf-calls holo-panel">
      <h3 className="eyebrow">{title}</h3>
      <ul>
        {rows.map((r) => (
          <li key={r.gameId}>
            <Link href={`/game/${r.gameId}`}>
              <span className="tabular">{shortDate(r.gameDate)}</span>
              <span>
                {r.away} @ {r.home}
              </span>
              <span className="tabular">
                {r.pick} {pct(r.confidence)}
              </span>
              <span className="tabular perf-muted">
                {r.awayScore}–{r.homeScore}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small segmented control (one choice pressed). */
function Seg<T extends string>({
  value,
  set,
  options,
  label,
}: {
  value: T;
  set: (v: T) => void;
  options: [T, string][];
  label: string;
}) {
  return (
    <div className="perf-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

type Filter = "all" | "right" | "missed";
type Source = "all" | "live" | "backfill";

function PickTable({ rows }: { rows: PickRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [source, setSource] = useState<Source>("all");
  const shown = rows.filter(
    (r) =>
      (filter === "all" || (filter === "right") === r.correct) && (source === "all" || r.source === source),
  );
  return (
    <section className="perf-table holo-panel" aria-labelledby="picks">
      <div className="perf-table__head">
        <h2 id="picks" className="eyebrow">
          Recent picks
        </h2>
        <div className="perf-table__filters">
          <Seg label="Result" value={filter} set={setFilter} options={[["all", "All"], ["right", "Right"], ["missed", "Missed"]]} />
          <Seg label="Source" value={source} set={setSource} options={[["all", "All"], ["live", "Live"], ["backfill", "Backtest"]]} />
        </div>
      </div>
      <div className="perf-table__scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Game</th>
              <th scope="col">Model</th>
              <th scope="col">Elo</th>
              <th scope="col">Final</th>
              <th scope="col">
                <span className="sr-only">Source</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.gameId} data-correct={r.correct}>
                <td className="tabular perf-muted">{shortDate(r.gameDate)}</td>
                <td>
                  <Link href={`/game/${r.gameId}`}>
                    {r.away} @ {r.home}
                  </Link>
                </td>
                <td className="tabular">
                  <span aria-label={r.correct ? "right" : "missed"} className="perf-mark">
                    {r.correct ? "✓" : "✗"}
                  </span>{" "}
                  {r.pick} {pct(r.confidence)}
                </td>
                <td className="tabular perf-muted">
                  {r.eloPick ? `${r.eloCorrect ? "✓" : "✗"} ${r.eloPick}` : "—"}
                </td>
                <td className="tabular">
                  {r.away} {r.awayScore}–{r.homeScore} {r.home}
                </td>
                <td className="perf-muted perf-source">{r.source === "live" ? "Live" : "Backtest"}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="perf-muted">
                  No picks match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The report card: season toggle, headline tiles, rolling accuracy, calibration, calls, picks. */
export function PerformanceView({ seasons }: { seasons: SeasonSummary[] }) {
  const [index, setIndex] = useState(0);
  const reduced = useReducedMotion();
  const s = seasons[index];
  const homeAcc = useMemo(() => s?.card.home.accuracy ?? HOME_RATE, [s]);
  if (!s) return <p className="mt-10 text-muted-foreground">No graded games yet. Check back after the first results.</p>;
  const { model, elo, home } = s.card;

  return (
    <div className="perf">
      {seasons.length > 1 && (
        <div className="perf-seg perf-seasons" role="group" aria-label="Season">
          {seasons.map((x, i) => (
            <button key={x.season} type="button" aria-pressed={i === index} onClick={() => setIndex(i)}>
              {seasonLabel(i, x.season)}
            </button>
          ))}
        </div>
      )}

      <p className="perf-headline">
        Right on <CountUp className="tabular font-bold" value={model.accuracy} format={(n) => pct(n)} /> of{" "}
        {model.n.toLocaleString()} games,{" "}
        {verdict(model, elo)}.
      </p>
      <p className="perf-muted perf-small">
        {s.live > 0 && s.backfill > 0
          ? `${s.live} live picks (published before tip-off) and ${s.backfill.toLocaleString()} walk-forward backtest picks (a model trained only on games before that week), ${shortDate(s.from)} to ${shortDate(s.to)}.`
          : s.live > 0
            ? `${s.live} live picks, published before tip-off.`
            : `${s.backfill.toLocaleString()} walk-forward backtest picks: each made by a model trained only on games before that week.`}
      </p>

      <div className="perf-tiles">
        <Tile label="Accuracy" model={model.accuracy} elo={elo.accuracy} home={home.accuracy} format={(n) => pct(n, 1)}
              note="Share of games where the team given 50%+ won." /> {/* prettier-ignore */}
        <Tile label="Log loss" model={model.logLoss} elo={elo.logLoss} home={home.logLoss} format={(n) => n.toFixed(3)} lowerIsBetter
              note="Penalizes confident misses. Lower is better; 0.693 is a coin flip." /> {/* prettier-ignore */}
        <Tile label="Brier score" model={model.brier} elo={elo.brier} home={home.brier} format={(n) => n.toFixed(3)} lowerIsBetter
              note="Squared error of the probability. Lower is better; 0.250 is a coin flip." /> {/* prettier-ignore */}
        <div className="perf-tile holo-panel" data-tilt {...tiltHandlers()}>
          <p className="perf-tile__label">Games graded</p>
          <p className="perf-tile__value tabular">
            <CountUp value={model.n} format={(n) => Math.round(n).toLocaleString()} />
          </p>
          <p className="perf-tile__note">
            Regular-season games that finished, each with a probability set before tip-off.
          </p>
        </div>
      </div>

      <div className="perf-charts">
        <section className="perf-chart holo-panel" aria-labelledby="rolling">
          <h2 id="rolling" className="eyebrow">
            Accuracy, last 50 games
          </h2>
          <p className="perf-muted perf-small">Each point is the share right over the 50 games before it.</p>
          {s.rolling.length ? (
            <div className="perf-chart__plot" role="img" aria-label={`Rolling 50-game accuracy, ending at ${pct(s.rolling.at(-1)!.model)} for the model.`}>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={s.rolling} margin={{ top: 10, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="game" tick={{ fill: MUTED, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis domain={[0.4, 0.9]} ticks={[0.4, 0.5, 0.6, 0.7, 0.8, 0.9]} tickFormatter={(v) => pct(v)} tick={{ fill: MUTED, fontSize: 11 }} tickLine={false} axisLine={false} />
                  <ReferenceLine y={homeAcc} stroke={MUTED} strokeDasharray="2 4" label={{ value: "Home team", fill: MUTED, fontSize: 10, position: "insideBottomRight" }} />
                  <Tooltip
                    contentStyle={{ background: "#0a1022", border: "1px solid rgba(243,246,252,0.14)", borderRadius: 8 }}
                    labelFormatter={(g) => `Game ${g}`}
                    formatter={(v, name) => [pct(Number(v), 1), name === "model" ? "Model" : "Elo"]}
                  />
                  <Line type="monotone" dataKey="elo" stroke={MUTED} strokeDasharray="4 4" dot={false} strokeWidth={1.5} isAnimationActive={!reduced} />
                  <Line type="monotone" dataKey="model" stroke={BLUE} dot={false} strokeWidth={2.2} isAnimationActive={!reduced} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="perf-muted">Needs 50 graded games.</p>
          )}
          <p className="perf-legend">
            <span className="perf-legend__model" /> Model <span className="perf-legend__elo" /> Elo
          </p>
        </section>

        <section className="perf-chart holo-panel" aria-labelledby="calibration">
          <h2 id="calibration" className="eyebrow">
            Calibration
          </h2>
          <p className="perf-muted perf-small">
            When the model gives its pick 60–70%, does that team win about 65% of the time? On the line means yes.
          </p>
          <div className="perf-chart__plot" role="img" aria-label="Calibration: predicted chance against how often the favorite won.">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={s.calibration} margin={{ top: 10, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke={GRID} />
                <XAxis type="number" dataKey="predicted" domain={[0.5, 1]} ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]} tickFormatter={(v) => pct(v)} tick={{ fill: MUTED, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis type="number" domain={[0.3, 1]} ticks={[0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]} tickFormatter={(v) => pct(v)} tick={{ fill: MUTED, fontSize: 11 }} tickLine={false} axisLine={false} />
                <ReferenceLine segment={[{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }]} stroke={MUTED} strokeDasharray="4 4" />
                <Tooltip
                  cursor={false}
                  contentStyle={{ background: "#0a1022", border: "1px solid rgba(243,246,252,0.14)", borderRadius: 8 }}
                  formatter={(v, name) => [pct(Number(v), 1), name === "actual" ? "Favorite won" : "Model said"]}
                  labelFormatter={() => ""}
                />
                <Scatter dataKey="actual" fill={BLUE} isAnimationActive={!reduced} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <table className="perf-cal-table tabular">
            <thead>
              <tr>
                <th scope="col">Model said</th>
                <th scope="col">Favorite won</th>
                <th scope="col">Games</th>
              </tr>
            </thead>
            <tbody>
              {s.calibration.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td>{pct(b.actual)}</td>
                  <td className="perf-muted">{b.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="perf-callgrid">
        <CallList title="Most confident hits" rows={s.best} />
        <CallList title="Most confident misses" rows={s.worst} />
      </div>

      <PickTable key={s.season} rows={s.recent} />

      <p className="perf-muted perf-small">
        Graded on finished regular-season games only. The home-team baseline always picks the home team at{" "}
        {pct(HOME_RATE, 1)}, the home win rate in the training years. Elo uses the same pregame ratings the model sees.
        The model was tested once on the 2025-26 season before going live; it hasn&apos;t been tuned on these numbers.
      </p>
    </div>
  );
}
