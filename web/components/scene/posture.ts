import * as THREE from "three";

/**
 * A posture correction layered on every animation (docs/DESIGN.md section 3). The rig and clips
 * came from an automatic pipeline that guessed his stance from one image: shoulders hunched up
 * and forward, chest a little sunk, arms pressed against the jersey. After the mixer poses him
 * each frame, each bone below gets a small extra rotation, expressed in the body's own frame
 * (x = his left, y = up, z = forward) so the same settings read the same whichever way he faces.
 *
 * Angles are degrees. Left and right mirror each other. Tune them in /dev/jerseys (Posture).
 */
export interface Posture {
  /** Chest up: the upper spine leans back (positive) to open the chest. */
  chest: number;
  /** Lower spine, the same way, smaller. */
  spine: number;
  /** Neck and head lift (positive = chin up), to undo a forward head. */
  neck: number;
  head: number;
  /** Shoulders (clavicles) drop (positive = down) and pull back (positive = back). */
  shoulderDown: number;
  shoulderBack: number;
  /** Upper arms swing out from the torso (positive = away), so they don't press into the jersey. */
  armOut: number;
  /** Upper arms rotate a little forward/back (positive = forward) to hang naturally. */
  armForward: number;
}

/** Tuned in the lab on the idle and shot clips (Nov 2026). */
export const POSTURE: Posture = {
  chest: 6,
  spine: 2,
  neck: -3,
  head: 5,
  shoulderDown: 11,
  shoulderBack: 8,
  armOut: 7,
  armForward: 0,
};

export const NO_POSTURE: Posture = {
  chest: 0,
  spine: 0,
  neck: 0,
  head: 0,
  shoulderDown: 0,
  shoulderBack: 0,
  armOut: 0,
  armForward: 0,
};

const D = THREE.MathUtils.DEG2RAD;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const NAMES = {
  spine: "Spine1",
  chest: "Spine2",
  neck: "Neck",
  head: "Head",
  lClav: "LeftShoulder",
  rClav: "RightShoulder",
  lArm: "LeftArm",
  rArm: "RightArm",
} as const;

type Bones = Record<keyof typeof NAMES, THREE.Object3D | null> & {
  /** Each corrected bone's animated pose this frame, put back after the frame is drawn. */
  clean: Map<THREE.Object3D, THREE.Quaternion>;
};

export function postureBones(root: THREE.Object3D): Bones {
  const out = { clean: new Map() } as Bones;
  for (const [key, name] of Object.entries(NAMES)) {
    const bone = root.getObjectByName(`mixamorig${name}`) ?? null;
    out[key as keyof typeof NAMES] = bone;
    if (bone) out.clean.set(bone, new THREE.Quaternion());
  }
  return out;
}

const tmp = {
  body: new THREE.Quaternion(),
  parent: new THREE.Quaternion(),
  rot: new THREE.Quaternion(),
  a: new THREE.Quaternion(),
  b: new THREE.Quaternion(),
};

/**
 * Rotate ``bone`` by ``angle`` (radians) about ``axis`` given in the body's frame, on top of its
 * animated pose: q' = P^-1 · (B · R · B^-1) · P · q, with P its parent's world rotation and B the
 * body's. Its children follow.
 */
function turn(bone: THREE.Object3D | null, axis: THREE.Vector3, angle: number) {
  if (!bone || !bone.parent || Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(tmp.parent);
  tmp.rot.setFromAxisAngle(axis, angle);
  // Body frame -> world.
  tmp.a.copy(tmp.body).multiply(tmp.rot).multiply(tmp.b.copy(tmp.body).invert());
  // World -> parent's frame, applied before the bone's own rotation.
  tmp.a.premultiply(tmp.b.copy(tmp.parent).invert()).multiply(tmp.parent);
  bone.quaternion.premultiply(tmp.a);
  bone.updateMatrixWorld(true);
}

/**
 * Apply ``p`` at ``weight`` (0..1) to a posed skeleton. ``body`` is the object whose orientation
 * is the body frame (the player's root). Call after the mixer every frame, and ``restorePosture``
 * after the frame is drawn.
 */
export function applyPosture(body: THREE.Object3D, bones: Bones, p: Posture, weight: number) {
  for (const [bone, q] of bones.clean) q.copy(bone.quaternion);
  if (weight > 0) correct(body, bones, p, weight);
}

/**
 * Put the animated pose back once the frame is drawn. The correction must never stay on the
 * bones between frames: the mixer saves a bone's current pose when a clip starts or blends, so a
 * lingering correction would be saved into it and compound frame after frame.
 */
export function restorePosture(bones: Bones) {
  for (const [bone, q] of bones.clean) bone.quaternion.copy(q);
}

function correct(body: THREE.Object3D, bones: Bones, p: Posture, weight: number) {
  body.updateMatrixWorld(true);
  body.getWorldQuaternion(tmp.body);
  const w = weight * D;
  // Leaning back is a negative turn about x (x = his left; positive pitches the top forward).
  turn(bones.spine, X, -p.spine * w);
  turn(bones.chest, X, -p.chest * w);
  turn(bones.neck, X, p.neck * w);
  turn(bones.head, X, -p.head * w);
  // Shoulders: his left clavicle points +x; down is a negative turn about z, back a positive
  // turn about y. The right side mirrors both.
  turn(bones.lClav, Z, -p.shoulderDown * w);
  turn(bones.rClav, Z, p.shoulderDown * w);
  turn(bones.lClav, Y, p.shoulderBack * w);
  turn(bones.rClav, Y, -p.shoulderBack * w);
  // Arms out from the torso, and forward.
  turn(bones.lArm, Z, p.armOut * w);
  turn(bones.rArm, Z, -p.armOut * w);
  turn(bones.lArm, Y, -p.armForward * w);
  turn(bones.rArm, Y, p.armForward * w);
}
