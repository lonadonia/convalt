#!/usr/bin/env node
/**
 * Power-generation scene: asset preparation.
 *
 *   node scripts/prepare-field.mjs            (or: npm run assets:field)
 *
 * Sources (preserved untouched; extracted zip-slip safe into asset-source/):
 *   solar-panel.zip   source/model.fbx (binary FBX 7400, one mesh "SolarPanel", 1854 triangles, cm)
 *                     + textures/SolarPanel_{Albedo,Normal,Metalness}.png (2048², Unity-style: metallic
 *                     in R, smoothness in A). The mesh is a 72-cell module (28-triangle textured slab
 *                     + 66-triangle junction box) on a 45° A-frame stand (brackets, posts, rails, bolts).
 *   lorton-field.zip  source/model.zip › model.obj (photogrammetry, 723 k vertices, 1.44 M triangles,
 *                     no normals, 31 × 39 × 3 scan units) + two 8192² texture atlases.
 *
 * The installation reuses the Overview / Module scene's own panel (public/models/solar-panel-*.glb);
 * the module below is no longer used by the page and is only built with --legacy-module.
 *
 * Module → public/models/field-module-{2k,1k}.glb  (--legacy-module)
 *   Keeps the module (slab + junction box); the stand is dropped (the installation gets procedural
 *   mounting tables). Normalized: metres, centred, front face +Z, long side X, uniformly scaled to the
 *   Module scene's panel width (1.864 m) — aspect 2.000 vs 1.994, so no stretching is needed.
 *   Maps repacked for glTF: metallicRoughness (G = 1 − smoothness, B = metallic).
 *
 * Terrain → public/models/field/terrain-{desktop,mobile}.glb + layer textures (WebP)
 *   Scale: 10 m per scan unit, from recognizable features (single-track lanes ≈ 0.3 units ≈ 3 m,
 *   two-lane road ≈ 0.67 units, UK warning-line period 6 m + 3 m ≈ 0.86 units, sheep ≈ 0.13 units).
 *   1. Top-down rasterization of the scan (0.25 m): top-surface heights, per-cell atlas + UV.
 *   2. Hole fill; photogrammetry trees (spiky, melted) softened into rounded canopies ≤ 5 m.
 *   3. A 300 m apron around the scan: heights continue the scan edge and relax to its mean level,
 *      colours are a heavy blur of the scan edge — no copied landmarks. It fades into haze at runtime.
 *   4. 1 m grid over scan + apron, simplified with meshoptimizer (error-bounded), normals from the
 *      heightfield, meshopt-compressed + quantized GLB.
 *   5. Orthophoto layers resampled from the atlases (2× supersampled): site inset, full scan, apron.
 * Writes docs/field-asset-report.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import validator from 'gltf-validator';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { parseObj, bounds, rasterize, loadTexture, sampleTex } from './lib/terrain-raster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'asset-source');
const OUT_MODELS = path.join(ROOT, 'public', 'models');
const OUT_FIELD = path.join(OUT_MODELS, 'field');
const DOCS = path.join(ROOT, 'docs');
const log = (...a) => console.log('•', ...a);
const kb = (bytesOrFile) => +((typeof bytesOrFile === 'number' ? bytesOrFile : fs.statSync(bytesOrFile).size) / 1024).toFixed(1);

/** Metres per scan unit (see header). */
const SCALE = 10;
/** Width of the Module scene's panel (the handoff target). */
const MODULE_WIDTH = 1.864;
/**
 * Cell field (half extents, metres) of the Module scene's panel — src/config/intro.ts MODEL_CELL_FIELD.
 * The new module is scaled uniformly so its cell field matches this one (geometric mean of the two
 * axis ratios): the hero crossfade then registers the 12 × 6 cell grids within ≈ 0.5 %.
 */
const TARGET_CELL_FIELD = { hx: 0.9215, hy: 0.457 };
/**
 * Site the inset texture is centred on (field frame: scan units × SCALE, metres). Must contain the
 * installation defined in src/config/field.ts (checked at runtime).
 */
const SITE = { x: 15, z: -25, inset: 192 };
const APRON = 300;

// ---------------------------------------------------------------------------------------------
// 0. Sources
// ---------------------------------------------------------------------------------------------
function safeExtract(bytes, dest) {
  const entries = unzipSync(new Uint8Array(bytes));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const n = path.normalize(name);
    if (path.isAbsolute(n) || n.split(path.sep).includes('..')) throw new Error(`Unsafe entry ${name}`);
    const out = path.join(dest, n);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
  }
  return Object.keys(entries);
}

function extractSources() {
  const panelDir = path.join(SRC, 'field-panel');
  if (!fs.existsSync(path.join(panelDir, 'source', 'model.fbx'))) {
    log('Extracted solar-panel.zip:', safeExtract(fs.readFileSync(path.join(ROOT, 'solar-panel.zip')), panelDir).join(', '));
  }
  const fieldDir = path.join(SRC, 'lorton-field');
  if (!fs.existsSync(path.join(fieldDir, 'source', 'model', 'model.obj'))) {
    log('Extracted lorton-field.zip:', safeExtract(fs.readFileSync(path.join(ROOT, 'lorton-field.zip')), fieldDir).join(', '));
    log('Extracted nested model.zip:', safeExtract(fs.readFileSync(path.join(fieldDir, 'source', 'model.zip')), path.join(fieldDir, 'source', 'model')).join(', '));
  }
  return { panelDir, fieldDir };
}

