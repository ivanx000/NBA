"use client";

import { type Side, useScene } from "@/lib/scene-store";
import type { SlateTeam } from "@/lib/slate";
import { readableTeamColor } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

/**
 * A team's name over its player: city and record, the nickname, a bar in the team color. It is
 * also a button that picks the team (for keyboards and touch; clicking the player does the same),
 * and hovering or focusing it highlights the player.
 */
export function TeamLabel({
  team,
  side,
  neutral,
  onPick,
}: {
  team: SlateTeam;
  side: Side;
  neutral: boolean;
  /** Undefined when picking isn't possible (no prediction yet, postponed). */
  onPick?: (side: Side) => void;
}) {
  const t = requireTeam(team.teamId);
  const color = readableTeamColor(t);
  const setHover = useScene((s) => s.setHover);
  const hovered = useScene((s) => s.hover === side);
  // The button's accessible name is its visible text wrapped in "Pick the … to win" (WCAG 2.5.3:
  // the spoken name contains the words a voice-control user sees).
  const content = (
    <>
      {onPick && <span className="sr-only">Pick the </span>}
      <span className="block font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase tabular sm:text-[10px]">
        {team.city}
        <span className="hidden sm:inline">
          {" · "}
          {team.wins}-{team.losses}
          {!neutral && ` · ${side === "home" ? "Home" : "Away"}`}
        </span>
      </span>
      <span className="mt-1 block font-display text-xl leading-none font-extrabold uppercase [font-stretch:125%] sm:text-2xl lg:text-3xl">
        {team.name}
      </span>
      <span
        aria-hidden
        className="mx-auto mt-1.5 block h-[2px] rounded-full transition-all duration-300"
        style={{ background: color, boxShadow: `0 0 12px ${color}`, width: hovered ? "4rem" : "2.5rem" }}
      />
      <span className="mt-1 block font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase tabular sm:hidden">
        {team.wins}-{team.losses}
        {!neutral && ` · ${side === "home" ? "Home" : "Away"}`}
      </span>
      {onPick && <span className="sr-only"> to win</span>}
    </>
  );
  if (!onPick) return <div className="text-center">{content}</div>;
  return (
    <button
      type="button"
      data-pick-side={side}
      className="pointer-events-auto mx-auto rounded-lg px-3 py-1 text-center transition-transform duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-hi"
      onClick={() => onPick(side)}
      onPointerEnter={() => setHover(side)}
      onPointerLeave={() => setHover(null)}
      onFocus={() => setHover(side)}
      onBlur={() => setHover(null)}
    >
      {content}
    </button>
  );
}
