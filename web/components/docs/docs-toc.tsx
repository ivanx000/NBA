"use client";

import { useEffect, useState } from "react";

export interface TocItem {
  id: string;
  text: string;
  depth: 2 | 3;
}

/** "On this page": the page's headings, with the one in view marked as you scroll. */
export function DocsToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const headings = items.map((i) => document.getElementById(i.id)).filter((h): h is HTMLElement => h !== null);
    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [items]);
  if (!items.length) return null;
  return (
    <nav aria-label="On this page" className="docs-toc">
      <p className="docs-sidebar__title">On this page</p>
      <ul>
        {items.map((i) => (
          <li key={i.id} data-depth={i.depth}>
            <a href={`#${i.id}`} aria-current={active === i.id ? "location" : undefined}>
              {i.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
