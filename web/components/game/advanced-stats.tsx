import { type CSSProperties } from "react";

import { ordinal, showStat, TEAM_STATS, type TeamAdvanced } from "@/lib/advanced-stats";
import type { GameAdvanced } from "@/lib/slate";

import "./advanced.css";

/** The headline numbers for one team, each with its league rank. */
const TILE_KEYS = ["offRating", "defRating", "netRating", "pace", "ts", "efg", "tovPct", "orebPct", "ftRate"] as const;

/** Rank tiers for color: top third, middle, bottom third. */
function tier(rank: number, of: number): "top" | "mid" | "low" {
  if (rank <= Math.ceil(of / 3)) return "top";
  if (rank > of - Math.ceil(of / 3)) return "low";
  return "mid";
}

/**
 * One team's season numbers as open tiles: ratings, pace and its own Four Factors, each with its
 * league rank (pointing at one explains it).
 */
export function TeamAdvancedTiles({ stats }: { stats: TeamAdvanced }) {
  return (
    <dl className="adv-tiles">
      {TILE_KEYS.map((key) => {
        const def = TEAM_STATS.find((s) => s.key === key)!;
        const rank = stats.ranks[key];
        return (
          <div key={key} className="adv-tiles__tile" title={`${def.label}: ${def.note}`}>
            <dt>{def.short}</dt>
            <dd className="tabular">
              {showStat(key, stats.values[key], def.kind)}
              {/* Pace has no better or worse, so its rank isn't colored. */}
              <span className="adv-tiles__rank" data-tier={key === "pace" ? "mid" : tier(rank, stats.of)}>
                {ordinal(rank)}
              </span>
            </dd>
            <span className="sr-only">{`${ordinal(rank)} of ${stats.of}. ${def.note}.`}</span>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Both teams side by side on every stat: the better number bold in its team's color, and a bar
 * from the middle toward the team that ranks higher, as long as the gap in ranks.
 */
export function AdvancedMatchup({
  advanced,
  away,
  home,
}: {
  advanced: GameAdvanced;
  away: { abbr: string; color: string };
  home: { abbr: string; color: string };
}) {
  const a = advanced.teams.away;
  const h = advanced.teams.home;
  if (!a || !h) return <p className="adv-empty">Not enough games yet this season.</p>;
  const of = Math.max(a.of, h.of);
  return (
    <div className="adv-matchup" style={{ "--away": away.color, "--home": home.color } as CSSProperties}>
      <div className="adv-matchup__head" aria-hidden>
        <span>{away.abbr}</span>
        <span>{home.abbr}</span>
      </div>
      <ul>
        {TEAM_STATS.map((def) => {
          const ra = a.ranks[def.key];
          const rh = h.ranks[def.key];
          const neutral = def.key === "pace";
          const edge = neutral || ra === rh ? null : ra < rh ? "away" : "home";
          const gap = neutral ? 0 : Math.abs(ra - rh) / (of - 1 || 1);
          const value = (t: TeamAdvanced) => showStat(def.key, t.values[def.key], def.kind);
          return (
            <li key={def.key} title={def.note} data-edge={edge ?? undefined}>
              <span className="adv-matchup__value tabular" data-side="away">
                {value(a)} <small>{ordinal(ra)}</small>
              </span>
              <span className="adv-matchup__label">
                {def.label}
                <span className="adv-matchup__bar" aria-hidden>
                  {edge && <span data-side={edge} style={{ "--w": `${Math.max(gap, 0.04) * 50}%` } as CSSProperties} />}
                </span>
              </span>
              <span className="adv-matchup__value tabular" data-side="home">
                <small>{ordinal(rh)}</small> {value(h)}
              </span>
              <span className="sr-only">
                {`${def.label}: ${away.abbr} ${value(a)}, ${ordinal(ra)}; ${home.abbr} ${value(h)}, ${ordinal(rh)}.`}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="adv-note">
        Season to date, before this game. Ranks out of {of}; pace (possessions per 48 minutes) has no better side.
      </p>
    </div>
  );
}
