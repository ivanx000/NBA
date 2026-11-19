"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface SidebarSection {
  title: string;
  pages: { slug: string; title: string }[];
}

function SidebarList({ sections, pathname }: { sections: SidebarSection[]; pathname: string | null }) {
  return (
    <nav aria-label="Docs" className="docs-sidebar">
      {sections.map((s) => (
        <div key={s.title} className="docs-sidebar__section">
          <p className="docs-sidebar__title">{s.title}</p>
          <ul>
            {s.pages.map((p) => {
              const href = p.slug ? `/docs/${p.slug}` : "/docs";
              const current = pathname === href;
              return (
                <li key={href}>
                  <Link href={href} aria-current={current ? "page" : undefined}>
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The docs sections and pages; the current page is marked. */
export function DocsSidebar({ sections }: { sections: SidebarSection[] }) {
  return <SidebarList sections={sections} pathname={usePathname()} />;
}

/**
 * Shown while the URL streams in: the same list, nothing marked. (A separate export: properties
 * on a client component don't cross into the server layout.)
 */
export function DocsSidebarFallback({ sections }: { sections: SidebarSection[] }) {
  return <SidebarList sections={sections} pathname={null} />;
}
