import { dayLabel, tipoffET } from "@/lib/dates";
import type { SlateGame } from "@/lib/slate";

/** "BOS @ NYK · Tonight 7:30 PM ET" (DESIGN.md section 2). */
export function MatchupHeader({ game, today }: { game: SlateGame; today: string }) {
  const when =
    game.status === "final"
      ? `Final ${game.awayScore}–${game.homeScore}`
      : game.status === "live"
        ? `Live ${game.awayScore}–${game.homeScore}`
        : game.status === "postponed"
          ? "Postponed"
          : `${dayLabel(game.gameDate, today)} ${tipoffET(game.tipoffUtc) ?? ""}`.trim();
  return (
    <p className="text-center text-sm text-muted-foreground tabular sm:text-base">
      <span className="text-foreground">
        {game.away.abbr} @ {game.home.abbr}
      </span>
      {" · "}
      {when}
      {game.isNeutral && " · Neutral site"}
      {game.gameLabel && ` · ${game.gameLabel}`}
    </p>
  );
}
