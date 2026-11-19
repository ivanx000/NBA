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

export type ShotOutcome = "swish" | "backIron" | "rattle";

/** Clean swish when confident, back iron in the middle, a rattle in when it's close to a coin flip. */
export function shotOutcome(winnerProb: number): ShotOutcome {
  if (winnerProb >= 0.7) return "swish";
  if (winnerProb >= 0.58) return "backIron";
  return "rattle";
}

export interface ShotPath {
  outcome: ShotOutcome;
  /** Seconds from release to the end of the path (the ball has dropped through the net). */
  duration: number;
  /** Seconds from release until the ball goes through the rim (flash, sparks, net wobble). */
  makeAt: number;
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

export function shotPath(release: Vec3, rim: Vec3, outcome: ShotOutcome): ShotPath {
  // Horizontal direction of travel, shooter to rim.
  const dx = rim.x - release.x;
  const dz = rim.z - release.z;
  const len = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / len, y: 0, z: dz / len };
  const front = add(add(rim, scale(dir, -RIM_TOUCH)), up(0.06));
  const back = add(add(rim, scale(dir, RIM_TOUCH)), up(0.06));
  const end = outcome === "swish" ? add(rim, up(0.02)) : outcome === "backIron" ? back : front;

  const flight = arc(release, end, Math.max(release.y, end.y) + APEX_ABOVE_M);
  // A slight acceleration over the flight (between linear and GSAP's power1.in).
  const segments: Segment[] = [{ duration: FLIGHT_S, at: (u) => flight(0.55 * u + 0.45 * u * u) }];
  if (outcome === "backIron") {
    // Off the back iron, up a little, and down through the middle.
    const bounce = arc(back, add(rim, up(0.02)), rim.y + 0.4);
    segments.push({ duration: 0.42, at: bounce });
  } else if (outcome === "rattle") {
    // Off the front rim, up and over to the back, then around the rim before it drops.
    const toBack = add(add(rim, scale(dir, RIM_TOUCH)), up(0.05));
    const bounce = arc(front, toBack, rim.y + 0.55);
    segments.push({ duration: 0.5, at: bounce });
    const start = Math.atan2(dir.z, dir.x);
    segments.push({
      duration: 0.7,
      at: (u) => {
        const angle = start + u * Math.PI * 2 * 1.25;
        const r = RIM_TOUCH * (1 - u);
        return { x: rim.x + Math.cos(angle) * r, y: rim.y + 0.05 * (1 - u) + 0.015 * Math.sin(u * 18), z: rim.z + Math.sin(angle) * r };
      },
    });
  }
  const makeAt = segments.reduce((s, seg) => s + seg.duration, 0);
  const entry = segments.at(-1)!.at(1);
  segments.push({ duration: DROP_S, at: (u) => add(entry, up(-DROP_M * u * u)) });
  const duration = makeAt + DROP_S;

  return {
    outcome,
    duration,
    makeAt,
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