// ---------------------------------------------------------------------------------------------
// 1. Module
// ---------------------------------------------------------------------------------------------
async function loadFbx(file) {
  globalThis.document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_) {} }) };
  globalThis.self ??= globalThis;
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const warn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(format(...a));
  const buf = fs.readFileSync(file);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path.dirname(file) + '/');
  console.warn = warn;
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (meshes.length !== 1) throw new Error(`Expected one mesh, found ${meshes.length}`);
  const g = meshes[0].geometry;
  return { name: meshes[0].name, rotation: meshes[0].rotation.toArray().slice(0, 3), position: g.attributes.position.array, normal: g.attributes.normal.array, uv: g.attributes.uv.array, warnings };
}

/** Connected components of a triangle soup, welded by position (0.01 source units). */
function components(position) {
  const n = position.length / 3;
  const ids = new Map();
  const vid = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(position[i * 3] * 100)},${Math.round(position[i * 3 + 1] * 100)},${Math.round(position[i * 3 + 2] * 100)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    vid[i] = ids.get(k);
  }
  const parent = Int32Array.from({ length: ids.size }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < n / 3; t++) {
    const a = find(vid[t * 3]);
    parent[find(vid[t * 3 + 1])] = a;
    parent[find(vid[t * 3 + 2])] = a;
  }
  const comps = new Map();
  for (let t = 0; t < n / 3; t++) {
    const r = find(vid[t * 3]);
    if (!comps.has(r)) comps.set(r, { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    const c = comps.get(r);
    c.tris.push(t);
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) {
      const v = position[(t * 3 + k) * 3 + a];
      c.min[a] = Math.min(c.min[a], v); c.max[a] = Math.max(c.max[a], v);
    }
  }
  return [...comps.values()].map((c) => ({ ...c, size: c.max.map((m, a) => m - c.min[a]) }));
}

