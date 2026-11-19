/**
 * Build the motion library: every extra animation we made in Meshy, in one small file, for later.
 *
 *   pnpm assets:motions   # assets-src/motions/batch_*.glb -> public/models/motion-library.glb
 *
 * Meshy downloads at most 20 clips at a time, so the clips come in batches (each a full rigged
 * export). This keeps only the skeleton and the animations (no mesh, no textures): the clips
 * target bones by name, so they play on player.glb's skeleton. player.glb keeps the clips the
 * site uses; the library is for trying others (/dev/jerseys) and for future features.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Animation, type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

import { clipReports, findNode, MAX_DRIFT_M } from "./clips.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const BATCH_DIR = path.join(repoRoot, "assets-src/motions");
const OUTPUT = path.join(repoRoot, "web/public/models/motion-library.glb");
/** Index of the library (name, seconds, drift), read by /dev/jerseys. */
const INDEX = path.join(repoRoot, "web/public/models/motion-library.json");

/**
 * Text to Motion clips are exported under their Meshy task id. Each prompt is in
 * docs/ASSET_PIPELINE.md (section 4, motion library).
 */
const TEXT_TO_MOTION: Record<string, string> = {
  _01a1e151_c5e0_720b_b27f_eed4fb99377d: "ShoulderStretch",
  _01a1e152_f064_77be_826e_3760312560de: "NeckRoll",
  _01a1e154_1bbe_7096_b4f0_c4d87fc63503: "IdleWeightShift",
  _01a1e155_2aba_75ce_af03_76f5f2f0a067: "HandsOnHips",
  _01a1e156_2ce6_7205_bb6a_54a0cc24ae02: "ArmsCrossed",
  _01a1e157_2f10_749b_9220_1cd26c08f5f7: "Disappointed",
  _01a1e158_3b15_74d5_873f_837dd16b39b6: "Nod",
  _01a1e159_3df8_77ce_b2fe_851b96302815: "HeadShake",
  _01a1e15a_43fc_767c_a2d6_6351b3f6905a: "TurnAround",
  _01a1e15b_4e6a_72ac_9b2e_823784ecfafe: "Dribble",
  _01a1e15c_5417_71eb_9f7a_5e9ddb48121e: "FreeThrow",
  _01a1e15d_68e1_7431_8755_6149a16cce67: "ChestPass",
  _01a1e15e_7092_77aa_b875_46bd5078f611: "Clap",
  _01a1e15f_7075_7508_877e_68dc065aaf30: "FistPumpSmall",
  _01a1e160_7deb_73bd_8526_58ade5f20c39: "PointUp",
  _01a1e161_7c8e_747f_965e_13889b2d9c69: "ThumbsUp",
  _01a1e162_8369_75b9_af4d_77d692af0ac0: "WipeBrow",
  _01a1e163_8166_73fa_b994_62fbceec2922: "AdjustJersey",
  _01a1e164_826d_711f_88eb_b3f5fa3a2fe7: "BounceLoose",
  _01a1e165_9247_7643_94fd_fc9ffb3e58a8: "DefenseStance",
  _01a1e166_9201_779a_8a5f_02ba67e77c27: "LookUpScoreboard",
  _01a1e167_8f7c_7547_b31f_b98fa4ec961a: "ChestTap",
  _01a1e168_988c_73e8_be58_a3fac8e1210c: "FormShooting",
  _01a1e16b_28d7_729e_b643_e987f379d7b9: "FocusBreath",
  _01a1e16c_3325_728b_b5f7_e2111afdab2b: "Handshake",
  _01a1e16d_3947_70a7_8d8b_52f284bb5580: "ArmSwings",
  _01a1e16e_439b_7444_b8bf_38fa03bd2720: "JumpShot2",
  _01a1e16f_4eec_7333_8d45_1c6ce4749b19: "PointTeammate",
};

/** Clips that aren't library material: in player.glb already, Meshy defaults, or rejected. */
const SKIP = new Set([
  "Running",
  "Walking",
  "_01a1dd3f_b25e_70a2_a101_ced8b9f5eddc", // JumpShot (player.glb)
  "_01a1dfd2_b7fa_74bf_bd78_021afab90a30", // Text to Motion celebration: didn't look human
  "Idle_3", // player.glb "Idle"
  "Idle_02",
  "Idle_03",
  "Short_Breathe_and_Look_Around", // player.glb "Idle_Look"
  "Cheer_with_Both_Hands_Up", // player.glb "Celebrate"
]);

