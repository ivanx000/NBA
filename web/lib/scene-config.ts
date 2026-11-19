/**
 * Facts about the player model, from `pnpm assets:player` (web/scripts/assets/prepare-player.mts).
 * Re-check them whenever the model is regenerated.
 */

export const PLAYER_MODEL_URL = "/models/player.glb";
export const UNIFORM_MASK_URL = "/textures/player/uniform_mask.webp";
/** Extra animations for later use (built by `pnpm assets:motions`); not loaded by the site yet. */
export const MOTION_LIBRARY_URL = "/models/motion-library.glb";

/** Model height in meters (feet at y = 0, facing +z). */
export const PLAYER_HEIGHT_M = 1.98;

/**
 * The ball attaches to this bone during the shot. three's GLTFLoader strips ":" from node names,
 * so the glTF bone "mixamorig:RightHand" is named "mixamorigRightHand" at runtime.
 */
export const HAND_BONE = "mixamorigRightHand";

/** Clip names in player.glb (docs/ASSET_PIPELINE.md section 4). */
export const CLIPS = {
  idle: ["Idle", "Idle_02", "Idle_03", "Idle_Look"],
  shot: "JumpShot",
  celebrate: ["Celebrate"], // Meshy library preset "Cheer with Both Hands Up"
} as const;

export type ClipName =
  | (typeof CLIPS.idle)[number]
  | typeof CLIPS.shot
  | (typeof CLIPS.celebrate)[number];

/**
 * Seconds into JumpShot when the ball leaves the hands: the jump's peak (the hips are highest at
 * 1.27 s). Checked in the cinematic (Phase 7): the ball leaves with the arms extended overhead.
 */
export const JUMPSHOT_RELEASE_TIME = 1.27;