async function prepareModule(panelDir) {
  const fbx = await loadFbx(path.join(panelDir, 'source', 'model.fbx'));
  const comps = components(fbx.position);
  // Module slab: the component spanning the module (≈165 × 83 cm) that is only a few cm thick.
  const body = comps.find((c) => c.size[0] > 150 && c.size[1] > 70 && c.size[2] < 6);
  if (!body) throw new Error('Module slab not found');
  // Junction box: a compact component behind the slab, inside its outline.
  const jbox = comps.find((c) => c !== body && c.tris.length > 40 && c.size[0] < 20 && c.size[1] < 20 && c.max[2] <= body.min[2] + 0.05 && c.min[2] > body.min[2] - 3);
  if (!jbox) throw new Error('Junction box not found');
  const dropped = comps.filter((c) => c !== body && c !== jbox);
  let scale = MODULE_WIDTH / body.size[0]; // source units (cm) → metres, provisional (width match)
  const centre = body.min.map((m, a) => m + body.size[a] / 2);
  const tris = [...body.tris, ...jbox.tris];
  const P = new Float32Array(tris.length * 9), N = new Float32Array(tris.length * 9), UV = new Float32Array(tris.length * 6), T = new Float32Array(tris.length * 12);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const s = t * 3 + k, d = i * 3 + k;
      for (let a = 0; a < 3; a++) { P[d * 3 + a] = (fbx.position[s * 3 + a] - centre[a]) * scale; N[d * 3 + a] = fbx.normal[s * 3 + a]; }
      UV[d * 2] = fbx.uv[s * 2];
      UV[d * 2 + 1] = 1 - fbx.uv[s * 2 + 1]; // glTF: v down
    }
    // Face tangent from UV gradients (every face of the slab/box is planar).
    const p = [0, 1, 2].map((k) => [P[(i * 3 + k) * 3], P[(i * 3 + k) * 3 + 1], P[(i * 3 + k) * 3 + 2]]);
    const w = [0, 1, 2].map((k) => [UV[(i * 3 + k) * 2], UV[(i * 3 + k) * 2 + 1]]);
    const e1 = p[1].map((v, a) => v - p[0][a]), e2 = p[2].map((v, a) => v - p[0][a]);
    const du1 = w[1][0] - w[0][0], dv1 = w[1][1] - w[0][1], du2 = w[2][0] - w[0][0], dv2 = w[2][1] - w[0][1];
    const r = 1 / (du1 * dv2 - du2 * dv1 || 1e-9);
    let tg = e1.map((v, a) => (v * dv2 - e2[a] * dv1) * r);
    const bt = e2.map((v, a) => (v * du1 - e1[a] * du2) * r);
    const nrm = [N[i * 9], N[i * 9 + 1], N[i * 9 + 2]];
    const dp = tg[0] * nrm[0] + tg[1] * nrm[1] + tg[2] * nrm[2];
    tg = tg.map((v, a) => v - nrm[a] * dp);
    const l = Math.hypot(...tg) || 1;
    tg = tg.map((v) => v / l);
    const c = [nrm[1] * tg[2] - nrm[2] * tg[1], nrm[2] * tg[0] - nrm[0] * tg[2], nrm[0] * tg[1] - nrm[1] * tg[0]];
    const hand = c[0] * bt[0] + c[1] * bt[1] + c[2] * bt[2] < 0 ? -1 : 1;
    for (let k = 0; k < 3; k++) T.set([tg[0], tg[1], tg[2], hand], (i * 3 + k) * 4);
  });
  let size = body.size.map((v) => +(v * scale).toFixed(4));
  // Front: the recessed glass (cell) face and the frame lip.
  let frontZ = +((body.max[2] - centre[2]) * scale).toFixed(4);
  let glassZ = frontZ, glassUV = null;
  for (const t of body.tris) {
    const z = [0, 1, 2].map((k) => fbx.position[(t * 3 + k) * 3 + 2]);
    const nz = fbx.normal[t * 9 + 2];
    if (nz > 0.99 && Math.max(...z) < body.max[2] - 0.1) {
      glassZ = +((z[0] - centre[2]) * scale).toFixed(4);
      const us = [0, 1, 2].map((k) => fbx.uv[(t * 3 + k) * 2]), vs = [0, 1, 2].map((k) => fbx.uv[(t * 3 + k) * 2 + 1]);
      const xs = [0, 1, 2].map((k) => fbx.position[(t * 3 + k) * 3]), ys = [0, 1, 2].map((k) => fbx.position[(t * 3 + k) * 3 + 1]);
      glassUV = { uMin: Math.min(...us), uMax: Math.max(...us), vMin: Math.min(...vs), vMax: Math.max(...vs), xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) };
      if (glassUV.xMax - glassUV.xMin > 100) break;
    }
  }
  const provisional = await measureCellField(path.join(panelDir, 'textures', 'SolarPanel_Albedo.png'), glassUV, centre, scale);
  const match = Math.sqrt((TARGET_CELL_FIELD.hx / provisional.hx) * (TARGET_CELL_FIELD.hy / provisional.hy));
  scale *= match;
  for (let i = 0; i < P.length; i++) P[i] *= match;
  size = body.size.map((v) => +(v * scale).toFixed(4));
  frontZ = +(frontZ * match).toFixed(4);
  glassZ = +(glassZ * match).toFixed(4);
  const cellField = await measureCellField(path.join(panelDir, 'textures', 'SolarPanel_Albedo.png'), glassUV, centre, scale);

  // Textures: albedo, normal (OpenGL / +Y, as glTF), metallic-roughness repacked from Unity's layout.
  const T0 = path.join(panelDir, 'textures');
  const outputs = {};
  for (const set of [{ name: '2k', size: 2048 }, { name: '1k', size: 1024 }]) {
    const baseColor = await sharp(path.join(T0, 'SolarPanel_Albedo.png')).resize(set.size, set.size, { kernel: 'lanczos3' }).removeAlpha().webp({ quality: 90, effort: 6, smartSubsample: true }).toBuffer();
    // Lossy at high quality: the map's fine grain makes lossless 2K ≈ 2.2 MB for no visible gain.
    const normal = await sharp(path.join(T0, 'SolarPanel_Normal.png')).resize(set.size, set.size, { kernel: 'lanczos3' }).removeAlpha().webp({ quality: 94, effort: 6, smartSubsample: false }).toBuffer();
    const { data: ms, info } = await sharp(path.join(T0, 'SolarPanel_Metalness.png')).resize(set.size, set.size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mr = Buffer.alloc(info.width * info.height * 3);
    for (let i = 0; i < info.width * info.height; i++) { mr[i * 3] = 255; mr[i * 3 + 1] = 255 - ms[i * 4 + 3]; mr[i * 3 + 2] = ms[i * 4]; }
    const metallicRoughness = await sharp(mr, { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ quality: 92, effort: 6 }).toBuffer();
    const file = path.join(OUT_MODELS, `field-module-${set.name}.glb`);
    const extras = { size, frontZ, glassZ, cellField, pivot: 'centre of the module slab; front face +Z; long side X', source: 'solar-panel.zip › source/model.fbx (module slab + junction box; stand removed)' };
    const res = await writeModuleGlb(file, { positions: P, normals: N, uvs: UV, tangents: T }, { baseColor, normal, metallicRoughness }, extras);
    outputs[set.name] = { file: path.relative(ROOT, file).replaceAll('\\', '/'), kilobytes: kb(res.bytes), textureKilobytes: { baseColor: kb(baseColor.length), normal: kb(normal.length), metallicRoughness: kb(metallicRoughness.length) }, validation: { errors: res.validation.numErrors, warnings: res.validation.numWarnings, infos: res.validation.numInfos } };
    log(`field-module-${set.name}.glb: ${outputs[set.name].kilobytes} KB, validator ${res.validation.numErrors} errors / ${res.validation.numWarnings} warnings`);
  }
  return {
    source: { mesh: fbx.name, nodeRotation: fbx.rotation, triangles: fbx.position.length / 9, components: comps.length, loaderWarnings: fbx.warnings },
    kept: { slabTriangles: body.tris.length, junctionBoxTriangles: jbox.tris.length },
    dropped: dropped.map((c) => ({ triangles: c.tris.length, sizeCm: c.size.map((v) => +v.toFixed(2)) })),
    sourceSizeCm: body.size.map((v) => +v.toFixed(2)),
    uniformScale: +scale.toFixed(6),
    cellFieldMatch: { target: TARGET_CELL_FIELD, provisional, factor: +match.toFixed(5) },
    size,
    frontZ,
    glassZ,
    cellField,
    outputs,
  };
}

