import type { SlateTeam } from "@/lib/slate";
import { readableTeamColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

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
  return (
    <div className={`text-center transition-opacity duration-300 ${dimmed ? "opacity-30" : ""}`}>
      <p className="text-xs text-muted-foreground sm:text-sm">{team.city}</p>
      <p
        className="font-display text-3xl leading-none font-bold tracking-wide uppercase sm:text-5xl"
        style={{ color: readableTeamColor(t) }}
      >
        {team.name}
      </p>
      <p className="mt-1 text-xs text-muted-foreground tabular sm:text-sm">
        {team.wins}-{team.losses}
        {!neutral && ` · ${side === "home" ? "Home" : "Away"}`}
      </p>
    </div>
  );
}
