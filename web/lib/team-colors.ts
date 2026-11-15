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

const HOLO_WHITE = "#EAF2FF";

function hue(hex: string): { h: number; s: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / max; // HSV saturation: near-white counts as grey (HSL would call it saturated)
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s };
}

/** Two holograms are too alike when both are white-ish or their hues are within 40 degrees. */
export function hologramsClash(a: string, b: string): boolean {
  const [x, y] = [hue(a), hue(b)];
  const greyA = x.s < 0.3;
  const greyB = y.s < 0.3;
  if (greyA || greyB) return greyA && greyB;
  const diff = Math.abs(x.h - y.h);
  return Math.min(diff, 360 - diff) < 40;
}

/** Hologram for the away team when nothing else separates the two (both white-ish). */
const HOLO_CYAN = "#6FE3FF";

export interface HologramSide {
  jersey: JerseyColorway;
  color: string;
  /** Lettering color: the jersey's text color as a hologram, or white if that blends in. */
  ink: string;
}

function side(jersey: JerseyColorway, color = hologramColor(jersey)): HologramSide {
  const text = hologramColor({ ...jersey, base: jersey.text });
  return { jersey, color, ink: hologramsClash(text, color) ? "#FFFFFF" : text };
}

/**
 * Jerseys and hologram colors for a matchup. Starts from ``matchupJerseys``; if the two holograms
 * would look alike (navy and royal both glow blue), the away team, then the home team, switches
 * to its alternate; if they still match (black and white uniforms both glow white), the away
 * hologram turns cyan.
 */
export function hologramMatchup(home: Team, away: Team): { home: HologramSide; away: HologramSide } {
  const first = matchupJerseys(home, away);
  const options = [
    first,
    { home: home.jersey.primary, away: away.jersey.alt },
    { home: home.jersey.alt, away: away.jersey.primary },
  ];
  const pick = options.find((o) => !hologramsClash(hologramColor(o.home), hologramColor(o.away)));
  if (pick) {
    return { home: side(pick.home), away: side(pick.away) };
  }
  return { home: side(first.home), away: side(first.away, HOLO_CYAN) };
}

/**
 * Hologram color for a jersey: its base color, brightened and saturated enough to glow on a
 * dark background (a dark green stays green instead of falling back to white). Pass the
 * colorway from ``matchupJerseys`` so clashing matchups use the alternate.
 */
export function hologramColor(jersey: JerseyColorway): string {
  // A black jersey glows in its trim color when the trim is colorful (Heat red, not white).
  const dark = Math.max(...rgb(jersey.base)) < 40;
  const source = dark && hue(jersey.trim).s >= 0.3 ? jersey.trim : jersey.base;
  const [r, g, b] = rgb(source).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l0 = (max + min) / 2;
  const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  if (s0 < 0.15) return HOLO_WHITE; // white, gray or black jerseys: a cool white hologram
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const s = Math.max(s0, 0.75);
  const l = Math.min(Math.max(l0, 0.55), 0.7);
  // HSL -> RGB
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r1)}${hex(g1)}${hex(b1)}`.toUpperCase();
}
