"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

import { tipoffET } from "@/lib/dates";
import type { SlateGame } from "@/lib/slate";
import { requireTeam } from "@/lib/teams";

import { LocalTime } from "./local-time";
import "./game-drawer.css";

/** The drawer opens when the pointer comes this close to the left edge (CSS px). */
const EDGE_PX = 110;
/** ...and closes once it's this far right of the open drawer, after a short delay. */
const LEAVE_MARGIN_PX = 60;
const CLOSE_DELAY_MS = 260;

function Status({ game }: { game: SlateGame }) {
  if (game.status === "postponed") return <>Postponed</>;
  if (game.status === "final" || game.status === "live") {
    return (
      <>
        {game.status === "live" ? "Live" : "Final"}{" "}
        <span className="tabular">
          {game.awayScore}–{game.homeScore}
        </span>
      </>
    );
  }
  return <LocalTime iso={game.tipoffUtc} fallback={tipoffET(game.tipoffUtc) ?? "Time TBD"} />;
}

function GameCard({
  game,
  selected,
  disabled,
  onSelect,
}: {
  game: SlateGame;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const away = requireTeam(game.away.teamId);
  const home = requireTeam(game.home.teamId);
  const style = { "--away": away.colors.primary, "--home": home.colors.primary } as CSSProperties;
  return (
    <button
      type="button"
      className="game-card"
      style={style}
      aria-current={selected ? "true" : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="game-card__status">
        <Status game={game} />
        {game.gameLabel && <span className="game-card__label"> · {game.gameLabel}</span>}
      </span>
      <span className="game-card__matchup font-display">
        {game.away.abbr}
        <span className="game-card__at">@</span>
        {game.home.abbr}
      </span>
      <span className="game-card__teams">
        <span className="game-card__dot" style={{ "--c": away.colors.primary } as CSSProperties} aria-hidden />
        {game.away.name}
        <span>at</span>
        <span className="game-card__dot" style={{ "--c": home.colors.primary } as CSSProperties} aria-hidden />
        {game.home.name}
      </span>
    </button>
  );
}

/**
 * Today's games as flat hologram cards in a drawer on the left. On a mouse it slides out when
 * the pointer nears the left edge and tucks away when it leaves; on touch, a tab on the edge
 * opens it. Keyboard focus opens it too.
 */
export function GameDrawer({
  games,
  heading,
  selectedId,
  onSelect,
  disabled,
}: {
  games: SlateGame[];
  heading: string;
  selectedId: string | null;
  onSelect: (gameId: string) => void;
  disabled: boolean;
}) {
  const [openState, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  // Hover-to-reveal, only for a real mouse (touch has no hover; it uses the tab).
  useEffect(() => {
    const mouse = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!mouse.matches || disabled) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const width = panel.current?.offsetWidth ?? 0;
      if (e.clientX <= EDGE_PX) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
        setOpen(true);
      } else if (e.clientX > width + LEAVE_MARGIN_PX && closeTimer.current === undefined) {
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = undefined;
          // Keep it open while a card has keyboard focus (a mouse click focuses without the ring).
          if (!panel.current?.querySelector(":focus-visible")) setOpen(false);
        }, CLOSE_DELAY_MS);
      } else if (e.clientX <= width + LEAVE_MARGIN_PX) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
      }
    };
    const onLeave = () => setOpen(false);
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    };
  }, [disabled]);

  // Closed while the cinematic plays; Escape closes it.
  const open = openState && !disabled;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Bring the selected card into view when the drawer opens.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView({ block: "nearest" });
  }, [open]);

  return (
    <>
      {open && (
        // Touch: tapping outside the drawer closes it.
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="game-drawer__scrim"
          onClick={() => setOpen(false)}
        />
      )}
      <button
        type="button"
        className="game-drawer__tab"
        aria-expanded={open}
        aria-controls="game-drawer"
        data-open={open || undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label={`${heading}: ${games.length}`}
      >
        {/* One small tick per game in its two teams' colors; tonight's pick is longer and lit. */}
        <span className="game-drawer__ticks" aria-hidden>
          {games.map((g) => (
            <span
              key={g.gameId}
              className="game-drawer__tick"
              data-current={g.gameId === selectedId || undefined}
              style={
                {
                  "--away": requireTeam(g.away.teamId).colors.primary,
                  "--home": requireTeam(g.home.teamId).colors.primary,
                } as CSSProperties
              }
            />
          ))}
        </span>
        <span className="game-drawer__count" aria-hidden>
          {games.length} games
        </span>
      </button>
      <div
        ref={panel}
        id="game-drawer"
        className="game-drawer"
        data-open={open || undefined}
        onFocus={() => setOpen(true)}
        role="region"
        aria-label={heading}
      >
        <p className="eyebrow game-drawer__heading">{heading}</p>
        <ul className="game-drawer__list">
          {games.map((g) => (
            <li key={g.gameId}>
              <GameCard
                game={g}
                selected={g.gameId === selectedId}
                disabled={disabled}
                onSelect={() => {
                  onSelect(g.gameId);
                  // On touch the drawer covers the players: get out of the way.
                  if (!window.matchMedia("(hover: hover)").matches) setOpen(false);
                }}
              />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
