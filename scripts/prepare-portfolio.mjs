#!/usr/bin/env node
/**
 * Imagery for the lower-page sections (project portfolio, company) → delivery WebPs in
 * public/media/portfolio/, a typed manifest the page imports (src/content/portfolioMedia.ts) and
 * docs/portfolio-asset-report.json.
 *
 * Every image is an official convalt.com file, named by its URL. Sources, in order:
 *   1. the matching file in Convalt_Energy_Images/ (the site archive; image_sources.csv maps each
 *      file to its original URL — matched by URL, never by guesswork);
 *   2. otherwise a download of that exact URL into asset-source/portfolio/ (kept as the original).
 * Originals are never modified. Each image gets one intentional crop (aspect + focal point) and a
 * few widths, never wider than the crop itself (no upscaling).
 *
 *   node scripts/prepare-portfolio.mjs      (npm run assets:portfolio)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = path.join(ROOT, 'Convalt_Energy_Images');
const DOWNLOADS = path.join(ROOT, 'asset-source/portfolio');
const OUT = path.join(ROOT, 'public/media/portfolio');
const IMG = 'https://www.convalt.com/assets/images/';

const CARD = { aspect: 3 / 2, widths: [480, 720, 960] };
/**
 * `url` is the file used. `supplied` records the URL given for the page when a sharper official
 * copy of the same picture is used instead (compared below: `sameAs`).
 */
