import type { Metadata } from "next";

import { StatusAction, StatusLink, StatusPage } from "@/components/status-page";

export const metadata: Metadata = { title: "Page not found · Tip-Off" };

/** Unknown URLs, and pages that call notFound() without their own not-found file. */
export default function NotFound() {
  return (
    <StatusPage
      label="404"
      title="No such page"
      actions={
        <>
          <StatusAction href="/">Pick tonight&apos;s winner</StatusAction>
          <StatusLink href="/performance">Model performance</StatusLink>
          <StatusLink href="/docs">Docs</StatusLink>
        </>
      }
    >
      <p>The link may be old or mistyped. Tonight&apos;s games are on the home page.</p>
    </StatusPage>
  );
}
