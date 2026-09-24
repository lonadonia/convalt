#!/usr/bin/env node
/**
 * Asset preparation for the Convalt module story.
 *
 *   node scripts/prepare-assets.mjs            (or: npm run assets)
 *
 * 1. Safely extracts simple-72-cell-solar-panel.zip (and its nested source zip) into
 *    asset-source/solar-panel/ without touching the original archive.
 * 2. Parses "solar panel.fbx" with three.js FBXLoader (geometry only).
 * 3. Normalizes the mesh: removes the Blender export transform (-90° X, ×100), keeps metres,
 *    centres it, uses flat face normals and converts UVs to glTF convention.
 * 4. Re-bakes the supplied normal map into a detail-only map for flat normals (see rebakeNormals()).
 * 5. Builds 2K (desktop) and 1K (mobile) texture sets as WebP:
 *      baseColor (sRGB), metallicRoughness (G = roughness, B = metalness, linear), normal (linear).
 * 6. Writes self-contained GLBs to public/models/, validates them with the Khronos glTF validator
 *    and writes docs/asset-report.json.
 *
 * Only the leaner "textures/" set is used; the copies inside source/simple_solar_panel_72c.zip were
 * verified pixel-identical (they only add an opaque alpha channel). The 4K sources are never shipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import validator from 'gltf-validator';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = path.join(ROOT, 'simple-72-cell-solar-panel.zip');
// Extraction target (override with CONVALT_ASSET_SOURCE to extract elsewhere, e.g. for a clean check).
const SRC = process.env.CONVALT_ASSET_SOURCE ? path.resolve(process.env.CONVALT_ASSET_SOURCE) : path.join(ROOT, 'asset-source', 'solar-panel');
const FBX = path.join(SRC, 'source', 'extracted', 'solar panel.fbx');
const TEX = path.join(SRC, 'textures');
const OUT = path.join(ROOT, 'public', 'models');
const DOCS = path.join(ROOT, 'docs');
const WORK = path.join(path.dirname(SRC), 'work');

const REBAKE_SIZE = 2048;
const DETAIL_DEADZONE_DEG = 1.5; // soft-shrink sub-1.5° grain: cleaner glass reflections, far smaller lossless files
const SETS = [
  { name: '2k', size: 2048, baseQuality: 90, ormQuality: 92 },
  { name: '1k', size: 1024, baseQuality: 88, ormQuality: 90 },
];

const log = (...a) => console.log('•', ...a);

// ---------------------------------------------------------------------------------------------
// 1. Extraction (zip-slip safe, never overwrites the original archive)
// ---------------------------------------------------------------------------------------------
function safeExtract(zipBytes, destDir) {
  const entries = unzipSync(new Uint8Array(zipBytes));
  const written = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const normalized = path.normalize(name);
    if (path.isAbsolute(normalized) || normalized.split(path.sep).includes('..')) {
      throw new Error(`Refusing unsafe archive entry: ${name}`);
    }
    const target = path.join(destDir, normalized);
    if (!target.startsWith(destDir)) throw new Error(`Refusing unsafe archive entry: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written.push(normalized);
  }
  return written;
}

function extractSources() {
  if (fs.existsSync(FBX) && fs.existsSync(path.join(TEX, 'solar_panel_diffuse.png'))) {
    log('Sources already extracted:', path.relative(ROOT, SRC));
    return;
  }
  if (!fs.existsSync(ZIP)) throw new Error(`Missing ${path.relative(ROOT, ZIP)}`);
  fs.mkdirSync(SRC, { recursive: true });
  const outer = safeExtract(fs.readFileSync(ZIP), SRC);
  log('Extracted', outer.length, 'entries from', path.basename(ZIP));
  const inner = safeExtract(fs.readFileSync(path.join(SRC, 'source', 'simple_solar_panel_72c.zip')), path.join(SRC, 'source', 'extracted'));
  log('Extracted', inner.length, 'entries from nested source zip');
}

// ---------------------------------------------------------------------------------------------
// 2. FBX parsing (geometry only)
// ---------------------------------------------------------------------------------------------
async function loadFbxGeometry() {
  // FBXLoader creates <img> elements for referenced textures; images are not needed here.
  globalThis.document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_) {} }) };
  globalThis.self ??= globalThis;
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const warn = console.warn;
  const skipped = [];
  console.warn = (...a) => skipped.push(format(...a));
  const buf = fs.readFileSync(FBX);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path.dirname(FBX) + '/');
  console.warn = warn;
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (meshes.length !== 1) throw new Error(`Expected one mesh, found ${meshes.length}`);
  const mesh = meshes[0];
  const g = mesh.geometry;
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const raw = buf.toString('latin1');
  return {
    name: mesh.name,
    nodeTransform: { rotation: mesh.rotation.toArray().slice(0, 3), scale: mesh.scale.toArray() },
    position: g.attributes.position.array,
    normal: g.attributes.normal.array,
    uv: g.attributes.uv.array,
    materialName: material.name,
    loaderWarnings: skipped,
    textureRefs: [...new Set(raw.match(/[\w\- .]{1,120}\.(png|jpe?g|tga|tif)/gi) ?? [])],
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Geometry normalization
// ---------------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function buildTriangles(src) {
  const { position: P, uv: U, normal: N } = src;
  const count = P.length / 3;
  // Bounds (local mesh space is already metres; the ×100 node scale is dropped)
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[3 * i + k]); max[k] = Math.max(max[k], P[3 * i + k]); }
  const center = min.map((m, k) => (m + max[k]) / 2);
  const tris = [];
  for (let t = 0; t < count / 3; t++) {
    const v = [0, 1, 2].map((k) => {
      const i = 3 * t + k;
      return {
        p: [P[3 * i] - center[0], P[3 * i + 1] - center[1], P[3 * i + 2] - center[2]],
        n: [N[3 * i], N[3 * i + 1], N[3 * i + 2]],
        uv: [U[2 * i], U[2 * i + 1]], // FBX / three convention: v up
      };
    });
    const fn = norm(cross(sub(v[1].p, v[0].p), sub(v[2].p, v[0].p)));
    let chart = 'side';
    if (fn[2] > 0.99) chart = 'front';
    else if (fn[2] < -0.99) chart = 'back';
    tris.push({ v, fn, chart });
  }
  return { tris, bounds: { min: sub(min, center), max: sub(max, center), size: sub(max, min) }, center };
}

function uvRect(tris, chart) {
  const r = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of tris) if (t.chart === chart) for (const v of t.v) { r[0] = Math.min(r[0], v.uv[0]); r[1] = Math.min(r[1], v.uv[1]); r[2] = Math.max(r[2], v.uv[0]); r[3] = Math.max(r[3], v.uv[1]); }
  return r; // [u0, v0, u1, v1] in v-up convention
}

function faceTangent(t) {
  // dP/du and dP/dv (v up = "up" in the image, i.e. +Y of an OpenGL / glTF normal map)
  const e1 = sub(t.v[1].p, t.v[0].p), e2 = sub(t.v[2].p, t.v[0].p);
  const du1 = t.v[1].uv[0] - t.v[0].uv[0], dv1 = t.v[1].uv[1] - t.v[0].uv[1];
  const du2 = t.v[2].uv[0] - t.v[0].uv[0], dv2 = t.v[2].uv[1] - t.v[0].uv[1];
  const r = 1 / (du1 * dv2 - du2 * dv1);
  const T = [0, 1, 2].map((k) => (e1[k] * dv2 - e2[k] * dv1) * r);
  const B = [0, 1, 2].map((k) => (e2[k] * du1 - e1[k] * du2) * r);
  const N = t.fn;
  const To = norm(sub(T, N.map((x) => x * dot(N, T))));
  const w = dot(cross(N, To), B) < 0 ? -1 : 1;
  return [...To, w];
}

function weldFlat(tris) {
  const positions = [], normals = [], uvs = [], tangents = [], indices = [];
  const map = new Map();
  for (const t of tris) {
    const tangent = faceTangent(t);
    for (const v of t.v) {
      const key = [...v.p.map((x) => x.toFixed(5)), ...t.fn.map((x) => x.toFixed(3)), ...v.uv.map((x) => x.toFixed(5))].join(',');
      let idx = map.get(key);
      if (idx === undefined) {
        idx = positions.length / 3;
        map.set(key, idx);
        positions.push(...v.p);
        normals.push(...t.fn);
        tangents.push(...tangent);
        uvs.push(v.uv[0], 1 - v.uv[1]); // glTF: v down
      }
      indices.push(idx);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), tangents: new Float32Array(tangents), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

// ---------------------------------------------------------------------------------------------
// 4. Normal-map re-bake
// ---------------------------------------------------------------------------------------------
/**
 * The supplied normal map was baked against smoothed low-poly normals (every vertex normal of the
 * slab is averaged, tilted ~45° at the corners) and against a triangulation that does not match the
 * FBX polygons as triangulated by FBXLoader. Its large-scale content therefore only compensates for
 * that bake-time normal field. Measured with a MikkTSpace-style basis, it leaves a mean error of
 * ~38° (OpenGL green) / ~66° (DirectX green) on the flat front face in three.js.
 *
 * Fix: for each large planar chart (front, back) estimate the low-frequency field L with a masked,
 * normalized box-Gaussian blur (edges and fine grooves are excluded from the estimate), then rotate
 * every texel by the minimal rotation taking L to +Z. What remains is the genuine surface detail
 * (frame-lip bevel, cell and busbar lines) relative to a flat face. The 30 mm side strips carry
 * no usable detail and are written flat. Output uses the OpenGL/glTF convention (+Y = up in image).
 */
