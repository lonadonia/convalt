#!/usr/bin/env node
/**
 * Renders the data-center lab (dev/dc-lab.html) — reference camera and camera-path samples — and
 * builds a side-by-side comparison with the reference screenshot. Needs the dev server:
 *
 *   node scripts/serve.mjs --dev node scripts/dc-lab-shots.mjs [--out dir] [--at 0.06,0.22,…] [--vp 1903x843]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, opt('out', 'docs/datacenter-lab'));
const AT = opt('at', '0.06,0.22,0.38,0.52,0.66,0.8').split(',').map(Number);
const [W, H] = opt('vp', '1903x843').split('x').map(Number);
const extra = opt('query', '');
const REF = path.join(ROOT, 'asset-source/data-center/archive/Screenshot 2026-09-24 170556/Screenshot 2026-09-24 170556.png');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const issues = [];
async function shot(query, file, vp = { width: W, height: H }) {
  const page = await browser.newPage({ viewport: vp });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') issues.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => issues.push('pageerror ' + e.message));
  await page.goto(`http://localhost:5173/dev/dc-lab.html?${query}${extra ? '&' + extra : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(200);
  fs.writeFileSync(file, await page.screenshot());
  const hud = await page.evaluate(() => document.getElementById('hud')?.textContent);
  await page.close();
  return hud;
}
// Reference camera at the reference image size, then side by side with the reference.
const refShot = path.join(OUT, 'lab-reference-camera.png');
console.log(await shot('mode=ref', refShot, { width: 1347, height: 752 }));
const [a, b] = await Promise.all([sharp(REF).resize({ width: 940 }).toBuffer(), sharp(refShot).resize({ width: 940 }).toBuffer()]);
await sharp({ create: { width: 1890, height: 525, channels: 3, background: '#fff' } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: 950, top: 0 }]).png().toFile(path.join(OUT, 'lab-reference-compare.png'));
// Camera path samples at the target viewport.
const files = [];
for (const t of AT) {
  const f = path.join(OUT, `lab-path-${String(Math.round(t * 1000)).padStart(4, '0')}.png`);
  console.log(t, await shot(`mode=path&t=${t}&tier=${W < 700 ? 'mobile' : 'desktop'}`, f));
  files.push(f);
}
const tileW = W < 700 ? 240 : 470;
const tiles = await Promise.all(files.map((f) => sharp(f).resize({ width: tileW }).toBuffer({ resolveWithObject: true })));
const th = tiles[0].info.height, cols = W < 700 ? 6 : 3, rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * (tileW + 8) + 8, height: rows * (th + 8) + 8, channels: 3, background: '#555' } })
  .composite(tiles.map((t, i) => ({ input: t.data, left: 8 + (i % cols) * (tileW + 8), top: 8 + Math.floor(i / cols) * (th + 8) })))
  .png().toFile(path.join(OUT, 'lab-path-sheet.png'));
await browser.close();
console.log('issues:', issues.length ? [...new Set(issues)].join(' | ') : 'none');
