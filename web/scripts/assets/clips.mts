/** Shared helpers for the asset scripts: find skeleton nodes and check animation clips. */
import type { Animation, Document, Node as GltfNode } from "@gltf-transform/core";
import * as THREE from "three";

/** Sideways hips travel allowed within a clip before it counts as "not in place". */
export const MAX_DRIFT_M = 0.15;

export function findNode(doc: Document, suffix: string): GltfNode {
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === suffix || n.getName().endsWith(`:${suffix}`));
  if (!node) throw new Error(`no node named ${suffix}`);
  return node;
}

/** World-space scale applied to a node's local translation (Mixamo rigs are often in cm). */
export function parentScale(node: GltfNode): number {
  const parent = node.getParentNode();
  if (!parent) return 1;
  const m = parent.getWorldMatrix();
  return Math.hypot(m[0], m[1], m[2]);
}

export type ClipReport = { name: string; duration: number; driftXZ: number; peakTime: number; rise: number };

export function clipReports(doc: Document, hips: GltfNode): ClipReport[] {
  const scale = parentScale(hips);
  return doc
    .getRoot()
    .listAnimations()
    .map((anim) => {
      const channel = anim
        .listChannels()
        .find((c) => c.getTargetNode() === hips && c.getTargetPath() === "translation");
      const sampler = channel?.getSampler();
      const times = sampler?.getInput()?.getArray();
      const values = sampler?.getOutput()?.getArray();
      const duration = Math.max(
        0,
        ...anim.listSamplers().map((s) => s.getInput()?.getMax([])[0] ?? 0),
      );
      if (!times || !values) return { name: anim.getName(), duration, driftXZ: 0, peakTime: 0, rise: 0 };
      const [x0, y0, z0] = [values[0], values[1], values[2]];
      let driftXZ = 0;
      let peakY = y0;
      let peakTime = times[0];
      for (let i = 0; i < times.length; i++) {
        const [x, y, z] = [values[i * 3], values[i * 3 + 1], values[i * 3 + 2]];
        driftXZ = Math.max(driftXZ, Math.hypot(x - x0, z - z0) * scale);
        if (y > peakY) [peakY, peakTime] = [y, times[i]];
      }
      return { name: anim.getName(), duration, driftXZ, peakTime, rise: (peakY - y0) * scale };
    });
}

type Path = "translation" | "rotation" | "scale";

/** Value of ``node``'s ``path`` channel in ``anim`` at time ``t`` (linear, slerp for rotation). */
export function sampleAt(anim: Animation, node: GltfNode, path: Path, t: number): number[] {
  const channel = anim.listChannels().find((c) => c.getTargetNode() === node && c.getTargetPath() === path);
  const input = channel?.getSampler()?.getInput()?.getArray();
  const output = channel?.getSampler()?.getOutput()?.getArray();
  if (!input || !output) {
    return path === "rotation" ? node.getRotation() : path === "scale" ? node.getScale() : node.getTranslation();
  }
  const n = path === "rotation" ? 4 : 3;
  let i = 0;
  while (i < input.length - 2 && input[i + 1] < t) i++;
  const k = Math.min(1, Math.max(0, (t - input[i]) / (input[i + 1] - input[i] || 1)));
  const a = Array.from(output.slice(i * n, i * n + n));
  const b = Array.from(output.slice((i + 1) * n, (i + 1) * n + n));
  if (n === 4) {
    const q = new THREE.Quaternion(...(a as [number, number, number, number]));
    q.slerp(new THREE.Quaternion(...(b as [number, number, number, number])), k);
    return [q.x, q.y, q.z, q.w];
  }
  return a.map((v, j) => v + (b[j] - v) * k);
}

/**
 * Keep only the part of ``anim`` from ``from`` seconds on, preceded by a ``leadIn``-second ease
 * from the clip's first pose (the normal stance) into the pose at ``from``, so the clip still
 * starts and ends like the other idles.
 */
export function trimWithLeadIn(doc: Document, anim: Animation, from: number, leadIn: number) {
  const buffer = doc.getRoot().listBuffers()[0];
  const steps = 10;
  const ease = (x: number) => x * x * (3 - 2 * x);
  for (const channel of anim.listChannels()) {
    const node = channel.getTargetNode();
    const path = channel.getTargetPath() as Path;
    const sampler = channel.getSampler();
    const input = sampler?.getInput()?.getArray();
    const output = sampler?.getOutput()?.getArray();
    if (!node || !sampler || !input || !output) continue;
    const n = path === "rotation" ? 4 : 3;
    const start = sampleAt(anim, node, path, 0);
    const target = sampleAt(anim, node, path, from);
    const times: number[] = [];
    const values: number[] = [];
    for (let s = 0; s < steps; s++) {
      const w = ease(s / steps);
      times.push((leadIn * s) / steps);
      if (n === 4) {
        const q = new THREE.Quaternion(...(start as [number, number, number, number]));
        q.slerp(new THREE.Quaternion(...(target as [number, number, number, number])), w);
        values.push(q.x, q.y, q.z, q.w);
      } else values.push(...start.map((v, j) => v + (target[j] - v) * w));
    }
    times.push(leadIn);
    values.push(...target);
    for (let i = 0; i < input.length; i++) {
      if (input[i] <= from) continue;
      times.push(leadIn + input[i] - from);
      values.push(...Array.from(output.slice(i * n, i * n + n)));
    }
    sampler
      .setInput(doc.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(new Float32Array(times)))
      .setOutput(doc.createAccessor().setType(n === 4 ? "VEC4" : "VEC3").setBuffer(buffer).setArray(new Float32Array(values)));
  }
}
