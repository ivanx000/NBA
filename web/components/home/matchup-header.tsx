import { dayLabel, tipoffET } from "@/lib/dates";
import type { SlateGame } from "@/lib/slate";

/** "Tonight · 7:30 PM ET · NBA Cup" as a small mono line over the players (DESIGN.md section 2). */
export function MatchupHeader({ game, today }: { game: SlateGame; today: string }) {
  const when =
    game.status === "final"
      ? `Final ${game.awayScore}–${game.homeScore}`
      : game.status === "live"
        ? `Live ${game.awayScore}–${game.homeScore}`
        : game.status === "postponed"
          ? "Postponed"
          : `${dayLabel(game.gameDate, today)} · ${tipoffET(game.tipoffUtc) ?? "Time TBD"}`;
  return (
    <p className="eyebrow text-center text-[0.65rem] tabular">
      <span className="sr-only">
        {game.away.city} {game.away.name} at {game.home.city} {game.home.name}.{" "}
      </span>
      {when}
      {game.isNeutral && " · Neutral site"}
      {game.gameLabel && ` · ${game.gameLabel}`}
    </p>
  );
}
