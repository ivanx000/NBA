import type { Metadata } from "next";

/** Development tools (jersey lab): never indexed. robots.txt also disallows /dev/. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DevLayout({ children }: LayoutProps<"/dev">) {
  return children;
}
