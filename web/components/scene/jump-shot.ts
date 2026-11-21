import * as THREE from "three";

import { JUMPSHOT_RELEASE_TIME } from "@/lib/scene-config";

/**
 * A jump shot built in code (docs/DESIGN.md section 3). The AI-generated clips held the ball
 * overhead with both arms straight up; a real jumper sets the ball above the shooting eye with the
 * elbow under it, rises, releases at the top with the arm reaching toward the rim and a wrist
 * flick, and holds the follow-through while landing.
 *
 * The shot is authored as paths for the body (hips, lean, head) and the hands, and turned into
 * joint rotations with two-bone IK for the arms and legs (feet stay planted until takeoff). It's
 * sampled into an ordinary AnimationClip named "JumpShot" when the model loads, so the mixer, the
 * cross-fades, the ball (which rides on the fingers until release) and the camera use it as is.
 *
 * Body frame: the model faces +z, +x is his left, y is up. He shoots right-handed.
 */

/** Seconds into the clip when the ball leaves his hand: the top of the jump. */
export const SHOT_RELEASE_S = JUMPSHOT_RELEASE_TIME;
export const SHOT_DURATION_S = 2.2;
const FPS = 30;

type Key<T> = [number, T];

/** Catmull-Rom through keys (clamped at the ends): smooth speed through every key. */
function spline(keys: Key<number>[]): (t: number) => number {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    const last = keys.length - 1;
    if (t >= keys[last][0]) return keys[last][1];
    let i = 0;
    while (keys[i + 1][0] < t) i++;
    const [t1, p1] = keys[i];
    const [t2, p2] = keys[i + 1];
    const p0 = keys[Math.max(0, i - 1)][1];
    const p3 = keys[Math.min(last, i + 2)][1];
    const u = (t - t1) / (t2 - t1);
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  };
}

function spline3(keys: Key<THREE.Vector3>[]): (t: number, out: THREE.Vector3) => THREE.Vector3 {
  const [x, y, z] = (["x", "y", "z"] as const).map((c) => spline(keys.map(([t, v]) => [t, v[c]] as Key<number>)));
  return (t, out) => out.set(x(t), y(t), z(t));
}

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const D = THREE.MathUtils.DEG2RAD;
const AX = new THREE.Vector3(1, 0, 0);

const tmp = {
  p: new THREE.Quaternion(),
  q: new THREE.Quaternion(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  d: new THREE.Vector3(),
  e: new THREE.Vector3(),
};

/** Rotate ``bone`` by the world-space rotation ``qw`` (its children follow). */
function rotateWorld(bone: THREE.Object3D, qw: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(tmp.p);
  // q' = P^-1 · qw · P · q
  tmp.q.copy(tmp.p).invert().multiply(qw).multiply(tmp.p);
  bone.quaternion.premultiply(tmp.q);
  bone.updateMatrixWorld(true);
}

/** Turn ``bone`` so the direction ``from`` (world) points along ``to`` (world). */
function aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  rotateWorld(bone, q);
}

/** Rotate ``bone`` about the body's x axis (positive tips its far end forward). */
function pitch(bone: THREE.Object3D | undefined, angle: number) {
  if (!bone || Math.abs(angle) < 1e-6) return;
  rotateWorld(bone, new THREE.Quaternion().setFromAxisAngle(AX, angle));
}

const world = (o: THREE.Object3D, out: THREE.Vector3) => o.getWorldPosition(out);

/**
 * Two-bone IK: bend ``upper`` and ``lower`` so ``end`` reaches ``target``, with the middle joint
 * pointing toward ``pole``. Lengths are kept; a target out of reach is approached in a line.
 */
function twoBone(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
  const A = world(upper, new THREE.Vector3());
  const B = world(lower, new THREE.Vector3());
  const C = world(end, new THREE.Vector3());
  const l1 = A.distanceTo(B);
  const l2 = B.distanceTo(C);
  const toT = target.clone().sub(A);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const dir = toT.normalize();
  // The bend direction: the pole, made perpendicular to the reach.
  const bend = pole.clone().sub(A);
  bend.sub(dir.clone().multiplyScalar(bend.dot(dir))).normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const Bn = A.clone().add(dir.clone().multiplyScalar(l1 * cosA)).add(bend.multiplyScalar(l1 * sinA));
  aim(upper, B.clone().sub(A), Bn.clone().sub(A));
  const B2 = world(lower, new THREE.Vector3());
  const C2 = world(end, new THREE.Vector3());
  const reach = A.clone().add(dir.multiplyScalar(d));
  aim(lower, C2.sub(B2), reach.sub(B2));
}

