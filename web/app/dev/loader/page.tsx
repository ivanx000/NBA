import { notFound } from "next/navigation";

import { ArenaLoader } from "@/components/arena-loader";

/** Dev-only: the loading screen, held still on screen to look at. */
export default function LoaderPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="h-svh">
      <ArenaLoader label="Loading tonight's games" />
    </main>
  );
}
