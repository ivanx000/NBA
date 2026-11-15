/** Dates are ET schedule days ("YYYY-MM-DD"); the NBA's day boundary is America/New_York. */

export const ET = "America/New_York";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function todayET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A valid schedule day from a URL parameter, or null. */
export function parseDay(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return null;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return value >= "2015-10-01" && value <= "2035-12-31" ? value : null;
}

/** NBA season containing a schedule day, e.g. 2026-11-14 -> "2026-27". */
export function seasonFor(day: string): string {
  const y = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "Tonight", "Tomorrow", "Yesterday" or "Sat, Nov 15" relative to today (ET). */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Tonight";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** "7:30 PM ET" */
export function tipoffET(isoUtc: string | null): string | null {
  if (!isoUtc) return null;
  const t = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ET,
  }).format(new Date(isoUtc));
  return `${t} ET`;
}