interface Rig {
  root: THREE.Object3D;
  bones: THREE.Bone[];
  get: (name: string) => THREE.Bone;
}

function rig(root: THREE.Object3D): Rig {
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const byName = new Map(bones.map((b) => [b.name.replace(/^mixamorig:?/, ""), b]));
  return {
    root,
    bones,
    get: (n) => {
      const b = byName.get(n);
      if (!b) throw new Error(`jump-shot: no bone ${n}`);
      return b;
    },
  };
}

/**
 * Build the clip on ``scene`` (a clone of the player model, posed by nothing else), starting from
 * ``stance`` (the idle clip) at time 0 so the hands, fingers and feet begin where the idle has them.
 */
export function buildJumpShot(scene: THREE.Object3D, stance: THREE.AnimationClip): THREE.AnimationClip {
  const r = rig(scene);
  // The idle's first frame as the base pose.
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(stance).play();
  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const base = r.bones.map((b) => ({ b, q: b.quaternion.clone(), p: b.position.clone() }));
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  const reset = () => {
    for (const { b, q, p } of base) {
      b.quaternion.copy(q);
      b.position.copy(p);
    }
    scene.updateMatrixWorld(true);
  };

  const hips = r.get("Hips");
  const [lUp, lLeg, lFoot] = ["LeftUpLeg", "LeftLeg", "LeftFoot"].map(r.get);
  const [rUp, rLeg, rFoot] = ["RightUpLeg", "RightLeg", "RightFoot"].map(r.get);
  const [lArm, lFore, lHand] = ["LeftArm", "LeftForeArm", "LeftHand"].map(r.get);
  const [rArm, rFore, rHand] = ["RightArm", "RightForeArm", "RightHand"].map(r.get);
  const spine = ["Spine", "Spine1", "Spine2"].map(r.get);
  const neck = r.get("Neck");
  const head = r.get("Head");

  const footL0 = world(lFoot, new THREE.Vector3());
  const footR0 = world(rFoot, new THREE.Vector3());
  const handL0 = world(lHand, new THREE.Vector3());
  const handR0 = world(rHand, new THREE.Vector3());
  const hipsY0 = hips.position.y;
  // Hips local units per meter (the armature may be scaled).
  hips.parent!.updateMatrixWorld(true);
  const unit = 1 / new THREE.Vector3().setFromMatrixScale(hips.parent!.matrixWorld).y;

  // --- The body ---------------------------------------------------------------------------
  // Hips height: a dip to load the legs, the jump (peak at release), the landing absorbed.
  const hipDy = spline([
    [0, 0], [0.3, -0.12], [0.5, -0.06], [0.72, 0.18], [SHOT_RELEASE_S, 0.3], [1.12, 0.22], [1.3, 0],
    [1.44, -0.08], [1.75, -0.01], [SHOT_DURATION_S, 0],
  ]); // prettier-ignore
  const takeoff = 0.6;
  const landing = 1.3;
  // Forward lean of the torso (degrees), the head's look (negative = up, at the rim).
  const lean = spline([[0, 0], [0.3, 11], [0.6, 4], [SHOT_RELEASE_S, -2], [1.3, 3], [1.44, 8], [1.8, 1], [SHOT_DURATION_S, 0]]);
  const look = spline([[0, 0], [0.35, -3], [0.75, -13], [1.3, -11], [1.8, -3], [SHOT_DURATION_S, 0]]);
  // Wrist: cocked back under the ball, then the flick, held in the follow-through.
  const wrist = spline([[0, 0], [0.3, -10], [0.78, -55], [SHOT_RELEASE_S, -40], [1.05, 45], [1.2, 65], [1.48, 62], [1.95, 0], [SHOT_DURATION_S, 0]]);

  // --- The ball and the hands (body frame, before the jump's lift) ---------------------------
  const ball = spline3([
    [0, handL0.clone().add(handR0).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.02, 0.1))],
    [0.3, new THREE.Vector3(-0.02, 1.0, 0.3)],
    [0.55, new THREE.Vector3(-0.05, 1.45, 0.26)],
    [0.78, new THREE.Vector3(-0.1, 1.95, 0.22)],
    [SHOT_RELEASE_S, new THREE.Vector3(-0.12, 2.1, 0.3)],
  ]);
  // Shooting hand: under and behind the ball until release; then up and out toward the rim.
  const followR = spline3([
    [SHOT_RELEASE_S, new THREE.Vector3(-0.14, 1.98, 0.24)],
    [1.08, new THREE.Vector3(-0.15, 2.12, 0.42)],
    [1.48, new THREE.Vector3(-0.15, 2.08, 0.44)],
    [1.95, handR0.clone()],
    [SHOT_DURATION_S, handR0.clone()],
  ]);
  // Guide hand: on the side of the ball, then off it and down.
  const followL = spline3([
    [SHOT_RELEASE_S, new THREE.Vector3(0.05, 1.96, 0.3)],
    [1.15, new THREE.Vector3(0.2, 1.7, 0.28)],
    [1.95, handL0.clone()],
    [SHOT_DURATION_S, handL0.clone()],
  ]);
  const UNDER = new THREE.Vector3(-0.02, -0.14, -0.07);
  const SIDE = new THREE.Vector3(0.15, -0.03, -0.02);

  const v = { ball: new THREE.Vector3(), r: new THREE.Vector3(), l: new THREE.Vector3(), lift: new THREE.Vector3() };
  const frames = Math.round(SHOT_DURATION_S * FPS) + 1;
  const times = new Float32Array(frames);
  const rot = r.bones.map(() => new Float32Array(frames * 4));
  const pos = new Float32Array(frames * 3);

  for (let f = 0; f < frames; f++) {
    const t = Math.min(SHOT_DURATION_S, f / FPS);
    times[f] = t;
    reset();
    const dy = hipDy(t);
    hips.position.y = hipsY0 + dy * unit;
    hips.updateMatrixWorld(true);

    // Torso lean, spread over the spine; head and neck look up at the rim.
    const lw = lean(t) * D;
    spine.forEach((b, i) => pitch(b, lw * [0.4, 0.3, 0.3][i]));
    pitch(neck, look(t) * D * 0.4);
    pitch(head, look(t) * D * 0.6);

    // Legs: feet planted until takeoff, lifted with the body in the air (toes pointed), planted
    // again from the landing. Knees bend forward.
    const air = t > takeoff && t < landing;
    const lift = air ? Math.max(0, dy - 0.03) : 0;
    for (const [up, leg, foot, f0] of [[lUp, lLeg, lFoot, footL0], [rUp, rLeg, rFoot, footR0]] as const) {
      const target = f0.clone().add(v.lift.set(0, lift, 0));
      const hip = world(up, tmp.a);
      const pole = tmp.b.copy(hip).add(tmp.c.set(0, -0.45, 0.6));
      pole.x = f0.x;
      twoBone(up, leg, foot, target, pole);
      pitch(foot, smooth(lift / 0.15) * 25 * D);
    }

    // Arms: carry the ball up the midline; after release the shooting arm reaches for the rim.
    const lifted = (p: THREE.Vector3) => p.add(v.lift.set(0, dy, 0));
    const toBall = smooth(t / 0.3);
    if (t <= SHOT_RELEASE_S) {
      lifted(ball(t, v.ball));
      v.r.copy(v.ball).add(UNDER).lerp(handR0, 1 - toBall);
      v.l.copy(v.ball).add(SIDE).lerp(handL0, 1 - toBall);
    } else {
      lifted(followR(t, v.r));
      lifted(followL(t, v.l));
      // Back to the stance: no lift at the end.
      const settle = smooth((t - 1.48) / 0.47);
      v.r.y -= dy * settle;
      v.l.y -= dy * settle;
    }
    const shoulderR = world(rArm, tmp.d);
    twoBone(rArm, rFore, rHand, v.r, tmp.e.copy(shoulderR).add(tmp.c.set(-0.12, -0.35, 0.4)));
    const shoulderL = world(lArm, tmp.d);
    twoBone(lArm, lFore, lHand, v.l, tmp.e.copy(shoulderL).add(tmp.c.set(0.4, -0.3, 0.15)));
    pitch(rHand, wrist(t) * D);
    pitch(lHand, wrist(t) * D * 0.25);

    r.bones.forEach((b, i) => b.quaternion.toArray(rot[i], f * 4));
    hips.position.toArray(pos, f * 3);
  }
  reset();

  const tracks: THREE.KeyframeTrack[] = r.bones.map((b, i) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, rot[i]));
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, pos));
  return new THREE.AnimationClip("JumpShot", SHOT_DURATION_S, tracks);
}

const cache = new WeakMap<THREE.Object3D, THREE.AnimationClip>();

/** The clip for a loaded model, built once (on a private clone) and shared. */
export function jumpShotFor(source: THREE.Object3D, clone: (o: THREE.Object3D) => THREE.Object3D, stance: THREE.AnimationClip) {
  let clip = cache.get(source);
  if (!clip) {
    clip = buildJumpShot(clone(source), stance);
    cache.set(source, clip);
  }
  return clip;
}
