/**
 * Smooth the skin weights around the neck and shoulders (docs/ASSET_PIPELINE.md section 4).
 *
 * Meshy's auto-rig binds the shoulder area with sharp boundaries between the clavicle, upper arm,
 * upper spine and neck, so the jersey pinches at the collar and stretches at the armholes when
 * the arms move. Here each vertex in that region takes a blend of its own weights and its mesh
 * neighbors' (a few passes of Laplacian smoothing, strongest in the middle of the region and
 * fading out at its edges), then keeps its four largest influences. Vertices split at UV seams are
 * merged by position first, so the two sides of a seam always move together.
 */
import type { Document } from "@gltf-transform/core";

/** Joints whose influence is smoothed (glTF names, with or without the "mixamorig:" prefix). */
const SHOULDER_JOINTS = ["Spine2", "Neck", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm"];
/** The region in meters (feet at 0): full strength between ``core``, fading to nothing at ``outer``. */
const REGION = { outer: [1.3, 1.74], core: [1.4, 1.66] } as const;
const PASSES = 8;
const STRENGTH = 0.6; // share of the neighbor average taken each pass, at full strength
const PLAYER_HEIGHT_M = 1.98;

const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export function smoothShoulderWeights(doc: Document): { vertices: number } {
  const skin = doc.getRoot().listSkins()[0];
  const jointNames = skin.listJoints().map((j) => j.getName().replace(/^mixamorig:?/, ""));
  const watched = new Set(SHOULDER_JOINTS.map((n) => jointNames.indexOf(n)).filter((i) => i >= 0));
  let changed = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posA = prim.getAttribute("POSITION");
      const jA = prim.getAttribute("JOINTS_0");
      const wA = prim.getAttribute("WEIGHTS_0");
      const idx = prim.getIndices();
      if (!posA || !jA || !wA || !idx) continue;
      const n = posA.getCount();
      const p = [0, 0, 0];
      const ys = new Float64Array(n);
      const keys: string[] = new Array(n);
      let minY = Infinity;
      let maxY = -Infinity;
      for (let v = 0; v < n; v++) {
        posA.getElement(v, p);
        ys[v] = p[1];
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
        keys[v] = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
      }
      const scale = PLAYER_HEIGHT_M / (maxY - minY);

      // Merge vertices that share a position (UV seams).
      const groupOf = new Int32Array(n);
      const groups = new Map<string, number>();
      for (let v = 0; v < n; v++) {
        let g = groups.get(keys[v]);
        if (g === undefined) groups.set(keys[v], (g = groups.size));
        groupOf[v] = g;
      }
      const nG = groups.size;

      // Weights per group (sparse joint -> weight), from the first vertex of each group.
      const weights: Map<number, number>[] = Array.from({ length: nG }, () => new Map());
      const seen = new Uint8Array(nG);
      const yOf = new Float64Array(nG);
      const j = [0, 0, 0, 0];
      const w = [0, 0, 0, 0];
      for (let v = 0; v < n; v++) {
        const g = groupOf[v];
        if (seen[g]) continue;
        seen[g] = 1;
        yOf[g] = (ys[v] - minY) * scale;
        jA.getElement(v, j);
        wA.getElement(v, w);
        for (let k = 0; k < 4; k++) if (w[k] > 0) weights[g].set(j[k], (weights[g].get(j[k]) ?? 0) + w[k]);
      }

      // Which groups to smooth, and how strongly.
      const amount = new Float64Array(nG);
      for (let g = 0; g < nG; g++) {
        const y = yOf[g];
        const fade = smoothstep(REGION.outer[0], REGION.core[0], y) * (1 - smoothstep(REGION.core[1], REGION.outer[1], y));
        const touches = [...weights[g].keys()].some((k) => watched.has(k));
        amount[g] = touches ? fade * STRENGTH : 0;
      }

      // Neighbors over triangle edges, between groups.
      const neighbors: Set<number>[] = Array.from({ length: nG }, () => new Set());
      const ia = idx.getArray()!;
      for (let t = 0; t < ia.length; t += 3) {
        const [a, b, c] = [groupOf[ia[t]], groupOf[ia[t + 1]], groupOf[ia[t + 2]]];
        for (const [x, y] of [[a, b], [b, c], [c, a]]) {
          if (x === y) continue;
          neighbors[x].add(y);
          neighbors[y].add(x);
        }
      }

      let cur = weights;
      for (let pass = 0; pass < PASSES; pass++) {
        const next = cur.map((m) => new Map(m));
        for (let g = 0; g < nG; g++) {
          const s = amount[g];
          if (!s || !neighbors[g].size) continue;
          const avg = new Map<number, number>();
          for (const h of neighbors[g]) for (const [k, x] of cur[h]) avg.set(k, (avg.get(k) ?? 0) + x / neighbors[g].size);
          const blend = new Map<number, number>();
          for (const [k, x] of cur[g]) blend.set(k, (1 - s) * x);
          for (const [k, x] of avg) blend.set(k, (blend.get(k) ?? 0) + s * x);
          next[g] = blend;
        }
        cur = next;
      }

      // Keep the four largest influences, renormalized, and write every vertex of each group.
      for (let v = 0; v < n; v++) {
        const g = groupOf[v];
        if (!amount[g]) continue;
        const top = [...cur[g].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const total = top.reduce((s, [, x]) => s + x, 0) || 1;
        const jo = [0, 0, 0, 0];
        const wo = [0, 0, 0, 0];
        top.forEach(([k, x], i) => {
          jo[i] = k;
          wo[i] = x / total;
        });
        jA.setElement(v, jo);
        wA.setElement(v, wo);
        changed++;
      }
    }
  }
  return { vertices: changed };
}
