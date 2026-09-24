#!/usr/bin/env node
/**
 * Data-center asset preparation (scene 04).
 *
 *   node scripts/prepare-datacenter.mjs          (or: npm run assets:datacenter)
 *
 * Source (preserved untouched): data-center.zip
 *   ├─ Screenshot 2026-09-24 170556.zip › four viewer screenshots (composition references only)
 *   └─ data-center-low-poly.zip
 *        ├─ source/DataCenter.fbx   binary FBX: one merged rack mesh, two floor planes, fixtures;
 *        │                          the front texture is embedded as well
 *        └─ textures/x_0_0_0_14130174_800.jpeg (the same front texture), internal_ground_ao_texture.jpeg
 *           (a generic viewer ground shadow, not referenced by any mesh — unused)
 *
 * 1. Extracts both archive levels (zip-slip safe) into asset-source/data-center/.
 * 2. Parses the FBX with three's FBXLoader and bakes every node transform (−90° X, ×100).
 * 3. Units → metres: the cabinets are 1130 units tall and are set to 2.0 m (a typical 42U
 *    cabinet), so 1 unit = 1.770 mm. The platform centre is the origin, the floor is y = 0, rack
 *    fronts face +Z. The model's cabinets are stylised (0.93 m wide, 0.64 m deep); no single real
 *    scale fits every dimension, height was chosen because it sets the human scale.
 * 4. The rack mesh's 901 alternating material runs are regrouped per material (4 primitives, so
 *    4 draw calls instead of 901); every primitive is welded and indexed; UVs → glTF convention.
 * 5. Measures the arrangement (rack rows, cabinet fronts, floor tiles, fixtures) into node extras.
 * 6. Front texture → WebP; PBR materials named after the source materials (tuned at runtime);
 *    meshopt compression + quantization; Khronos glTF Validator.
 * 7. Writes docs/datacenter-asset-report.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMaterialsEmissiveStrength, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import validator from 'gltf-validator';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = path.join(ROOT, 'data-center.zip');
const SRC = path.join(ROOT, 'asset-source', 'data-center');
const OUT = path.join(ROOT, 'public', 'models', 'datacenter.glb');
const DOCS = path.join(ROOT, 'docs');
const log = (...a) => console.log('•', ...a);
const r3 = (x) => +x.toFixed(3);

/** Cabinet height in model units (measured) and the height it represents. */
const CABINET_UNITS = 1130;
const CABINET_M = 2.0;
const S = CABINET_M / CABINET_UNITS;

// ---------------------------------------------------------------------------------------------
// 1. Extraction
// ---------------------------------------------------------------------------------------------
function extract() {
  const listing = [];
  const walk = (buf, dir, depth) => {
    const files = unzipSync(new Uint8Array(buf));
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) continue;
      const dest = path.resolve(dir, name);
      if (!dest.startsWith(path.resolve(dir) + path.sep)) throw new Error(`Unsafe path in archive: ${name}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
      listing.push({ file: path.relative(SRC, dest).replaceAll('\\', '/'), bytes: data.length, depth });
      if (/\.zip$/i.test(name)) walk(data, dest.replace(/\.zip$/i, ''), depth + 1);
    }
  };
  if (!fs.existsSync(ZIP)) throw new Error('Missing data-center.zip');
  walk(fs.readFileSync(ZIP), path.join(SRC, 'archive'), 0);
  return listing;
}

// ---------------------------------------------------------------------------------------------
// 2–4. FBX → per-material welded geometry in metres
// ---------------------------------------------------------------------------------------------
async function loadFbx(file) {
  const embedded = [];
  globalThis.self = globalThis;
  globalThis.window = { URL: { createObjectURL: (blob) => { embedded.push(blob); return `blob:embedded-${embedded.length}`; } } };
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_) {} }) };
  const THREE = await import('three');
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const buf = fs.readFileSync(file);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path.dirname(file) + '/');
  root.updateMatrixWorld(true);
  const source = { nodes: [], lights: 0, cameras: 0 };
  const byMaterial = new Map(); // name → { pos: [], nrm: [], uv: [] }
  root.traverse((o) => {
    if (o.isLight) source.lights++;
    if (o.isCamera) source.cameras++;
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    source.nodes.push({ name: o.name, triangles: pos.count / 3, materialRuns: groups.length, materials: [...new Set(mats.map((m) => m.name))] });
    for (const gr of groups) {
      const m = mats[gr.materialIndex];
      if (!byMaterial.has(m.name)) byMaterial.set(m.name, { pos: [], nrm: [], uv: [], source: { type: m.type, color: `#${m.color.getHexString()}`, specular: m.specular ? `#${m.specular.getHexString()}` : null, shininess: r3(m.shininess ?? 0), map: Boolean(m.map), emissive: `#${m.emissive.getHexString()}` } });
      const b = byMaterial.get(m.name);
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        b.pos.push(pos.getX(i) * S, pos.getY(i) * S, pos.getZ(i) * S);
        b.nrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
        b.uv.push(uv ? uv.getX(i) : 0, uv ? 1 - uv.getY(i) : 0); // glTF: v runs down the image
      }
    }
  });
  const images = await Promise.all(embedded.map(async (b) => ({ type: b.type, bytes: Buffer.from(await b.arrayBuffer()) })));
  return { THREE, byMaterial, source, images };
}

