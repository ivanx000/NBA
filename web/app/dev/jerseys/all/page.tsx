import { notFound } from "next/navigation";

import { AllJerseys } from "./all-jerseys";

/** Dev-only: every team's jersey on the hologram player at once (`?alt=1` for alternates). */
export default function AllJerseysPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AllJerseys />;
}
