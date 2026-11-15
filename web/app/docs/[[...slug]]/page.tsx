import type { Metadata } from "next";

import { PageStub } from "@/components/page-stub";

export const metadata: Metadata = { title: "Docs · Tip-Off" };

export function generateStaticParams() {
  return [{ slug: [] }];
}

export default function Page() {
  return (
    <PageStub title="Docs">
      Technical docs on the data pipeline, leakage prevention, models and evaluation are being
      written.
    </PageStub>
  );
}
