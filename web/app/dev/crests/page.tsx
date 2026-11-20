import { notFound } from "next/navigation";

import { CrestSheet } from "./crest-sheet";

/** Dev-only: every team's center-court crest on one page. */
export default function CrestsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CrestSheet />;
}
