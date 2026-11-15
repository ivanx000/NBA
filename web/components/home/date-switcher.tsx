"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { addDays, dayLabel } from "@/lib/dates";

export function DateSwitcher({
  date,
  today,
  onChange,
}: {
  date: string;
  today: string;
  onChange: (day: string) => void;
}) {
  const label = dayLabel(date, today) === "Tonight" ? "Today" : dayLabel(date, today);
  const arrow =
    "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={arrow} onClick={() => onChange(addDays(date, -1))}
              aria-label="Previous day">
        <ChevronLeft className="size-4" />
      </button>
      <label className="relative flex-1 text-center">
        <span className="font-display text-base font-semibold tracking-wide uppercase">{label}</span>
        <input
          type="date"
          value={date}
          min="2025-10-01"
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="Choose a date"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <button type="button" className={arrow} onClick={() => onChange(addDays(date, 1))}
              aria-label="Next day">
        <ChevronRight className="size-4" />
      </button>
      {date !== today && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="ml-1 rounded-md px-2 py-1 text-xs text-brand-accent hover:bg-white/10"
        >
          Today
        </button>
      )}
    </div>
  );
}
