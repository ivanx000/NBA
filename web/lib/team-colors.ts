import type { JerseyColorway, Team } from "@/lib/teams";

const BG = "#0A0A0C";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A team color that reads on the dark background (DESIGN.md section 1): primary, else
 * secondary, else tertiary, else white. 3:1 is the bar for large display text. */
export function readableTeamColor(team: Team, minContrast = 3): string {
  const candidates = [team.colors.primary, team.colors.secondary, team.colors.tertiary];
  return candidates.find((c) => c && contrast(c, BG) >= minContrast) ?? "#F5F5F7";
}

function distance(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Jerseys for a matchup. If the primaries clash, the away team wears its alternate (PRD 5). */
export function matchupJerseys(home: Team, away: Team): { home: JerseyColorway; away: JerseyColorway } {
  const clash = distance(home.jersey.primary.base, away.jersey.primary.base) < 90;
  return { home: home.jersey.primary, away: clash ? away.jersey.alt : away.jersey.primary };
}

/** Light color for a team's spotlight: its brightest brand color. */
export function spotlightColor(team: Team): string {
  const candidates = [team.colors.primary, team.colors.secondary, team.colors.tertiary].filter(
    (c): c is NonNullable<typeof c> => Boolean(c),
  );
  return candidates.sort((a, b) => luminance(b) - luminance(a))[0] ?? "#FFFFFF";
}
