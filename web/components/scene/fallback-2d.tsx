import type { Side, SlateGame } from "@/lib/slate";
import { matchupJerseys } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

/** 2D stand-in for the arena: two team-colored panels with the jersey number. */
export function Fallback2D({ game, winner }: { game: SlateGame; winner: Side | null }) {
  const home = requireTeam(game.home.teamId);
  const away = requireTeam(game.away.teamId);
  const jerseys = matchupJerseys(home, away);
  const panel = (side: Side) => {
    const team = side === "home" ? home : away;
    const jersey = jerseys[side];
    const dim = winner !== null && winner !== side;
    return (
      <div
        className={`flex flex-1 items-center justify-center transition-opacity duration-300 ${dim ? "opacity-25" : "opacity-60"}`}
        style={{ background: `radial-gradient(circle at 50% 45%, ${jersey.base}, transparent 70%)` }}
      >
        <span
          className="font-display text-[22vmin] leading-none font-bold"
          style={{ color: jersey.text, WebkitTextStroke: `2px ${jersey.trim}` }}
        >
          {team.jersey.number}
        </span>
      </div>
    );
  };
  return (
    <div className="flex h-full bg-background lg:pr-[330px]" aria-hidden>
      {panel("away")}
      {panel("home")}
    </div>
  );
}
