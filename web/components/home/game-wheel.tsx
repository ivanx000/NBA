"use client";

import { type CSSProperties, useEffect, useRef } from "react";

import { dayLabel, tipoffET } from "@/lib/dates";
import type { SlateGame } from "@/lib/slate";
import { requireTeam } from "@/lib/teams";

import { LocalTime } from "./local-time";
import "./game-wheel.css";

/** Degrees between neighboring cards on the drum. */
const STEP = 24;
/** Cards further than this many steps from the front are hidden. */
const VISIBLE = 3;
/** Wheel-event distance that turns the drum by one card (mouse wheels send ~100). */
const SCROLL_PER_CARD = 70;

/** "Final" for today's games, otherwise the day ("Yesterday", "Thu, Nov 13"). */
function finalLabel(day: string, today: string): string {
  const label = dayLabel(day, today);
  return label === "Tonight" ? "Final" : label;
}

function StatusLine({ game, today }: { game: SlateGame; today: string }) {
  if (game.status === "postponed") return <>Postponed</>;
  if (game.status === "final" || game.status === "live") {
    return (
      <>
        {game.status === "live" ? "Live" : finalLabel(game.gameDate, today)}{" "}
        <span className="tabular">
          {game.awayScore}–{game.homeScore}
        </span>
      </>
    );
  }
  const day = dayLabel(game.gameDate, today);
  return (
    <>
      {day === "Tonight" ? "" : `${day} `}
      <LocalTime iso={game.tipoffUtc} fallback={tipoffET(game.tipoffUtc) ?? "Time TBD"} />
    </>
  );
}

/** One arcade panel: the two teams' colors, the matchup in big outlined letters. */
function WheelCard({ game, today }: { game: SlateGame; today: string }) {
  const away = requireTeam(game.away.teamId);
  const home = requireTeam(game.home.teamId);
  const style = {
    "--away": away.colors.primary,
    "--home": home.colors.primary,
  } as CSSProperties;
  return (
    <span className="wheel-card" style={style}>
      <span className="wheel-card__matchup font-display">
        <span>{away.abbr}</span>
        <span className="wheel-card__at">@</span>
        <span>{home.abbr}</span>
      </span>
      <span className="wheel-card__status">
        <StatusLine game={game} today={today} />
      </span>
    </span>
  );
}

/**
 * The game picker: an arcade prize wheel facing the viewer. Games run oldest at the top to
 * today's last game at the bottom; the front card is the selected game. Scrolling down (or
 * pressing Up) turns the drum so the card above comes to the front (older games); scrolling up
 * (or Down) brings newer games.
 */
export function GameWheel({
  games,
  today,
  selectedId,
  onSelect,
  reducedMotion,
  disabled,
}: {
  games: SlateGame[];
  today: string;
  selectedId: string | null;
  onSelect: (gameId: string) => void;
  reducedMotion: boolean;
  disabled?: boolean;
}) {
  const front = Math.max(0, games.findIndex((g) => g.gameId === selectedId));
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ games, onSelect, disabled });
  // Where the wheel is heading: moves immediately on input so a fast flick turns several cards
  // before React re-renders; resyncs whenever the selection changes from outside.
  const cursor = useRef(front);
  useEffect(() => {
    latest.current = { games, onSelect, disabled };
  });
  useEffect(() => {
    cursor.current = front;
  }, [front]);

  // Wheel and touch input need non-passive listeners so the page doesn't scroll instead.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let pending = 0;
    let touchY: number | null = null;
    const turn = (steps: number) => {
      const { games: g, onSelect: select, disabled: off } = latest.current;
      if (off || !g.length) return;
      const next = Math.min(g.length - 1, Math.max(0, cursor.current + steps));
      if (next === cursor.current) return;
      cursor.current = next;
      select(g[next].gameId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      pending += e.deltaY;
      while (Math.abs(pending) >= SCROLL_PER_CARD) {
        // Scrolling down shows older games (the card above comes to the front).
        turn(pending > 0 ? -1 : 1);
        pending -= Math.sign(pending) * SCROLL_PER_CARD;
      }
    };
    const onTouchStart = (e: TouchEvent) => (touchY = e.touches[0].clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (touchY === null) return;
      e.preventDefault();
      const dy = e.touches[0].clientY - touchY;
      if (Math.abs(dy) >= 48) {
        // Dragging down pulls the card above to the front, like spinning the drum by hand.
        turn(dy > 0 ? -1 : 1);
        touchY = e.touches[0].clientY;
      }
    };
    const onTouchEnd = () => (touchY = null);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const to = (i: number) => {
      e.preventDefault();
      const next = Math.min(games.length - 1, Math.max(0, i));
      if (next !== front) onSelect(games[next].gameId);
    };
    if (e.key === "ArrowUp") to(front - 1);
    else if (e.key === "ArrowDown") to(front + 1);
    else if (e.key === "Home") to(0);
    else if (e.key === "End") to(games.length - 1);
  };

  const selected = games[front];
  return (
    <div
      ref={root}
      role="listbox"
      tabIndex={0}
      aria-label="Games. Use the arrow keys or scroll to turn the wheel."
      aria-activedescendant={selected ? `wheel-${selected.gameId}` : undefined}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={`game-wheel ${reducedMotion ? "game-wheel--still" : ""}`}
    >
      <div className="game-wheel__drum" style={{ "--turn": `${front * STEP}deg` } as CSSProperties}>
        {games.map((game, i) => {
          const offset = i - front;
          const hidden = Math.abs(offset) > VISIBLE;
          const away = requireTeam(game.away.teamId);
          const home = requireTeam(game.home.teamId);
          return (
            <button
              key={game.gameId}
              id={`wheel-${game.gameId}`}
              type="button"
              role="option"
              aria-selected={offset === 0}
              aria-label={`${away.city} ${away.name} at ${home.city} ${home.name}, ${dayLabel(game.gameDate, today)}`}
              tabIndex={-1}
              disabled={disabled}
              aria-hidden={hidden || undefined}
              onClick={() => offset !== 0 && onSelect(game.gameId)}
              className="game-wheel__slot"
              data-distance={Math.min(Math.abs(offset), VISIBLE + 1)}
              style={
                {
                  "--angle": `${-i * STEP}deg`,
                  "--fade": hidden ? 0 : 1 - Math.abs(offset) * 0.24,
                  "--dim": offset === 0 ? 1 : 0.55,
                } as CSSProperties
              }
            >
              <WheelCard game={game} today={today} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