function weld({ pos, nrm, uv }) {
  const key = (i) => `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}|${Math.round(nrm[i * 3] * 1e3)},${Math.round(nrm[i * 3 + 1] * 1e3)},${Math.round(nrm[i * 3 + 2] * 1e3)}|${Math.round(uv[i * 2] * 1e5)},${Math.round(uv[i * 2 + 1] * 1e5)}`;
  const map = new Map();
  const P = [], N = [], T = [], I = [];
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let j = map.get(k);
    if (j === undefined) {
      j = P.length / 3;
      map.set(k, j);
      P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      N.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
      T.push(uv[i * 2], uv[i * 2 + 1]);
    }
    I.push(j);
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(T), indices: P.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I), triangles: n / 3 };
}

/** Connected islands (shared positions) of a triangle soup → bounding boxes. */
function islands(pos) {
  const nT = pos.length / 9;
  const parent = Array.from({ length: nT }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const seen = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const i = t * 9 + k * 3;
    const key = `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(pos[i + 2] * 1e4)}`;
    if (seen.has(key)) { const a = find(t), b = find(seen.get(key)); if (a !== b) parent[a] = b; } else seen.set(key, t);
  }
  const boxes = new Map();
  for (let t = 0; t < nT; t++) {
    const root = find(t);
    if (!boxes.has(root)) boxes.set(root, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0 });
    const b = boxes.get(root); b.tris++;
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { const v = pos[t * 9 + k * 3 + a]; b.min[a] = Math.min(b.min[a], v); b.max[a] = Math.max(b.max[a], v); }
  }
  return [...boxes.values()].map((b) => ({ min: b.min.map(r3), max: b.max.map(r3), tris: b.tris }));
}

// ---------------------------------------------------------------------------------------------
// 5–6. GLB
// ---------------------------------------------------------------------------------------------
/** Runtime material roles (the scene tunes these by name). Source names are kept in extras. */
const ROLES = {
  MetalCase: { name: 'RackCase', node: 'Racks', base: [0.035, 0.037, 0.04, 1], metallic: 0.6, roughness: 0.45 },
  Frente: { name: 'RackFront', node: 'Racks', base: [1, 1, 1, 1], metallic: 0.3, roughness: 0.5, texture: true, emissiveTexture: true, emissive: [0.35, 0.35, 0.35] },
  Verde: { name: 'LedGreen', node: 'Racks', base: [0.02, 0.1, 0.06, 1], metallic: 0, roughness: 0.4, emissive: [0.12, 1, 0.55], strength: 2.5 },
  Amarelo: { name: 'LedAmber', node: 'Racks', base: [0.1, 0.07, 0.02, 1], metallic: 0, roughness: 0.4, emissive: [1, 0.62, 0.15], strength: 1.6 },
  PisoBranco: { name: 'FloorTile', node: 'Floor', base: [0.62, 0.64, 0.65, 1], metallic: 0, roughness: 0.22 },
  PisoPreto: { name: 'FloorGrout', node: 'Floor', base: [0.012, 0.012, 0.013, 1], metallic: 0, roughness: 0.7 },
  LampCase: { name: 'FixtureCase', node: 'Fixtures', base: [0.03, 0.032, 0.035, 1], metallic: 0.5, roughness: 0.5 },
  LampTeto: { name: 'FixtureLight', node: 'Fixtures', base: [1, 1, 1, 1], metallic: 0, roughness: 0.9, emissive: [1, 0.98, 0.95], strength: 3 },
};