function rasterizeCharts(tris, W, H) {
  const chartId = new Uint8Array(W * H); // 0 none, 1 front, 2 back, 3 side
  const ids = { front: 1, back: 2, side: 3 };
  for (const t of tris) {
    const px = t.v.map((v) => [v.uv[0] * W, (1 - v.uv[1]) * H]);
    const area = (px[1][0] - px[0][0]) * (px[2][1] - px[0][1]) - (px[2][0] - px[0][0]) * (px[1][1] - px[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...px.map((p) => p[0])))), x1 = Math.min(W - 1, Math.ceil(Math.max(...px.map((p) => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...px.map((p) => p[1])))), y1 = Math.min(H - 1, Math.ceil(Math.max(...px.map((p) => p[1]))));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const w0 = ((px[1][0] - cx) * (px[2][1] - cy) - (px[2][0] - cx) * (px[1][1] - cy)) / area;
      const w1 = ((px[2][0] - cx) * (px[0][1] - cy) - (px[0][0] - cx) * (px[2][1] - cy)) / area;
      const w2 = 1 - w0 - w1;
      const e = -1e-6;
      if (w0 >= e && w1 >= e && w2 >= e) chartId[y * W + x] = ids[t.chart];
    }
  }
  return chartId;
}

function erode(mask, W, H, iterations) {
  let cur = mask.slice();
  for (let it = 0; it < iterations; it++) {
    const next = cur.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!cur[i]) continue;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !cur[i - 1] || !cur[i + 1] || !cur[i - W] || !cur[i + W]) next[i] = 0;
    }
    cur = next;
  }
  return cur;
}

