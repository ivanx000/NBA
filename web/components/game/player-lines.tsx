import { type CSSProperties } from "react";

import {
  didNotPlay,
  inRange,
  type PlayerLine,
  rangeText,
  round,
  shortName,
  STAT_LABEL,
  STATS,
} from "@/lib/players";

import "./players.css";

function Real({ line }: { line: PlayerLine }) {
  if (!line.actual) return null;
  if (didNotPlay(line)) return <p className="player-real">Didn&apos;t play</p>;
  return (
    <p className="player-real tabular">
      Real: {STATS.map((s) => `${line.actual?.[s] ?? "—"} ${STAT_LABEL[s].toLowerCase()}`).join(", ")} in{" "}
      {Math.round(line.actual.minutes)} min
    </p>
  );
}

/** The results screen's compact list: one team's top players by projected minutes. */
export function PlayerList({ lines, color, limit = 5 }: { lines: PlayerLine[]; color: string; limit?: number }) {
  return (
    <ol className="player-list" style={{ "--team": color } as CSSProperties}>
      {lines.slice(0, limit).map((line) => (
        <li key={line.playerId}>
          <div className="player-list__body">
            <p className="player-list__head">
              <span className="player-list__name">{shortName(line.name)}</span>
              <span className="player-list__min tabular">{round(line.minutes)} min</span>
            </p>
            <p className="player-list__stats tabular">
              {STATS.map((s) => (
                <span key={s}>
                  <b>{round(line.proj[s])}</b> {STAT_LABEL[s]}{" "}
                  <span className="player-list__range">{rangeText(line.range[s])}</span>
                </span>
              ))}
            </p>
            <Real line={line} />
          </div>
        </li>
      ))}
    </ol>
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
}: {
  lines: PlayerLine[];
  teamName: string;
  color: string;
}) {
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
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.playerId} data-dnp={didNotPlay(line) || undefined}>
              <th scope="row">
                <span>{line.name}</span>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
