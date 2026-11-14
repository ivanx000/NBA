import teamsData from "../../shared/teams.json";

/** Hex color string, e.g. "#E03A3E". */
export type Hex = `#${string}`;

export type Conference = "East" | "West";

export interface JerseyColorway {
  base: Hex;
  trim: Hex;
  text: Hex;
  shorts: Hex;
}

export interface Team {
  team_id: number;
  abbr: string;
  city: string;
  name: string;
  conference: Conference;
  division: string;
  colors: {
    primary: Hex;
    secondary: Hex;
    tertiary?: Hex;
  };
  jersey: {
    number: string;
    chest_text: string;
    primary: JerseyColorway;
    alt: JerseyColorway;
  };
  arena_coords: {
    lat: number;
    lon: number;
  };
}

interface TeamsFile {
  teams: Team[];
}

/** All 30 teams, from shared/teams.json (the single source of truth). */
export const teams: readonly Team[] = (teamsData as unknown as TeamsFile).teams;

const byAbbr = new Map(teams.map((t) => [t.abbr, t]));
const byId = new Map(teams.map((t) => [t.team_id, t]));

/** Look up a team by abbreviation ("BOS", case-insensitive) or NBA team id. */
export function getTeam(key: string | number): Team | undefined {
  return typeof key === "number" ? byId.get(key) : byAbbr.get(key.toUpperCase());
}

/** Like getTeam, but throws for unknown keys. */
export function requireTeam(key: string | number): Team {
  const team = getTeam(key);
  if (!team) throw new Error(`Unknown team: ${key}`);
  return team;
}

/** "Boston Celtics" */
export function teamFullName(team: Team): string {
  return `${team.city} ${team.name}`;
}