function boxBlur(src, W, H, r) {
  // Separable running-sum box blur, clamp-to-edge, single channel.
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const d = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / d;
      acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / d;
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

const gaussianish = (ch, W, H, r) => boxBlur(boxBlur(boxBlur(ch, W, H, r), W, H, r), W, H, r);

function rotateToZ(L, m) {
  // Minimal rotation taking unit vector L onto +Z, applied to m (Rodrigues).
  const c = L[2];
  const k = [L[1], -L[0], 0]; // L × Z
  const s = Math.hypot(k[0], k[1]);
  if (s < 1e-8) return c > 0 ? m : [m[0], -m[1], -m[2]];
  const kx = k[0] / s, ky = k[1] / s;
  const kv = [ky * m[2], -kx * m[2], kx * m[1] - ky * m[0]]; // k × m (kz = 0)
  const kdm = kx * m[0] + ky * m[1];
  return [
    m[0] * c + kv[0] * s + kx * kdm * (1 - c),
    m[1] * c + kv[1] * s + ky * kdm * (1 - c),
    m[2] * c + kv[2] * s,
  ];
}

function shrinkTowardZ(d, deg) {
  // Rotate d toward +Z by up to `deg` degrees (soft threshold on the detail angle).
  const ang = Math.acos(Math.min(1, Math.max(-1, d[2])));
  const cut = (deg * Math.PI) / 180;
  if (ang <= cut) return [0, 0, 1];
  const s = Math.hypot(d[0], d[1]);
  const a = ang - cut;
  return [(d[0] / s) * Math.sin(a), (d[1] / s) * Math.sin(a), Math.cos(a)];
}

async function rebakeNormals(tris) {
  const W = REBAKE_SIZE, H = REBAKE_SIZE;
  const { data } = await sharp(path.join(TEX, 'solar_panel_normal.png')).resize(W, H, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = W * H;
  const mx = new Float32Array(n), my = new Float32Array(n), mz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = norm([data[3 * i] / 127.5 - 1, data[3 * i + 1] / 127.5 - 1, data[3 * i + 2] / 127.5 - 1]);
    mx[i] = v[0]; my[i] = v[1]; mz[i] = v[2];
  }
  const chartId = rasterizeCharts(tris, W, H);
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { out[3 * i + 2] = 1; }
  const stats = {};
  const EDGE_MARGIN = 20; // texels excluded from the low-frequency estimate (frame-lip bevel)
  const R = 16; // 3× box r=16 ≈ Gaussian σ ≈ 16 texels (≈ 19 mm on the front face at 2K)

  for (const [chartName, id] of [['front', 1], ['back', 2]]) {
    const chartMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) chartMask[i] = chartId[i] === id ? 1 : 0;
    let weight = erode(chartMask, W, H, EDGE_MARGIN);
    let L;
    for (let pass = 0; pass < 2; pass++) {
      const wx = new Float32Array(n), wy = new Float32Array(n), wz = new Float32Array(n), ww = new Float32Array(n);
      for (let i = 0; i < n; i++) { const w = weight[i]; if (!w) continue; wx[i] = mx[i] * w; wy[i] = my[i] * w; wz[i] = mz[i] * w; ww[i] = w; }
      const bx = gaussianish(wx, W, H, R), by = gaussianish(wy, W, H, R), bz = gaussianish(wz, W, H, R), bw = gaussianish(ww, W, H, R);
      L = { x: bx, y: by, z: bz, w: bw };
      if (pass === 0) {
        // Reject texels that deviate strongly from the local field (grooves, lines) and re-estimate.
        const refined = weight.slice();
        for (let i = 0; i < n; i++) {
          if (!weight[i] || bw[i] < 1e-4) continue;
          const l = norm([bx[i], by[i], bz[i]]);
          if (dot(l, [mx[i], my[i], mz[i]]) < Math.cos((4 * Math.PI) / 180)) refined[i] = 0;
        }
        weight = refined;
      }
    }
    let count = 0, sumAng = 0, over5 = 0, maxAng = 0, missing = 0;
    for (let i = 0; i < n; i++) {
      if (!chartMask[i]) continue;
      if (L.w[i] < 1e-5) { missing++; continue; }
      const l = norm([L.x[i], L.y[i], L.z[i]]);
      const d = shrinkTowardZ(norm(rotateToZ(l, [mx[i], my[i], mz[i]])), DETAIL_DEADZONE_DEG);
      out[3 * i] = d[0]; out[3 * i + 1] = d[1]; out[3 * i + 2] = d[2];
      const ang = (Math.acos(Math.min(1, d[2])) * 180) / Math.PI;
      count++; sumAng += ang; maxAng = Math.max(maxAng, ang); if (ang > 5) over5++;
    }
    stats[chartName] = {
      texels: count,
      meanDetailDeg: +(sumAng / count).toFixed(2),
      maxDetailDeg: +maxAng.toFixed(1),
      pctOver5Deg: +((100 * over5) / count).toFixed(2),
      unresolvedTexels: missing,
    };
  }

  // Dilate front/back charts 6 texels into the gutter so mip levels do not bleed flat texels in.
  for (let it = 0; it < 6; it++) {
    const src = out.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (chartId[i]) continue;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (chartId[j] === 1 || chartId[j] === 2) { out[3 * i] = src[3 * j]; out[3 * i + 1] = src[3 * j + 1]; out[3 * i + 2] = src[3 * j + 2]; chartId[i] = chartId[j] + 10; break; }
      }
    }
    for (let i = 0; i < n; i++) if (chartId[i] > 10) chartId[i] -= 10;
  }
  return { vectors: out, size: W, stats };
}

