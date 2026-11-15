/**
 * Build the uniform mask from the base player texture, with no hand painting.
 *
 *   pnpm assets:mask   # assets-src/base/textures/texture_0.png -> assets-src/masks/jersey_mask.png
 *
 * The base player wears a plain white jersey and shorts with black socks and sneakers, so in UV
 * space the uniform is the bright, unsaturated pixels. Skin is saturated and hair and shoes are
 * dark. Small bright blobs (eye whites, teeth) are dropped and the mask is dilated a little to
 * cover UV island edges. White = uniform, black = everything else.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const INPUT = path.join(repoRoot, "assets-src/base/textures/texture_0.png");
const OUTPUT = path.join(repoRoot, "assets-src/masks/jersey_mask.png");
const WEB_OUTPUT = path.join(repoRoot, "web/public/textures/player/uniform_mask.webp");
const MESH = path.join(repoRoot, "assets-src/base/meshy_rigged.glb");
const WEB_SIZE = 1024;
const PLAYER_HEIGHT_M = 1.98;
const WAIST_M = 1.06; // jersey above, shorts below (matches components/scene/tint-material.ts)
const TRIM_M = 0.028; // collar and armhole trim width
const STRIPE_NORMAL = 0.8; // shorts texels facing this far sideways get the side stripe
const UNIFORM_Y = [0.5, 1.75]; // meters: below are socks and shoes, above is hair
const SKIN_SATURATION = 0.25; // skin is more saturated than this, fabric (even in shadow) less
const COLLAR_MIN_M = 1.52; // trim only at the collar (above this) or the armholes (beyond ARMHOLE_MIN_X)
const ARMHOLE_MIN_X = 0.12;
const ARMHOLE_MIN_Y = 1.32; // below this the hanging arms touch the jersey sides

const MIN_VALUE = 0.42; // fabric in shadow is still lighter than this
const MAX_SATURATION = 0.16; // skin is well above this
const MIN_BLOB_FRACTION = 0.00004; // of all pixels: removes eyes and teeth, keeps small islands
const DILATE_PX = 2;

export function classify(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const value = max / 255;
    const saturation = max === 0 ? 0 : (max - min) / max;
    mask[i] = value >= MIN_VALUE && saturation <= MAX_SATURATION ? 1 : 0;
  }
  return mask;
}

/** Zero out 4-connected components smaller than ``minSize`` pixels. */
export function dropSmallBlobs(mask: Uint8Array, width: number, height: number, minSize: number) {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const blob: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    blob.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      blob.push(i);
      const x = i % width;
      const neighbors = [i - width, i + width, x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1];
      for (const n of neighbors) {
        if (n >= 0 && n < mask.length && mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (blob.length < minSize) for (const i of blob) mask[i] = 0;
  }
  return mask;
}

export function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  let cur = mask;
  for (let step = 0; step < radius; step++) {
    const next = cur.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (cur[i]) continue;
        if (
          (x > 0 && cur[i - 1]) ||
          (x < width - 1 && cur[i + 1]) ||
          (y > 0 && cur[i - width]) ||
          (y < height - 1 && cur[i + width])
        ) {
          next[i] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

async function main() {
  const { data, info } = await sharp(INPUT).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let mask = classify(new Uint8Array(data), width, height);
  mask = dropSmallBlobs(mask, width, height, Math.round(width * height * MIN_BLOB_FRACTION));
  mask = dilate(mask, width, height, DILATE_PX);

  const out = Buffer.alloc(width * height);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 255 : 0;
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  await sharp(out, { raw: { width, height, channels: 1 } }).png({ compressionLevel: 9 }).toFile(OUTPUT);
  const share = mask.reduce((s, v) => s + v, 0) / mask.length;
  console.log(`wrote ${path.relative(repoRoot, OUTPUT)} (${width}x${height}, uniform ${(share * 100).toFixed(1)}%)`);

  // Runtime channel mask for the tint shader (approach B): R uniform, G trim, B side stripe.
  const channels = await bakeChannels(mask, width, WEB_SIZE);
  fs.mkdirSync(path.dirname(WEB_OUTPUT), { recursive: true });
  await sharp(channels, { raw: { width: WEB_SIZE, height: WEB_SIZE, channels: 3 } })
    .webp({ lossless: true })
    .toFile(WEB_OUTPUT);
  console.log(`wrote ${path.relative(repoRoot, WEB_OUTPUT)}`);
}

/**
 * Classify whole triangles as uniform (1) or not (0), by 3D height and color: between the shorts
 * hem and the collar, anything that isn't skin-colored is uniform, however dark the fold shadow.
 * Then a majority filter over mesh neighbors (shared edges, matched by position across UV seams)
 * flips thin strips of misvotes, since skin and uniform each come in large connected patches.
 */
function classifyTriangles(
  pos: ArrayLike<number>,
  idx: ArrayLike<number>,
  uv: ArrayLike<number>,
  base: Buffer,
  maskSize: number,
  minY: number,
  scale: number,
): Uint8Array {
  const nTris = idx.length / 3;
  const vote = new Uint8Array(nTris);
  const inBand = new Uint8Array(nTris);
  const px = (v: number) =>
    Math.min(maskSize - 1, Math.floor(uv[v * 2 + 1] * maskSize)) * maskSize +
    Math.min(maskSize - 1, Math.floor(uv[v * 2] * maskSize));
  for (let t = 0; t < nTris; t++) {
    const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    const y = ((pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3 - minY) * scale;
    if (y <= UNIFORM_Y[0] || y >= UNIFORM_Y[1]) continue;
    inBand[t] = 1;
    const cu = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3;
    const cv = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3;
    const center = Math.min(maskSize - 1, Math.floor(cv * maskSize)) * maskSize + Math.min(maskSize - 1, Math.floor(cu * maskSize));
    let [sr, sg, sb] = [0, 0, 0];
    for (const i of [px(a), px(b), px(c), center, center]) {
      [sr, sg, sb] = [sr + base[i * 3], sg + base[i * 3 + 1], sb + base[i * 3 + 2]];
    }
    const max = Math.max(sr, sg, sb);
    vote[t] = max > 0 && (max - Math.min(sr, sg, sb)) / max < SKIN_SATURATION ? 1 : 0;
  }

  // Edge adjacency by rounded position (UV seams split vertices but not positions).
  const key = (v: number) =>
    `${Math.round(pos[v * 3] * 1e4)},${Math.round(pos[v * 3 + 1] * 1e4)},${Math.round(pos[v * 3 + 2] * 1e4)}`;
  const edges = new Map<string, number[]>();
  for (let t = 0; t < nTris; t++) {
    const k = [key(idx[t * 3]), key(idx[t * 3 + 1]), key(idx[t * 3 + 2])];
    for (const [p, q] of [[k[0], k[1]], [k[1], k[2]], [k[2], k[0]]]) {
      const e = p < q ? `${p}|${q}` : `${q}|${p}`;
      (edges.get(e) ?? edges.set(e, []).get(e)!).push(t);
    }
  }
  const neighbors: number[][] = Array.from({ length: nTris }, () => []);
  for (const tris of edges.values()) {
    for (const t of tris) for (const u of tris) if (t !== u) neighbors[t].push(u);
  }

  let cur = vote;
  for (let pass = 0; pass < 3; pass++) {
    const next = cur.slice();
    for (let t = 0; t < nTris; t++) {
      if (!inBand[t] || neighbors[t].length < 2) continue;
      const yes = neighbors[t].reduce((s, u) => s + cur[u], 0);
      if (yes * 2 > neighbors[t].length) next[t] = 1;
      else if (yes * 2 < neighbors[t].length) next[t] = 0;
    }
    cur = next;
  }
  return cur;
}

/**
 * Bake trim and stripe channels by rasterizing the mesh in UV space, so every texel knows its
 * bind-pose position and normal. Trim: uniform texels above the waist within TRIM_M of skin
 * (collar and armholes). Stripe: shorts texels on the outer side of each leg.
 */
async function bakeChannels(uniform: Uint8Array, maskSize: number, size: number): Promise<Buffer> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(MESH);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute("POSITION")!.getArray()!;
  const nor = prim.getAttribute("NORMAL")!.getArray()!;
  const uv = prim.getAttribute("TEXCOORD_0")!.getArray()!;
  const idx = prim.getIndices()!.getArray()!;
  const nVerts = uv.length / 2;
  const minY = Math.min(...Array.from({ length: nVerts }, (_, i) => pos[i * 3 + 1]));
  const maxY = Math.max(...Array.from({ length: nVerts }, (_, i) => pos[i * 3 + 1]));
  const scale = PLAYER_HEIGHT_M / (maxY - minY); // to meters, feet at 0

  // Skin vertices (not uniform, and not dark shoes or hair) into a spatial grid.
  const base = await sharp(INPUT).removeAlpha().resize(maskSize, maskSize).raw().toBuffer();
  const cell = TRIM_M;
  const grid = new Map<string, number[][]>();
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let v = 0; v < nVerts; v++) {
    const px = Math.min(maskSize - 1, Math.max(0, Math.floor(uv[v * 2] * maskSize)));
    const py = Math.min(maskSize - 1, Math.max(0, Math.floor(uv[v * 2 + 1] * maskSize)));
    const i = py * maskSize + px;
    if (uniform[i]) continue;
    const [r, g, b] = [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
    const max = Math.max(r, g, b);
    if (max < 60 || (max - Math.min(r, g, b)) / max < 0.25) continue; // shoes, socks, hair
    const p = [pos[v * 3] * scale, (pos[v * 3 + 1] - minY) * scale, pos[v * 3 + 2] * scale];
    const k = key(p[0], p[1], p[2]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
  }
  const nearSkin = (x: number, y: number, z: number) => {
    const [cx, cy, cz] = [Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const p of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? [])
            if (Math.hypot(p[0] - x, p[1] - y, p[2] - z) < TRIM_M) return true;
    return false;
  };

  const out = Buffer.alloc(size * size * 3);
  const covered = new Uint8Array(size * size);
  const ratio = maskSize / size;
  const uniformTris = classifyTriangles(pos, idx, uv, base, maskSize, minY, scale);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const [ax, ay, bx, by, cx, cy] = [a, b, c].flatMap((v) => [uv[v * 2] * size, uv[v * 2 + 1] * size]);
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const triUniform = uniformTris[t / 3] === 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [sx, sy] = [x + 0.5, y + 0.5];
        const w0 = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) / area;
        const w1 = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
        const o = y * size + x;
        covered[o] = 1;
        if (!triUniform) continue;
        const lerp = (arr: ArrayLike<number>, k: number) => arr[a * 3 + k] * w0 + arr[b * 3 + k] * w1 + arr[c * 3 + k] * w2;
        const px = lerp(pos, 0) * scale;
        const py = (lerp(pos, 1) - minY) * scale;
        const pz = lerp(pos, 2) * scale;
        const nx = lerp(nor, 0);
        const nLen = Math.hypot(nx, lerp(nor, 1), lerp(nor, 2)) || 1;
        out[o * 3] = 255;
        if (py > WAIST_M && (py > COLLAR_MIN_M || (Math.abs(px) > ARMHOLE_MIN_X && py > ARMHOLE_MIN_Y)) && nearSkin(px, py, pz)) out[o * 3 + 1] = 255;
        if (py < WAIST_M && Math.abs(px) > 0.1 && Math.sign(nx) === Math.sign(px) && Math.abs(nx / nLen) > STRIPE_NORMAL) {
          out[o * 3 + 2] = 255;
        }
      }
    }
  }
  // Islands are packed edge to edge, so texture filtering at a border reads the neighbor island.
  // OR in the dilated per-texel color mask, which reaches over the borders (and over Meshy's
  // padding), so seams don't come out untinted.
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [mx, my] = [Math.floor(x * ratio), Math.floor(y * ratio)];
      let hit = 0;
      for (let dy = 0; dy < ratio && !hit; dy++)
        for (let dx = 0; dx < ratio && !hit; dx++) hit = uniform[(my + dy) * maskSize + mx + dx];
      if (hit) {
        out[(y * size + x) * 3] = 255;
        covered[y * size + x] = 1;
      }
    }
  // Bleed into the gutters between UV islands so texture filtering doesn't pull in black.
  for (let pass = 0; pass < 8; pass++) {
    const next = Buffer.from(out);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const o = y * size + x;
        if (covered[o]) continue;
        for (const n of [o - 1, o + 1, o - size, o + size]) {
          if (n < 0 || n >= size * size || !covered[n]) continue;
          next[o * 3] = out[n * 3];
          next[o * 3 + 1] = out[n * 3 + 1];
          next[o * 3 + 2] = out[n * 3 + 2];
          covered[o] = 2;
          break;
        }
      }
    for (let i = 0; i < covered.length; i++) if (covered[i] === 2) covered[i] = 1;
    out.set(next);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