/** Cell field (blue region) inside the glass chart → half extents on the module front (metres). */
async function measureCellField(albedoFile, g, centre, scale) {
  const { data, info } = await sharp(albedoFile).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const px = (u, v) => { const x = Math.min(W - 1, Math.max(0, Math.round(u * W))), y = Math.min(H - 1, Math.max(0, Math.round((1 - v) * H))); const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const isCell = ([r, gg, b]) => b > 110 && b > r + 40 && b > gg + 10;
  // Scan along the chart's two axes through cell centres; find the outermost cell texels.
  const steps = 600;
  let uLo = 1, uHi = 0, vLo = 1, vHi = 0;
  for (const f of [0.23, 0.41, 0.59, 0.77]) {
    for (let k = 0; k <= steps; k++) {
      const u = g.uMin + (g.uMax - g.uMin) * (k / steps), v = g.vMin + (g.vMax - g.vMin) * f;
      if (isCell(px(u, v))) { uLo = Math.min(uLo, u); uHi = Math.max(uHi, u); }
      const u2 = g.uMin + (g.uMax - g.uMin) * f, v2 = g.vMin + (g.vMax - g.vMin) * (k / steps);
      if (isCell(px(u2, v2))) { vLo = Math.min(vLo, v2); vHi = Math.max(vHi, v2); }
    }
  }
  // On this chart u runs along the module's short side (y) and v along its long side (x).
  const toY = (u) => g.yMin + ((u - g.uMin) / (g.uMax - g.uMin)) * (g.yMax - g.yMin);
  const toX = (v) => g.xMax - ((v - g.vMin) / (g.vMax - g.vMin)) * (g.xMax - g.xMin);
  const xs = [toX(vLo), toX(vHi)].map((x) => (x - centre[0]) * scale), ys = [toY(uLo), toY(uHi)].map((y) => (y - centre[1]) * scale);
  return { hx: +((Math.max(...xs) - Math.min(...xs)) / 2).toFixed(4), hy: +((Math.max(...ys) - Math.min(...ys)) / 2).toFixed(4), cx: +((xs[0] + xs[1]) / 2).toFixed(4), cy: +((ys[0] + ys[1]) / 2).toFixed(4) };
}

async function writeModuleGlb(file, geo, textures, extras) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'convalt prepare-field (gltf-transform)';
  const buffer = doc.createBuffer();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const n = geo.positions.length / 3;
  const indices = new Uint16Array(n).map((_, i) => i);
  const acc = (name, type, array) => doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
  const tex = (name, image) => doc.createTexture(name).setImage(new Uint8Array(image)).setMimeType('image/webp').setURI(`${name}.webp`);
  const material = doc.createMaterial('FieldModule')
    .setBaseColorTexture(tex('baseColor', textures.baseColor))
    .setMetallicRoughnessTexture(tex('metallicRoughness', textures.metallicRoughness))
    .setNormalTexture(tex('normal', textures.normal))
    .setMetallicFactor(1)
    .setRoughnessFactor(1);
  for (const info of [material.getBaseColorTextureInfo(), material.getMetallicRoughnessTextureInfo(), material.getNormalTextureInfo()]) info.setMinFilter(9987).setMagFilter(9729).setWrapS(33071).setWrapT(33071);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('POSITION', 'VEC3', geo.positions))
    .setAttribute('NORMAL', acc('NORMAL', 'VEC3', geo.normals))
    .setAttribute('TANGENT', acc('TANGENT', 'VEC4', geo.tangents))
    .setAttribute('TEXCOORD_0', acc('TEXCOORD_0', 'VEC2', geo.uvs))
    .setIndices(acc('indices', 'SCALAR', indices))
    .setMaterial(material);
  const mesh = doc.createMesh('FieldModule').addPrimitive(prim);
  doc.createScene('Scene').addChild(doc.createNode('FieldModule').setMesh(mesh).setExtras(extras));
  const io = new NodeIO().registerExtensions([EXTTextureWebP]);
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(file, bytes);
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 50, writeTimestamp: false });
  return { bytes: bytes.byteLength, validation: report.issues };
}

// ---------------------------------------------------------------------------------------------
// 2. Terrain
// ---------------------------------------------------------------------------------------------

