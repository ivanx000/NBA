import { type CSSProperties } from "react";

import { factorCopy } from "@/lib/factor-copy";
import type { SlateGame } from "@/lib/slate";
import { readableTeamColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import "./game.css";

/**
 * The model's top reasons as bars: each in the color of the team it favors, its length the
 * size of the effect (in win-probability points), the team's side marked.
 */
export function FactorBars({ game, limit = 4 }: { game: SlateGame; limit?: number }) {
  const names = { home: game.home.name, away: game.away.name };
  const factors = (game.prediction?.factors ?? []).slice(0, limit).map((f) => factorCopy(f, names));
  if (!factors.length) return null;
  const max = Math.max(...factors.map((f) => f.points), 1);
  return (
    <ul className="factor-bars" aria-label="Why the model thinks so">
      {factors.map((f) => {
        const team = game[f.favors];
        const color = readableTeamColor(requireTeam(team.teamId));
        return (
          <li key={f.text} style={{ "--c": color } as CSSProperties}>
            <span className="factor-bars__text">{f.text}</span>
            <span className="factor-bars__value tabular">
              {team.abbr} +{f.points.toFixed(1)}
            </span>
            <span className="factor-bars__track" aria-hidden>
              <span style={{ width: `${(f.points / max) * 100}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
