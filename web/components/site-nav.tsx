"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Predict" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/performance", label: "Model performance" },
  { href: "/docs", label: "Docs" },
];
const GITHUB_URL = "https://github.com/ivanx000/NBA";

export function SiteNav() {
  const pathname = usePathname();
  return <NavBar pathname={pathname} />;
}

/** Rendered while the pathname streams in on dynamic routes (no active link yet). */
export function SiteNavFallback() {
  return <NavBar pathname={null} />;
}

function NavBar({ pathname }: { pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const isActive = (href: string) =>
    pathname !== null && (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    // Other pages scroll under the nav, so it gets a dark glass backing there; the home page doesn't scroll.
    <header
      className={`fixed inset-x-0 top-0 z-40 ${pathname !== null && pathname !== "/" ? "bg-background/75 backdrop-blur-md" : ""}`}
    >
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4 sm:px-6"
      >
        {/* No wordmark on the home page (or while the path streams in): the room is the brand. */}
        {pathname !== null && pathname !== "/" ? (
          <Link href="/" className="group flex items-center gap-2 font-display text-lg font-extrabold uppercase">
            {/* The site's mark (app/icon.svg); it spins up like a ball on hover. */}
            <Image
              src="/icon.svg"
              alt=""
              width={22}
              height={22}
              unoptimized
              className="transition-transform duration-500 ease-out group-hover:-translate-y-0.5 group-hover:rotate-[200deg]"
            />
            Tip-Off
          </Link>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="rounded-md px-3 py-1.5 font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase hover:text-foreground md:hidden"
          aria-expanded={open}
          aria-controls="site-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>
        <ul
          id="site-menu"
          className={`${open ? "flex" : "hidden"} absolute inset-x-0 top-14 flex-col gap-1 border-b border-border bg-background/95 p-4 backdrop-blur md:static md:flex md:flex-row md:items-center md:gap-6 md:border-0 md:bg-transparent md:p-0`}
        >
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={`ink-link block py-1.5 font-mono text-xs tracking-[0.08em] uppercase transition-colors hover:text-foreground ${
                  isActive(l.href) ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {l.label}
              </Link>
            </li>
          ))}
          <li>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="ink-link block py-1.5 font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase transition-colors hover:text-foreground"
            >
              GitHub
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
