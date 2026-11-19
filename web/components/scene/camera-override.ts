import * as THREE from "three";

/**
 * Where the cinematic wants the camera. The home camera rig blends toward it by `weight` (0: the
 * home framing, 1: this shot), so the cinematic never fights the rig. Module-level because there
 * is one scene; the cinematic writes it, the rig reads it every frame.
 */
export const cameraOverride = {
  weight: 0,
  position: new THREE.Vector3(),
  target: new THREE.Vector3(),
  fov: 35,
  /** Brief camera shake on the make, 0 to 1. */
  shake: 0,
};

export function resetCameraOverride() {
  cameraOverride.weight = 0;
  cameraOverride.shake = 0;
}
