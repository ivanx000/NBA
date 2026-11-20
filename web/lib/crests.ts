/**
 * Center-court crests: one for each team, painted at center court when it's the home team
 * (components/scene/court.tsx draws them with components/scene/crest-art.ts).
 *
 * These are the site's own designs, never a team's logo (CLAUDE.md: no official logos or wordmark
 * artwork). Each is made from the team's colors, its city and nickname in the site's own type,
 * and a simple, generic symbol suggested by the nickname or the city (a feather for the Hawks, a
 * honeycomb for the Hornets, a lone star for San Antonio). No symbol traces a team's actual mark:
 * where the obvious one is the team's logo (a bull's head, a bridge, a crown), a different one is
 * used. Every team gets its own shape, layout and symbol, so no two courts look alike.
 */

export type CrestShape = "circle" | "roundel" | "shield" | "diamond" | "hexagon" | "octagon" | "square" | "badge";

/**
 * - stacked: the symbol on top, the nickname across the middle, the city underneath;
 * - ring: the city along the top edge, the nickname slanted across the middle, the symbol large and faint behind;
 * - banner: the symbol on top, the nickname on a ribbon across the middle, the city underneath;
 * - monogram: the team's three letters big in the middle over the faint symbol, the nickname small below.
 */
export type CrestLayout = "stacked" | "ring" | "banner" | "monogram";

export type CrestMotif =
  | "feather"
  | "knot"
  | "net"
  | "honeycomb"
  | "star6"
  | "chevrons"
  | "horseshoe"
  | "gem"
  | "gear"
  | "waves"
  | "orbit"
  | "checker"
  | "sail"
  | "palm"
  | "claws"
  | "sunrays"
  | "diamonds"
  | "moon"
  | "fleur"
  | "stars"
  | "bolt"
  | "sparkle"
  | "stripes"
  | "cactus"
  | "pines"
  | "laurel"
  | "lonestar"
  | "leaf"
  | "equalizer"
  | "obelisk";

export interface Crest {
  shape: CrestShape;
  layout: CrestLayout;
  motif: CrestMotif;
}

/** By team abbreviation (shared/teams.json). */
export const CRESTS: Record<string, Crest> = {
  ATL: { shape: "shield", layout: "stacked", motif: "feather" },
  BOS: { shape: "roundel", layout: "ring", motif: "knot" },
  BKN: { shape: "square", layout: "monogram", motif: "net" },
  CHA: { shape: "hexagon", layout: "stacked", motif: "honeycomb" },
  CHI: { shape: "circle", layout: "banner", motif: "star6" }, // the six-pointed star of the city's flag
  CLE: { shape: "shield", layout: "banner", motif: "chevrons" },
  DAL: { shape: "roundel", layout: "stacked", motif: "horseshoe" },
  DEN: { shape: "diamond", layout: "stacked", motif: "gem" },
  DET: { shape: "octagon", layout: "ring", motif: "gear" }, // the Motor City
  GSW: { shape: "circle", layout: "stacked", motif: "waves" }, // the bay
  HOU: { shape: "circle", layout: "monogram", motif: "orbit" }, // Space City
  IND: { shape: "square", layout: "banner", motif: "checker" }, // the race
  LAC: { shape: "shield", layout: "ring", motif: "sail" },
  LAL: { shape: "roundel", layout: "banner", motif: "palm" },
  MEM: { shape: "hexagon", layout: "monogram", motif: "claws" },
  MIA: { shape: "circle", layout: "ring", motif: "sunrays" },
  MIL: { shape: "diamond", layout: "banner", motif: "diamonds" },
  MIN: { shape: "octagon", layout: "stacked", motif: "moon" },
  NOP: { shape: "shield", layout: "monogram", motif: "fleur" }, // the city's fleur-de-lis
  NYK: { shape: "roundel", layout: "monogram", motif: "stars" }, // five stars, five boroughs
  OKC: { shape: "hexagon", layout: "banner", motif: "bolt" },
  ORL: { shape: "diamond", layout: "ring", motif: "sparkle" },
  PHI: { shape: "square", layout: "stacked", motif: "stripes" }, // thirteen stripes
  PHX: { shape: "octagon", layout: "banner", motif: "cactus" },
  POR: { shape: "hexagon", layout: "ring", motif: "pines" },
  SAC: { shape: "octagon", layout: "monogram", motif: "laurel" },
  SAS: { shape: "diamond", layout: "monogram", motif: "lonestar" },
  TOR: { shape: "square", layout: "ring", motif: "leaf" },
  UTA: { shape: "badge", layout: "stacked", motif: "equalizer" }, // jazz on a meter
  WAS: { shape: "badge", layout: "banner", motif: "obelisk" }, // the monument
};

/** The crest for a team (a plain circle with a lone star for anything unknown). */
export function crestFor(abbr: string): Crest {
  return CRESTS[abbr] ?? { shape: "circle", layout: "stacked", motif: "lonestar" };
}