/** Separable running min/max over a square window of half-size r (cells). */
function minMaxFilter(src, W, H, r, op) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const pick = op === 'min' ? Math.min : Math.max;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = op === 'min' ? Infinity : -Infinity;
    for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = pick(m, src[y * W + k]);
    tmp[y * W + x] = m;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = op === 'min' ? Infinity : -Infinity;
    for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) m = pick(m, tmp[k * W + x]);
    out[y * W + x] = m;
  }
  return out;
}

/** Separable box blur, repeated (≈ Gaussian). */
function blur(src, W, H, r, passes = 3) {
  let a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      let s = 0, n = 0;
      for (let k = 0; k <= Math.min(W - 1, r); k++) { s += a[y * W + k]; n++; }
      for (let x = 0; x < W; x++) {
        b[y * W + x] = s / n;
        const add = x + r + 1, rem = x - r;
        if (add < W) { s += a[y * W + add]; n++; }
        if (rem >= 0) { s -= a[y * W + rem]; n--; }
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = 0; k <= Math.min(H - 1, r); k++) { s += b[k * W + x]; n++; }
      for (let y = 0; y < H; y++) {
        a[y * W + x] = s / n;
        const add = y + r + 1, rem = y - r;
        if (add < H) { s += b[add * W + x]; n++; }
        if (rem >= 0) { s -= b[rem * W + x]; n--; }
      }
    }
  }
  return a;
}

function fillHoles(h, W, H) {
  let holes = 0;
  for (const v of h) if (Number.isNaN(v)) holes++;
  for (let pass = 0; pass < 400 && holes; pass++) {
    const next = h.slice();
    holes = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!Number.isNaN(h[i])) continue;
      let s = 0, n = 0;
      if (x > 0 && !Number.isNaN(h[i - 1])) { s += h[i - 1]; n++; }
      if (x < W - 1 && !Number.isNaN(h[i + 1])) { s += h[i + 1]; n++; }
      if (y > 0 && !Number.isNaN(h[i - W])) { s += h[i - W]; n++; }
      if (y < H - 1 && !Number.isNaN(h[i + W])) { s += h[i + W]; n++; }
      if (n) next[i] = s / n; else holes++;
    }
    h.set(next);
  }
}

/** Orthophoto of a metric rect (field frame), tiled and supersampled. Returns an RGB buffer. */
async function orthoRect(obj, atlases, rect, width, height, ss = 2) {
  const out = Buffer.alloc(width * height * 3);
  const tile = 512;
  const px = [0, 0, 0];
  const cellM = (rect.x1 - rect.x0) / width;
  for (let ty = 0; ty < height; ty += tile) for (let tx = 0; tx < width; tx += tile) {
    const tw = Math.min(tile, width - tx), th = Math.min(tile, height - ty);
    const r = rasterize(obj, { x0: (rect.x0 + tx * cellM) / SCALE, z0: (rect.z0 + ty * cellM) / SCALE, cell: cellM / ss / SCALE, cols: tw * ss, rows: th * ss });
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      let R = 0, G = 0, B = 0, n = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const i = (y * ss + sy) * r.cols + (x * ss + sx);
        const m = r.mat[i];
        if (m < 0) continue;
        sampleTex(atlases[m], r.u[i], r.v[i], px);
        R += px[0]; G += px[1]; B += px[2]; n++;
      }
      const o = ((ty + y) * width + (tx + x)) * 3;
      if (n) { out[o] = R / n; out[o + 1] = G / n; out[o + 2] = B / n; } else { out[o] = 110; out[o + 1] = 124; out[o + 2] = 88; }
    }
  }
  return out;
}