/** Library name for a Meshy clip: Text to Motion by id, presets as exported ("Agree_Gesture"). */
export function libraryName(meshyName: string): string | null {
  if (SKIP.has(meshyName)) return null;
  if (meshyName in TEXT_TO_MOTION) return TEXT_TO_MOTION[meshyName];
  if (/^_[0-9a-f]{8}_/.test(meshyName)) throw new Error(`unmapped Text to Motion clip ${meshyName}`);
  return meshyName;
}

/** Copy ``anim`` from another document into ``target``, matching bones by name. */
export function copyAnimation(anim: Animation, target: Document, name: string) {
  const nodes = new Map(target.getRoot().listNodes().map((n) => [n.getName(), n]));
  const buffer = target.getRoot().listBuffers()[0];
  const copy = target.createAnimation(name);
  for (const channel of anim.listChannels()) {
    const node = nodes.get(channel.getTargetNode()?.getName() ?? "");
    const sampler = channel.getSampler();
    const input = sampler?.getInput();
    const output = sampler?.getOutput();
    if (!node || !sampler || !input || !output) continue;
    const s = target
      .createAnimationSampler()
      .setInterpolation(sampler.getInterpolation())
      .setInput(target.createAccessor().setType(input.getType()).setArray(input.getArray()!.slice()).setBuffer(buffer))
      .setOutput(target.createAccessor().setType(output.getType()).setArray(output.getArray()!.slice()).setBuffer(buffer));
    copy.addSampler(s).addChannel(
      target.createAnimationChannel().setTargetNode(node).setTargetPath(channel.getTargetPath()!).setSampler(s),
    );
  }
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  const batches = fs
    .readdirSync(BATCH_DIR)
    .filter((f) => /^batch_.*\.glb$/.test(f))
    .sort();
  if (!batches.length) throw new Error(`no batches in ${BATCH_DIR}`);

  // The first batch provides the skeleton; drop its mesh, skin and textures.
  const lib = await io.read(path.join(BATCH_DIR, batches[0]));
  for (const node of lib.getRoot().listNodes()) node.setMesh(null).setSkin(null);
  for (const anim of lib.getRoot().listAnimations()) anim.dispose();
  const seen = new Set<string>();
  for (const file of batches) {
    const doc = await io.read(path.join(BATCH_DIR, file));
    for (const anim of doc.getRoot().listAnimations()) {
      const name = libraryName(anim.getName());
      if (!name || seen.has(name)) continue;
      seen.add(name);
      copyAnimation(anim, lib, name);
    }
  }
  for (const m of lib.getRoot().listMeshes()) m.dispose();
  for (const s of lib.getRoot().listSkins()) s.dispose();

  const reports = clipReports(lib, findNode(lib, "Hips"));
  console.table(
    reports.map((r) => ({ clip: r.name, seconds: +r.duration.toFixed(2), "drift m": +r.driftXZ.toFixed(3) })),
  );
  const drifting = reports.filter((r) => r.driftXZ > MAX_DRIFT_M).map((r) => r.name);
  if (drifting.length) console.warn(`not in place (> ${MAX_DRIFT_M} m): ${drifting.join(", ")}`);

  // Animation-only: a looser resample tolerance and meshopt's "high" level (quantized keyframes) keep
  // 60+ clips small without visible change at this scale.
  await lib.transform(prune(), dedup(), resample({ tolerance: 2e-3 }), meshopt({ encoder: MeshoptEncoder, level: "high" }));
  await io.write(OUTPUT, lib);
  const index = reports
    .map((r) => ({
      name: r.name,
      seconds: +r.duration.toFixed(2),
      driftM: +r.driftXZ.toFixed(2),
      inPlace: r.driftXZ <= MAX_DRIFT_M,
      source: Object.values(TEXT_TO_MOTION).includes(r.name) ? "text-to-motion" : "meshy-library",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + "\n");
  const mb = fs.statSync(OUTPUT).size / 1024 / 1024;
  console.log(`wrote ${path.relative(repoRoot, OUTPUT)}: ${reports.length} clips, ${mb.toFixed(2)} MB`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
