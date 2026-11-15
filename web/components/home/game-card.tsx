"use client";

import { tipoffET } from "@/lib/dates";
import type { SlateGame } from "@/lib/slate";
import { readableTeamColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

import { LocalTime } from "./local-time";

function StatusLine({ game }: { game: SlateGame }) {
  if (game.status === "postponed") return <span>Postponed</span>;
  if (game.status === "final" || game.status === "live") {
    return (
      <span className="tabular">
        {game.status === "live" ? <span className="text-bad">Live </span> : "Final "}
        {game.awayScore}–{game.homeScore}
      </span>
    );
  }
  return <LocalTime iso={game.tipoffUtc} fallback={tipoffET(game.tipoffUtc) ?? "Time TBD"} />;
}

export function GameCard({
  game,
  selected,
  showDate,
  onSelect,
}: {
  game: SlateGame;
  selected: boolean;
  showDate?: boolean;
  onSelect: () => void;
}) {
  const away = requireTeam(game.away.teamId);
  const home = requireTeam(game.home.teamId);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${away.city} ${away.name} at ${home.city} ${home.name}`}
      className={`group relative w-full min-w-[9.5rem] snap-start rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        selected
          ? "border-white/40 bg-white/10"
          : "border-white/10 bg-black/40 hover:border-white/25 hover:bg-white/5"
      } backdrop-blur-md`}
    >
      <span className="flex items-baseline gap-1.5 font-display text-lg font-semibold tracking-wide">
        <span style={{ color: readableTeamColor(away) }}>{away.abbr}</span>
        <span className="text-sm text-muted-foreground">@</span>
        <span style={{ color: readableTeamColor(home) }}>{home.abbr}</span>
      </span>
      <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <StatusLine game={game} />
        {showDate && <span>{game.gameDate.slice(5).replace("-", "/")}</span>}
      </span>
      {!game.prediction && game.status === "scheduled" && game.seasonType === "regular" && (
        <span className="mt-1 block text-[11px] text-muted-foreground/80">Prediction pending</span>
      )}
      {game.gameLabel && (
        <span className="mt-1 block truncate text-[11px] text-muted-foreground/80">
          {game.gameLabel}
        </span>
      )}
    </button>
  );
}
