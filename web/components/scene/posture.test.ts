import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { applyPosture, NO_POSTURE, POSTURE, postureBones, restorePosture } from "./posture";

/** A minimal Mixamo-named skeleton: hips -> spine -> chest -> neck -> head, and a left arm. */
function skeleton() {
  const root = new THREE.Group();
  const bone = (name: string, parent: THREE.Object3D, y = 0.1, x = 0) => {
    const b = new THREE.Bone();
    b.name = `mixamorig${name}`;
    b.position.set(x, y, 0);
    parent.add(b);
    return b;
  };
  const hips = bone("Hips", root, 1);
  const spine1 = bone("Spine1", bone("Spine", hips));
  const chest = bone("Spine2", spine1);
  bone("Head", bone("Neck", chest));
  bone("LeftArm", bone("LeftShoulder", chest, 0.1, 0.05), 0, 0.15);
  bone("RightArm", bone("RightShoulder", chest, 0.1, -0.05), 0, -0.15);
  root.updateMatrixWorld(true);
  return root;
}

describe("posture", () => {
  it("corrects by the configured angles and comes off cleanly after the frame", () => {
    const root = skeleton();
    const bones = postureBones(root);
    const chest = bones.chest!;
    const before = chest.quaternion.clone();
    applyPosture(root, bones, POSTURE, 1);
    expect((chest.quaternion.angleTo(before) * 180) / Math.PI).toBeCloseTo(POSTURE.chest, 4);
    restorePosture(bones);
    expect(chest.quaternion.angleTo(before)).toBeLessThan(1e-9);
  });

  it("never compounds across frames", () => {
    const root = skeleton();
    const bones = postureBones(root);
    const arm = bones.lArm!;
    const before = arm.quaternion.clone();
    for (let i = 0; i < 50; i++) {
      applyPosture(root, bones, POSTURE, 1);
      restorePosture(bones);
    }
    applyPosture(root, bones, POSTURE, 1);
    expect((arm.quaternion.angleTo(before) * 180) / Math.PI).toBeLessThan(POSTURE.armOut + POSTURE.armForward + 0.01);
  });

  it("does nothing with no posture or zero weight", () => {
    const root = skeleton();
    const bones = postureBones(root);
    const before = bones.head!.quaternion.clone();
    applyPosture(root, bones, NO_POSTURE, 1);
    applyPosture(root, bones, POSTURE, 0);
    expect(bones.head!.quaternion.angleTo(before)).toBe(0);
  });
});