function encodeNormals(vectors, W) {
  const n = W * W;
  const rgb = Buffer.alloc(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) rgb[3 * i + k] = Math.round(Math.min(1, Math.max(-1, vectors[3 * i + k])) * 127.5 + 127.5);
  return rgb;
}

function downsampleNormals(vectors, W) {
  const w = W / 2, out = new Float32Array(3 * w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const i = (2 * y + dy) * W + 2 * x + dx; for (let k = 0; k < 3; k++) acc[k] += vectors[3 * i + k]; }
    const v = norm(acc);
    out.set(v, 3 * (y * w + x));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 5. Texture sets
// ---------------------------------------------------------------------------------------------
async function buildTextureSet(set, normalVectors2k) {
  const { size } = set;
  const baseColor = await sharp(path.join(TEX, 'solar_panel_diffuse.png')).resize(size, size, { kernel: 'lanczos3' }).removeAlpha()
    .webp({ quality: set.baseQuality, effort: 6, smartSubsample: true }).toBuffer();
  const rough = await sharp(path.join(TEX, 'solar_panel_roughness.png')).resize(size, size).extractChannel(0).raw().toBuffer();
  const metal = await sharp(path.join(TEX, 'solar_panel_metalness.png')).resize(size, size).extractChannel(0).raw().toBuffer();
  const orm = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { orm[3 * i] = 255; orm[3 * i + 1] = rough[i]; orm[3 * i + 2] = metal[i]; }
  const metallicRoughness = await sharp(orm, { raw: { width: size, height: size, channels: 3 } })
    .webp({ quality: set.ormQuality, effort: 6, smartSubsample: false }).toBuffer();
  const vectors = size === REBAKE_SIZE ? normalVectors2k : downsampleNormals(normalVectors2k, REBAKE_SIZE);
  const normal = await sharp(encodeNormals(vectors, size), { raw: { width: size, height: size, channels: 3 } })
    .webp({ lossless: true, effort: 6 }).toBuffer();
  return { baseColor, metallicRoughness, normal };
}

async function sampleRegionColor(file, rectUV) {
  // Average sRGB colour of a UV rect (v-up convention) — used to tint procedural parts.
  const meta = await sharp(file).metadata();
  const left = Math.round(rectUV[0] * meta.width), right = Math.round(rectUV[2] * meta.width);
  const top = Math.round((1 - rectUV[3]) * meta.height), bottom = Math.round((1 - rectUV[1]) * meta.height);
  const region = await sharp(file).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
  const { channels } = await sharp(region).stats();
  return '#' + channels.slice(0, 3).map((c) => Math.round(c.mean).toString(16).padStart(2, '0')).join('');
}

async function measureFrameLip(frontRect) {
  // Walk inward from the left edge of the front chart at mid-height and find where the light frame
  // lip gives way to the dark cell field. Returns the width in metres.
  const file = path.join(TEX, 'solar_panel_diffuse.png');
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  // 6 cell rows: sample through the centre of the third row (mid-height is a white inter-row gap).
  const midRow = Math.round((1 - (frontRect[1] + (frontRect[3] - frontRect[1]) * (2.5 / 6))) * info.height);
  const startX = Math.ceil(frontRect[0] * W) + 1;
  let x = startX;
  for (; x < startX + 400; x++) {
    const i = 3 * (midRow * W + x);
    if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 90) break;
  }
  const texels = x - startX;
  const metresPerTexel = 1.864 / ((frontRect[2] - frontRect[0]) * W);
  return +(texels * metresPerTexel).toFixed(4);
}

