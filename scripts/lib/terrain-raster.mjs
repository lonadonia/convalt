/**
 * Photogrammetry terrain helpers (Node, no GPU): OBJ parsing and top-down rasterization.
 *
 * The supplied field is a photogrammetry scan (OBJ, two texture atlases). Rasterizing it from
 * above gives a single-valued height field (top surface) and, per cell, which atlas and UV the
 * visible surface uses — from which an orthophoto is resampled. Coordinates stay in the scan's
 * own units here; metric scaling happens later.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import sharp from 'sharp';

/** Growable typed array. */
class Buf {
  constructor(Type, n = 1 << 20) { this.T = Type; this.a = new Type(n); this.n = 0; }
  push(...vals) {
    if (this.n + vals.length > this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; }
    for (const v of vals) this.a[this.n++] = v;
  }
  done() { return this.a.subarray(0, this.n); }
}

/** Parses an OBJ with positions, UVs and triangle faces (v/vt). Returns flat arrays per material. */
export async function parseObj(file) {
  const P = new Buf(Float32Array), UV = new Buf(Float32Array);
  const faces = new Map(); // material → Buf(Int32) of [v0, t0, v1, t1, v2, t2]
  let cur = faces.get('default') ?? new Buf(Int32Array);
  faces.set('default', cur);
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const c0 = line.charCodeAt(0), c1 = line.charCodeAt(1);
    if (c0 === 118 && c1 === 32) { const p = line.split(/\s+/); P.push(+p[1], +p[2], +p[3]); }
    else if (c0 === 118 && c1 === 116) { const p = line.split(/\s+/); UV.push(+p[1], +p[2]); }
    else if (c0 === 102 && c1 === 32) {
      const p = line.trim().split(/\s+/);
      if (p.length !== 4) throw new Error('only triangles supported: ' + line);
      for (let i = 1; i <= 3; i++) {
        const [v, t] = p[i].split('/');
        cur.push(Number(v) - 1, t ? Number(t) - 1 : -1);
      }
    } else if (line.startsWith('usemtl ')) {
      const m = line.slice(7).trim();
      if (!faces.has(m)) faces.set(m, new Buf(Int32Array));
      cur = faces.get(m);
    }
  }
  const out = { positions: P.done(), uvs: UV.done(), materials: [] };
  for (const [name, b] of faces) if (b.n) out.materials.push({ name, faces: b.done() });
  return out;
}

export function bounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = positions[i + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  return { min, max };
}

/**
 * Top-down rasterization on a regular grid over x (columns) and z (rows).
 * Returns per cell: top height (NaN where the scan has no surface), material index and UV.
 */
export function rasterize(obj, { x0, z0, cell, cols, rows }) {
  const height = new Float32Array(cols * rows).fill(-Infinity);
  const mat = new Int8Array(cols * rows).fill(-1);
  const u = new Float32Array(cols * rows), v = new Float32Array(cols * rows);
  const P = obj.positions, UV = obj.uvs;
  obj.materials.forEach((m, mi) => {
    const F = m.faces;
    for (let f = 0; f < F.length; f += 6) {
      const a = F[f], b = F[f + 2], c = F[f + 4];
      const ta = F[f + 1], tb = F[f + 3], tc = F[f + 5];
      const ax = (P[a * 3] - x0) / cell, az = (P[a * 3 + 2] - z0) / cell, ay = P[a * 3 + 1];
      const bx = (P[b * 3] - x0) / cell, bz = (P[b * 3 + 2] - z0) / cell, by = P[b * 3 + 1];
      const cx = (P[c * 3] - x0) / cell, cz = (P[c * 3 + 2] - z0) / cell, cy = P[c * 3 + 1];
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(cols - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minZ = Math.max(0, Math.floor(Math.min(az, bz, cz))), maxZ = Math.min(rows - 1, Math.ceil(Math.max(az, bz, cz)));
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-12) continue;
      for (let z = minZ; z <= maxZ; z++) {
        const pz = z + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den;
          const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const y = w0 * ay + w1 * by + w2 * cy;
          const i = z * cols + x;
          if (y <= height[i]) continue;
          height[i] = y;
          mat[i] = mi;
          if (ta >= 0) {
            u[i] = w0 * UV[ta * 2] + w1 * UV[tb * 2] + w2 * UV[tc * 2];
            v[i] = w0 * UV[ta * 2 + 1] + w1 * UV[tb * 2 + 1] + w2 * UV[tc * 2 + 1];
          }
        }
      }
    }
  });
  for (let i = 0; i < height.length; i++) if (height[i] === -Infinity) height[i] = NaN;
  return { height, mat, u, v, cols, rows, x0, z0, cell };
}

/** Decodes a texture to raw RGB (8 bit) for sampling. */
export async function loadTexture(file) {
  const { data, info } = await sharp(file, { limitInputPixels: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Bilinear sample (u right, v up — OBJ convention). */
export function sampleTex(t, u, v, out) {
  const x = u * t.w - 0.5, y = (1 - v) * t.h - 0.5;
  const x0 = Math.max(0, Math.min(t.w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(t.h - 1, Math.floor(y)));
  const x1 = Math.min(t.w - 1, x0 + 1), y1 = Math.min(t.h - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
  for (let k = 0; k < 3; k++) {
    const a = t.data[(y0 * t.w + x0) * 3 + k], b = t.data[(y0 * t.w + x1) * 3 + k];
    const c = t.data[(y1 * t.w + x0) * 3 + k], d = t.data[(y1 * t.w + x1) * 3 + k];
    out[k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return out;
}

/** Orthophoto (RGB) from a raster and the material textures (index-aligned with obj.materials). */
export function orthophoto(r, textures, fill = [128, 128, 128]) {
  const img = Buffer.alloc(r.cols * r.rows * 3);
  const px = [0, 0, 0];
  for (let i = 0; i < r.cols * r.rows; i++) {
    const m = r.mat[i];
    if (m < 0 || !textures[m]) { img[i * 3] = fill[0]; img[i * 3 + 1] = fill[1]; img[i * 3 + 2] = fill[2]; continue; }
    sampleTex(textures[m], r.u[i], r.v[i], px);
    img[i * 3] = px[0]; img[i * 3 + 1] = px[1]; img[i * 3 + 2] = px[2];
  }
  return img;
}
