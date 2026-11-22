import { type CSSProperties } from "react";

import type { PlayerAdvanced } from "@/lib/advanced-stats";
import {
  didNotPlay,
  inRange,
  type PlayerLine,
  rangeText,
  round,
  STAT_LABEL,
  STATS,
} from "@/lib/players";

import "./players.css";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

/** "Questionable" and the like, from the official injury report when he was projected. */
function Status({ line }: { line: PlayerLine }) {
  if (!line.status || line.status === "Available") return null;
  return (
    <span className="player-status" title={`${line.status} on the official injury report`}>
      {line.status}
    </span>
  );
}

function Mark({ line, stat }: { line: PlayerLine; stat: (typeof STATS)[number] }) {
  const hit = inRange(line, stat);
  if (hit === null) return null;
  return (
    <span className="player-table__real" data-hit={hit}>
      {line.actual?.[stat]}
      <span className="sr-only">{hit ? ", inside the range" : ", outside the range"}</span>
      <span aria-hidden>{hit ? " ✓" : " ✗"}</span>
    </span>
  );
}

/** The game page's table for one team: every projected player, and the real line once final. */
export function PlayerTable({
  lines,
  teamName,
  color,
  advanced,
}: {
  lines: PlayerLine[];
  teamName: string;
  color: string;
  /** Season shooting and usage by player id: adds TS% and USG% columns. */
  advanced?: Record<number, PlayerAdvanced>;
}) {
  const showAdv = Boolean(advanced && lines.some((l) => advanced[l.playerId]));
  const final = lines.some((l) => l.actual !== null);
  return (
    <div className="player-table" style={{ "--team": color } as CSSProperties}>
      <table>
        <caption>{teamName}</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Min</th>
            {STATS.map((s) => (
              <th key={s} scope="col">
                {STAT_LABEL[s]}
              </th>
            ))}
            {showAdv && (
              <>
                <th scope="col" title="True shooting this season">
                  TS%
                </th>
                <th scope="col" title="Usage rate this season">
                  USG%
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.playerId} data-dnp={didNotPlay(line) || undefined}>
              <th scope="row">
                <span>{line.name}</span>
                <Status line={line} />
              </th>
              <td className="tabular">
                <b className="player-table__min">{round(line.minutes)}</b>
                {final && line.actual && (
                  <>
                    {/* An empty range row, so the real minutes line up with the real stats. */}
                    <span className="player-table__range" aria-hidden>
                      &nbsp;
                    </span>
                    <span className="player-table__real">
                      {Math.round(line.actual.minutes)}
                      <span className="sr-only"> minutes played</span>
                    </span>
                  </>
                )}
              </td>
              {STATS.map((s) => (
                <td key={s} className="tabular">
                  <b>{round(line.proj[s])}</b>
                  <span className="player-table__range">{rangeText(line.range[s])}</span>
                  <Mark line={line} stat={s} />
                </td>
              ))}
              {showAdv && (
                <>
                  <td className="tabular player-table__adv">{pct(advanced?.[line.playerId]?.ts ?? null)}</td>
                  <td className="tabular player-table__adv">{pct(advanced?.[line.playerId]?.usage ?? null)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