// ---------------------------------------------------------------------------------------------
// 6. GLB assembly and validation
// ---------------------------------------------------------------------------------------------
async function writeGlb(file, geo, textures, extras) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'convalt prepare-assets (gltf-transform)';
  const buffer = doc.createBuffer();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const pos = doc.createAccessor('POSITION').setType('VEC3').setArray(geo.positions).setBuffer(buffer);
  const nor = doc.createAccessor('NORMAL').setType('VEC3').setArray(geo.normals).setBuffer(buffer);
  const tan = doc.createAccessor('TANGENT').setType('VEC4').setArray(geo.tangents).setBuffer(buffer);
  const uv = doc.createAccessor('TEXCOORD_0').setType('VEC2').setArray(geo.uvs).setBuffer(buffer);
  const idx = doc.createAccessor('indices').setType('SCALAR').setArray(geo.indices).setBuffer(buffer);
  const tex = (name, image) => doc.createTexture(name).setImage(new Uint8Array(image)).setMimeType('image/webp').setURI(`${name}.webp`);
  const material = doc.createMaterial('SolarPanel')
    .setBaseColorTexture(tex('baseColor', textures.baseColor))
    .setMetallicRoughnessTexture(tex('metallicRoughness', textures.metallicRoughness))
    .setNormalTexture(tex('normal', textures.normal))
    .setMetallicFactor(1)
    .setRoughnessFactor(1)
    .setDoubleSided(false);
  for (const info of [material.getBaseColorTextureInfo(), material.getMetallicRoughnessTextureInfo(), material.getNormalTextureInfo()]) {
    info.setMinFilter(9987).setMagFilter(9729).setWrapS(33071).setWrapT(33071); // LINEAR_MIPMAP_LINEAR, LINEAR, CLAMP_TO_EDGE
  }
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nor).setAttribute('TANGENT', tan).setAttribute('TEXCOORD_0', uv).setIndices(idx).setMaterial(material);
  const mesh = doc.createMesh('SolarPanel').addPrimitive(prim);
  const node = doc.createNode('SolarPanel').setMesh(mesh).setExtras(extras);
  doc.createScene('Scene').addChild(node);
  const io = new NodeIO().registerExtensions([EXTTextureWebP]);
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(file, bytes);
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 50, writeTimestamp: false });
  return { bytes: bytes.byteLength, validation: report.issues };
}

