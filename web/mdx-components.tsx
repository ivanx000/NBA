import type { MDXComponents } from "mdx/types";
import Link from "next/link";

import { Diagram } from "@/components/docs/diagram";

/**
 * Components for every MDX page (required by @next/mdx). Typography comes from `.docs-prose`
 * (components/docs/docs.css); this maps internal links to <Link> and adds <Diagram>.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    a: ({ href = "", children, ...props }) =>
      href.startsWith("/") ? (
        <Link href={href} {...props}>
          {children}
        </Link>
      ) : (
        <a href={href} target="_blank" rel="noreferrer" {...props}>
          {children}
        </a>
      ),
    Diagram,
    ...components,
  };
}
