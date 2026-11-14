import { Button } from "@/components/ui/button";
import { teamFullName, teams } from "@/lib/teams";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-24 text-center">
      <p className="text-sm tracking-[0.3em] text-muted-foreground uppercase">
        NBA game forecaster
      </p>
      <h1 className="font-display text-7xl font-bold tracking-tight uppercase sm:text-8xl">
        Tip-Off
      </h1>
      <p className="max-w-md text-lg text-muted-foreground">
        Who wins tonight? Predictions, the reasons behind them, and a shot to prove it. Coming
        soon.
      </p>
      <Button size="lg" disabled className="font-display tracking-wider uppercase">
        Predict who wins
      </Button>
      <ul className="flex max-w-xl flex-wrap justify-center gap-2" aria-label="All 30 teams">
        {teams.map((team) => (
          <li
            key={team.team_id}
            title={teamFullName(team)}
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: team.colors.primary }}
          >
            <span className="sr-only">{teamFullName(team)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
