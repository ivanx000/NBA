import type { SlateTeam } from "@/lib/slate";
import { readableTeamColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

/** A team's name over its player: city and record, the nickname wide and heavy, a bar in the team color. */
export function TeamLabel({
  team,
  side,
  neutral,
  dimmed,
}: {
  team: SlateTeam;
  side: "home" | "away";
  neutral: boolean;
  dimmed?: boolean;
}) {
  const t = requireTeam(team.teamId);
  const color = readableTeamColor(t);
  return (
    <div className={`text-center transition-opacity duration-300 ${dimmed ? "opacity-30" : ""}`}>
      <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase tabular sm:text-xs">
        {team.city}
        <span className="hidden sm:inline">
          {" · "}
          {team.wins}-{team.losses}
          {!neutral && ` · ${side === "home" ? "Home" : "Away"}`}
        </span>
      </p>
      <p className="mt-1 font-display text-2xl leading-none font-extrabold uppercase [font-stretch:125%] sm:text-4xl lg:text-5xl">
        {team.name}
      </p>
      <span
        aria-hidden
        className="mx-auto mt-2 block h-[3px] w-12 rounded-full sm:w-16"
        style={{ background: color, boxShadow: `0 0 14px ${color}` }}
      />
      <p className="mt-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase tabular sm:hidden">
        {team.wins}-{team.losses}
        {!neutral && ` · ${side === "home" ? "Home" : "Away"}`}
      </p>
    </div>
  );
}
