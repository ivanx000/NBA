import { Suspense } from "react";

import { DocsSidebar, DocsSidebarFallback } from "@/components/docs/docs-sidebar";
import { DOC_SECTIONS } from "@/lib/docs";
import "@/components/docs/docs.css";

/** Docs layout: sections on the left, the page, and (from the page) "On this page" on the right. */
export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  const sections = DOC_SECTIONS.map((s) => ({ title: s.title, pages: s.pages.map(({ slug, title }) => ({ slug, title })) }));
  return (
    <div className="docs-shell">
      <aside className="docs-shell__nav">
        {/* The sidebar reads the URL to mark the current page. */}
        <Suspense fallback={<DocsSidebarFallback sections={sections} />}>
          <DocsSidebar sections={sections} />
        </Suspense>
      </aside>
      {children}
    </div>
  );
}
