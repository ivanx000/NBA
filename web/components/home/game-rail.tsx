"use client";

import type { Slate, SlateGame } from "@/lib/slate";

import { DateSwitcher } from "./date-switcher";
import { GameCard } from "./game-card";

function CardList({ games, selectedId, showDate, onSelect }: {
  games: SlateGame[];
  selectedId: string | null;
  showDate?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex snap-x gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
      {games.map((g) => (
        <li key={g.gameId} className="shrink-0 lg:shrink">
          <GameCard game={g} selected={g.gameId === selectedId} showDate={showDate}
                    onSelect={() => onSelect(g.gameId)} />
        </li>
      ))}
    </ul>
  );
}

export function GameRail({
  slate,
  selectedId,
  onSelect,
  onDateChange,
}: {
  slate: Slate;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDateChange: (day: string) => void;
}) {
  const offDay = slate.games.length === 0;
  return (
    <aside
      aria-label="Games"
      className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/45 p-3 backdrop-blur-md lg:max-h-full lg:overflow-y-auto"
    >
      <DateSwitcher date={slate.date} today={slate.today} onChange={onDateChange} />
      {offDay ? (
        <>
          <p className="text-sm text-muted-foreground">
            No games {slate.date === slate.today ? "today" : "on this day"}.
          </p>
          {slate.upcoming.length > 0 && (
            <section aria-label="Upcoming games" className="flex flex-col gap-2">
              <h2 className="text-xs text-muted-foreground">Upcoming</h2>
              <CardList games={slate.upcoming} selectedId={selectedId} showDate onSelect={onSelect} />
            </section>
          )}
          {slate.recent.length > 0 && (
            <section aria-label="Recent games" className="flex flex-col gap-2">
              <h2 className="text-xs text-muted-foreground">Recent</h2>
              <CardList games={slate.recent} selectedId={selectedId} showDate onSelect={onSelect} />
            </section>
          )}
        </>
      ) : (
        <CardList games={slate.games} selectedId={selectedId} onSelect={onSelect} />
      )}
    </aside>
  );
}