async function prepareTerrain(fieldDir) {
  const t0 = Date.now();
  const obj = await parseObj(path.join(fieldDir, 'source', 'model', 'model.obj'));
  const b = bounds(obj.positions);
  const materials = obj.materials.map((m) => m.name);
  const atlases = await Promise.all(materials.map((n) => loadTexture(path.join(fieldDir, 'textures', `${n}.jpeg`))));
  log('Terrain OBJ:', obj.positions.length / 3, 'vertices,', obj.materials.map((m) => `${m.name} ${m.faces.length / 6}`).join(', '), 'faces; bounds (units)', JSON.stringify(b));

  // 2.1 Heightfield (0.25 m) in the field frame (metres).
  const cell = 0.25;
  const scan = { x0: b.min[0] * SCALE, z0: b.min[2] * SCALE, x1: b.max[0] * SCALE, z1: b.max[2] * SCALE };
  const W = Math.ceil((scan.x1 - scan.x0) / cell), H = Math.ceil((scan.z1 - scan.z0) / cell);
  const r = rasterize(obj, { x0: scan.x0 / SCALE, z0: scan.z0 / SCALE, cell: cell / SCALE, cols: W, rows: H });
  const h = new Float32Array(W * H);
  let holes = 0;
  for (let i = 0; i < h.length; i++) { h[i] = r.height[i] * SCALE; if (Number.isNaN(h[i])) holes++; }
  fillHoles(h, W, H);

  // 2.2 Vegetation: photogrammetry trees are spiky, melted shells. Ground = morphological opening
  // (4 m window); what stands above it is smoothed and soft-clamped to rounded canopies ≤ 5 m.
  const ground = blur(minMaxFilter(minMaxFilter(h, W, H, 16, 'min'), W, H, 16, 'max'), W, H, 4, 2);
  const veg = new Float32Array(h.length);
  let vegCells = 0, vegMax = 0;
  for (let i = 0; i < h.length; i++) { veg[i] = Math.max(0, h[i] - ground[i]); if (veg[i] > 0.5) vegCells++; vegMax = Math.max(vegMax, veg[i]); }
  const vegSmooth = blur(veg, W, H, 3, 2);
  const CANOPY = 5;
  for (let i = 0; i < h.length; i++) {
    const v = veg[i] > 0.35 ? vegSmooth[i] : veg[i];
    h[i] = ground[i] + CANOPY * Math.tanh(v / CANOPY);
  }
  log(`Heightfield ${W}×${H} @ ${cell} m: holes filled ${holes} (${((100 * holes) / h.length).toFixed(2)} %), vegetation > 0.5 m on ${((100 * vegCells) / h.length).toFixed(1)} % of cells, max ${vegMax.toFixed(1)} m → soft-clamped to ${CANOPY} m`);

  // 2.3 Grid over scan + apron (1 m).
  const G = 1;
  const ext = { x0: Math.floor(scan.x0 - APRON), z0: Math.floor(scan.z0 - APRON), x1: Math.ceil(scan.x1 + APRON), z1: Math.ceil(scan.z1 + APRON) };
  const GW = Math.round((ext.x1 - ext.x0) / G) + 1, GH = Math.round((ext.z1 - ext.z0) / G) + 1;
  const sampleH = (x, z) => {
    const fx = Math.min(W - 1.001, Math.max(0, (x - scan.x0) / cell - 0.5)), fz = Math.min(H - 1.001, Math.max(0, (z - scan.z0) / cell - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (h[j * W + i] * (1 - u) + h[j * W + i + 1] * u) * (1 - v) + (h[(j + 1) * W + i] * (1 - u) + h[(j + 1) * W + i + 1] * u) * v;
  };
  let meanH = 0; for (const v of ground) meanH += v; meanH /= ground.length;
  // Scan edge heights, heavily smoothed, continue outward and relax to the mean level.
  const edgeSmooth = blur(h, W, H, 48, 3);
  const edgeH = (x, z) => {
    const fx = Math.min(W - 1, Math.max(0, Math.round((x - scan.x0) / cell))), fz = Math.min(H - 1, Math.max(0, Math.round((z - scan.z0) / cell)));
    return edgeSmooth[fz * W + fx];
  };
  const noise = (x, z) => Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 + 0.4) * 2.2 + Math.sin(x * 0.027 + z * 0.019) * 0.9;
  const heights = new Float32Array(GW * GH);
  const outsideDist = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = ext.x0 + i * G, z = ext.z0 + j * G;
    const dx = Math.max(scan.x0 - x, 0, x - scan.x1), dz = Math.max(scan.z0 - z, 0, z - scan.z1);
    const d = Math.hypot(dx, dz);
    outsideDist[j * GW + i] = d;
    if (d === 0) {
      // Blend the last 25 m inside the scan toward its smoothed edge (the scan's own border is noisy).
      const inside = Math.min(x - scan.x0, scan.x1 - x, z - scan.z0, scan.z1 - z);
      const k = Math.min(1, inside / 25);
      heights[j * GW + i] = sampleH(x, z) * (0.35 + 0.65 * k) + edgeH(x, z) * 0.65 * (1 - k);
    } else {
      const k = 1 - Math.exp(-d / 90);
      heights[j * GW + i] = edgeH(x, z) * (1 - k) + meanH * k + noise(x, z) * Math.min(1, d / 60);
    }
  }

  // 2.4 Mesh + simplification (error-bounded), per tier.
  const positions = new Float32Array(GW * GH * 3);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const o = (j * GW + i) * 3;
    positions[o] = ext.x0 + i * G; positions[o + 1] = heights[j * GW + i]; positions[o + 2] = ext.z0 + j * G;
  }
  const full = new Uint32Array((GW - 1) * (GH - 1) * 6);
  let q = 0;
  for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
    const a = j * GW + i, bb = a + 1, c = a + GW, d = c + 1;
    // consistent diagonal; winding: +Y up
    full[q++] = a; full[q++] = c; full[q++] = bb; full[q++] = bb; full[q++] = c; full[q++] = d;
  }
  await MeshoptSimplifier.ready;
  const slope = (x, z) => { const e = 1; return [(sampleAny(x + e, z) - sampleAny(x - e, z)) / (2 * e), (sampleAny(x, z + e) - sampleAny(x, z - e)) / (2 * e)]; };
  function sampleAny(x, z) {
    const fi = Math.min(GW - 1.001, Math.max(0, (x - ext.x0) / G)), fj = Math.min(GH - 1.001, Math.max(0, (z - ext.z0) / G));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    return (heights[j * GW + i] * (1 - u) + heights[j * GW + i + 1] * u) * (1 - v) + (heights[(j + 1) * GW + i] * (1 - u) + heights[(j + 1) * GW + i + 1] * u) * v;
  }
  const tiers = {};
  for (const tier of [{ name: 'desktop', target: 180000, error: 0.02 }, { name: 'mobile', target: 70000, error: 0.05 }]) {
    const [idx, err] = MeshoptSimplifier.simplify(full, positions, 3, tier.target * 3, tier.error, ['ErrorAbsolute', 'LockBorder']);
    const [remap, count] = MeshoptSimplifier.compactMesh(idx);
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    for (let v = 0; v < remap.length; v++) {
      const k = remap[v];
      if (k === 0xffffffff) continue;
      pos.set(positions.subarray(v * 3, v * 3 + 3), k * 3);
    }
    for (let k = 0; k < count; k++) {
      const [sx, sz] = slope(pos[k * 3], pos[k * 3 + 2]);
      const l = Math.hypot(sx, 1, sz);
      nor[k * 3] = -sx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -sz / l;
    }
    tiers[tier.name] = { positions: pos, normals: nor, indices: idx, triangles: idx.length / 3, vertices: count, error: +err.toFixed(4) };
    log(`Terrain mesh ${tier.name}: ${idx.length / 3} triangles, ${count} vertices, max error ${err.toFixed(3)} m`);
  }

  // 2.5 Orthophoto layers.
  fs.mkdirSync(OUT_FIELD, { recursive: true });
  const layers = {
    inset: { rect: { x0: SITE.x - SITE.inset / 2, z0: SITE.z - SITE.inset / 2, x1: SITE.x + SITE.inset / 2, z1: SITE.z + SITE.inset / 2 }, sizes: { desktop: 3072, mobile: 2048 } },
    scan: { rect: scan, sizes: { desktop: 2048, mobile: 1024 } },
  };
  const layerFiles = {};
  for (const [name, L] of Object.entries(layers)) {
    const wMax = L.sizes.desktop;
    const aspect = (L.rect.z1 - L.rect.z0) / (L.rect.x1 - L.rect.x0);
    const w = wMax, hgt = Math.round(wMax * aspect / 4) * 4;
    const img = await orthoRect(obj, atlases, L.rect, w, hgt, name === 'inset' ? 2 : 3);
    layerFiles[name] = {};
    for (const [tierName, size] of Object.entries(L.sizes)) {
      const file = path.join(OUT_FIELD, `terrain-${name}-${tierName}.webp`);
      await sharp(img, { raw: { width: w, height: hgt, channels: 3 } }).resize(size, Math.round(size * aspect / 4) * 4, { kernel: 'lanczos3' }).webp({ quality: 84, effort: 6 }).toFile(file);
      layerFiles[name][tierName] = { file: path.relative(ROOT, file).replaceAll('\\', '/'), kilobytes: kb(file) };
    }
    log(`Layer ${name}: ${w}×${hgt} → ${JSON.stringify(Object.fromEntries(Object.entries(layerFiles[name]).map(([k, v]) => [k, v.kilobytes + ' KB'])))}`);
    if (name === 'scan') layers.scan.image = { data: img, w, h: hgt };
  }
  // Apron layer: the scan, heavily blurred and diffused outward (no copied landmarks).
  {
    const size = 1024;
    const aw = size, ah = Math.round(size * (ext.z1 - ext.z0) / (ext.x1 - ext.x0));
    const small = await sharp(layers.scan.image.data, { raw: { width: layers.scan.image.w, height: layers.scan.image.h, channels: 3 } }).resize(160, Math.round(160 * layers.scan.image.h / layers.scan.image.w)).raw().toBuffer({ resolveWithObject: true });
    const sw = small.info.width, sh = small.info.height;
    const blurred = await sharp(small.data, { raw: { width: sw, height: sh, channels: 3 } }).blur(6).raw().toBuffer();
    let mean = [0, 0, 0];
    for (let i = 0; i < sw * sh; i++) for (let c = 0; c < 3; c++) mean[c] += blurred[i * 3 + c] / (sw * sh);
    const out = Buffer.alloc(aw * ah * 3);
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const wx = ext.x0 + (x + 0.5) * (ext.x1 - ext.x0) / aw, wz = ext.z0 + (y + 0.5) * (ext.z1 - ext.z0) / ah;
      const sx = Math.min(sw - 1, Math.max(0, Math.round((wx - scan.x0) / (scan.x1 - scan.x0) * sw - 0.5)));
      const sy = Math.min(sh - 1, Math.max(0, Math.round((wz - scan.z0) / (scan.z1 - scan.z0) * sh - 0.5)));
      const d = Math.hypot(Math.max(scan.x0 - wx, 0, wx - scan.x1), Math.max(scan.z0 - wz, 0, wz - scan.z1));
      const k = 1 - Math.exp(-d / 120);
      const vary = 1 + 0.05 * Math.sin(wx * 0.021 + 0.7) * Math.cos(wz * 0.017) + 0.03 * Math.sin((wx + wz) * 0.05);
      for (let c = 0; c < 3; c++) out[(y * aw + x) * 3 + c] = Math.max(0, Math.min(255, (blurred[(sy * sw + sx) * 3 + c] * (1 - k) + mean[c] * k) * vary));
    }
    const file = path.join(OUT_FIELD, 'terrain-apron.webp');
    await sharp(out, { raw: { width: aw, height: ah, channels: 3 } }).blur(1.2).webp({ quality: 80, effort: 6 }).toFile(file);
    layerFiles.apron = { all: { file: path.relative(ROOT, file).replaceAll('\\', '/'), kilobytes: kb(file) } };
    layers.apron = { rect: ext };
    log(`Layer apron: ${aw}×${ah}, ${kb(file)} KB`);
  }

  // 2.6 GLB per tier (meshopt-compressed, quantized); layer rects in extras.
  const meta = {
    frame: 'field frame: scan units × 10 (metres), Y up; x right, z down in the orthophoto',
    metresPerScanUnit: SCALE,
    scan,
    extent: ext,
    site: SITE,
    layers: { inset: layers.inset.rect, scan: layers.scan.rect, apron: layers.apron.rect },
    meanGround: +meanH.toFixed(3),
  };
  const outputs = {};
  for (const tierName of ['desktop', 'mobile']) {
    const t = tiers[tierName];
    const file = path.join(OUT_FIELD, `terrain-${tierName}.glb`);
    const bytes = await writeTerrainGlb(file, t, meta);
    outputs[tierName] = { file: path.relative(ROOT, file).replaceAll('\\', '/'), kilobytes: kb(bytes), triangles: t.triangles, vertices: t.vertices, maxErrorM: t.error };
    log(`terrain-${tierName}.glb: ${kb(bytes)} KB`);
  }
  log(`Terrain done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return {
    source: { vertices: obj.positions.length / 3, triangles: obj.materials.reduce((s, m) => s + m.faces.length / 6, 0), materials, atlas: '2 × 8192² JPEG', boundsUnits: b },
    heightfield: { cellM: cell, width: W, height: H, holesFilled: holes, vegetation: { maxAboveGroundM: +vegMax.toFixed(2), canopyClampM: CANOPY } },
    meta,
    meshes: outputs,
    textures: layerFiles,
  };
}

async function writeTerrainGlb(file, t, meta) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'convalt prepare-field (gltf-transform)';
  const buffer = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor('POSITION').setType('VEC3').setArray(t.positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor('NORMAL').setType('VEC3').setArray(t.normals).setBuffer(buffer))
    .setIndices(doc.createAccessor('indices').setType('SCALAR').setArray(t.indices).setBuffer(buffer))
    .setMaterial(doc.createMaterial('Terrain').setRoughnessFactor(1).setMetallicFactor(0));
  const mesh = doc.createMesh('Terrain').addPrimitive(prim);
  doc.createScene('Scene').addChild(doc.createNode('Terrain').setMesh(mesh).setExtras(meta));
  await MeshoptEncoder.ready;
  // 16-bit positions: ≈ 1.5 cm steps over the ≈ 1 km extent (the default 14 bits would be ≈ 6 cm).
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10 }));
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(file, bytes);
  return bytes.byteLength;
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const { panelDir, fieldDir } = extractSources();
  fs.mkdirSync(OUT_MODELS, { recursive: true });
  const onlyModule = process.argv.includes('--module-only');
  const legacyModule = onlyModule || process.argv.includes('--legacy-module');
  const module = legacyModule
    ? await prepareModule(panelDir)
    : { note: 'The installation reuses the Overview / Module scene panel (public/models/solar-panel-{2k,1k}.glb, 44 triangles, 1.864 × 0.935 × 0.030 m); no separate field module is built.' };
  if (legacyModule) log('Module:', JSON.stringify({ size: module.size, frontZ: module.frontZ, glassZ: module.glassZ, cellField: module.cellField }));
  const reportFile = path.join(DOCS, 'field-asset-report.json');
  const previous = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
  const terrain = onlyModule ? previous.terrain : await prepareTerrain(fieldDir);
  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify({
    generated: new Date().toISOString(),
    licence: 'Neither archive contains a licence, readme or attribution file. Terms must be confirmed with the supplier before production use.',
    archives: { 'solar-panel.zip': ['source/model.fbx', 'textures/SolarPanel_Albedo.png', 'textures/SolarPanel_Normal.png', 'textures/SolarPanel_Metalness.png'], 'lorton-field.zip': ['source/model.zip › model.obj, model.mtl, model.jpg, model1.jpg', 'textures/model.jpeg', 'textures/model1.jpeg'] },
    scaleAssumptions: {
      module: 'Visualization scale: every installed module is the Module scene panel at 1:1 (1.864 × 0.935 m). Real 72-cell modules are typically ≈ 1.95–2.0 m × ≈ 1.0 m; this is an illustrative installation, not a product specification.',
      terrain: `${SCALE} m per scan unit, estimated from recognizable features (lanes, road markings, sheep); an estimate, not survey data.`,
    },
    module,
    terrain,
  }, null, 2));
  log('Wrote docs/field-asset-report.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
