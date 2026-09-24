#!/usr/bin/env node
/**
 * Captures the factory intro at chosen intro-progress values (0–1) and builds a contact sheet.
 *   node scripts/intro-frames.mjs [--url http://localhost:4173/] [--out dir] [--vp 1903x843] [--mobile]
 *        [--at 0,0.05,0.1,...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('url', 'http://localhost:4173/');
const OUT = path.resolve(ROOT, opt('out', 'docs/intro-frames'));
const mobile = args.includes('--mobile');
const [W, H] = opt('vp', mobile ? '390x844' : '1903x843').split('x').map(Number);
const AT = opt('at', '0,0.03,0.1,0.2,0.27,0.34,0.4,0.48,0.56,0.63,0.72,0.8,0.83,0.88,0.94,1').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
const page = await context.newPage();
const issues = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') issues.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => issues.push('pageerror ' + e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__convalt?.ui.get().status === 'ready', null, { timeout: 45000 });
// The scroll-controlled footage must have a decoded frame before stepping through the intro.
await page.waitForFunction(() => window.__convaltPerf?.scrub?.ready === true, null, { timeout: 30000 }).catch(() => issues.push('assembly footage not ready'));
await page.waitForTimeout(1500);

const files = [];
for (const t of AT) {
  await page.evaluate((t) => {
    const el = document.querySelector('.story');
    const share = window.__convalt.journey.share();
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.round(top + t * share * (el.offsetHeight - window.innerHeight)));
  }, t);
  await page.waitForFunction((t) => {
    const s = window.__convalt.story; const share = window.__convalt.journey.share();
    const sc = window.__convaltPerf?.scrub;
    const settled = !sc || (sc.requested === sc.desired && !document.querySelector('[data-layer="assembly"] video')?.seeking);
    return Math.abs(s.target - t * share) < 0.003 && Math.abs(s.progress - s.target) < 0.0006 && settled;
  }, t, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(350);
  const file = path.join(OUT, `${mobile ? 'mobile' : 'desktop'}-intro-${String(Math.round(t * 1000)).padStart(4, '0')}.png`);
  fs.writeFileSync(file, await page.screenshot());
  const err = await page.evaluate(() => window.__convaltPerf?.handoffErrorPx ?? 0);
  const sc = await page.evaluate(() => window.__convaltPerf?.scrub);
  files.push({ t, file, err, frame: sc ? `${sc.presented}/${sc.desired}` : '' });
}
await browser.close();

const tileW = mobile ? 220 : 480;
const tiles = await Promise.all(files.map(async ({ t, file }) => {
  const img = await sharp(file).resize({ width: tileW }).png().toBuffer({ resolveWithObject: true });
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="22"><rect width="${tileW}" height="22" fill="#123336"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#fff">intro ${t.toFixed(3)}</text></svg>`);
  return sharp(img.data).extend({ top: 22, background: '#123336' }).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer({ resolveWithObject: true });
}));
const cols = mobile ? 8 : 4, th = Math.max(...tiles.map((t) => t.info.height)), gap = 8;
const rows = Math.ceil(tiles.length / cols);
const sheet = path.join(OUT, `${mobile ? 'mobile' : 'desktop'}-intro-sheet.png`);
await sharp({ create: { width: cols * tileW + (cols + 1) * gap, height: rows * th + (rows + 1) * gap, channels: 3, background: '#d7deda' } })
  .composite(tiles.map((t, i) => ({ input: t.data, left: gap + (i % cols) * (tileW + gap), top: gap + Math.floor(i / cols) * (th + gap) })))
  .png().toFile(sheet);
console.log('sheet', sheet);
console.log('assembly frame presented/desired:', files.map((f) => `${f.t}:${f.frame}`).join(' '));
console.log('handoff corner error (px):', files.filter((f) => f.err).map((f) => `${f.t}:${f.err.toFixed(2)}`).join(' ') || 'n/a');
console.log('issues:', issues.length ? issues.join(' | ') : 'none');
