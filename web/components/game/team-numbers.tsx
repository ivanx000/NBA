import type { TeamStats } from "@/lib/team-stats";

import "./game.css";

const wl = (r: { wins: number; losses: number }) => `${r.wins}-${r.losses}`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;

export function restLabel(days: number | null) {
  if (days === null) return "Season opener";
  if (days === 0) return "Back-to-back";
  return `${days} day${days === 1 ? "" : "s"} off`;
}

/** A team's season numbers before a game, as a grid of small tiles. */
export function TeamNumbers({ stats }: { stats: TeamStats }) {
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
    <dl className="team-numbers">
      {rows.map(([label, value]) => (
        <div key={label} className="team-numbers__tile">
          <dt>{label}</dt>
          <dd className="tabular">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
