/**
 * Turn Meshy's rigged export into the web player model.
 *
 *   pnpm assets:player                 # assets-src/base/meshy_rigged.glb -> public/models/player.glb
 *   pnpm assets:player --report-only   # print clips, bones, drift and jump timing; write nothing
 *
 * Steps (docs/ASSET_PIPELINE.md sections 4 and 7):
 * 1. Rename clips to the names the scene uses and drop clips we don't need.
 * 2. Check every clip is in place: the hips must not drift sideways.
 * 3. Report the right-hand bone, the model height and the JumpShot jump peak (the release).
 * 4. Optimize: dedup, prune, resample keyframes, WebP textures, meshopt compression.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  getBounds,
  meshopt,
  prune,
  resample,
  textureCompress,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

import { BATCH_DIR, copyAnimation, libraryName } from "./build-motion-library.mjs";
import { clipReports, findNode, MAX_DRIFT_M, trimWithLeadIn } from "./clips.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_IN = path.join(repoRoot, "assets-src/base/meshy_rigged.glb");
const DEFAULT_OUT = path.join(repoRoot, "web/public/models/player.glb");

/**
 * Meshy clip name -> name in player.glb (null drops the clip). Text to Motion clips are exported
 * under their task id, so they're listed by id.
 */
const CLIP_NAMES: Record<string, string | null> = {
  _01a1dd3f_b25e_70a2_a101_ced8b9f5eddc: "JumpShot",
  Idle_3: "Idle",
  Idle_02: "Idle_02",
  Idle_03: "Idle_03",
  Short_Breathe_and_Look_Around: "Idle_Look",
  Cheer_with_Both_Hands_Up: "Celebrate", // motion-captured library preset, used as is
  // Celebration candidates that weren't picked, and a Text to Motion one that didn't look human.
  Cheer_with_Both_Hands: null,
  Victory_Fist_Pump: null,
  victory: null,
  Victory_Cheer: null,
  _01a1dfd2_b7fa_74bf_bd78_021afab90a30: null,
  Running: null,
  Walking: null,
};
/**
 * Clips to trim: keep the part from ``from`` seconds on, eased in from the normal stance.
 * Idle_03 leans back with the arms overhead before its shoulder stretch; keep only the stretch.
 */
const TRIMS: Record<string, { from: number; leadIn: number }> = {
  Idle_03: { from: 2.5, leadIn: 0.8 },
};

/**
 * Subtle, in-place clips from the motion library (assets-src/motions batches, docs/ASSET_PIPELINE.md
 * section 4) that the site uses: more idle variety, and a head shake for a missed pick.
 */
export const FROM_LIBRARY = [
  "BounceLoose",
  "ArmSwings",
  "ShoulderStretch",
  "NeckRoll",
  "FocusBreath",
  "AdjustJersey",
  "LookUpScoreboard",
  "HeadShake",
];

export const REQUIRED_CLIPS = ["Idle", "Idle_02", "Idle_03", "Idle_Look", "JumpShot", "Celebrate", ...FROM_LIBRARY];

/** Copy ``FROM_LIBRARY`` from the motion batches into ``doc`` (bones match by name). */
async function addLibraryClips(io: NodeIO, doc: Document) {
  const wanted = new Set(FROM_LIBRARY);
  const files = fs.readdirSync(BATCH_DIR).filter((f) => /^batch_.*\.glb$/.test(f)).sort();
  for (const file of files) {
    const batch = await io.read(path.join(BATCH_DIR, file));
    for (const anim of batch.getRoot().listAnimations()) {
      const name = libraryName(anim.getName());
      if (name && wanted.delete(name)) copyAnimation(anim, doc, name);
    }
  }
  if (wanted.size) throw new Error(`motion batches lack: ${[...wanted].join(", ")}`);
}

const BUDGET_BYTES = 4 * 1024 * 1024;

function renameClips(doc: Document) {
  for (const anim of doc.getRoot().listAnimations()) {
    const name = anim.getName();
    if (!(name in CLIP_NAMES)) throw new Error(`unknown clip "${name}": add it to CLIP_NAMES`);
    const target = CLIP_NAMES[name];
    if (target === null) anim.dispose();
    else anim.setName(target);
  }
}

function checkClips(doc: Document) {
  const names = doc.getRoot().listAnimations().map((a) => a.getName());
  const missing = REQUIRED_CLIPS.filter((c) => !names.includes(c));
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (missing.length || dupes.length) {
    throw new Error(`clips: missing ${missing.join(", ") || "-"}; duplicated ${dupes.join(", ") || "-"}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reportOnly = args.includes("--report-only");
  const opt = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? path.resolve(args[i + 1]) : fallback;
  };
  const input = opt("--in", DEFAULT_IN);
  const output = opt("--out", DEFAULT_OUT);

  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(input);

  renameClips(doc);
  await addLibraryClips(io, doc);
  for (const [name, { from, leadIn }] of Object.entries(TRIMS)) {
    const anim = doc.getRoot().listAnimations().find((a) => a.getName() === name);
    if (!anim) throw new Error(`trim: no clip ${name}`);
    trimWithLeadIn(doc, anim, from, leadIn);
  }
  checkClips(doc);
  const hips = findNode(doc, "Hips");
  const hand = findNode(doc, "RightHand");
  const bounds = getBounds(doc.getRoot().listScenes()[0]);
  const reports = clipReports(doc, hips);

  console.log(`height: ${(bounds.max[1] - bounds.min[1]).toFixed(2)} m`);
  // three's GLTFLoader strips ":" from node names, so the runtime name differs.
  console.log(`HAND_BONE: ${hand.getName().replace(/[:.[\]/]/g, "")} (glTF name ${hand.getName()})`);
  console.table(
    reports.map((r) => ({
      clip: r.name,
      seconds: +r.duration.toFixed(2),
      "drift m": +r.driftXZ.toFixed(3),
      "hips peak s": +r.peakTime.toFixed(2),
      "rise m": +r.rise.toFixed(2),
    })),
  );
  const drifting = reports.filter((r) => r.driftXZ > MAX_DRIFT_M);
  if (drifting.length) {
    console.warn(`not in place (> ${MAX_DRIFT_M} m): ${drifting.map((r) => r.name).join(", ")}`);
  }
  const shot = reports.find((r) => r.name === "JumpShot")!;
  console.log(`JumpShot jump peak (release estimate): ${shot.peakTime.toFixed(2)} s`);
  if (reportOnly) return;

  await doc.transform(
    dedup(),
    prune(),
    resample(),
    // Color and normal maps at 1024, roughness/metal at 512 (it's nearly flat on fabric and skin).
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], slots: /^(baseColor|normal)/ }),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], slots: /^metallicRoughness/ }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  await io.write(output, doc);

  const bytes = (await import("node:fs")).statSync(output).size;
  console.log(`wrote ${path.relative(repoRoot, output)}: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  if (bytes > BUDGET_BYTES) throw new Error("player.glb is over the 4 MB budget");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
