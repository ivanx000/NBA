import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DocsToc } from "@/components/docs/docs-toc";
import { DOC_PAGES, docToc, findDoc } from "@/lib/docs";

export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug ? [p.slug] : [] }));
}

const keyOf = (slug: string[] | undefined) => slug?.join("/") ?? "";

export async function generateMetadata({ params }: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const doc = findDoc(keyOf((await params).slug));
  if (!doc) return { title: "Not found · Tip-Off docs" };
  return { title: doc.slug ? `${doc.title} · Tip-Off docs` : "Docs · Tip-Off", description: doc.description };
}

/**
 * One docs page. The URL is read inside <Suspense> so navigation stays instant (partial
 * prefetching); every page is still prerendered in full from generateStaticParams.
 */
export default function Page({ params }: PageProps<"/docs/[[...slug]]">) {
  return (
    <Suspense fallback={<main id="main" className="docs-shell__main" aria-busy />}>
      {params.then(({ slug }) => (
        <Doc slug={keyOf(slug)} />
      ))}
    </Suspense>
  );
}

/** content/docs/{slug}.mdx, with "On this page" and previous/next links. */
async function Doc({ slug: key }: { slug: string }) {
  const doc = findDoc(key);
  if (!doc) notFound();
  const { default: Content } = await import(`@/content/docs/${key || "index"}.mdx`);
  const toc = await docToc(key);
  const i = DOC_PAGES.findIndex((p) => p.slug === key);
  const prev = DOC_PAGES[i - 1];
  const next = DOC_PAGES[i + 1];
  const href = (slug: string) => (slug ? `/docs/${slug}` : "/docs");
  return (
    <>
      <main id="main" className="docs-shell__main">
        <p className="eyebrow">Docs</p>
        <h1 className="docs-title">{doc.title}</h1>
        <p className="docs-lede">{doc.description}</p>
        <article className="docs-prose">
          <Content />
        </article>
        <nav aria-label="Previous and next" className="docs-pager">
          {prev ? (
            <Link href={href(prev.slug)}>
              <span>Previous</span>
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={href(next.slug)} data-next>
              <span>Next</span>
              {next.title}
            </Link>
          )}
        </nav>
      </main>
      <aside className="docs-shell__toc">
        <DocsToc items={toc} />
      </aside>
    </>
  );
}
