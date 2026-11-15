import type { Metadata } from "next";

import { PageStub } from "@/components/page-stub";

export const metadata: Metadata = { title: "Model performance · Tip-Off" };

export default function Page() {
  return (
    <PageStub title="Model performance">
      The model&apos;s report card (accuracy against simple baselines, calibration and recent
      calls) will live here, built from predictions stored before each tip-off.
    </PageStub>
  );
}
