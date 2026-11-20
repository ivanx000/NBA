/**
 * The ball's path in the prediction cinematic (DESIGN.md section 4): an arc from the release point
 * to the rim, then an ending that depends on how confident the model is. No physics engine, just
 * keyframed segments relative to the rim.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type ShotOutcome = "swish" | "backIron" | "rattle" | "rimOut" | "brick";

/** Clean swish when confident, back iron in the middle, a rattle in when it's close to a coin flip. */
export function shotOutcome(winnerProb: number): ShotOutcome {
  if (winnerProb >= 0.7) return "swish";
  if (winnerProb >= 0.58) return "backIron";
  return "rattle";
}

/**
 * The shot for a user's pick: it goes in when the pick is right (by how confident the model is in
 * that team), and misses when it's wrong: around the rim and out when the picked team had a fair
 * chance (40%+), off the front of the rim when it didn't.
 */
export function pickShot(right: boolean, pickProb: number): ShotOutcome {
  if (right) return shotOutcome(pickProb);
  return pickProb >= 0.4 ? "rimOut" : "brick";
}

export const isMake = (o: ShotOutcome) => o === "swish" || o === "backIron" || o === "rattle";

export interface ShotPath {
  outcome: ShotOutcome;
  made: boolean;
  /** Seconds from release to the end of the path (through the net, or off the rim and down). */
  duration: number;
  /**
   * Seconds from release to the moment that decides it: through the rim for a make (flash, sparks,
   * net swing), off the rim for a miss.
   */
  decidedAt: number;
  /** Ball center at ``t`` seconds after release (clamped to the path). */
  at(t: number): Vec3;
}

/** Seconds in the air from release to the rim. */
export const FLIGHT_S = 1.1;
/** How far the apex sits above the higher of release and rim (meters). */
export const APEX_ABOVE_M = 2.5;
const RIM_RADIUS = 0.2286;
/** Where the ball's center sits on the rim when it touches the iron (rim radius minus a bit). */
const RIM_TOUCH = RIM_RADIUS - 0.06;
const DROP_S = 0.35;
const DROP_M = 0.9;

type Segment = { duration: number; at: (u: number) => Vec3 };

/** Rolling around the rim from its far side: ``turns`` laps, at radius ``radius(u)``, settling a little. */
function roll(rim: Vec3, dir: Vec3, turns: number, radius: (u: number) => number): (u: number) => Vec3 {
  const start = Math.atan2(dir.z, dir.x);
  return (u) => {
    const angle = start + u * Math.PI * 2 * turns;
    const r = radius(u);
    return { x: rim.x + Math.cos(angle) * r, y: rim.y + 0.05 * (1 - u) + 0.015 * Math.sin(u * 18), z: rim.z + Math.sin(angle) * r };
  };
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const up = (y: number): Vec3 => ({ x: 0, y, z: 0 });

function bezier(p0: Vec3, c: Vec3, p1: Vec3, u: number): Vec3 {
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const d = u * u;
  return { x: a * p0.x + b * c.x + d * p1.x, y: a * p0.y + b * c.y + d * p1.y, z: a * p0.z + b * c.z + d * p1.z };
}

/** An arc from ``p0`` to ``p1`` peaking at ``apexY`` (a quadratic Bezier's midpoint is its apex). */
function arc(p0: Vec3, p1: Vec3, apexY: number): (u: number) => Vec3 {
  const c = { x: (p0.x + p1.x) / 2, y: 2 * apexY - (p0.y + p1.y) / 2, z: (p0.z + p1.z) / 2 };
  return (u) => bezier(p0, c, p1, u);
}

export function shotPath(
  release: Vec3,
  rim: Vec3,
  outcome: ShotOutcome,
  /** Seconds in the air to the rim, and the apex's height over the higher end (a long shot wants more of both). */
  flightS = FLIGHT_S,
  apexM = APEX_ABOVE_M,
): ShotPath {
  // Horizontal direction of travel, shooter to rim.
  const dx = rim.x - release.x;
  const dz = rim.z - release.z;
  const len = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / len, y: 0, z: dz / len };
  const front = add(add(rim, scale(dir, -RIM_TOUCH)), up(0.06));
  const back = add(add(rim, scale(dir, RIM_TOUCH)), up(0.06));

  const end =
    outcome === "swish" ? add(rim, up(0.02)) : outcome === "backIron" || outcome === "rimOut" ? back : front;
  const flight = arc(release, end, Math.max(release.y, end.y) + apexM);
  // A slight acceleration over the flight (between linear and GSAP's power1.in).
  const segments: Segment[] = [{ duration: flightS, at: (u) => flight(0.55 * u + 0.45 * u * u) }];
  const made = isMake(outcome);
  let decidedAt = flightS;
  if (outcome === "backIron") {
    // Off the back iron, up a little, and down through the middle.
    const bounce = arc(back, add(rim, up(0.02)), rim.y + 0.4);
    segments.push({ duration: 0.42, at: bounce });
  } else if (outcome === "rattle") {
    // Off the front rim, up and over to the back, then around the rim before it drops.
    const toBack = add(add(rim, scale(dir, RIM_TOUCH)), up(0.05));
    segments.push({ duration: 0.5, at: arc(front, toBack, rim.y + 0.55) });
    segments.push({ duration: 0.7, at: roll(rim, dir, 1.25, (u) => RIM_TOUCH * (1 - u)) });
  } else if (outcome === "rimOut") {
    // Off the back iron, around the rim, and out the side.
    segments.push({ duration: 0.75, at: roll(rim, dir, 0.85, () => RIM_TOUCH) });
    const out = segments.at(-1)!.at(1);
    const away = { x: out.x - rim.x, y: 0, z: out.z - rim.z };
    const k = Math.hypot(away.x, away.z) || 1;
    const landing = { x: rim.x + (away.x / k) * 0.9, y: rim.y - 1.6, z: rim.z + (away.z / k) * 0.9 };
    segments.push({ duration: 0.6, at: arc(out, landing, rim.y + 0.12) });
    decidedAt = flightS + 0.75;
  } else if (outcome === "brick") {
    // Off the front of the rim and back toward the shooter.
    const landing = add(add(rim, scale(dir, -1.8)), up(-1.8));
    segments.push({ duration: 0.7, at: arc(front, landing, rim.y + 0.4) });
  }
  if (made) {
    decidedAt = segments.reduce((s, seg) => s + seg.duration, 0);
    const entry = segments.at(-1)!.at(1);
    segments.push({ duration: DROP_S, at: (u) => add(entry, up(-DROP_M * u * u)) });
  }
  const duration = segments.reduce((s, seg) => s + seg.duration, 0);

  return {
    outcome,
    made,
    duration,
    decidedAt,
    at(t) {
      let rest = Math.min(Math.max(t, 0), duration);
      for (const seg of segments) {
        if (rest <= seg.duration) return seg.at(rest / seg.duration);
        rest -= seg.duration;
      }
      return segments.at(-1)!.at(1);
    },
  };
}
