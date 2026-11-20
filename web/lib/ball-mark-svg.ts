import { BALL_SEAMS } from "@/components/ball-mark";

/** The basketball mark as a standalone SVG data URI, for places without React SVG (next/og). */
export function ballDataUri(color: string): string {
  const seams = BALL_SEAMS.map((d) => `<path d="${d}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><mask id="m"><rect width="64" height="64" fill="#fff"/><g fill="none" stroke="#000" stroke-width="3.6">${seams}</g></mask><circle cx="32" cy="32" r="30" fill="${color}" mask="url(#m)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
