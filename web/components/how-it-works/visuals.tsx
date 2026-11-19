"use client";

import { useEffect, useRef, useState } from "react";

import {
  EXAMPLE,
  EXAMPLE_BASE,
  EXAMPLE_FEATURES,
  EXAMPLE_REASONS,
  LEARNED_GAMES,
  runningTotals,
  SEASON_GAMES,
  stage,
  TEST_GAMES,
  TEST_SEASON,
} from "@/lib/story";
import { hologramMatchup } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import { useChapterProgress } from "./chapter";

const BLUE = "#5b8cff";
const RED = "#ff4d5e";
const UNLIT = "rgba(243, 246, 252, 0.09)";

const home = requireTeam(EXAMPLE.home);
const away = requireTeam(EXAMPLE.away);
const glow = hologramMatchup(home, away);
/** The example's two team colors (glow versions, readable on the dark background). */
export const KNICKS = glow.home.color;
export const CELTICS = glow.away.color;

const ease = (t: number) => 1 - (1 - t) ** 3;
const pct = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`;

/** A number that counts up as the chapter plays, with a caption. */
export function Figure({
  value,
  from = 0,
  unit = "count",
  span = [0, 0.7],
  children,
}: {
  value: number;
  from?: number;
  /** "percent": ``value`` is a share (0.67 shows as 67%). */
  unit?: "count" | "percent";
  /** The part of the chapter the count runs over. */
  span?: [number, number];
  children: React.ReactNode;
}) {
  const p = useChapterProgress();
  const shown = from + (value - from) * ease(stage(p, span[0], span[1]));
  const format = (v: number) => (unit === "percent" ? pct(v) : Math.round(v).toLocaleString("en-US"));
  return (
    <p className="story-figure">
      {/* Screen readers get the final number, not every step of the count. */}
      <span className="story-figure__n" aria-hidden>
        {format(shown)}
      </span>
      <span className="sr-only">{format(value)}</span>
      <span className="story-figure__label">{children}</span>
    </p>
  );
}

/* --- 1. Data: one dot per game ------------------------------------------------------------- */

const COLS = 41; // 1,230 games = 41 x 30

function SeasonBlock({ games, lit, color }: { games: number; lit: number; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const rows = Math.ceil(games / COLS);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || width === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pitch = width / COLS;
    el.width = Math.round(width * dpr);
    el.height = Math.round(rows * pitch * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const dot = Math.max(1, pitch * 0.62);
    const on = Math.round(games * lit);
    for (let i = 0; i < games; i++) {
      ctx.fillStyle = i < on ? color : UNLIT;
      ctx.fillRect((i % COLS) * pitch, Math.floor(i / COLS) * pitch, dot, dot);
    }
  }, [width, rows, games, lit, color]);

  return <canvas ref={canvas} className="story-dots__canvas" style={{ aspectRatio: `${COLS} / ${rows}` }} />;
}

export function GamesGrid() {
  const p = useChapterProgress();
  const per = 0.8 / SEASON_GAMES.length;
  return (
    <figure className="story-panel">
      <ol className="story-dots" aria-label="Games per season, one dot per game">
        {SEASON_GAMES.map((s, i) => (
          <li key={s.season} data-test={s.test || undefined}>
            <SeasonBlock
              games={s.games}
              // Seasons fill in order; quantized so the canvas only redraws in small steps.
              lit={Math.round(stage(p, i * per, (i + 1.6) * per) * 40) / 40}
              color={s.test ? RED : BLUE}
            />
            <span className="story-dots__label">
              {s.season} <span className="sr-only">{s.games} games</span>
            </span>
          </li>
        ))}
      </ol>
      <figcaption className="story-legend">
        <span>
          <i style={{ background: BLUE }} aria-hidden /> Learned from: {LEARNED_GAMES.toLocaleString("en-US")} games
        </span>
        <span>
          <i style={{ background: RED }} aria-hidden /> Kept back for one final test: {TEST_GAMES.toLocaleString("en-US")}
        </span>
      </figcaption>
    </figure>
  );
}

/* --- 2. Features: the example game as numbers ---------------------------------------------- */

const SEASON_SO_FAR = 18;
const TIPOFF_AT = 12;

export function FeatureBars() {
  const p = useChapterProgress();
  const past = stage(p, 0, 0.2);
  return (
    <figure className="story-panel">
      <figcaption className="story-panel__head">
        <span>
          Celtics at Knicks <span className="text-muted-foreground">(an example)</span>
        </span>
        <span className="text-muted-foreground">6 of the 56</span>
      </figcaption>

      {/* Only the past: the Knicks' games so far, the ones before tip-off lit. */}
      <div className="story-timeline" aria-label="Only games before tip-off are used">
        <div className="story-timeline__ticks" aria-hidden>
          {Array.from({ length: SEASON_SO_FAR }, (_, i) => (
            <span
              key={i}
              data-state={i < TIPOFF_AT ? (i < Math.round(past * TIPOFF_AT) ? "used" : "past") : "future"}
            />
          ))}
          <b style={{ left: `${(TIPOFF_AT / SEASON_SO_FAR) * 100}%` }}>Tip-off</b>
        </div>
        <p className="story-timeline__note">
          <span>Used: games before tip-off</span>
          <span>Never used: the game itself and after</span>
        </p>
      </div>

      <div className="story-axis" aria-hidden>
        <span style={{ color: CELTICS }}>Favors Celtics</span>
        <span style={{ color: KNICKS }}>Favors Knicks</span>
      </div>
      <ul className="story-features">
        {EXAMPLE_FEATURES.map((f, i) => {
          const grow = ease(stage(p, 0.2 + i * 0.09, 0.38 + i * 0.09));
          const knicks = f.lean > 0;
          return (
            <li key={f.label}>
              <p className="story-features__label">{f.label}</p>
              <p className="story-features__values">
                <span style={{ color: CELTICS }}>BOS {f.away}</span>
                <span style={{ color: KNICKS }}>NYK {f.home}</span>
              </p>
              <div className="story-diverge" aria-hidden>
                <span
                  style={{
                    width: `${Math.abs(f.lean) * 50 * grow}%`,
                    [knicks ? "left" : "right"]: "50%",
                    background: knicks ? KNICKS : CELTICS,
                    boxShadow: `0 0 12px ${knicks ? KNICKS : CELTICS}`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/* --- 3. Model: the reasons add up to the prediction ---------------------------------------- */

const LO = 0.45;
const HI = 0.7;
const x = (v: number) => `${((v - LO) / (HI - LO)) * 100}%`;
const REVEAL = (i: number) => [0.08 + i * 0.1, 0.16 + i * 0.1] as const;

/** The Knicks' win chance after as many reasons as have been revealed (eases between rows). */
export function runningChance(p: number): number {
  const totals = runningTotals();
  let at = EXAMPLE_BASE;
  totals.forEach((t, i) => {
    at += (t.to - t.from) * ease(stage(p, ...REVEAL(i)));
  });
  return at;
}

export function ChanceFigure() {
  const p = useChapterProgress();
  return (
    <p className="story-figure">
      <span className="story-figure__n" aria-hidden style={{ color: KNICKS }}>
        {pct(runningChance(p))}
      </span>
      <span className="sr-only">{pct(runningChance(1))}</span>
      <span className="story-figure__label">Knicks win chance in the example, built up one reason at a time</span>
    </p>
  );
}

export function Waterfall() {
  const p = useChapterProgress();
  const totals = runningTotals();
  const final = totals.at(-1)!.to;
  const done = stage(p, ...REVEAL(totals.length));
  return (
    <figure className="story-panel">
      <figcaption className="story-panel__head">
        <span>Why the Knicks are favored</span>
        <span className="text-muted-foreground">win chance, points</span>
      </figcaption>
      <ol className="story-waterfall">
        <li data-kind="base">
          <p>
            <span>Starting point</span>
            <span className="story-waterfall__note">an average game, home court included</span>
          </p>
          <div className="story-track">
            <span className="story-track__fill" style={{ width: x(EXAMPLE_BASE), background: "rgba(243,246,252,0.22)" }} />
          </div>
          <b>{pct(EXAMPLE_BASE)}</b>
        </li>
        {EXAMPLE_REASONS.map((r, i) => {
          const t = totals[i];
          const shown = ease(stage(p, ...REVEAL(i)));
          const knicks = r.points > 0;
          const color = r.factor === "Everything else" ? "rgba(243,246,252,0.45)" : knicks ? KNICKS : CELTICS;
          const lo = Math.min(t.from, t.to);
          return (
            <li key={r.factor} style={{ opacity: 0.25 + 0.75 * shown }}>
              <p>
                <span>{r.factor}</span>
                <span className="story-waterfall__note">{r.copy}</span>
              </p>
              <div className="story-track">
                <span
                  className="story-track__step"
                  style={{
                    left: x(lo),
                    width: `calc(${x(lo + Math.abs(r.points) / 100)} - ${x(lo)})`,
                    transform: `scaleX(${shown})`,
                    transformOrigin: knicks ? "left" : "right",
                    background: color,
                  }}
                />
              </div>
              <b style={{ color }}>
                {r.points > 0 ? "+" : "−"}
                {Math.abs(r.points).toFixed(1)}
              </b>
            </li>
          );
        })}
        <li data-kind="total" style={{ opacity: 0.25 + 0.75 * done }}>
          <p>
            <span>Prediction</span>
            <span className="story-waterfall__note">Knicks win</span>
          </p>
          <div className="story-track">
            <span
              className="story-track__fill"
              style={{ width: x(final), background: KNICKS, boxShadow: `0 0 14px ${KNICKS}` }}
            />
          </div>
          <b style={{ color: KNICKS }}>{pct(final)}</b>
        </li>
      </ol>
    </figure>
  );
}

/* --- 4. Prediction: published, then graded ------------------------------------------------- */

const DAY = [
  { at: "Morning", what: "Predictions made and saved" },
  { at: "Tip-off", what: "Locked: it can't change now" },
  { at: "Final", what: "Graded against the score" },
];

export function Scorecard() {
  const p = useChapterProgress();
  const rows = [
    { label: "Tip-Off model", value: TEST_SEASON.accuracy.model, color: BLUE },
    { label: "Elo ratings", value: TEST_SEASON.accuracy.elo, color: "rgba(243,246,252,0.7)" },
    { label: "Always pick the home team", value: TEST_SEASON.accuracy.home, color: "rgba(243,246,252,0.3)" },
  ];
  return (
    <figure className="story-panel">
      <ol className="story-day">
        {DAY.map((d, i) => (
          <li key={d.at} data-on={stage(p, i * 0.14, i * 0.14 + 0.08) >= 1 || undefined}>
            <b>{d.at}</b>
            <span>{d.what}</span>
          </li>
        ))}
      </ol>
      <div className="story-panel__head">
        <span>Games called right, {TEST_SEASON.season}</span>
        <span className="text-muted-foreground">{TEST_SEASON.games.toLocaleString("en-US")} games</span>
      </div>
      <ul className="story-bars">
        {rows.map((r, i) => {
          const grow = ease(stage(p, 0.4 + i * 0.1, 0.62 + i * 0.1));
          return (
            <li key={r.label}>
              <span>{r.label}</span>
              <div className="story-track">
                {/* The scale starts at 50%, a coin flip. */}
                <span
                  className="story-track__fill"
                  style={{ width: `${((r.value - 0.5) / 0.25) * 100 * grow}%`, background: r.color }}
                />
              </div>
              <b>{pct(r.value, 1)}</b>
            </li>
          );
        })}
      </ul>
      <p className="story-scale" aria-hidden>
        <span>50% (a coin flip)</span>
        <span>75%</span>
      </p>
    </figure>
  );
}
