import Link from "next/link";
import type { ReactNode } from "react";

/** A full-page message (not found, failed to load): a mono label, a big title, a line, actions. */
export function StatusPage({
  label,
  title,
  children,
  actions,
}: {
  /** Small mono label over the title, e.g. "404". */
  label: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <main id="main" className="mx-auto grid w-full max-w-3xl flex-1 content-center px-4 pt-32 pb-24 sm:px-6">
      <p className="eyebrow">{label}</p>
      <h1 className="mt-3 font-display text-5xl leading-[0.95] font-extrabold uppercase sm:text-7xl">{title}</h1>
      <span aria-hidden className="mt-5 block h-[3px] w-20 rounded-full bg-blue-hi shadow-[0_0_16px_var(--blue-hi)]" />
      <div className="mt-6 max-w-prose text-lg text-muted-foreground">{children}</div>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">{actions}</div>
    </main>
  );
}

/** The primary action on a status page (a red pill, like the site's other main buttons). */
export function StatusAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-full bg-nba-red px-5 py-3 font-bold text-white shadow-[0_0_24px_rgba(200,16,46,0.45)] transition-colors hover:bg-[#e0193a] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-blue-hi"
    >
      {children}
    </Link>
  );
}

/** A secondary link on a status page. */
export function StatusLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-blue-hi underline decoration-blue-hi/40 underline-offset-4 hover:decoration-blue-hi focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-blue-hi"
    >
      {children}
    </Link>
  );
}
