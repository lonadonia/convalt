#!/usr/bin/env node
/**
 * Power-generation layout report — runs the real layout generator (src/field/layout.ts) in Node
 * against the rendered terrain mesh, without a browser:
 *
 *   node scripts/field-layout-report.mjs [--tier desktop|mobile] [--out docs/field-layout]
 *
 * Prints module / table counts, rejected slots (with the reason), clearances, leg lengths and the
 * array's dimensions, and writes a top-view plan (tables, hero, usable boundary) over the site
 * orthophoto: <out>/field-layout-plan.webp + field-layout.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const tier = opt('tier', 'desktop');
const OUT = path.resolve(ROOT, opt('out', 'docs/field-layout'));

// The project's own TypeScript, loaded through Vite (same code the browser runs).
const vite = await createServer({ root: ROOT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const { buildLayout } = await vite.ssrLoadModule('/src/field/layout.ts');
const { createTerrainSampler } = await vite.ssrLoadModule('/src/field/terrainSampler.ts');
const { ARRAY, SITE, FIELD_ASSETS } = await vite.ssrLoadModule('/src/config/field.ts');
await vite.close();

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// Terrain: positions in the field frame (node transform applied), indices.
const terrainDoc = await io.read(path.join(ROOT, 'public', FIELD_ASSETS.terrain[tier]));
let positions, index, meta;
for (const node of terrainDoc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (node.getExtras()?.layers) meta = node.getExtras();
  if (!mesh || positions) continue;
  const prim = mesh.listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const m = node.getWorldMatrix();
  const n = pos.getCount();
  positions = new Float32Array(n * 3);
  const el = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, el);
    const [x, y, z] = el;
    positions[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    positions[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    positions[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  index = prim.getIndices().getArray();
}
const sampler = createTerrainSampler(positions, index);

// Module dimensions from the module GLB's extras (measured by prepare-field).
const moduleDoc = await io.read(path.join(ROOT, 'public', FIELD_ASSETS.module[tier]));
const extras = moduleDoc.getRoot().listNodes().map((n) => n.getExtras()).find((e) => e?.size);
const [width, height, thickness] = extras.size;
const L = buildLayout(sampler, { width, height, thickness });

const clear = L.tables.map((t) => t.clearance), legs = L.tables.map((t) => t.legs);
const report = {
  tier,
  modules: L.modules.length + 1,
  tables: L.tables.length,
  supportBoxes: L.tables.reduce((a, t) => a + t.supports.length, 0),
  rejected: L.rejected,
  array: { rows: ARRAY.rows, tablesPerRow: ARRAY.tablesPerRow, modulesPerTable: ARRAY.levels * ARRAY.columns, tiltDeg: ARRAY.tiltDeg, gcr: ARRAY.gcr },
  dims: Object.fromEntries(Object.entries(L.dims).map(([k, v]) => [k, +v.toFixed(3)])),
  clearanceM: [+Math.min(...clear.map((c) => c[0])).toFixed(3), +Math.max(...clear.map((c) => c[1])).toFixed(3)],
  legM: [+Math.min(...legs.map((l) => l[0])).toFixed(3), +Math.max(...legs.map((l) => l[1])).toFixed(3)],
  rollMax: +Math.max(...L.tables.map((t) => Math.abs(t.roll))).toFixed(4),
  revealMax: +Math.max(...L.modules.map((m) => m.reveal)).toFixed(2),
};
console.log(JSON.stringify(report, null, 1));

// Top-view plan over the inset orthophoto (field frame; image row 0 = the rect's z0 edge).
fs.mkdirSync(OUT, { recursive: true });
const rect = meta.layers.inset;
const img = path.join(ROOT, 'public', FIELD_ASSETS.layers.inset[tier]);
const S = 1400;
const toPx = (x, z) => [((x - rect.x0) / (rect.x1 - rect.x0)) * S, ((z - rect.z0) / (rect.z1 - rect.z0)) * S];
const theta = (SITE.rowAxisDeg * Math.PI) / 180;
// World → field: inverse of worldFromField.
const inv = L.worldFromField.clone().invert();
const fieldXZ = (p) => { const q = p.clone().applyMatrix4(inv); return [q.x, q.z]; };
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">`;
svg += `<polygon points="${SITE.polygon.map(([x, z]) => toPx(x, z).join(',')).join(' ')}" fill="none" stroke="#ffd34d" stroke-width="2" stroke-dasharray="8 6"/>`;
const hw = width / 2, hh = height / 2;
for (const m of [...L.modules, L.hero]) {
  const c = fieldXZ(m.position);
  // Module footprint: rotate the (landscape) rectangle by the row axis; projected depth ≈ height·cos(tilt).
  const d = hh * Math.cos((ARRAY.tiltDeg * Math.PI) / 180);
  const corners = [[-hw, -d], [hw, -d], [hw, d], [-hw, d]].map(([u, v]) => toPx(c[0] + u * Math.cos(theta) - v * Math.sin(theta), c[1] + u * Math.sin(theta) + v * Math.cos(theta)));
  svg += `<polygon points="${corners.map((p) => p.join(',')).join(' ')}" fill="${m === L.hero ? '#ff4d6d' : '#1b3f8f'}" stroke="#0b1d44" stroke-width="0.5"/>`;
}
svg += `<text x="16" y="34" font-family="sans-serif" font-size="24" fill="#fff" stroke="#000" stroke-width="0.6">${report.modules} modules · ${report.tables} tables · ${report.rejected.length} rejected (dashed: usable boundary, ${SITE.margin} m margin applies)</text></svg>`;
await sharp(img).resize(S, S).composite([{ input: Buffer.from(svg) }]).webp({ quality: 86 }).toFile(path.join(OUT, 'field-layout-plan.webp'));
fs.writeFileSync(path.join(OUT, 'field-layout.json'), JSON.stringify(report, null, 1));
console.log('plan', path.relative(ROOT, path.join(OUT, 'field-layout-plan.webp')));