// ---------------------------------------------------------------------------------------------
async function main() {
  extractSources();
  const src = await loadFbxGeometry();
  log(`FBX mesh "${src.name}", ${src.position.length / 9} triangles, material "${src.materialName}"`);
  const { tris, bounds } = buildTriangles(src);
  const size = bounds.size.map((v) => +v.toFixed(4));
  log('Normalized size (m):', size.join(' × '));
  const charts = { front: uvRect(tris, 'front'), back: uvRect(tris, 'back') };
  const geo = weldFlat(tris);
  log(`Welded flat geometry: ${geo.positions.length / 3} vertices, ${geo.indices.length / 3} triangles`);

  fs.mkdirSync(WORK, { recursive: true });
  const rebake = await rebakeNormals(tris);
  log('Normal re-bake detail stats:', JSON.stringify(rebake.stats));
  await sharp(encodeNormals(rebake.vectors, rebake.size), { raw: { width: rebake.size, height: rebake.size, channels: 3 } }).png().toFile(path.join(WORK, 'normal_flat_rebaked.png'));

  const frameLip = await measureFrameLip(charts.front);
  const colors = {
    frame: await sampleRegionColor(path.join(TEX, 'solar_panel_diffuse.png'), [0.02, 0.06, 0.95, 0.09]),
    back: await sampleRegionColor(path.join(TEX, 'solar_panel_diffuse.png'), [0.05, 0.65, 0.73, 0.95]),
  };
  log('Frame lip width (m):', frameLip, 'sampled colours:', JSON.stringify(colors));

  // Chart rects exported in glTF UV convention (v down) for the procedural assembly.
  const toGltf = (r) => [r[0], 1 - r[3], r[2], 1 - r[1]].map((v) => +v.toFixed(5));
  const extras = {
    source: 'simple-72-cell-solar-panel.zip › solar panel.fbx (mesh "Cube", material "baked")',
    units: 'metres', axes: 'X = long edge, Y = short edge, Z = front-face normal',
    size, frameLip,
    uvRects: { front: toGltf(charts.front), back: toGltf(charts.back) },
    colors,
    notes: 'Flat face normals; normal map re-baked to detail-only (see scripts/prepare-assets.mjs).',
  };

  fs.mkdirSync(OUT, { recursive: true });
  const outputs = {};
  for (const set of SETS) {
    const textures = await buildTextureSet(set, rebake.vectors);
    const file = path.join(OUT, `solar-panel-${set.name}.glb`);
    const result = await writeGlb(file, geo, textures, extras);
    const kb = (b) => +(b.byteLength / 1024).toFixed(1);
    outputs[set.name] = {
      file: path.relative(ROOT, file).replaceAll('\\', '/'),
      kilobytes: +(result.bytes / 1024).toFixed(1),
      textureKilobytes: { baseColor: kb(textures.baseColor), metallicRoughness: kb(textures.metallicRoughness), normal: kb(textures.normal) },
      textureSize: set.size,
      validation: { errors: result.validation.numErrors, warnings: result.validation.numWarnings, infos: result.validation.numInfos, hints: result.validation.numHints, messages: result.validation.messages },
    };
    log(`${set.name}: ${outputs[set.name].kilobytes} KB`, JSON.stringify(outputs[set.name].textureKilobytes), `validator: ${result.validation.numErrors} errors, ${result.validation.numWarnings} warnings, ${result.validation.numInfos} infos`);
    for (const m of result.validation.messages) log(`   [${m.severity}] ${m.code}: ${m.message} (${m.pointer ?? ''})`);
    if (result.validation.numErrors > 0) throw new Error(`glTF validation failed for ${file}`);
  }

  fs.mkdirSync(DOCS, { recursive: true });
  const report = {
    generated: new Date().toISOString(),
    source: {
      archive: path.basename(ZIP),
      fbx: 'source/simple_solar_panel_72c.zip › solar panel.fbx (binary FBX 7400)',
      mesh: { name: src.name, triangles: src.position.length / 9, vertices: src.position.length / 3, nodeTransform: src.nodeTransform },
      fbxTextureReferences: src.textureRefs,
      fbxLoaderWarnings: src.loaderWarnings,
      textureSetUsed: 'textures/ (RGB / greyscale PNG, 4096²)',
      textureSetSkipped: 'source/simple_solar_panel_72c.zip copies — pixel-identical RGBA duplicates',
      groundAO: 'textures/internal_ground_ao_texture.jpeg (512², blurred rectangle for a ground plane under a flat-lying panel) — not applied to the panel; no ground mesh or UVs for it exist in the FBX.',
      license: 'No license or attribution file is included in the supplied archive. Licence terms must be confirmed with the asset supplier before production use.',
    },
    normalized: { size, units: 'metres', frameLip, uvRects: extras.uvRects, colors },
    normalMap: {
      finding: 'Baked against smoothed low-poly normals and a different triangulation; large-scale content is compensation, not surface detail.',
      measurement: 'Mean deviation from the flat front face when reconstructed with a MikkTSpace-style basis: ~38° (OpenGL green), ~66° (DirectX green).',
      fix: 'Detail-only re-bake for flat normals (OpenGL / glTF convention); side strips flattened.',
      rebakeStats: rebake.stats,
    },
    outputs,
  };
  fs.writeFileSync(path.join(DOCS, 'asset-report.json'), JSON.stringify(report, null, 2));
  log('Wrote', path.relative(ROOT, path.join(DOCS, 'asset-report.json')));
}

main().catch((e) => { console.error(e); process.exit(1); });