async function writeGlb(parts, frontWebp, meta) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'convalt prepare-datacenter (gltf-transform)';
  const buffer = doc.createBuffer();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const strengthExt = doc.createExtension(KHRMaterialsEmissiveStrength);
  const front = doc.createTexture('rackFront').setImage(new Uint8Array(frontWebp)).setMimeType('image/webp').setURI('rackFront.webp');
  const meshes = new Map();
  const scene = doc.createScene('DataCenter');
  for (const [src, geo] of parts) {
    const role = ROLES[src];
    if (!role) throw new Error(`Unmapped material ${src}`);
    const mat = doc.createMaterial(role.name).setBaseColorFactor(role.base).setMetallicFactor(role.metallic).setRoughnessFactor(role.roughness).setExtras({ sourceMaterial: src });
    if (role.texture) {
      mat.setBaseColorTexture(front);
      mat.getBaseColorTextureInfo().setMinFilter(9987).setMagFilter(9729).setWrapS(33071).setWrapT(33071);
    }
    if (role.emissive) mat.setEmissiveFactor(role.emissive);
    if (role.emissiveTexture) {
      mat.setEmissiveTexture(front);
      mat.getEmissiveTextureInfo().setMinFilter(9987).setMagFilter(9729).setWrapS(33071).setWrapT(33071);
    }
    if (role.strength) mat.setExtension('KHR_materials_emissive_strength', strengthExt.createEmissiveStrength().setEmissiveStrength(role.strength));
    const acc = (name, type, array) => doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', acc('POSITION', 'VEC3', geo.positions))
      .setAttribute('NORMAL', acc('NORMAL', 'VEC3', geo.normals))
      .setIndices(acc('indices', 'SCALAR', geo.indices))
      .setMaterial(mat);
    if (role.texture) prim.setAttribute('TEXCOORD_0', acc('TEXCOORD_0', 'VEC2', geo.uvs));
    if (!meshes.has(role.node)) {
      const mesh = doc.createMesh(role.node);
      meshes.set(role.node, mesh);
      scene.addChild(doc.createNode(role.node).setMesh(mesh));
    }
    meshes.get(role.node).addPrimitive(prim);
  }
  scene.addChild(doc.createNode('Meta').setExtras(meta));
  await MeshoptEncoder.ready;
  // 14-bit positions over the ≈ 8 m model: ≈ 0.5 mm steps.
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP, KHRMaterialsEmissiveStrength]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const bytes = await io.writeBinary(doc);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes);
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 50, writeTimestamp: false });
  return { bytes: bytes.byteLength, validation: report.issues };
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();
  const listing = extract();
  log('Extracted', listing.length, 'files into', path.relative(ROOT, SRC));
  const lowPoly = path.join(SRC, 'archive', 'data-center-low-poly');
  const fbx = path.join(lowPoly, 'source', 'DataCenter.fbx');
  const { byMaterial, source, images } = await loadFbx(fbx);

  // Measurements (metres) before welding (triangle soups).
  const cases = islands(byMaterial.get('MetalCase').pos);
  const rows = cases.filter((c) => c.max[1] - c.min[1] > 1).map((c) => ({ x0: c.min[0], x1: c.max[0], z0: c.min[2], z1: c.max[2], h: c.max[1] })).sort((a, b) => b.z1 - a.z1);
  const fronts = islands(byMaterial.get('Frente').pos).map((f) => ({ x0: f.min[0], x1: f.max[0], y0: f.min[1], y1: f.max[1], z: f.max[2] })).sort((a, b) => b.z - a.z || a.x0 - b.x0);
  const fixtures = islands(byMaterial.get('LampTeto').pos).map((f) => ({ cx: r3((f.min[0] + f.max[0]) / 2), cz: r3((f.min[2] + f.max[2]) / 2), w: r3(f.max[0] - f.min[0]), d: r3(f.max[2] - f.min[2]), y: f.min[1] }));
  const tiles = islands(byMaterial.get('PisoBranco').pos);
  const floor = { half: r3(Math.max(...tiles.map((t) => Math.max(Math.abs(t.min[0]), Math.abs(t.max[0]))))), tiles: tiles.length, tile: r3(tiles[0].max[0] - tiles[0].min[0]) };
  const all = [...byMaterial.values()].flatMap((b) => b.pos);
  const bounds = { min: [0, 1, 2].map((a) => r3(Math.min(...all.filter((_, i) => i % 3 === a)))), max: [0, 1, 2].map((a) => r3(Math.max(...all.filter((_, i) => i % 3 === a)))) };
  const cabinet = { width: r3(fronts[1].x0 - fronts[0].x0), height: CABINET_M, depth: r3(rows[0].z1 - rows[0].z0), frontWidth: r3(fronts[0].x1 - fronts[0].x0) };

  // Front texture: the external file and the FBX's embedded copy are compared, then WebP.
  const external = path.join(lowPoly, 'textures', 'x_0_0_0_14130174_800.jpeg');
  const [a, b] = await Promise.all([sharp(external).raw().toBuffer(), images[0] ? sharp(images[0].bytes).raw().toBuffer() : null]);
  let same = b !== null && a.length === b.length;
  if (same) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  const frontMeta = await sharp(external).metadata();
  const frontWebp = await sharp(external).webp({ quality: 90, effort: 6 }).toBuffer();

  const parts = [...byMaterial].map(([name, soup]) => [name, weld(soup)]);
  const meta = {
    units: 'metres; origin = platform centre on the floor, Y up, rack fronts face +Z',
    unitsToMetres: +S.toFixed(8),
    scaleNote: `cabinets are ${CABINET_UNITS} units tall and set to ${CABINET_M} m (typical 42U cabinet); the stylised cabinets are then ${cabinet.width} m wide and ${cabinet.depth} m deep`,
    bounds,
    platform: floor,
    cabinet,
    rows,
    fronts,
    fixtures,
  };
  const res = await writeGlb(parts, frontWebp, meta);
  log(`datacenter.glb: ${(res.bytes / 1024).toFixed(1)} KB, validator ${res.validation.numErrors} errors / ${res.validation.numWarnings} warnings / ${res.validation.numInfos} infos`);

  const report = {
    generated: new Date().toISOString(),
    licence: 'The archive contains no licence, readme or attribution file (the model appears to come from an online 3D viewer export). Terms must be confirmed with the supplier before production use.',
    archive: listing,
    source: {
      fbx: 'data-center-low-poly/source/DataCenter.fbx (binary FBX; node transforms −90° X, ×100)',
      nodes: source.nodes,
      lights: source.lights,
      cameras: source.cameras,
      materials: Object.fromEntries([...byMaterial].map(([k, v]) => [k, v.source])),
      frontTexture: { file: 'textures/x_0_0_0_14130174_800.jpeg', size: `${frontMeta.width}×${frontMeta.height}`, identicalToEmbedded: same },
      unused: ['textures/internal_ground_ao_texture.jpeg — a generic blurred ground shadow from the viewer export; no mesh references it'],
      walls: 'none — the model is open: racks, a floating tiled platform and floating fixtures',
    },
    findings: {
      racks: `${rows.length} rows × ${fronts.length / rows.length} cabinets = ${fronts.length} cabinets, merged into one mesh ("Cluster"); fronts face +Z`,
      indicators: 'green (Verde) and amber (Amarelo) indicators are separate geometry with their own materials, no emissive values in the FBX → made emissive',
      fixtures: `${fixtures.length} ceiling fixtures: geometry only (dark casing + light face); no light objects → emissive faces + a small light rig at runtime`,
      floor: `${floor.tiles} white tiles (${floor.tile} m) + a separate dark grout mesh; coplanar but non-overlapping (no z-fighting)`,
    },
    output: {
      file: path.relative(ROOT, OUT).replaceAll('\\', '/'),
      kilobytes: +(res.bytes / 1024).toFixed(1),
      primitives: parts.map(([name, g]) => ({ source: name, material: ROLES[name].name, node: ROLES[name].node, triangles: g.triangles, vertices: g.positions.length / 3 })),
      drawCalls: parts.length,
      validation: { errors: res.validation.numErrors, warnings: res.validation.numWarnings, infos: res.validation.numInfos, messages: res.validation.messages.slice(0, 10) },
    },
    meta,
  };
  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, 'datacenter-asset-report.json'), JSON.stringify(report, null, 2));
  log('rows', rows.length, 'cabinets', fronts.length, 'fixtures', fixtures.length, 'platform ±' + floor.half + ' m', 'cabinet', JSON.stringify(cabinet));
  log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s → docs/datacenter-asset-report.json`);
}

await main();