const IMAGES = [
  // United States — the supplied files.
  { id: 'project-solis', url: `${IMG}project_solis_gallup_campus_rendering.webp`, ...CARD, focus: [0.42, 0.55] },
  { id: 'watertown-factory', url: `${IMG}pic/watertown_factory.webp`, ...CARD, focus: [0.5, 0.5] },
  { id: 'river-drivers-solar', url: `${IMG}pic/river_drivers_solar.webp`, ...CARD, focus: [0.64, 0.45] },
  { id: 'new-mexico-panel-recycling', url: `${IMG}pic/new_mexico_panel_recycling.webp`, ...CARD, focus: [0.55, 0.5] },
  { id: 'northern-maine-data-center', url: `${IMG}pic/northern_maine_data_center.webp`, ...CARD, focus: [0.5, 0.5] },
  // Other regions — the official homepage card images; where that copy is small, the same
  // picture from the project's own page.
  { id: 'redan-waste-to-energy', url: `${IMG}pic/redan_waste_to_energy.webp`, ...CARD, focus: [0.5, 0.5] },
  { id: 'vizhag-waste-to-energy', url: `${IMG}pic/vizhag_waste_to_energy.webp`, ...CARD, focus: [0.56, 0.5] },
  { id: 'mandalay-solar', url: `${IMG}pic/mandalay_solar.webp`, ...CARD, focus: [0.3, 0.5] },
  { id: 'lao-solar', url: `${IMG}lao_solar.png`, supplied: `${IMG}pic/lao_solar.webp`, ...CARD, focus: [0.5, 0.5] },
  { id: 'chad-solar', url: `${IMG}pic/chad_solar.webp`, ...CARD, focus: [0.5, 0.5] },
  { id: 'chad-rural-electrification', url: `${IMG}pic/chad_rural_electrification.webp`, ...CARD, focus: [0.5, 0.5] },
  { id: 'sierra-leone-solar', url: `${IMG}sierra_leone_solar.png`, supplied: `${IMG}pic/sierra_leone_solar.webp`, ...CARD, focus: [0.5, 0.62] },
  { id: 'kobong-hybrid-infrastructure', url: `${IMG}kobong_hybrid_infrastructure.png`, supplied: `${IMG}pic/kobong_hybrid_infrastructure.webp`, ...CARD, focus: [0.5, 0.55] },
  // Company section: the supplied picture's 1100 px original (the supplied /pic/ copy is 598 px).
  { id: 'integrated-energy-infrastructure', url: `${IMG}integrated_energy_infrastructure.webp`, supplied: `${IMG}pic/integrated_energy_infrastructure.webp`, aspect: 5 / 4, widths: [640, 900, 1100], focus: [0.5, 0.5] },
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function archiveIndex() {
  // Without the archive (e.g. a fresh clone) every image is fetched from its official URL.
  if (!fs.existsSync(path.join(ARCHIVE, 'image_sources.csv'))) return new Map();
  const rows = fs.readFileSync(path.join(ARCHIVE, 'image_sources.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean);
  const byUrl = new Map();
  for (const row of rows) {
    const [file, url] = row.split(',');
    byUrl.set(url, path.join(ARCHIVE, file));
  }
  return byUrl;
}

async function source(url, byUrl) {
  const local = byUrl.get(url);
  if (local && fs.existsSync(local)) return { kind: 'archive', file: local };
  const file = path.join(DOWNLOADS, path.basename(new URL(url).pathname));
  if (!fs.existsSync(file)) {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (asset preparation)' } });
    if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
    fs.mkdirSync(DOWNLOADS, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return { kind: 'downloaded', file };
}

/** Same picture? Mean absolute difference of 32×24 grey thumbnails (0 = identical, /255). */
async function sameAs(a, b) {
  const t = (f) => sharp(f).resize(32, 24, { fit: 'fill' }).greyscale().raw().toBuffer();
  const [x, y] = await Promise.all([t(a), t(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]);
  return +(d / x.length).toFixed(1);
}

function cropBox(w, h, aspect, [fx, fy]) {
  const cw = Math.min(w, Math.round(h * aspect));
  const ch = Math.min(h, Math.round(cw / aspect));
  const left = Math.round(Math.min(Math.max(fx * w - cw / 2, 0), w - cw));
  const top = Math.round(Math.min(Math.max(fy * h - ch / 2, 0), h - ch));
  return { left, top, width: cw, height: ch };
}

const byUrl = archiveIndex();
fs.mkdirSync(OUT, { recursive: true });
const manifest = {};
const report = { generated: new Date().toISOString(), note: 'Official convalt.com images. No licence file accompanies the archive; confirm terms before production.', images: [] };

for (const spec of IMAGES) {
  const src = await source(spec.url, byUrl);
  const buf = fs.readFileSync(src.file);
  const meta = await sharp(buf).metadata();
  const box = cropBox(meta.width, meta.height, spec.aspect, spec.focus);
  const widths = [...new Set(spec.widths.map((w) => Math.min(w, box.width)))].sort((a, b) => a - b);
  const outputs = [];
  for (const w of widths) {
    const h = Math.round(w / spec.aspect);
    const name = `${spec.id}-${w}.webp`;
    const info = await sharp(buf).extract(box).resize(w, h, { fit: 'fill' }).webp({ quality: 80, effort: 5 }).toFile(path.join(OUT, name));
    outputs.push({ file: `/media/portfolio/${name}`, width: w, height: h, bytes: info.size });
  }
  const largest = outputs.at(-1);
  manifest[spec.id] = { src: largest.file, width: largest.width, height: largest.height, srcSet: outputs.map((o) => `${o.file} ${o.width}w`).join(', ') };
  let supplied = null;
  if (spec.supplied) {
    const s = await source(spec.supplied, byUrl);
    const m = await sharp(s.file).metadata();
    supplied = { url: spec.supplied, source: path.relative(ROOT, s.file), size: `${m.width}×${m.height}`, meanDifference: await sameAs(s.file, src.file) };
  }
  report.images.push({ id: spec.id, url: spec.url, source: src.kind, file: path.relative(ROOT, src.file), bytes: buf.length, sha256: sha256(buf), size: `${meta.width}×${meta.height}`, crop: { ...box, aspect: +spec.aspect.toFixed(4), focus: spec.focus }, supplied, outputs });
  console.log(spec.id.padEnd(34), src.kind.padEnd(10), `${meta.width}×${meta.height}`.padEnd(10), '→', outputs.map((o) => `${o.width}w ${(o.bytes / 1024).toFixed(0)}KB`).join(', '), supplied ? `(supplied copy ${supplied.size}, Δ ${supplied.meanDifference})` : '');
}

const ts = `// Generated by scripts/prepare-portfolio.mjs — do not edit by hand.
export type MediaImage = { src: string; width: number; height: number; srcSet: string };

export const PORTFOLIO_MEDIA = ${JSON.stringify(manifest, null, 2).replace(/"(\w[\w-]*)":/g, (m, k) => (/^[a-z]\w*$/i.test(k) ? `${k}:` : `'${k}':`)).replace(/"/g, "'")} as const satisfies Record<string, MediaImage>;

export type MediaId = keyof typeof PORTFOLIO_MEDIA;
`;
fs.writeFileSync(path.join(ROOT, 'src/content/portfolioMedia.ts'), ts);
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/portfolio-asset-report.json'), JSON.stringify(report, null, 2));
console.log(`\n${IMAGES.length} images → public/media/portfolio/, src/content/portfolioMedia.ts, docs/portfolio-asset-report.json`);
