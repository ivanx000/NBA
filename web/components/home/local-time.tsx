"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Tip-off time in the viewer's own time zone (PRD 3.1). Renders ET on the server. */
export function LocalTime({ iso, fallback }: { iso: string | null; fallback: string }) {
  const local = useSyncExternalStore(
    noop,
    () =>
      iso
        ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
            new Date(iso),
          )
        : fallback,
    () => fallback,
  );
  return <time dateTime={iso ?? undefined}>{local}</time>;
}
