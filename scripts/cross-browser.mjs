#!/usr/bin/env node
/**
 * Cross-engine smoke test of the journey: Chrome/Edge (installed), Firefox and WebKit (Playwright
 * builds; install with `node node_modules/playwright/cli.js install firefox webkit`).
 * States: factory opening, departure blend (multi-layer masks), scroll-controlled footage (the
 * presented frame is checked against the mapped frame), film → model handoff, overview, component
 * scene, power generation (rows, final view) and data centers (close view, final view). Headless
 * Firefox has no WebGL by default; it is launched with WebGL forced on.
 *   node scripts/cross-browser.mjs [--url http://localhost:4173/] [--out docs/screenshots]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('url', 'http://localhost:4173/');
const OUT = path.resolve(ROOT, opt('out', 'docs/screenshots'));
fs.mkdirSync(OUT, { recursive: true });

const engines = [
  ['chrome', () => chromium.launch({ channel: 'chrome' })],
  ['edge', () => chromium.launch({ channel: 'msedge' })],
  ['firefox', () => firefox.launch({ firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false } })],
  ['webkit', () => webkit.launch()],
];
const STATES = [
  ['opening', { intro: 0 }],
  ['departure', { intro: 0.07 }],
  ['footage', { intro: 0.45 }],
  ['handoff', { intro: 0.825 }],
  ['overview', { story: 0 }],
  ['component', { story: 0.72 }],
  ['field-rows', { field: 0.6 }],
  ['field-final', { field: 0.94 }],
  ['dc-closeup', { dc: 0.1 }],
  ['dc-final', { dc: 0.95 }],
  ['portfolio', { el: '#portfolio .pf-item[data-index="1"]', offsetVh: 0.13 }],
  ['company', { el: '#company' }],
];

async function goTo(page, pos) {
  if ('el' in pos) {
    // Sections below the journey (ordinary flow): element at the top; visible images decoded.
    await page.evaluate(({ el, offsetVh = 0 }) => { const e = document.querySelector(el); window.scrollTo(0, Math.round(e.getBoundingClientRect().top + window.scrollY - 24 + offsetVh * window.innerHeight)); }, pos);
    await page.waitForFunction(() => [...document.querySelectorAll('.lp-section img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight; }).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1300);
    return;
  }
  await page.evaluate((pos) => {
    const el = document.querySelector('.story');
    const j = window.__convalt?.journey;
    if (!el || !j) return;
    const v = 'intro' in pos ? pos.intro * j.share() : 'field' in pos ? j.fromField(pos.field) : 'dc' in pos ? j.fromDc(pos.dc) : j.fromStory(pos.story);
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + v * (el.offsetHeight - window.innerHeight));
  }, pos);
  await page.waitForFunction(() => {
    const s = window.__convalt?.story;
    const c = document.querySelector('.stage__content');
    const sc = window.__convaltPerf?.scrub;
    const v = document.querySelector('[data-layer="assembly"] video');
    const scrubbed = !sc || !sc.ready || (sc.requested === sc.desired && !v?.seeking);
    return !s || (Math.abs(s.progress - s.target) < 0.0008 && (!c || c.style.opacity === '') && scrubbed);
  }, null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

const results = [];
for (const [name, launch] of engines) {
  let browser;
  try {
    browser = await launch();
  } catch (e) {
    results.push({ engine: name, launched: false, error: String(e.message).split('\n')[0] });
    console.log(name, 'could not launch:', String(e.message).split('\n')[0]);
    continue;
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const issues = [];
  page.on('console', (m) => { if (m.type() === 'error') issues.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => issues.push('pageerror: ' + e.message.slice(0, 200)));
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const state = await page.waitForFunction(() => {
    const u = window.__convalt?.ui.get();
    return u && (u.status === 'ready' || u.status === 'error' || !u.webgl) ? { status: u.status, webgl: u.webgl } : null;
  }, null, { timeout: 45000 }).then((h) => h.jsonValue()).catch(() => ({ status: 'timeout' }));
  const readyMs = Date.now() - t0;
  const info = await page.evaluate(() => ({
    ua: navigator.userAgent,
    layout: document.documentElement.dataset.layout,
    maskComposite: CSS.supports('mask-composite', 'intersect'),
    renderer: (() => { try { const gl = document.querySelector('canvas')?.getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'no canvas'; } catch { return 'n/a'; } })(),
  }));
  await page.waitForFunction(() => window.__convaltPerf?.scrub?.ready === true, null, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const shots = [];
  const frames = {};
  const sections = {};
  if (info.layout === 'pinned') {
    for (const [label, pos] of STATES) {
      if ('field' in pos && !sections.field) sections.field = await page.waitForFunction(() => ['ready', 'error'].includes(window.__convalt.ui.get().fieldStatus) && window.__convalt.ui.get().fieldStatus, null, { timeout: 90000 }).then((h) => h.jsonValue()).catch(() => 'timeout');
      if ('dc' in pos && !sections.dc) sections.dc = await page.waitForFunction(() => ['ready', 'error'].includes(window.__convalt.ui.get().dcStatus) && window.__convalt.ui.get().dcStatus, null, { timeout: 90000 }).then((h) => h.jsonValue()).catch(() => 'timeout');
      await goTo(page, pos);
      if ('field' in pos || 'dc' in pos) sections[label] = await page.evaluate(() => { const r = window.__convaltPerf?.render ?? {}; return `${r.mode}:${r.calls}`; });
      if ('el' in pos) sections[label] = await page.evaluate(() => { const s = document.querySelector('#portfolio'); const active = [...s.querySelectorAll('.pf-item')].findIndex((it) => it.dataset.active === 'true'); const vis = [...document.querySelectorAll('.lp-section img')].filter((im) => { const r = im.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; }); return `mode:${s.dataset.mode} active:${active} images:${vis.filter((im) => im.complete && im.naturalWidth > 0).length}/${vis.length}`; });
      if ('intro' in pos && pos.intro > 0.1 && pos.intro < 0.8) {
        frames[label] = await page.evaluate(() => {
          const c = window.__convalt, sc = window.__convaltPerf?.scrub;
          const intro = Math.min(1, c.story.progress / c.journey.share());
          return `${sc?.presented}/${c.journey.frameAt(intro)}`;
        });
      }
      const file = path.join(OUT, `browser-${name}-${label}.webp`);
      await sharp(await page.screenshot()).webp({ quality: 86 }).toFile(file);
      shots.push(label);
    }
  } else {
    const file = path.join(OUT, `browser-${name}-static.webp`);
    await sharp(await page.screenshot()).webp({ quality: 86 }).toFile(file);
    shots.push('static');
  }
  const after = await page.evaluate(() => ({ progress: window.__convalt?.story.progress, video: window.__convalt?.ui.get().videoState }));
  results.push({ engine: name, launched: true, version: browser.version(), readyMs, ...state, ...info, ...after, footageFrames: frames, sections, shots, issues });
  console.log(name, browser.version(), JSON.stringify({ readyMs, ...state, layout: info.layout, maskComposite: info.maskComposite, renderer: info.renderer, video: after.video, footageFrames: frames, sections, shots: shots.length, issues: issues.length }));
  for (const i of issues) console.log('   ', i);
  await browser.close();
}
fs.writeFileSync(path.join(OUT, 'cross-browser.json'), JSON.stringify(results, null, 2));
