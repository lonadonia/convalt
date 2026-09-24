#!/usr/bin/env node
/**
 * Captures the power-generation scene (or, with --section dc, the data-center scene) at chosen
 * section-progress values (0–1) and builds a contact sheet.
 *   node scripts/field-frames.mjs [--url http://localhost:4173/] [--out dir] [--vp 1903x843] [--mobile] [--at 0,0.1,...] [--section field|dc]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('url', 'http://localhost:4173/') + (opt('query', '') ? '?' + opt('query', '') : '');
const OUT = path.resolve(ROOT, opt('out', 'docs/field-frames'));
const mobile = args.includes('--mobile');
const [W, H] = opt('vp', mobile ? '390x844' : '1903x843').split('x').map(Number);
const TAG = opt('tag', '');
const SECTION = opt('section', 'field');
const from = SECTION === 'dc' ? 'fromDc' : 'fromField';
const AT = opt('at', '0,0.06,0.12,0.18,0.24,0.3,0.36,0.44,0.52,0.6,0.68,0.76,0.84,0.92,1').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
const page = await context.newPage();
const issues = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') issues.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => issues.push('pageerror ' + e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__convalt?.ui.get().status === 'ready', null, { timeout: 45000 });
// Jump to the module scene so the field assets load, then wait for them.
await page.evaluate(() => { const el = document.querySelector('.story'); const j = window.__convalt.journey.fromStory(0.7); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + j * (el.offsetHeight - window.innerHeight)); });
await page.waitForFunction(() => ['ready', 'error'].includes(window.__convalt.ui.get().fieldStatus), null, { timeout: 60000 }).catch(() => issues.push('field not ready'));
if (SECTION === 'dc') await page.waitForFunction(() => ['ready', 'error'].includes(window.__convalt.ui.get().dcStatus), null, { timeout: 60000 }).catch(() => issues.push('data centers not ready'));
const status = await page.evaluate((dc) => (dc ? window.__convalt.ui.get().dcStatus : window.__convalt.ui.get().fieldStatus), SECTION === 'dc');
await page.waitForTimeout(800);

const rows = [];
for (const t of AT) {
  await page.evaluate(([t, from]) => {
    const el = document.querySelector('.story');
    const j = window.__convalt.journey[from](t);
    window.scrollTo(0, Math.round(el.getBoundingClientRect().top + window.scrollY + j * (el.offsetHeight - window.innerHeight)));
  }, [t, from]);
  await page.waitForFunction(([t, from]) => {
    const s = window.__convalt.story; const j = window.__convalt.journey[from](t);
    const c = document.querySelector('.stage__content');
    return Math.abs(s.target - j) < 0.002 && Math.abs(s.progress - s.target) < 0.0004 && (!c || c.style.opacity === '');
  }, [t, from], { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(450);
  const file = path.join(OUT, `${mobile ? 'mobile' : 'desktop'}${TAG}-${SECTION}-${String(Math.round(t * 1000)).padStart(4, '0')}.png`);
  fs.writeFileSync(file, await page.screenshot());
  const info = await page.evaluate(() => ({ ...window.__convaltPerf.render }));
  rows.push({ t, file, info });
}
const stats = await page.evaluate((dc) => (dc ? window.__convaltDc : window.__convaltField) ?? null, SECTION === 'dc');
await browser.close();

const tileW = mobile ? 220 : 480;
const tiles = await Promise.all(rows.map(async ({ t, file }) => {
  const img = await sharp(file).resize({ width: tileW }).png().toBuffer({ resolveWithObject: true });
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="22"><rect width="${tileW}" height="22" fill="#123336"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#fff">${SECTION} ${t.toFixed(3)}</text></svg>`);
  return sharp(img.data).extend({ top: 22, background: '#123336' }).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer({ resolveWithObject: true });
}));
const cols = mobile ? 8 : 4, th = Math.max(...tiles.map((x) => x.info.height)), gap = 8;
const nrows = Math.ceil(tiles.length / cols);
const sheet = path.join(OUT, `${mobile ? 'mobile' : 'desktop'}${TAG}-${SECTION}-sheet.png`);
await sharp({ create: { width: cols * tileW + (cols + 1) * gap, height: nrows * th + (nrows + 1) * gap, channels: 3, background: '#d7deda' } })
  .composite(tiles.map((x, i) => ({ input: x.data, left: gap + (i % cols) * (tileW + gap), top: gap + Math.floor(i / cols) * (th + gap) })))
  .png().toFile(sheet);
console.log('sheet', sheet, 'field status', status);
console.log('layout', JSON.stringify(stats));
console.log('render (calls/triangles/mode):', rows.map((r) => `${r.t}:${r.info.calls}/${r.info.triangles}/${r.info.mode}`).join(' '));
const counts = new Map();
for (const m of issues) counts.set(m, (counts.get(m) ?? 0) + 1);
console.log('issues:', counts.size ? [...counts].map(([m, n]) => `${n}× ${m}`).join(' | ') : 'none');
