import { notFound } from "next/navigation";

import { JerseyLab } from "./jersey-lab";

/** Dev-only: check team jerseys and animation clips on the rigged player. */
export default function JerseyLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <JerseyLab />;
}
