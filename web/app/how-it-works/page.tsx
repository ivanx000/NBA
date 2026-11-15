import type { Metadata } from "next";

import { PageStub } from "@/components/page-stub";

export const metadata: Metadata = { title: "How it works · Tip-Off" };

export default function Page() {
  return (
    <PageStub title="How it works">
      A short, visual walk from box scores to a prediction is on the way. For now, the docs
      describe the data, features and model.
    </PageStub>
  );
}
