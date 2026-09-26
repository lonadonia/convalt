#!/usr/bin/env node
/**
 * Browser validation for the journey (factory intro + story + power generation + data centers),
 * using the locally installed Chrome through Playwright.
 *
 *   node scripts/capture.mjs shots   [--url http://localhost:4173/] [--out docs/screenshots] [--only reference,mobile]
 *   node scripts/capture.mjs posters [--url …]      renders public/media/*-poster*.webp from the live scene
 *   node scripts/capture.mjs perf    [--url …] [--headed]   scripted scroll with frame-time + scrub logs
 *   node scripts/capture.mjs checks  [--url …] [--blocks 7,8]   videos, scrubbing, skip, fallbacks, keyboard, reduced motion, resize, power generation, data centers
 *   node scripts/capture.mjs ui      [--url …]      focus, menu over the video, reduced motion, settle sweep
 *   node scripts/capture.mjs record  [--url …] [--out docs/intro-recording] [--mobile] [--field]   forward/reverse scroll video + filmstrip + frame log
 *                                   (--field: power generation, default out docs/field-recording;
 *                                    --dc: data centers, default out docs/datacenter-recording)
 *
 * Positions are given as intro progress (0–1: opening loop → scroll-controlled footage → model
 * handoff), story progress (0–1: the existing overview → module → closing), field progress
 * (0–1: power generation, from the centred module to the reading interval) or data-center progress
 * (0–1: dark transition → close view → pullback → copy); all map onto the one journey progress.
 * Serve the build first (npm run build, then npm run preview — or wrap the command in
 * node scripts/serve.mjs, which serves dist/ only while it runs).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args[0] ?? 'shots';
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = opt('url', 'http://localhost:4173/');
const FIELD_RECORD = mode === 'record' && args.includes('--field');
const DC_RECORD = mode === 'record' && args.includes('--dc');
const OUT = path.resolve(ROOT, opt('out', mode === 'perf' ? 'docs/perf' : FIELD_RECORD ? 'docs/field-recording' : DC_RECORD ? 'docs/datacenter-recording' : mode === 'record' ? 'docs/intro-recording' : 'docs/screenshots'));
const HEADED = args.includes('--headed');

const VIEWPORTS = {
  /** Viewport of the supplied layout reference screenshot. */
  reference: { width: 1903, height: 843, deviceScaleFactor: 1 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  wide: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  tablet: { width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tabletPortrait: { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  retina: { width: 1440, height: 900, deviceScaleFactor: 2 },
};

/** Screenshot to disk with retries: on Windows, antivirus or sync clients can briefly lock files. */
async function shoot(page, file, options = {}) {
  const buffer = await page.screenshot(options);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(file, buffer);
      return buffer;
    } catch (e) {
      if (attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

async function launch() {
  return chromium.launch({ channel: 'chrome', headless: !HEADED, args: ['--ignore-gpu-blocklist'] });
}

function watch(page, log) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log.push(`[console.${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => {
    // Media range requests are legitimately cancelled when a video stops buffering or seeks.
    if (/\.mp4(\?|$)/.test(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED') return;
    log.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => { if (r.status() >= 400) log.push(`[http ${r.status()}] ${r.url()}`); });
}

/**
 * Instruments media elements before any page script runs: counts play() calls per layer and
 * every currentTime write to the footage, flagging writes issued while a seek is still pending.
 */
const INSTRUMENT = () => {
  const w = window;
  w.__media = { play: { loop: 0, assembly: 0, other: 0 }, pause: { loop: 0, assembly: 0, other: 0 }, writes: 0, overlapping: 0 };
  const layerOf = (el) => el.closest?.('[data-layer]')?.getAttribute('data-layer') ?? 'other';
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { const k = layerOf(this); w.__media.play[k] = (w.__media.play[k] ?? 0) + 1; return play.apply(this, a); };
  const pause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function (...a) { const k = layerOf(this); w.__media.pause[k] = (w.__media.pause[k] ?? 0) + 1; return pause.apply(this, a); };
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get() { return d.get.call(this); },
    set(v) {
      if (layerOf(this) === 'assembly') { w.__media.writes++; if (this.seeking) w.__media.overlapping++; }
      d.set.call(this, v);
    },
  });
};

async function waitReady(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const c = window.__convalt;
    if (!c) return false;
    const s = c.ui.get();
    return !s.webgl || s.status === 'ready' || s.status === 'error';
  }, null, { timeout });
}

/** The scroll-controlled footage has a decoded frame (the page never reveals it before that). */
async function waitFootage(page, timeout = 30000) {
  return page.waitForFunction(() => window.__convaltPerf?.scrub?.ready === true, null, { timeout }).then(() => true, () => false);
}

/** Journey progress for a position given as { intro } or { story } (or a raw journey number). */
async function journeyOf(page, pos) {
  return page.evaluate((pos) => {
    const j = window.__convalt.journey;
    if (typeof pos === 'number') return pos;
    if ('intro' in pos) return pos.intro * j.share();
    if ('field' in pos) return j.fromField(pos.field);
    if ('dc' in pos) return j.fromDc(pos.dc);
    return j.fromStory(pos.story);
  }, pos);
}

/** The power-generation assets are loaded and its scene built (they load after the module). */
async function waitField(page, timeout = 60000) {
  return page.waitForFunction(() => ['ready', 'error'].includes(window.__convalt?.ui.get().fieldStatus), null, { timeout })
    .then(() => page.evaluate(() => window.__convalt.ui.get().fieldStatus), () => 'timeout');
}

/** Snapshot of the power-generation state: place, loading, what the last frame showed, text. */
function fieldState(page) {
  return page.evaluate(() => {
    const c = window.__convalt;
    const f = window.__convaltField ?? null;
    const text = document.querySelector('.stage .chapter--field');
    const r = window.__convaltPerf?.render ?? {};
    const start = c.journey.storyEnd(), end = c.journey.fieldEnd();
    return {
      target: c.story.target,
      progress: c.story.progress,
      field: Math.min(1, Math.max(0, (c.story.progress - start) / (end - start))),
      status: c.ui.get().fieldStatus,
      chapter: c.ui.get().chapter,
      live: f ? { ...f.live } : null,
      stats: f ? { modules: f.modules, tables: f.tables, supports: f.supports, rejected: f.rejected, clearance: f.clearance, legs: f.legs } : null,
      text: text ? Number(getComputedStyle(text).opacity) : null,
      calls: r.calls,
      triangles: r.triangles,
    };
  });
}

/** The data-center model is loaded and its scene built (it loads after the field). */
async function waitDc(page, timeout = 60000) {
  return page.waitForFunction(() => ['ready', 'error'].includes(window.__convalt?.ui.get().dcStatus), null, { timeout })
    .then(() => page.evaluate(() => window.__convalt.ui.get().dcStatus), () => 'timeout');
}

/** Snapshot of the data-center state: place, loading, render mode, dark treatment, copy. */
function dcState(page) {
  return page.evaluate(() => {
    const c = window.__convalt;
    const end = c.journey.fieldEnd();
    const text = document.querySelector('.stage .chapter--dc');
    const r = window.__convaltPerf?.render ?? {};
    const header = document.querySelector('.site-header');
    return {
      target: c.story.target,
      progress: c.story.progress,
      dc: (c.story.progress - end) / (1 - end),
      status: c.ui.get().dcStatus,
      chapter: c.ui.get().chapter,
      mode: r.mode,
      calls: r.calls,
      triangles: r.triangles,
      text: text ? Number(getComputedStyle(text).opacity) : null,
      fieldText: Number(getComputedStyle(document.querySelector('.stage .chapter--field')).opacity),
      backdrop: Number(document.querySelector('.dc-backdrop')?.style.opacity || 0),
      onDark: Number(header?.style.getPropertyValue('--on-dark') || 0),
      stats: window.__convaltDc ?? null,
    };
  });
}

/** Mean luminance (0–255) of a screenshot, and the share of clearly green pixels (indicators). */
async function lumaOf(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, green = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (g > 28 && g > r * 1.5 && g > b * 1.15) green++;
  }
  const n = info.width * info.height;
  return { luma: sum / n, green: green / n };
}

/** Same reveal state within a pixel of scroll: front within 0.5 m, counts within ±3. */
const sameReveal = (a, b) => Math.abs(a.reveal - b.reveal) < 0.5 && Math.abs(a.placed - b.placed) <= 3 && Math.abs(a.arriving - b.arriving) <= 3 && a.placed + a.arriving >= 0;

/** Mean absolute RGB difference (0–255) between two same-size screenshots. */
async function meanDiff(a, b) {
  const [x, y] = await Promise.all([a, b].map((buf) => sharp(buf).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

async function scrollToJourney(page, j) {
  await page.evaluate((j) => {
    const el = document.querySelector('.story');
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.round(top + j * (el.offsetHeight - window.innerHeight)));
  }, j);
}

/**
 * Scrolls to a position and waits until the smoothed progress has settled, any jump cut has
 * finished and the footage has finished seeking.
 */
async function goTo(page, pos, settleMs = 400) {
  if (typeof pos === 'object' && 'el' in pos) {
    await page.evaluate(({ el, offset = 0, offsetVh = 0 }) => {
      const e = document.querySelector(el);
      window.scrollTo(0, Math.round(e.getBoundingClientRect().top + window.scrollY + offset + offsetVh * window.innerHeight));
    }, pos);
    // Visible images decoded, entrance finished.
    await page.waitForFunction(() => [...document.querySelectorAll('.lp-section img')]
      .filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight; })
      .every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(settleMs + 1100);
    return 1;
  }
  if (typeof pos === 'object' && ('after' in pos || 'bottom' in pos)) {
    await page.evaluate((pos) => {
      const el = document.querySelector('.story');
      const end = el.getBoundingClientRect().top + window.scrollY + el.offsetHeight - window.innerHeight;
      window.scrollTo(0, pos.bottom ? document.documentElement.scrollHeight : Math.round(end + pos.after * window.innerHeight));
    }, pos);
    await page.waitForTimeout(settleMs + 500);
    return 1;
  }
  const j = await journeyOf(page, pos);
  await scrollToJourney(page, j);
  await page.waitForFunction((j) => {
    const s = window.__convalt?.story;
    const u = window.__convalt?.ui.get();
    if (!s) return false;
    const targetOk = Math.abs(s.target - j) < 0.003 || (u && !u.motion);
    const content = document.querySelector('.stage__content');
    const settledFade = !content || content.style.opacity === '';
    const sc = window.__convaltPerf?.scrub;
    const v = document.querySelector('[data-layer="assembly"] video');
    const scrubbed = !sc || !sc.ready || (sc.requested === sc.desired && !v?.seeking);
    return targetOk && Math.abs(s.progress - s.target) < 0.0008 && settledFade && scrubbed;
  }, j, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(settleMs);
  return j;
}

/**
 * The header's own surface in the current scene: background, backdrop filter, shadow, border and
 * any generated box (::before / ::after). The header is meant to have none of these anywhere.
 */
function headerSurface(page) {
  return page.evaluate(() => {
    const h = document.querySelector('.site-header');
    const cs = getComputedStyle(h);
    const boxes = ['::before', '::after'].filter((p) => !['none', 'normal'].includes(getComputedStyle(h, p).content));
    const plain = cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none' && (cs.backdropFilter ?? 'none') === 'none' && (cs.webkitBackdropFilter ?? 'none') === 'none' && cs.boxShadow === 'none' && cs.borderBottomWidth === '0px' && cs.borderTopWidth === '0px' && boxes.length === 0;
    return { plain, bg: cs.backgroundColor, blur: cs.backdropFilter, shadow: cs.boxShadow, border: cs.borderBottomWidth, boxes };
  });
}

/**
 * Worst-case contrast of the header links (or the phone's "Menu" label) against what is directly
 * behind their glyphs: the scene plus the header's halo, rendered with the text itself transparent
 * (a text-shadow still paints); the glyph mask comes from a render with the text in pure magenta.
 */
async function headerTextContrast(page) {
  const lum = (c) => c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const info = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('.site-header .primary-nav, .site-header .menu-toggle')].find((e) => e.getBoundingClientRect().width > 0);
    const r = nav.getBoundingClientRect();
    const c = getComputedStyle(document.querySelector('.site-header')).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const fg = c.every((v) => v <= 1) ? c.map((v) => Math.round(v * 255)) : c;
    return { x: Math.floor(r.left), y: Math.max(0, Math.floor(r.top)), w: Math.ceil(r.width), h: Math.ceil(r.height), fg };
  });
  const clip = { x: info.x, y: info.y, width: info.w, height: info.h };
  const TEXT = '.site-header .primary-nav a, .site-header .menu-toggle__label';
  const shot = async (css) => {
    const tag = await page.addStyleTag({ content: css });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const png = await page.screenshot({ clip });
    await tag.evaluate((el) => el.remove());
    return sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const mask = await shot(`${TEXT} { color: #ff00ff !important; text-shadow: none !important; transition: none !important; }`);
  const back = await shot(`${TEXT} { color: transparent !important; transition: none !important; }`);
  const fgL = lum(info.fg);
  let worst = Infinity;
  const m = mask.data;
  for (let i = 0; i < m.length; i += 3) {
    if (!(m[i] > 180 && m[i + 2] > 180 && m[i + 1] < 80)) continue; // not a glyph pixel
    const bgL = lum([back.data[i], back.data[i + 1], back.data[i + 2]]);
    worst = Math.min(worst, (Math.max(fgL, bgL) + 0.05) / (Math.min(fgL, bgL) + 0.05));
  }
  return +worst.toFixed(2);
}

/** Snapshot of the intro state used by several checks. */
function introState(page) {
  return page.evaluate(() => {
    const c = window.__convalt;
    const vid = (layer) => {
      const v = document.querySelector(`[data-layer="${layer}"] video`);
      return v ? { paused: v.paused, time: +v.currentTime.toFixed(4), src: (v.currentSrc || '').split('/').pop(), readyState: v.readyState, seeking: v.seeking, muted: v.muted } : null;
    };
    const layer = (k) => {
      const el = document.querySelector(`[data-layer="${k}"]`);
      return el ? { display: getComputedStyle(el).display, opacity: Number(getComputedStyle(el).opacity), transform: el.style.transform, mask: el.style.maskImage || el.style.webkitMaskImage || '' } : null;
    };
    const share = c.journey.share();
    const intro = Math.min(1, c.story.progress / share);
    const sc = window.__convaltPerf?.scrub ?? {};
    return {
      target: c.story.target,
      progress: c.story.progress,
      intro,
      share,
      expectedFrame: c.journey.frameAt(intro),
      scrub: { desired: sc.desired, requested: sc.requested, presented: sc.presented, seeks: sc.seeks, ready: sc.ready, failed: sc.failed },
      videoState: c.ui.get().videoState,
      chapter: c.ui.get().chapter,
      status: c.ui.get().status,
      loop: vid('loop'),
      assembly: vid('assembly'),
      heroIntro: Number(getComputedStyle(document.querySelector('.intro-hero')).opacity),
      heroOverview: Number(getComputedStyle(document.querySelector('.chapter--hero')).opacity),
      factory: getComputedStyle(document.querySelector('.factory')).display !== 'none' ? Number(getComputedStyle(document.querySelector('.factory')).opacity) : 0,
      onDark: Number(document.querySelector('.site-header')?.style.getPropertyValue('--on-dark') || 0),
      layers: { loop: layer('loop'), assembly: layer('assembly') },
      media: window.__media ?? null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------------------------
const STATES = [
  { name: '00-opening', pos: { intro: 0 } },
  { name: '01-departure', pos: { intro: 0.07 } },
  { name: '02-footage-robot', pos: { intro: 0.2 } },
  { name: '03-footage-release', pos: { intro: 0.4 } },
  { name: '04-footage-approach', pos: { intro: 0.52 } },
  { name: '05-footage-overhead', pos: { intro: 0.66 } },
  { name: '06-last-frame-push-in', pos: { intro: 0.79 } },
  { name: '07-handoff-crossfade', pos: { intro: 0.825 } },
  { name: '08-handoff-factory-out', pos: { intro: 0.87 } },
  { name: '09-handoff-travel', pos: { intro: 0.93 } },
  { name: '10-overview', pos: { story: 0 } },
  { name: '11-transition', pos: { story: 0.28 } },
  { name: '12-opening', pos: { story: 0.5 } },
  { name: '13-component-inspection', pos: { story: 0.72 } },
  { name: '14-component-cells', pos: { story: 0.72 }, layer: 'cells' },
  { name: '15-reassembly', pos: { story: 0.89 } },
  { name: '16-closing', pos: { story: 1 } },
  // Power generation (scene 03): the states the brief asks to see.
  { name: '17-field-centred-module', pos: { field: 0 } },
  { name: '18-field-environment', pos: { field: 0.16 } },
  { name: '19-field-first-panel', pos: { field: 0.3 } },
  { name: '20-field-small-group', pos: { field: 0.4 } },
  { name: '21-field-rows', pos: { field: 0.6 } },
  { name: '22-field-installation', pos: { field: 0.8 } },
  { name: '23-field-text', pos: { field: 0.94 } },
  // Data centers (scene 04): the transition, the close view, the pullback, the reference view.
  { name: '24-dc-transition', pos: { dc: 0.045 } },
  { name: '25-dc-closeup', pos: { dc: 0.1 } },
  { name: '26-dc-pullback', pos: { dc: 0.45 } },
  { name: '27-dc-final-view', pos: { dc: 0.8 } },
  { name: '28-dc-text', pos: { dc: 0.95 } },
  // Lower page: the pinned stage releasing into the dark footer, and the footer.
  { name: '29-pin-release', pos: { after: 0.45 } },
  { name: '30-footer', pos: { bottom: true } },
  // The sections after the data centers, in ordinary flow.
  { name: '31-portfolio', pos: { el: '#portfolio' } },
  { name: '32-portfolio-project', pos: { el: '#portfolio .pf-item[data-index="1"]', offsetVh: 0.13 } },
  { name: '33-company', pos: { el: '#company' } },
];
/** Full state set at the reference size and on the phone; key states elsewhere. */
const FULL_SETS = ['reference', 'mobile'];
const KEY_STATES = ['31-portfolio', '32-portfolio-project', '33-company', '00-opening', '02-footage-robot', '05-footage-overhead', '07-handoff-crossfade', '10-overview', '13-component-inspection', '21-field-rows', '23-field-text', '25-dc-closeup', '28-dc-text', '30-footer'];
const statesFor = (vpName) => (FULL_SETS.includes(vpName) ? STATES : STATES.filter((st) => KEY_STATES.includes(st.name)));

async function shots() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const report = {};
  const only = opt('only', 'reference,desktop,wide,tablet,tabletPortrait,mobile').split(',');
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    if (!only.includes(vpName)) continue;
    const log = [];
    // Documentation screenshots: 1× (2× for the phone) to keep file sizes reasonable.
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.width < 500 ? 2 : 1, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
    const page = await context.newPage();
    watch(page, log);
    const t0 = Date.now();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const readyMs = Date.now() - t0;
    await waitFootage(page);
    await page.waitForTimeout(1500); // a few seconds of the ambient loop
    const handoff = {};
    const frames = {};
    const field = {};
    for (const st of statesFor(vpName)) {
      const lower = 'dc' in st.pos || 'after' in st.pos || 'bottom' in st.pos;
      if (('field' in st.pos || lower) && !field.status) field.status = await waitField(page);
      if (lower && !field.dcStatus) field.dcStatus = await waitDc(page);
      if (st.layer) await page.click(`#layer-button-${st.layer}`);
      await goTo(page, st.pos, st.layer ? 700 : 450);
      // Documentation stills as high-quality WebP (photographic content; PNG would be ~10× larger).
      await sharp(await page.screenshot()).webp({ quality: 88, effort: 5 }).toFile(path.join(OUT, `${vpName}-${st.name}.webp`));
      const s = await introState(page);
      if (s.intro < 1) frames[st.name] = `${s.scrub.presented}/${s.expectedFrame}`;
      if (st.name.startsWith('07')) handoff.errorPx = await page.evaluate(() => window.__convaltPerf?.handoffErrorPx ?? null);
      if ('field' in st.pos) {
        const f = await fieldState(page);
        field[st.name] = { ...f.live, text: f.text, calls: f.calls, triangles: f.triangles };
      }
      if ('dc' in st.pos) {
        const d = await dcState(page);
        field[st.name] = { mode: d.mode, calls: d.calls, triangles: d.triangles, text: d.text };
      }
      if (st.layer) await page.click(`#layer-button-${st.layer}`);
    }
    report[vpName] = { readyMs, handoffCornerErrorPx: handoff.errorPx, footageFrames: frames, field, log };
    console.log(`${vpName}: ready in ${readyMs} ms, handoff corner error ${handoff.errorPx?.toFixed?.(2) ?? 'n/a'} px, footage frames presented/expected ${JSON.stringify(frames)}, ${log.length} console/network issues`);
    for (const l of log) console.log('   ', l);
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'capture-log.json'), JSON.stringify(report, null, 2));
  for (const vpName of Object.keys(report)) {
    const files = statesFor(vpName).map((st) => path.join(OUT, `${vpName}-${st.name}.webp`)).filter((p) => fs.existsSync(p));
    if (!files.length) continue;
    const portrait = VIEWPORTS[vpName].height > VIEWPORTS[vpName].width;
    const tileW = portrait ? 240 : 480;
    const tiles = await Promise.all(files.map((p) => sharp(p).resize({ width: tileW }).png().toBuffer({ resolveWithObject: true })));
    const tileH = Math.max(...tiles.map((t) => t.info.height));
    const cols = portrait ? 12 : files.length <= 6 ? files.length : 4;
    const rows = Math.ceil(files.length / cols);
    const gap = 12;
    await sharp({ create: { width: cols * tileW + (cols + 1) * gap, height: rows * tileH + (rows + 1) * gap, channels: 3, background: '#d7deda' } })
      .composite(tiles.map((t, i) => ({ input: t.data, left: gap + (i % cols) * (tileW + gap), top: gap + Math.floor(i / cols) * (tileH + gap) })))
      .webp({ quality: 86 }).toFile(path.join(OUT, `overview-${vpName}.webp`));
  }
}

// ---------------------------------------------------------------------------------------------
// Posters for loading / fallback states (canvas only, transparent page)
// ---------------------------------------------------------------------------------------------
async function posters() {
  const browser = await launch();
  const outDir = path.join(ROOT, 'public', 'media');
  fs.mkdirSync(outDir, { recursive: true });
  const jobs = [
    { name: 'hero-poster', p: 0, vp: { width: 1600, height: 1000 }, still: 'hero-still' },
    { name: 'module-detail', p: 0.72, vp: { width: 1600, height: 1000 }, still: 'module-still' },
    { name: 'hero-poster-mobile', p: 0, vp: { width: 390, height: 844 }, scale: 2 },
    { name: 'module-detail-mobile', p: 0.72, vp: { width: 390, height: 844 }, scale: 2 },
    // Power generation: full-frame stills (sky and field are opaque), final framing and a centred one.
    { name: 'field-poster', field: 1, vp: { width: 1600, height: 1000 }, opaque: true },
    { name: 'field-poster-mobile', field: 1, vp: { width: 390, height: 844 }, scale: 2, opaque: true },
    { name: 'field-still', field: 0.74, vp: { width: 1600, height: 900 }, opaque: true },
    { name: 'datacenter-poster', dc: 0.95, vp: { width: 1600, height: 1000 }, opaque: true },
    { name: 'datacenter-poster-mobile', dc: 0.95, vp: { width: 390, height: 844 }, scale: 2, opaque: true },
    // The document layout shows the still beside its text: crop to the installation (right side).
    { name: 'datacenter-still', dc: 0.95, vp: { width: 1600, height: 900 }, opaque: true, crop: [0.34, 0.04, 1, 0.94] },
  ];
  for (const job of jobs) {
    const context = await browser.newContext({ viewport: job.vp, deviceScaleFactor: job.scale ?? 1, isMobile: Boolean(job.scale), hasTouch: Boolean(job.scale) });
    const page = await context.newPage();
    await page.goto(`${BASE}?capture=1&motion=0`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    // The field assets build in the background right after the module; let that finish first so
    // no capture lands on a frame delayed by it, and only shoot a fully faded-in canvas.
    await waitField(page);
    if (job.dc !== undefined) await waitDc(page);
    await goTo(page, job.dc !== undefined ? { dc: job.dc } : job.field !== undefined ? { field: job.field } : { story: job.p }, 900);
    await page.waitForFunction(() => document.querySelector('.canvas-wrap')?.style.opacity === '1', null, { timeout: 10000 }).catch(() => console.warn(job.name, 'canvas not fully visible'));
    await page.waitForTimeout(300);
    let png = await page.screenshot({ omitBackground: !job.opaque });
    if (job.crop) {
      const m = await sharp(png).metadata();
      const [x0, y0, x1, y1] = job.crop;
      png = await sharp(png).extract({ left: Math.round(x0 * m.width), top: Math.round(y0 * m.height), width: Math.round((x1 - x0) * m.width), height: Math.round((y1 - y0) * m.height) }).png().toBuffer();
    }
    const file = path.join(outDir, `${job.name}.webp`);
    await sharp(png).webp(job.opaque ? { quality: 78, effort: 6 } : { quality: 82, alphaQuality: 90, effort: 6 }).toFile(file);
    console.log(job.name, (fs.statSync(file).size / 1024).toFixed(1), 'KB');
    if (job.still) {
      // Tightly cropped still for the static (no-WebGL) layout; faint shadow halo is trimmed.
      const trimmed = await sharp(png).trim({ threshold: 14 }).toBuffer({ resolveWithObject: true });
      const pad = Math.round(Math.max(trimmed.info.width, trimmed.info.height) * 0.05);
      const stillFile = path.join(outDir, `${job.still}.webp`);
      const padded = await sharp(trimmed.data).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      // Feather alpha toward the borders so the soft shadow halo never ends in a hard edge.
      const { width: w, height: h } = padded.info;
      const feather = Math.round(Math.min(w, h) * 0.2);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.min(x, w - 1 - x, y, h - 1 - y) / feather;
        if (d >= 1) continue;
        const k = d <= 0 ? 0 : d * d * (3 - 2 * d);
        const i = (y * w + x) * 4 + 3;
        padded.data[i] = Math.round(padded.data[i] * k);
      }
      await sharp(padded.data, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(stillFile);
      const meta = await sharp(stillFile).metadata();
      console.log(job.still, `${meta.width}×${meta.height}`, (fs.statSync(stillFile).size / 1024).toFixed(1), 'KB');
    }
    await context.close();
  }
  await browser.close();
}

// ---------------------------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------------------------
function percentile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

async function perf() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const chromeVersion = browser.version();
  const results = {};
  const vpNames = (opt('viewports', 'reference,desktop')).split(',');
  for (const vpName of vpNames) {
    const vp = VIEWPORTS[vpName];
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
    const page = await context.newPage();
    const log = [];
    watch(page, log);
    await page.goto(`${BASE}?perf=1`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitFootage(page);
    await page.waitForTimeout(2000);
    const gpu = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const gl = c?.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    const moduleJ = await journeyOf(page, { story: 0.72 });
    const fieldStatus = await waitField(page);
    const dcStatus = await waitDc(page);
    // Scripted journey: continuous scrolling through intro, story and power generation, back up,
    // a jump, then a slow pass through power generation alone (its own GPU/CPU/draw-call log).
    const journey = await page.evaluate(async (moduleJ) => {
      const el = document.querySelector('.story');
      const top = el.getBoundingClientRect().top + window.scrollY;
      const range = el.offsetHeight - window.innerHeight;
      const share = window.__convalt.journey.share();
      const storyEnd = window.__convalt.journey.storyEnd();
      const fieldEnd = window.__convalt.journey.fieldEnd();
      const raf = [];
      const lag = [];
      const draw = [];
      const drawDc = [];
      let last = performance.now();
      let running = true;
      const tick = (t) => {
        const p = window.__convalt.story.progress;
        // Segment: 1 intro, 0 story, 2 power generation, 3 data centers.
        raf.push([t - last, p < share ? 1 : p < storyEnd ? 0 : p < fieldEnd ? 2 : 3]);
        const r = window.__convaltPerf.render;
        if (p > storyEnd && p < fieldEnd) draw.push([r.calls, r.triangles]);
        if (p > fieldEnd) drawDc.push([r.calls, r.triangles, r.mode]);
        const sc = window.__convaltPerf.scrub;
        if (p > share * 0.12 && p < share * 0.8 && sc.presented >= 0) lag.push(Math.abs(sc.desired - sc.presented));
        last = t;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__convaltPerf.frames.length = 0;
      window.__convaltPerf.gpu.length = 0;
      window.__convaltPerf.cpu.length = 0;
      const seeks0 = window.__convaltPerf.scrub.seeks;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const segment = async (from, to, ms) => {
        const start = performance.now();
        while (performance.now() - start < ms) {
          const k = (performance.now() - start) / ms;
          window.scrollTo(0, top + (from + (to - from) * k) * range);
          await new Promise((r) => requestAnimationFrame(r));
        }
        window.scrollTo(0, top + to * range);
      };
      await segment(0, 1, 24000); // slow read-through: factory intro, overview, module, power generation
      await sleep(800);
      await segment(1, 0, 12000); // reverse to the opening
      await sleep(800);
      window.scrollTo(0, top + moduleJ * range); // a jump from the opening (cuts through a fade)
      await sleep(2500);
      const main = { frames: window.__convaltPerf.frames.map((f) => [f[1], f[2]]), gpu: window.__convaltPerf.gpu.slice(), cpu: window.__convaltPerf.cpu.slice() };
      // Power generation alone: module → reading interval and back, at reading speed.
      window.__convaltPerf.frames.length = 0;
      window.__convaltPerf.gpu.length = 0;
      window.__convaltPerf.cpu.length = 0;
      await segment(moduleJ, storyEnd, 2500);
      await sleep(600);
      window.__convaltPerf.frames.length = 0;
      window.__convaltPerf.gpu.length = 0;
      window.__convaltPerf.cpu.length = 0;
      await segment(storyEnd, 1, 14000);
      await sleep(800);
      await segment(1, storyEnd, 9000);
      await sleep(600);
      const field = { frames: window.__convaltPerf.frames.map((f) => [f[1], f[2]]), gpu: window.__convaltPerf.gpu.slice(), cpu: window.__convaltPerf.cpu.slice() };
      // Data centers alone: field reading interval → band → close view → pullback → copy, and back.
      await segment(storyEnd, fieldEnd, 2500);
      await sleep(600);
      window.__convaltPerf.frames.length = 0;
      window.__convaltPerf.gpu.length = 0;
      window.__convaltPerf.cpu.length = 0;
      await segment(fieldEnd - 0.01, 1, 12000);
      await sleep(800);
      await segment(1, fieldEnd - 0.01, 8000);
      await sleep(600);
      const dc = { frames: window.__convaltPerf.frames.map((f) => [f[1], f[2]]), gpu: window.__convaltPerf.gpu.slice(), cpu: window.__convaltPerf.cpu.slice() };
      running = false;
      return { raf, lag, draw, drawDc, seeks: window.__convaltPerf.scrub.seeks - seeks0, seekMs: window.__convaltPerf.scrub.seekMs.slice(), ...main, field, dc };
    }, moduleJ);
    const vsync = percentile(journey.raf.slice(5).map((r) => r[0]).filter((ms) => ms < 500).sort((a, b) => a - b), 0.5);
    const summary = (arr) => ({
      samples: arr.length,
      p50: +percentile(arr, 0.5).toFixed(2),
      p90: +percentile(arr, 0.9).toFixed(2),
      p95: +percentile(arr, 0.95).toFixed(2),
      p99: +percentile(arr, 0.99).toFixed(2),
      max: +Math.max(...arr).toFixed(2),
      droppedPct: +((100 * arr.filter((v) => v > vsync * 1.5).length) / arr.length).toFixed(2),
      below60fpsPct: +((100 * arr.filter((v) => v > 25).length) / arr.length).toFixed(2),
    });
    const rafAll = journey.raf.slice(5).filter((r) => r[0] < 500);
    const sorted = (arr) => arr.slice().sort((a, b) => a - b);
    const renderFrames = journey.frames.map((f) => f[0]).filter((ms) => ms < 200);
    const dprs = [...new Set(journey.frames.map((f) => f[1].toFixed(2)))];
    const cost = (arr) => {
      const s = sorted(arr);
      return { samples: s.length, p50: +percentile(s, 0.5).toFixed(2), p95: +percentile(s, 0.95).toFixed(2), p99: +percentile(s, 0.99).toFixed(2), max: +(s[s.length - 1] ?? NaN).toFixed(2) };
    };
    const lagS = sorted(journey.lag);
    results[vpName] = {
      viewport: vp,
      gpu,
      vsyncMs: +vsync.toFixed(2),
      rafIntervalMs: summary(sorted(rafAll.map((r) => r[0]))),
      rafIntervalIntroMs: summary(sorted(rafAll.filter((r) => r[1]).map((r) => r[0]))),
      rafIntervalStoryMs: summary(sorted(rafAll.filter((r) => r[1] === 0).map((r) => r[0]))),
      rafIntervalFieldMs: summary(sorted(rafAll.filter((r) => r[1] === 2).map((r) => r[0]))),
      rafIntervalDataCentersMs: summary(sorted(rafAll.filter((r) => r[1] === 3).map((r) => r[0]))),
      renderedFrameIntervalMs: summary(sorted(renderFrames.slice(1))),
      footage: { seeks: journey.seeks, seekMsRecent: cost(journey.seekMs), lagFrames: { p50: percentile(lagS, 0.5), p90: percentile(lagS, 0.9), max: lagS[lagS.length - 1] ?? null } },
      gpuFrameMs: cost(journey.gpu),
      cpuRenderMs: cost(journey.cpu),
      dprUsed: dprs,
      powerGeneration: {
        fieldStatus,
        renderedFrameIntervalMs: summary(sorted(journey.field.frames.map((f) => f[0]).filter((ms) => ms < 200).slice(1))),
        gpuFrameMs: cost(journey.field.gpu),
        cpuRenderMs: cost(journey.field.cpu),
        dprUsed: [...new Set(journey.field.frames.map((f) => f[1].toFixed(2)))],
        drawCalls: cost(journey.draw.map((d) => d[0])),
        triangles: cost(journey.draw.map((d) => d[1])),
      },
      dataCenters: {
        dcStatus,
        renderedFrameIntervalMs: summary(sorted(journey.dc.frames.map((f) => f[0]).filter((ms) => ms < 200).slice(1))),
        gpuFrameMs: cost(journey.dc.gpu),
        cpuRenderMs: cost(journey.dc.cpu),
        dprUsed: [...new Set(journey.dc.frames.map((f) => f[1].toFixed(2)))],
        drawCalls: cost(journey.drawDc.map((d) => d[0])),
        drawCallsInBand: cost(journey.drawDc.filter((d) => d[2] === 'band').map((d) => d[0])),
        triangles: cost(journey.drawDc.map((d) => d[1])),
      },
      issues: log,
    };
    console.log(vpName, JSON.stringify(results[vpName], null, 1));
    await context.close();
  }
  await browser.close();
  const meta = { date: new Date().toISOString(), url: BASE, headless: !HEADED, chrome: chromeVersion };
  fs.writeFileSync(path.join(OUT, `perf-${Date.now()}.json`), JSON.stringify({ meta, results }, null, 2));
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------
async function checks() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const results = [];
  const record = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail); };
  // --blocks 7,8 runs only those groups (1 opening/scrubbing, 2 skip/links, 3 keyboard, 4 phone,
  // 5 reduced motion, 6 failures, 7 power generation, 8 data centers, 9 header and lower page).
  const only = opt('blocks', '').split(',').filter(Boolean).map(Number);
  const want = (n) => !only.length || only.includes(n);
  const vp = VIEWPORTS.desktop;
  const near = (a, b, tol) => Math.abs(a - b) < tol;
  const newPage = async (options = {}) => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...options });
    await context.addInitScript(INSTRUMENT);
    return { context, page: await context.newPage() };
  };

  // 1. Opening loop, silence, departure at different loop times, pause once covered, resume.
  if (want(1)) {
    const { context, page } = await newPage();
    const log = [];
    watch(page, log);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const posterFirst = await page.evaluate(() => Boolean(document.querySelector('.boot') || document.querySelector('.factory__poster')));
    record('first paint shows the loop poster (boot frame → poster in place)', posterFirst);
    await waitReady(page);
    await page.waitForFunction(() => window.__convalt.ui.get().videoState === 'playing', null, { timeout: 10000 }).catch(() => undefined);
    const footage = await waitFootage(page);
    await page.waitForTimeout(400);
    const open = await introState(page);
    record('opening: headline, playing loop, white navigation, footage hidden', open.heroIntro > 0.99 && open.videoState === 'playing' && !open.loop.paused && open.onDark > 0.99 && open.layers.assembly.opacity === 0 && open.heroOverview < 0.01, JSON.stringify({ hero: open.heroIntro, loop: open.loop, onDark: open.onDark }));
    record('footage decoded and resting on its first usable frame before any scroll (never played)', footage && open.assembly.paused && open.scrub.presented === 6 && open.media.play.assembly === 0, JSON.stringify({ scrub: open.scrub, plays: open.media.play }));
    record('served videos are derivatives (never the 4K originals)', /^factory-loop-(1080|720|portrait)\.mp4$/.test(open.loop.src) && /^factory-assembly-(1080|720|portrait)\.mp4$/.test(open.assembly.src), `${open.loop.src} + ${open.assembly.src}`);

    // Several loop cycles: keeps playing and wraps (loop duration 6.92 s).
    const cycle = await page.evaluate(async () => {
      const v = document.querySelector('[data-layer="loop"] video');
      let wraps = 0, last = v.currentTime;
      const t0 = performance.now();
      while (performance.now() - t0 < 15000) {
        await new Promise((r) => setTimeout(r, 100));
        if (v.currentTime < last - 1) wraps++;
        last = v.currentTime;
      }
      return { wraps, playing: !v.paused };
    });
    record('opening loop plays continuously through several loops', cycle.wraps >= 2 && cycle.playing, JSON.stringify(cycle));

    const silent = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ muted: v.muted, defaultMuted: v.defaultMuted, attr: v.hasAttribute('muted'), audioBytes: v.webkitAudioDecodedByteCount ?? 0 })));
    record('all videos silent: muted, defaultMuted, muted attribute, no decoded audio', silent.every((v) => v.muted && v.defaultMuted && v.attr && v.audioBytes === 0), JSON.stringify(silent));

    // Departure from two different points of the loop: keeps playing while visible, pauses once
    // covered (no seek), resumes from that frame on the way back.
    for (const at of [1.2, 5.3]) {
      await page.waitForFunction((at) => Math.abs(document.querySelector('[data-layer="loop"] video').currentTime - at) < 0.25, at, { timeout: 12000 }).catch(() => undefined);
      await goTo(page, { intro: 0.07 }, 250);
      const mid = await introState(page);
      await goTo(page, { intro: 0.2 }, 300);
      const c1 = await introState(page);
      await page.waitForTimeout(600);
      const c2 = await introState(page);
      await goTo(page, { intro: 0 }, 400);
      const back = await introState(page);
      const dur = await page.evaluate(() => document.querySelector('[data-layer="loop"] video').duration);
      const advance = ((back.loop.time - c2.loop.time) + dur) % dur;
      record(`departure at loop t≈${at}s: loop plays through the blend, pauses once covered, resumes from the same frame`,
        !mid.loop.paused && mid.layers.assembly.opacity > 0.05 && c1.loop.paused && c2.loop.time === c1.loop.time && c1.layers.loop.display === 'none' && !back.loop.paused && advance < 1.2,
        `blend: loop ${mid.loop.paused ? 'paused' : 'playing'}, footage opacity ${mid.layers.assembly.opacity.toFixed(2)}; covered: paused at ${c1.loop.time}s; back: resumed ${back.loop.time}s`);
    }

    // Hovering at the boundary where the footage covers the loop: no play/pause call storm.
    await goTo(page, { intro: 0.105 }, 400);
    const m0 = (await introState(page)).media;
    for (let i = 0; i < 12; i++) {
      await scrollToJourney(page, await journeyOf(page, { intro: i % 2 ? 0.113 : 0.127 }));
      await page.waitForTimeout(140);
    }
    await page.waitForTimeout(500);
    const m1 = (await introState(page)).media;
    const calls = { play: m1.play.loop - m0.play.loop, pause: m1.pause.loop - m0.pause.loop };
    record('scrolling back and forth across the loop/footage boundary: no repeated play/pause calls', calls.play <= 1 && calls.pause <= 1, `12 crossings → loop play() ×${calls.play}, pause() ×${calls.pause}`);

    // Scrubbing accuracy: after settling, the presented footage frame is exactly the mapped frame.
    // Latency has its own check (settles within 0.6 s); here the compositor gets up to 1.5 s to
    // present the completed seek, so a slow composite on a loaded machine is not read as a wrong frame.
    const accuracy = [];
    for (const t of [0.13, 0.25, 0.4, 0.55, 0.62, 0.7, 0.745, 0.9]) {
      await goTo(page, { intro: t }, 250);
      await page.waitForFunction(() => {
        const c = window.__convalt;
        return window.__convaltPerf?.scrub?.presented === c.journey.frameAt(Math.min(1, c.story.progress / c.journey.share()));
      }, null, { timeout: 1500 }).catch(() => undefined);
      const s = await introState(page);
      accuracy.push({ t, presented: s.scrub.presented, expected: s.expectedFrame, paused: s.assembly.paused, desired: s.scrub.desired, requested: s.scrub.requested, time: s.assembly.time });
    }
    // The page's job: the paused element sits on the mapped frame (seeks go to the middle of a
    // frame, time = (frame + 0.5) / 24 fps). The presented frame is logged beside it: Chrome's
    // requestVideoFrameCallback report can lag behind a completed seek on a loaded machine
    // (presentation itself is checked by the settle, step, reversal and hold checks).
    const onMapped = (a) => a.paused && a.requested === a.expected && Math.round(a.time * 24 - 0.5) === a.expected;
    record('scroll position → exact footage frame (video paused on the mapped frame; presented frame logged)', accuracy.every(onMapped), accuracy.map((a) => `${a.t}:${a.presented}/${a.expected}` + (a.presented === a.expected ? '' : ` (element on ${Math.round(a.time * 24 - 0.5)}: requested ${a.requested}, time ${a.time}; presentation report lagging)`)).join(' '));
    const last = accuracy.find((a) => a.t === 0.9);
    record('after the footage window the last frame (142) is held', last?.presented === 142, `presented ${last?.presented}`);

    // Holding the scroll midway holds the frame (no drift, no playback).
    await goTo(page, { intro: 0.45 }, 300);
    const hold = await page.evaluate(async () => {
      const seen = new Set();
      const v = document.querySelector('[data-layer="assembly"] video');
      const t0 = performance.now();
      while (performance.now() - t0 < 1500) { seen.add(window.__convaltPerf.scrub.presented); await new Promise((r) => setTimeout(r, 50)); }
      return { frames: [...seen], paused: v.paused, time: v.currentTime };
    });
    record('holding the scroll midway holds one frame (no drift, no playback)', hold.frames.length === 1 && hold.paused, JSON.stringify(hold));

    // Stopping: after a scroll gesture ends, the footage settles on the final frame quickly.
    await goTo(page, { intro: 0.3 }, 300);
    const j1 = await journeyOf(page, { intro: 0.4 });
    const settle = await page.evaluate(async (j1) => {
      const el = document.querySelector('.story');
      const top = el.getBoundingClientRect().top + window.scrollY;
      const range = el.offsetHeight - window.innerHeight;
      const y0 = window.scrollY, y1 = top + j1 * range;
      const t0 = performance.now();
      while (performance.now() - t0 < 800) {
        window.scrollTo(0, y0 + (y1 - y0) * ((performance.now() - t0) / 800));
        await new Promise((r) => requestAnimationFrame(r));
      }
      window.scrollTo(0, y1);
      const stop = performance.now();
      const c = window.__convalt;
      const want = c.journey.frameAt(Math.min(1, j1 / c.journey.share()));
      while (performance.now() - stop < 3000) {
        await new Promise((r) => requestAnimationFrame(r));
        if (window.__convaltPerf.scrub.presented === want) return { ms: Math.round(performance.now() - stop), frame: want };
      }
      return { ms: null, frame: want };
    }, j1);
    record('after the scroll stops, the footage settles on the final frame within 0.6 s (no rubber-banding)', settle.ms !== null && settle.ms < 600, `${settle.ms} ms to frame ${settle.frame}`);

    // Small scroll → small change.
    const small = [];
    await page.mouse.move(700, 450);
    const base = (await introState(page)).scrub.presented;
    for (const dy of [40, 40, 40]) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(800);
      small.push((await introState(page)).scrub.presented);
    }
    const steps = small.map((f, i) => f - (i ? small[i - 1] : base));
    record('small wheel steps (40 px) advance the footage by a few frames each', steps.every((d) => d >= 1 && d <= 6), `frames ${base} → ${small.join(' → ')} (steps ${steps.join(', ')})`);

    // Fast scrolling with immediate reversals: coalesced seeks, correct destination.
    const before = await introState(page);
    for (const t of [0.7, 0.2, 0.6, 0.15, 0.72, 0.3]) { await scrollToJourney(page, await journeyOf(page, { intro: t })); await page.waitForTimeout(40); }
    await goTo(page, { intro: 0.3 }, 400);
    const after = await introState(page);
    record('fast scrolling + immediate reversals land on the right frame', after.scrub.presented === after.expectedFrame, `presented ${after.scrub.presented} expected ${after.expectedFrame}`);
    record('seeks are coalesced: never written while a seek is pending', after.media.overlapping === 0 && after.media.writes > 0, `currentTime writes ${after.media.writes}, while seeking ${after.media.overlapping}, seeks during the burst ${after.scrub.seeks - before.scrub.seeks}`);
    record('the scroll-controlled footage is never played', after.media.play.assembly === 0, JSON.stringify(after.media.play));

    // Resize within and across tiers keeps the place and the frame.
    await goTo(page, { intro: 0.55 }, 300);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(1200);
    const z1 = await introState(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(2500);
    const z2 = await introState(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => window.__convaltPerf.scrub.ready && window.__convaltPerf.scrub.requested === window.__convaltPerf.scrub.desired, null, { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    const z3 = await introState(page);
    record('resize (same tier and across tiers) keeps the intro position and footage frame', near(z1.intro, 0.55, 0.02) && near(z2.intro, 0.55, 0.02) && near(z3.intro, 0.55, 0.02) && z3.scrub.presented === z3.expectedFrame,
      `intro ${z1.intro.toFixed(3)} / mobile ${z2.intro.toFixed(3)} (${z2.assembly.src}) / back ${z3.intro.toFixed(3)}, frame ${z3.scrub.presented}/${z3.expectedFrame}`);

    await goTo(page, { story: 0.72 }, 300);
    await page.setViewportSize({ width: 900, height: 1100 });
    await page.waitForTimeout(900);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => { const j = window.__convalt.journey; const t = window.__convalt.story.target; return { p: window.__convalt.story.progress, t, story: (t - j.share()) / (j.storyEnd() - j.share()), status: window.__convalt.ui.get().status }; });
    record('resize keeps the story state', Math.abs(state.p - state.t) < 0.02 && near(state.story, 0.72, 0.02) && state.status === 'ready', JSON.stringify(state));

    for (let i = 0; i < 6; i++) await goTo(page, i % 2 ? 0.05 : 0.95, 0);
    await goTo(page, 0, 700);
    const top = await introState(page);
    record('fast scrolling across intro and story, then back to the top, restores the opening', top.progress < 0.002 && top.heroIntro > 0.99 && top.heroOverview < 0.01 && !top.loop.paused && top.scrub.presented === 6, JSON.stringify({ p: top.progress, hero: top.heroIntro, loop: top.loop.paused, frame: top.scrub.presented }));
    record('no console errors / failed requests (load, loops, scrubbing, reversals, resize)', log.length === 0, log.join(' | '));
    await context.close();
  }

  // 2. Skip intro, deep links, reload at a restored position, history.
  if (want(2)) {
    const { context, page } = await newPage();
    const log = [];
    watch(page, log);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitFootage(page);
    const overviewJ = await journeyOf(page, { story: 0.02 });
    // Record the visible stage opacity every frame while skipping: it must cut, not fast-forward.
    await page.evaluate(() => {
      window.__skipLog = [];
      const loop = () => {
        window.__skipLog.push({ p: window.__convalt.story.progress, fade: document.querySelector('.stage__visual').style.opacity });
        if (window.__skipLog.length < 240) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.click('.intro-control--skip');
    await page.waitForTimeout(1600);
    const sk = await page.evaluate(() => ({ t: window.__convalt.story.target, p: window.__convalt.story.progress, focus: document.activeElement?.id, hash: location.hash, factory: getComputedStyle(document.querySelector('.factory')).display, log: window.__skipLog }));
    const visibleMid = sk.log.filter((f) => f.p > 0.05 * overviewJ && f.p < 0.95 * overviewJ && Number(f.fade || 1) > 0.05);
    record('"Skip intro" lands on the overview, focuses its heading, updates the URL', near(sk.t, overviewJ, 0.004) && near(sk.p, sk.t, 0.002) && sk.focus === 'hero-title' && sk.hash === '#overview' && sk.factory === 'none', JSON.stringify({ t: sk.t, focus: sk.focus, hash: sk.hash }));
    record('"Skip intro" cuts through a brief fade (no fast-forward through the footage)', visibleMid.length === 0, `${visibleMid.length} visible in-between frames`);

    await page.goto(`${BASE}#module`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(1500);
    const moduleJ = await journeyOf(page, { story: 0.72 });
    const s1 = await page.evaluate(() => ({ t: window.__convalt.story.target, p: window.__convalt.story.progress, fade: document.querySelector('.stage__visual').style.opacity }));
    record('direct link #module opens the component scene', near(s1.t, moduleJ, 0.01) && near(s1.p, s1.t, 0.01) && s1.fade === '1', JSON.stringify(s1));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(1500);
    const s2 = await page.evaluate(() => ({ t: window.__convalt.story.target, p: window.__convalt.story.progress }));
    record('refresh restores the same state', near(s2.t, moduleJ, 0.015) && near(s2.p, s2.t, 0.02), JSON.stringify(s2));

    await page.goto(`${BASE}#overview`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(1500);
    const s3 = await page.evaluate(() => window.__convalt.story.target);
    record('direct link #overview opens the overview', near(s3, overviewJ, 0.01), `target=${s3.toFixed(4)}`);

    // Reload in the middle of the footage: restored place, the right frame, loop not playing.
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitFootage(page);
    await goTo(page, { intro: 0.5 }, 400);
    const before = await introState(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitFootage(page);
    await page.waitForFunction(() => window.__convaltPerf.scrub.requested === window.__convaltPerf.scrub.desired && !document.querySelector('[data-layer="assembly"] video').seeking, null, { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const after = await introState(page);
    record('reload mid-footage restores the same place and frame (loop not playing)', near(after.intro, before.intro, 0.01) && after.scrub.presented === before.scrub.presented && after.loop.paused && after.layers.assembly.opacity === 1,
      `intro ${before.intro.toFixed(3)} → ${after.intro.toFixed(3)}; frame ${before.scrub.presented} → ${after.scrub.presented}; loop ${after.videoState}`);

    // Browser back after in-page navigation.
    await goTo(page, { story: 0 }, 400);
    await page.evaluate(() => document.querySelector('.stage a[href="#module"]').click());
    await page.waitForTimeout(2500);
    await page.goBack();
    await page.waitForTimeout(1500);
    const s4 = await page.evaluate(() => ({ t: window.__convalt.story.target, p: window.__convalt.story.progress, hash: location.hash }));
    record('browser back returns to a consistent state', near(s4.p, s4.t, 0.02), JSON.stringify(s4));
    record('no console errors (skip, deep links, reloads)', log.length === 0, log.join(' | '));
    await context.close();
  }

  // 3. Keyboard.
  if (want(3)) {
    const { context, page } = await newPage({ reducedMotion: 'no-preference' });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const order = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim().slice(0, 30)));
      // Stop there: the next stops are the footer links, and focusing them scrolls to the page end.
      if (order.at(-1).startsWith('Skip intro')) break;
    }
    record('tab order at the opening reaches "Skip intro" (no video or motion controls)', order.some((t) => t.startsWith('Skip intro')) && !order.some((t) => /background video|^Motion/i.test(t)), order.join(' → '));
    await page.focus('.intro-control--skip');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const sk = await page.evaluate(() => document.activeElement?.id);
    record('"Skip intro" (Enter) moves focus to the overview heading', sk === 'hero-title', `focus=${sk}`);
    await page.keyboard.press('Tab');
    const next = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30));
    record('next Tab stop after skipping is "Explore the module"', next?.startsWith('Explore the module'), `next=${next}`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    const moduleJ = await journeyOf(page, { story: 0.72 });
    const st = await page.evaluate(() => ({ t: window.__convalt.story.target, focus: document.activeElement?.id }));
    record('"Explore the module" (Enter) reaches the component scene and focuses its heading', near(st.t, moduleJ, 0.01) && st.focus === 'module-title', JSON.stringify(st));
    await page.focus('#layer-button-protection');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const exp1 = await page.getAttribute('#layer-button-protection', 'aria-expanded');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    await page.waitForTimeout(400);
    const exp2 = await page.evaluate(() => ({ p: document.querySelector('#layer-button-protection').getAttribute('aria-expanded'), c: document.querySelector('#layer-button-cells').getAttribute('aria-expanded'), panel: !document.querySelector('#layer-panel-cells').hidden, active: window.__convalt.ui.get().activeLayer }));
    record('layer controls: Enter/Space/Arrow keys', exp1 === 'true' && exp2.p === 'false' && exp2.c === 'true' && exp2.panel && exp2.active === 'cells', JSON.stringify(exp2));
    await context.close();
  }

  // 4. Phone: portrait derivatives, menu over the footage, scrubbing, skip, layer control.
  if (want(4)) {
    const m = VIEWPORTS.mobile;
    const { context, page } = await newPage({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitFootage(page);
    const s0 = await introState(page);
    record('phone serves the portrait derivatives of both videos', s0.loop.src === 'factory-loop-portrait.mp4' && s0.assembly.src === 'factory-assembly-portrait.mp4', `${s0.loop.src} + ${s0.assembly.src}`);
    await page.tap('.menu-toggle');
    await page.waitForTimeout(300);
    const menu = await page.evaluate(() => {
      const panel = document.querySelector('#mobile-menu');
      const link = panel.querySelector('a');
      return { open: !panel.hidden, color: getComputedStyle(link).color, bg: getComputedStyle(panel).backgroundColor };
    });
    record('mobile menu over the footage opens with dark-on-ivory text', menu.open && menu.color !== 'rgb(255, 255, 255)', JSON.stringify(menu));
    await page.tap('.menu-toggle');
    await page.waitForTimeout(300);
    await goTo(page, { intro: 0.5 }, 300);
    const s1 = await introState(page);
    record('phone: scrubbing shows the mapped frame', s1.scrub.presented === s1.expectedFrame && s1.assembly.paused, `${s1.scrub.presented}/${s1.expectedFrame}`);
    await goTo(page, { intro: 0 }, 400);
    await page.tap('.intro-control--skip');
    await page.waitForTimeout(1500);
    const overviewJ = await journeyOf(page, { story: 0.02 });
    const t = await page.evaluate(() => window.__convalt.story.target);
    record('touch: "Skip intro" reaches the overview (mobile)', near(t, overviewJ, 0.005), `target=${t.toFixed(4)}`);
    await goTo(page, { story: 0.72 }, 600);
    await page.tap('#layer-button-structure');
    await page.waitForTimeout(500);
    const active = await page.evaluate(() => window.__convalt.ui.get().activeLayer);
    const box = await page.locator('#layer-button-structure').boundingBox();
    record('touch: tap selects a layer (mobile)', active === 'structure', `active=${active}`);
    record('touch target ≥ 44 px (mobile layer control)', box && box.height >= 44 && box.width >= 44, JSON.stringify(box));
    const fs1 = await waitField(page);
    await goTo(page, { field: 0.94 }, 800);
    const pf = await fieldState(page);
    const assets = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name.split('/').pop()).filter((n) => /terrain|field-module|solar-panel/.test(n)));
    const cta = await page.locator('.stage .chapter--field a.btn--primary').boundingBox();
    record('phone: power generation uses the light assets (mobile terrain, the 1K Overview panel — no separate field module) and completes', fs1 === 'ready' && assets.includes('terrain-mobile.glb') && assets.includes('solar-panel-1k.glb') && !assets.some((n) => /desktop|2k|field-module/.test(n)) && pf.live?.placed === pf.stats.modules - 1 && pf.text > 0.99,
      JSON.stringify({ status: fs1, assets, placed: pf.live?.placed, text: pf.text }));
    record('phone: projects link is a comfortable touch target', cta && cta.height >= 44, JSON.stringify(cta));
    const ds = await waitDc(page);
    await goTo(page, { dc: 0.95 }, 900);
    const pd = await dcState(page);
    const dcCta = await page.locator('.stage .chapter--dc a.btn--primary').boundingBox();
    const dcBox = await page.evaluate(() => { const r = document.querySelector('.stage .chapter--dc .eyebrow').getBoundingClientRect(); return { top: r.top, h: window.innerHeight }; });
    record('phone: data centers reframed above the copy; copy and link usable', ds === 'ready' && pd.mode === 'datacenter' && pd.text > 0.99 && dcCta && dcCta.height >= 44 && dcBox.top > dcBox.h * 0.35,
      JSON.stringify({ status: ds, mode: pd.mode, text: pd.text, cta: dcCta?.height, copyTop: Math.round(dcBox.top) }));
    await shoot(page, path.join(OUT, 'mobile-dc-final.png'));
    await context.close();
  }

  // 5. Reduced motion: static opening poster, no autoplay, footage not loaded, direct steps.
  if (want(5)) {
    const { context, page } = await newPage({ reducedMotion: 'reduce' });
    // A choice saved by the former on-page Motion switch: ignored, the OS setting rules.
    await context.addInitScript(() => { try { localStorage.setItem('convalt-motion', 'on'); } catch { /* storage unavailable */ } });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(2500);
    const o = await introState(page);
    // newPage instruments media from the first script on: a brief start that is paused again (the
    // preference resolved after the loop's first play decision) still counts as autoplay.
    const loopPlays = o.media?.play?.loop ?? 0;
    const control = await page.evaluate(() => Boolean(document.querySelector('.intro-controls button, .motion-toggle')));
    record('reduced motion (OS setting, a saved on-page choice ignored): no autoplay (play() never called), poster + readable opening copy, no video controls', o.loop.paused && loopPlays === 0 && o.loop.time < 0.05 && o.heroIntro > 0.99 && !control && o.videoState === 'paused', JSON.stringify({ loop: o.loop, loopPlays, state: o.videoState, control }));
    record('reduced motion: the scroll-controlled footage is not downloaded', o.assembly.src === '' && o.media.play.assembly === 0, `src="${o.assembly.src}"`);
    await goTo(page, { intro: 0.3 }, 700);
    const a = await page.evaluate(() => window.__convalt.story.progress);
    await goTo(page, { intro: 0.7 }, 900);
    const b = await page.evaluate(() => ({ p: window.__convalt.story.progress, share: window.__convalt.journey.share() }));
    record('reduced motion: no camera travel — the opening holds, then one step to the overview', a === 0 && near(b.p, b.share, 1e-6), `early=${a} later=${b.p.toFixed(4)} (overview=${b.share.toFixed(4)})`);
    await goTo(page, { story: 0.5 }, 900);
    const moduleJ = await journeyOf(page, { story: 0.72 });
    const p = await page.evaluate(() => window.__convalt.story.progress);
    const motion = await page.evaluate(() => window.__convalt.ui.get().motion);
    record('prefers-reduced-motion: motion off, stepped story states', motion === false && near(p, moduleJ, 0.001), `motion=${motion} progress=${p}`);
    const rmField = await waitField(page);
    await goTo(page, { field: 0.3 }, 1200);
    const fieldJ = await journeyOf(page, { field: 0.9 });
    const rf = await fieldState(page);
    record('reduced motion: power generation is one step to the completed installation with its text', rmField === 'ready' && near(rf.progress, fieldJ, 0.001) && rf.live?.placed === rf.stats.modules - 1 && rf.live.arriving === 0 && rf.text > 0.99,
      JSON.stringify({ progress: rf.progress.toFixed(4), expected: fieldJ.toFixed(4), placed: rf.live?.placed, text: rf.text }));
    await shoot(page, path.join(OUT, 'reduced-motion-field-desktop.png'));
    // Field → data centers under reduced motion: one step (a short fade, the stage kept dark).
    await waitDc(page);
    await page.evaluate(() => {
      window.__rmLog = [];
      const loop = () => {
        window.__rmLog.push({ b: Number(document.querySelector('.dc-backdrop')?.style.opacity || 0), p: window.__convalt.story.progress });
        if (window.__rmLog.length < 150) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await goTo(page, { dc: 0.4 }, 1500);
    const dcJ = await journeyOf(page, { dc: 0.93 });
    const rd = await dcState(page);
    const rmLog = await page.evaluate(() => window.__rmLog);
    const fieldJ2 = await journeyOf(page, { field: 0.9 });
    const between = rmLog.filter((f) => f.p > fieldJ2 + 1e-6 && f.p < dcJ - 1e-6).length;
    record('reduced motion: data centers is one step to the settled view with its copy (no travel, no ivory flash)', near(rd.progress, dcJ, 0.001) && rd.text > 0.99 && between === 0 && rmLog.every((f) => f.p <= fieldJ2 + 1e-6 || f.b > 0.99),
      JSON.stringify({ progress: rd.progress.toFixed(4), expected: dcJ.toFixed(4), text: rd.text, inBetweenFrames: between }));
    await shoot(page, path.join(OUT, 'reduced-motion-dc-desktop.png'));
    // No on-page switch: a change of the OS setting is followed while the page is open.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(400);
    const m2 = await page.evaluate(() => ({ motion: window.__convalt.ui.get().motion, toggles: document.querySelectorAll('.motion-toggle').length }));
    record('no Motion switch on the page; a change of the OS reduced-motion setting is followed live', m2.motion === true && m2.toggles === 0, JSON.stringify(m2));
    await context.close();
  }

  // 6. Failures: model error, no WebGL, context loss, refused autoplay, failed videos.
  if (want(6)) {
    const { context, page } = await newPage();
    const log = [];
    watch(page, log);
    await page.goto(`${BASE}?model=fail`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitFootage(page);
    await goTo(page, { intro: 0.6 }, 300);
    const mid = await introState(page);
    record('model failure: the factory footage still follows the scroll', mid.status === 'error' && mid.scrub.presented === mid.expectedFrame, `status=${mid.status} frame ${mid.scrub.presented}/${mid.expectedFrame}`);
    await goTo(page, { story: 0 }, 600);
    const st = await page.evaluate(() => ({ status: window.__convalt.ui.get().status, note: document.querySelector('.stage-status')?.textContent, heroVisible: getComputedStyle(document.querySelector('.chapter--hero')).opacity, poster: Number(document.querySelector('.poster')?.style.opacity || 0) }));
    record('model failure → overview with still image + note, text usable', st.status === 'error' && Boolean(st.note) && Number(st.heroVisible) > 0.9 && st.poster > 0.9, JSON.stringify(st));
    await goTo(page, { story: 0.72 }, 500);
    const txt = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.chapter--module')).opacity));
    record('model failure: story text still follows scroll', txt > 0.9, `module opacity ${txt}`);
    await shoot(page, path.join(OUT, 'fallback-model-error-desktop.png'));
    await goTo(page, { field: 0.94 }, 900);
    const mf = await page.evaluate(() => ({ poster: Number(document.querySelectorAll('.stage-media .poster')[2]?.style.opacity ?? 0), text: Number(getComputedStyle(document.querySelector('.stage .chapter--field')).opacity), cta: document.querySelector('.stage .chapter--field a.btn--primary')?.href }));
    record('model failure: power generation shows the installation still, its text and the projects link', mf.poster > 0.99 && mf.text > 0.99 && /\/projects\/$/.test(mf.cta ?? ''), JSON.stringify(mf));
    await shoot(page, path.join(OUT, 'fallback-model-error-field-desktop.png'));

    await page.goto(`${BASE}?webgl=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const st2 = await page.evaluate(() => ({ layout: document.documentElement.dataset.layout, h1: document.querySelector('h1')?.textContent, video: Boolean(document.querySelector('.static-intro__video')?.getAttribute('poster')), skip: Boolean(document.querySelector('.static-intro__skip')), layers: document.querySelectorAll('.layer__button').length, links: [...document.querySelectorAll('a[href*="convalt.com/projects"]')].length, field: document.querySelector('#power-generation #field-title')?.textContent, fieldCta: document.querySelector('#power-generation a.btn--primary')?.href, fieldStill: Boolean(document.querySelector('#power-generation img')) }));
    record('no WebGL → static document: factory opening, skip link, all explanations and links', st2.layout === 'static' && st2.h1 === 'Where energytakes shape.' && st2.video && st2.skip && st2.layers === 3 && st2.links >= 3, JSON.stringify(st2));
    record('no WebGL → static document includes power generation with its still and projects link', /From one module/.test(st2.field ?? '') && /\/projects\/$/.test(st2.fieldCta ?? '') && st2.fieldStill, JSON.stringify({ field: st2.field, cta: st2.fieldCta, still: st2.fieldStill }));
    const st3 = await page.evaluate(() => ({ title: document.querySelector('#data-centers #dc-title')?.textContent, cta: document.querySelector('#data-centers a.btn--primary')?.href, still: Boolean(document.querySelector('#data-centers img')) }));
    record('no WebGL → static document includes data centers with its still and project link', /Infrastructure for/.test(st3.title ?? '') && /northern-maine-data-center\/$/.test(st3.cta ?? '') && st3.still, JSON.stringify(st3));
    await shoot(page, path.join(OUT, 'fallback-no-webgl-desktop.png'), { fullPage: true });

    await page.goto(`${BASE}?lose=2500`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(3000);
    const lost = await page.evaluate(() => window.__convalt.ui.get().status);
    await page.waitForTimeout(3500);
    const restored = await page.evaluate(() => window.__convalt.ui.get().status);
    record('context loss during the intro → recovery', lost === 'context-lost' && restored === 'ready', `lost=${lost} restored=${restored}`);
    record('no unexpected console errors (failure modes)', log.every((l) => /model|forced|fail|WebGL|context/i.test(l)), log.join(' | '));
    await context.close();
  }
  if (want(6)) {
    // Autoplay refused: the poster stays (no retry, no control) — and scrubbing still works (it never plays).
    const { context, page } = await newPage();
    await context.addInitScript(() => {
      HTMLMediaElement.prototype.play = function play() { return Promise.reject(new DOMException('refused', 'NotAllowedError')); };
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(1200);
    const s = await introState(page);
    const control = await page.evaluate(() => Boolean(document.querySelector('.intro-controls button')));
    const poster = await page.evaluate(() => getComputedStyle(document.querySelector('.factory__poster')).display !== 'none' && document.querySelector('.factory__poster').complete);
    await waitFootage(page);
    await goTo(page, { intro: 0.5 }, 300);
    const later = await introState(page);
    record('autoplay refused → matching poster stays, scroll-controlled footage unaffected', s.videoState === 'blocked' && !control && poster && later.scrub.presented === later.expectedFrame, JSON.stringify({ state: s.videoState, control, frame: `${later.scrub.presented}/${later.expectedFrame}` }));
    await context.close();
  }
  if (want(6)) {
    // Opening loop fails: its poster stays in the same framing, no video control, journey works.
    const { context, page } = await newPage();
    await page.route(/factory-loop-[^/]*\.mp4(\?|$)/, (r) => r.abort());
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(1500);
    const s = await introState(page);
    const control = await page.evaluate(() => Boolean(document.querySelector('.intro-controls button')));
    const poster = await page.evaluate(() => document.querySelector('.factory__poster').complete && document.querySelector('.factory__poster').naturalWidth > 0);
    await waitFootage(page);
    await goTo(page, { intro: 0.4 }, 300);
    const later = await introState(page);
    record('opening loop failure → poster in place, no video control, footage still scrubs', s.videoState === 'error' && !control && poster && later.scrub.presented === later.expectedFrame, JSON.stringify({ state: s.videoState, control, poster }));
    await context.close();
  }
  if (want(6)) {
    // Scroll-controlled footage fails: the page stays usable — the opening holds through the
    // intro, the model fades in and the overview is reached; Skip intro works.
    const { context, page } = await newPage();
    await page.route(/factory-assembly-[^/]*\.mp4(\?|$)/, (r) => r.abort());
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(2500);
    await goTo(page, { intro: 0.4 }, 400);
    const mid = await introState(page);
    await goTo(page, { story: 0 }, 800);
    const end = await introState(page);
    await shoot(page, path.join(OUT, 'fallback-footage-error-desktop.png'));
    record('footage failure → opening stays in place (no blank frame), overview reached with the model', mid.scrub.failed && mid.layers.loop.display === 'block' && mid.layers.assembly.opacity === 0 && end.heroOverview > 0.99 && end.status === 'ready',
      JSON.stringify({ failed: mid.scrub.failed, loop: mid.layers.loop.display, footage: mid.layers.assembly.opacity, hero: end.heroOverview }));
    await goTo(page, { intro: 0 }, 600);
    await page.click('.intro-control--skip');
    await page.waitForTimeout(1500);
    const overviewJ = await journeyOf(page, { story: 0.02 });
    const t = await page.evaluate(() => window.__convalt.story.target);
    record('footage failure: "Skip intro" still reaches the overview', near(t, overviewJ, 0.005), `target=${t.toFixed(4)}`);
    await context.close();
  }

  // 7. Power generation: background loading, deterministic layout, reveal order, reverse scrolling,
  //    text timing, projects link, deep link, reload, resize across tiers, fast scrolling, cost.
  if (want(7)) {
    // One panel for Overview and Power Generation: the installation, the hero and the Module scene's
    // panel share one geometry and the same textures, and the switch between the panel and the
    // field's hero at the start of the field is invisible (same pixels).
    const { context, page } = await newPage();
    await page.goto(BASE + '?inspect=1', { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitField(page);
    await goTo(page, { field: 0.004 }, 600);
    const shared = await page.evaluate(() => {
      const { scene } = window.__three;
      const byName = (n) => { let o = null; scene.traverse((x) => { if (!o && x.name === n) o = x; }); return o; };
      const panel = byName('SuppliedSolarPanel'), hero = byName('HeroPanel'), modules = byName('Modules-placed'), arriving = byName('Modules-arriving');
      const maps = (m) => [m.map, m.normalMap, m.roughnessMap, m.metalnessMap].map((t) => t?.uuid ?? null).join();
      return {
        found: Boolean(panel && hero && modules && arriving),
        geometry: panel && hero && modules ? hero.geometry === panel.geometry && modules.geometry === panel.geometry : false,
        textures: panel && hero && modules && arriving ? [hero, modules, arriving].every((m) => maps(m.material) === maps(panel.material)) : false,
        values: panel && modules ? ['roughness', 'metalness', 'envMapIntensity'].every((k) => modules.material[k] === panel.material[k]) : false,
        triangles: panel ? panel.geometry.index.count / 3 : 0,
        visible: { panel: panel?.visible, hero: hero?.visible },
      };
    });
    const pixels = await page.evaluate(async () => {
      const { gl, scene, camera } = window.__three;
      const byName = (n) => { let o = null; scene.traverse((x) => { if (!o && x.name === n) o = x; }); return o; };
      const panel = byName('SuppliedSolarPanel'), hero = byName('HeroPanel');
      const grab = () => { gl.render(scene, camera); const c = gl.domElement; const w = c.width, h = c.height; const px = new Uint8Array(w * h * 4); const ctx = gl.getContext(); ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px); return px; };
      const a = grab();
      hero.visible = false; panel.visible = true;
      const b = grab();
      hero.visible = true; panel.visible = false;
      let diff = 0, n = 0, max = 0;
      for (let k = 0; k < a.length; k += 4 * 7) { const d = Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]); diff += d; n++; if (d > max) max = d; }
      return { mean: +(diff / n / 3).toFixed(3), max };
    });
    record('Overview and Power Generation use the same panel: one geometry, the same textures and values for the hero and all installed modules; the handoff switch changes no pixels', shared.found && shared.geometry && shared.textures && shared.values && shared.visible.hero === true && shared.visible.panel === false && pixels.mean < 0.5, JSON.stringify({ ...shared, switchPixelDiff: pixels }));
    await context.close();
  }
  if (want(7)) {
    const { context, page } = await newPage();
    const log = [];
    watch(page, log);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const t0 = Date.now();
    const status = await waitField(page);
    const loadMs = Date.now() - t0;
    const first = await fieldState(page);
    record('power generation: assets load in the background once the module is ready', status === 'ready' && first.chapter === 'intro', `${status} ${loadMs} ms after the module (still in the intro)`);
    const st = first.stats;
    const total = st.modules - 1; // instanced; the hero module is the Module scene's panel
    record('layout: 672 modules (+50% over the first 448), none rejected, lower edge ≥ 0.75 m above ground, legs reach the ground', st.modules >= 620 && st.modules <= 700 && st.rejected === 0 && st.clearance[0] >= 0.749 && st.legs[0] > 0.5 && st.legs[1] < 2,
      JSON.stringify(st));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitField(page);
    const again = await fieldState(page);
    record('layout is deterministic (identical after a reload)', JSON.stringify(again.stats) === JSON.stringify(st), '');

    const seq = {};
    // Sampled inside the reveal plateaus (settling tolerance ≈ 0.002 of field progress).
    for (const t of [0.2, 0.3, 0.38, 0.45, 0.54, 0.6, 0.7, 0.8, 0.9, 1]) {
      await goTo(page, { field: t }, 350);
      seq[t] = await fieldState(page);
    }
    const shown = (t) => seq[t].live.placed + seq[t].live.arriving;
    record('reveal order: hero alone → small group → its table → its row → rows → all',
      shown(0.2) === 0 && shown(0.3) === 0 && shown(0.38) >= 2 && shown(0.38) <= 8 && seq[0.45].live.placed >= 13 && shown(0.45) < 24 && seq[0.54].live.placed >= 55 && seq[0.6].live.placed < total && seq[0.8].live.placed === total && seq[0.8].live.arriving === 0,
      [0.2, 0.3, 0.38, 0.45, 0.54, 0.6, 0.7, 0.8].map((t) => `${t}:${seq[t].live.placed}+${seq[t].live.arriving}`).join(' '));
    record('the whole installation is visible from 0.8 to the end (nothing missing, nothing arriving)', [0.8, 0.9, 1].every((t) => seq[t].live.placed === total && seq[t].live.arriving === 0 && seq[t].live.supportsArriving === 0 && seq[t].live.supportsPlaced === st.supports), `${total} instanced modules + hero, ${st.supports} support boxes`);
    record('section text: hidden while the installation builds, fully shown for the reading interval', seq[0.6].text < 0.01 && seq[0.7].text < 0.01 && seq[0.9].text > 0.99 && seq[1].text > 0.99, [0.6, 0.7, 0.8, 0.9, 1].map((t) => `${t}:${seq[t].text}`).join(' '));
    record('draw calls and triangles stay bounded (instancing): final overview', seq[1].calls <= 12 && seq[1].triangles < 400000, `${seq[1].calls} calls, ${seq[1].triangles} triangles`);

    // Reverse: the same place reached from above shows the same state and the same image.
    await goTo(page, { field: 0.5 }, 700);
    const up = { state: await fieldState(page), png: await page.screenshot() };
    await goTo(page, { field: 0.97 }, 500);
    await goTo(page, { field: 0.5 }, 700);
    const down = { state: await fieldState(page), png: await page.screenshot() };
    const diff = await meanDiff(up.png, down.png);
    record('reverse scrolling reproduces the forward state (reveal, counts, pixels)', sameReveal(up.state.live, down.state.live) && diff < 0.5, `live ${JSON.stringify(down.state.live)}, mean pixel difference ${diff.toFixed(3)}`);

    // Fast scrolling with reversals through the section lands on the right state.
    for (const t of [0.9, 0.15, 0.75, 0.05, 1, 0.35]) { await scrollToJourney(page, await journeyOf(page, { field: t })); await page.waitForTimeout(40); }
    await goTo(page, { field: 0.6 }, 600);
    const fast = await fieldState(page);
    record('fast scrolling + reversals through power generation land on the right state', sameReveal(fast.live, seq[0.6].live), `${JSON.stringify(fast.live)} vs ${JSON.stringify(seq[0.6].live)}`);

    const cta = await page.evaluate(() => {
      const a = document.querySelector('.stage .chapter--field a.btn--primary');
      const nav = [...document.querySelectorAll('.site-header a')].find((x) => x.textContent.trim() === 'Projects');
      return a ? { href: a.href, text: a.textContent.trim(), nav: nav?.href } : null;
    });
    record('"Explore our projects" links to the existing projects route (as the navigation does)', cta && cta.text === 'Explore our projects' && cta.href === cta.nav && /\/projects\/$/.test(cta.href), JSON.stringify(cta));

    await page.goto(`${BASE}#power-generation`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitField(page);
    await page.waitForTimeout(1800);
    const dl = await fieldState(page);
    const fieldJ = await journeyOf(page, { field: 0.9 });
    const focusable = await page.evaluate(() => document.querySelector('#field-title')?.getAttribute('tabindex'));
    record('direct link #power-generation opens the completed installation with its text', near(dl.target, fieldJ, 0.01) && near(dl.progress, dl.target, 0.01) && dl.text > 0.99 && dl.live.placed === total && focusable === '-1', JSON.stringify({ t: dl.target.toFixed(4), expected: fieldJ.toFixed(4), placed: dl.live.placed, text: dl.text }));

    await goTo(page, { field: 0.6 }, 500);
    const before = await fieldState(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitField(page);
    await page.waitForTimeout(1800);
    const after = await fieldState(page);
    record('reload inside power generation restores the same place and reveal state', near(after.field, before.field, 0.01) && sameReveal(after.live, before.live), `field ${before.field.toFixed(3)} → ${after.field.toFixed(3)}, placed ${before.live.placed} → ${after.live.placed}`);

    await goTo(page, { field: 0.7 }, 500);
    const d0 = await fieldState(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);
    const ms = await waitField(page);
    await page.waitForTimeout(1500);
    const m = await fieldState(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(1200);
    const ds = await waitField(page);
    await page.waitForTimeout(1500);
    const d = await fieldState(page);
    record('resize across tiers inside power generation keeps the place; the scene is rebuilt per tier', ms === 'ready' && ds === 'ready' && near(m.field, 0.7, 0.02) && near(d.field, 0.7, 0.02) && Math.abs(m.live.placed - d0.live.placed) <= 3 && Math.abs(d.live.placed - d0.live.placed) <= 3,
      `field ${d0.field.toFixed(3)} / phone ${m.field.toFixed(3)} (${m.triangles} tris) / back ${d.field.toFixed(3)} (${d.triangles} tris), placed ${d0.live.placed}/${m.live.placed}/${d.live.placed}`);
    record('no console errors / failed requests (power generation)', log.length === 0, log.join(' | '));
    await context.close();
  }
  if (want(7)) {
    // Field assets fail: the module stays in view with a note; the text and projects link still appear.
    const { context, page } = await newPage();
    const log = [];
    watch(page, log);
    await page.route(/\/models\/field\//, (r) => r.abort());
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const status = await waitField(page, 30000);
    await goTo(page, { field: 0.5 }, 700);
    const mid = await page.evaluate(() => ({ note: document.querySelector('.stage-status')?.textContent ?? '', canvas: document.querySelector('.canvas-wrap')?.style.opacity }));
    await goTo(page, { field: 0.94 }, 700);
    const end = await fieldState(page);
    await shoot(page, path.join(OUT, 'fallback-field-error-desktop.png'));
    record('field assets fail → the module stays in view with a note; text and projects link still appear', status === 'error' && /could not be loaded/.test(mid.note) && mid.canvas === '1' && end.text > 0.99, JSON.stringify({ status, note: mid.note, canvas: mid.canvas, text: end.text }));
    record('no unexpected console errors (field failure)', log.every((l) => /field|models\/field|power-generation|failed/i.test(l)), log.join(' | '));
    await context.close();
  }

  // 8. Data centers: background loading, the dark transition (scroll-driven, no white flash, a
  //    readable close view right after it), reverse and fast scrolling, links, deep link, reload,
  //    resize, the reference framing beside the copy.
  if (want(8)) {
    const { context, page } = await newPage();
    const log = [];
    watch(page, log);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitField(page);
    const status = await waitDc(page);
    const first = await dcState(page);
    record('data centers: model loads in the background after the field (8 draw calls)', status === 'ready' && first.stats?.drawCalls === 8, JSON.stringify({ drawCalls: first.stats?.drawCalls, triangles: first.stats?.triangles }));
    await goTo(page, { dc: 0.5 }, 400);
    const path1 = (await dcState(page)).stats?.path;
    record('camera path stays in open space: ≥ 0.3 m from every rack row and fixture, rising gently below the fixtures', path1 && path1.clearance >= 0.3 && path1.minHeight > 1 && path1.maxHeight < 3.1 && path1.startDistance < 1.6,
      JSON.stringify(path1));

    // The band, sampled in small scroll steps (the transition is scroll-driven, not timed).
    const band = [];
    for (const t of [0, 0.02, 0.03, 0.038, 0.045, 0.052, 0.06, 0.075, 0.1]) {
      await goTo(page, { dc: t }, 250);
      const st = await dcState(page);
      band.push({ t, ...st, ...(await lumaOf(await page.screenshot())) });
    }
    const at = (t) => band.find((b) => b.t === t);
    record('transition: field only → both (dim, in the band) → data centers only; the field is no longer rendered after it', at(0).mode === 'field' && at(0.045).mode === 'band' && at(0.1).mode === 'datacenter' && at(0.1).calls < 30,
      band.map((b) => `${b.t}:${b.mode}/${b.calls}`).join(' '));
    const lumas = band.map((b) => b.luma);
    const darkest = Math.min(...lumas);
    const spike = band.slice(1, -1).some((b) => b.luma > Math.max(at(0).luma, at(0.1).luma) + 3);
    record('no white flash: the band darkens to charcoal and rises again (no frame brighter than its ends)', !spike && darkest < 25, band.map((b) => `${b.t}:${b.luma.toFixed(1)}`).join(' '));
    const dark = band.reduce((a, b) => (b.luma < a.luma ? b : a));
    record('no empty black frame: server indicators already glow at the darkest point of the band', dark.green > 0.0005, `darkest t=${dark.t}: luma ${dark.luma.toFixed(1)}, indicator pixels ${(dark.green * 100).toFixed(2)}%`);
    record('readable close view right after the band (indicators and racks clearly visible)', at(0.1).luma > 18 && at(0.1).green > 0.01, `luma ${at(0.1).luma.toFixed(1)}, indicator pixels ${(at(0.1).green * 100).toFixed(1)}%`);
    record('dark treatment: solar copy gone, header light-on-dark, stage backdrop charcoal', at(0.1).fieldText < 0.01 && at(0.1).onDark > 0.99 && at(0.1).backdrop > 0.99 && at(0).onDark < 0.01, JSON.stringify({ fieldText: at(0.1).fieldText, onDark: at(0.1).onDark, backdrop: at(0.1).backdrop }));

    const seq = {};
    for (const t of [0.5, 0.7, 0.8, 0.86, 0.95, 1]) { await goTo(page, { dc: t }, 300); seq[t] = await dcState(page); }
    record('copy: hidden during the pullback, fully shown for the reading interval', seq[0.5].text < 0.01 && seq[0.7].text < 0.01 && seq[0.95].text > 0.99 && seq[1].text > 0.99, [0.5, 0.7, 0.8, 0.86, 0.95, 1].map((t) => `${t}:${seq[t].text}`).join(' '));
    await goTo(page, { dc: 0.95 }, 500);
    const layoutBox = await page.evaluate(() => {
      const r = document.querySelector('.stage .chapter--dc .display').getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(document.querySelector('.stage .chapter--dc .display'));
      return { textRight: range.getBoundingClientRect().right / window.innerWidth, top: r.top / window.innerHeight };
    });
    const png = await page.screenshot();
    const cols = await (async () => {
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      // Columns containing bright or green pixels (the installation), ignoring the header and footer bands.
      let minX = info.width, maxX = 0;
      for (let y = Math.round(info.height * 0.12); y < info.height * 0.88; y++) for (let x = Math.round(info.width * layoutBox.textRight + 20); x < info.width; x++) {
        const i = (y * info.width + x) * 3;
        if (data[i + 1] > 70 || data[i] > 110) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      }
      return { left: minX / info.width, right: maxX / info.width };
    })();
    record('final composition: copy on the left, installation to its right with a clear gap, reaching the right side', cols.left > layoutBox.textRight + 0.02 && cols.right > 0.85 && cols.right - cols.left > 0.42,
      JSON.stringify({ textRight: +layoutBox.textRight.toFixed(3), model: [+cols.left.toFixed(3), +cols.right.toFixed(3)] }));

    // Reverse and fast scrolling.
    await goTo(page, { dc: 0.5 }, 700);
    const up = { state: await dcState(page), png: await page.screenshot() };
    await goTo(page, { dc: 0.97 }, 500);
    await goTo(page, { dc: 0.5 }, 700);
    const down = { state: await dcState(page), png: await page.screenshot() };
    const diff = await meanDiff(up.png, down.png);
    record('reverse scrolling reproduces the forward state exactly (camera, copy, pixels)', near(up.state.dc, down.state.dc, 1e-4) && diff < 0.8, `mean pixel difference ${diff.toFixed(3)}`);
    for (const t of [0.9, 0.02, 0.6, 0.04, 1, 0.3]) { await scrollToJourney(page, await journeyOf(page, { dc: t })); await page.waitForTimeout(40); }
    await goTo(page, { dc: 0.3 }, 600);
    const fast = await dcState(page);
    await goTo(page, { field: 0.95 }, 700);
    const back = await dcState(page);
    record('fast scrolling + reversals through the band land correctly; scrolling back restores the field', near(fast.dc, 0.3, 0.002) && fast.mode === 'datacenter' && back.mode === 'field' && back.onDark < 0.01 && back.fieldText > 0.99, JSON.stringify({ fast: fast.mode, back: back.mode, onDark: back.onDark, fieldText: back.fieldText }));

    const cta = await page.evaluate(() => { const a = document.querySelector('.stage .chapter--dc a.btn--primary'); return a ? { href: a.href, text: a.textContent.trim() } : null; });
    record('CTA links to the existing data-center project page (label matches the destination)', cta && cta.href === 'https://www.convalt.com/projects/northern-maine-data-center/' && /data center project/.test(cta.text), JSON.stringify(cta));

    await page.goto(`${BASE}#data-centers`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitDc(page);
    await page.waitForTimeout(1800);
    const dl = await dcState(page);
    const dcJ = await journeyOf(page, { dc: 0.93 });
    record('direct link #data-centers opens the settled view with its copy', near(dl.target, dcJ, 0.01) && near(dl.progress, dl.target, 0.01) && dl.text > 0.99 && dl.mode === 'datacenter', JSON.stringify({ t: dl.target.toFixed(4), expected: dcJ.toFixed(4), mode: dl.mode, text: dl.text }));
    await goTo(page, { dc: 0.4 }, 500);
    const before = await dcState(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitDc(page);
    await page.waitForTimeout(1800);
    const after = await dcState(page);
    record('reload inside data centers restores the same place', near(after.dc, before.dc, 0.01) && after.mode === 'datacenter', `dc ${before.dc.toFixed(3)} → ${after.dc.toFixed(3)}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1500);
    await waitDc(page);
    await page.waitForTimeout(1200);
    const m = await dcState(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(1500);
    const d = await dcState(page);
    record('resize across tiers inside data centers keeps the place (the model is not reloaded)', near(m.dc, before.dc, 0.02) && near(d.dc, before.dc, 0.02) && m.mode === 'datacenter' && d.mode === 'datacenter', `dc ${before.dc.toFixed(3)} / phone ${m.dc.toFixed(3)} / back ${d.dc.toFixed(3)}`);
    record('no console errors / failed requests (data centers)', log.length === 0, log.join(' | '));
    await context.close();
  }
  if (want(8)) {
    // Data-center model fails: the field darkens into charcoal, the copy and link appear with a note.
    const { context, page } = await newPage();
    const log = [];
    watch(page, log);
    await page.route(/\/models\/datacenter\.glb/, (r) => r.abort());
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitField(page);
    const status = await waitDc(page, 30000);
    await goTo(page, { dc: 0.95 }, 800);
    const st = await dcState(page);
    const note = await page.evaluate(() => document.querySelector('.stage-status')?.textContent ?? '');
    await shoot(page, path.join(OUT, 'fallback-dc-error-desktop.png'));
    record('data-center model fails → charcoal stage, copy and link still appear, with a note', status === 'error' && st.mode === 'charcoal' && st.text > 0.99 && /could not be loaded/.test(note), JSON.stringify({ status, mode: st.mode, text: st.text, note }));
    record('no unexpected console errors (data-center failure)', log.every((l) => /datacenter|data-center|failed/i.test(l)), log.join(' | '));
    await context.close();
  }

  // 9. Header, logo and the dark lower page: visible logo size and sharpness, header text contrast
  //    over every scene, dark continuity from the data centers through the footer (no ivory),
  //    reverse scrolling, reload at the footer, the mobile menu over the dark page, overflow.
  if (want(9)) {
    const headerContrast = headerTextContrast;
    const { context, page } = await newPage();
    const log = [];
    watch(page, log);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const logo = await page.evaluate(() => { const img = document.querySelector('.brand .logo'); const r = img.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), natural: img.naturalWidth, header: document.querySelector('.site-header').offsetHeight }; });
    record('logo: visibly larger (artwork-trimmed) and sharp; header height on the desktop target', logo.w >= 150 && logo.w <= 185 && logo.natural >= logo.w * 2 && logo.header >= 76 && logo.header <= 88, JSON.stringify(logo));
    await waitFootage(page);
    const contrast = {};
    await goTo(page, { intro: 0 }, 800); contrast.video = await headerContrast(page);
    await goTo(page, { story: 0.72 }, 500); contrast.module = await headerContrast(page);
    await waitField(page);
    for (const t of [0.15, 0.3, 0.6, 0.94]) { await goTo(page, { field: t }, 500); contrast[`field${t}`] = await headerContrast(page); }
    await waitDc(page);
    for (const t of [0.1, 0.3, 0.45, 0.6, 0.75, 0.95]) { await goTo(page, { dc: t }, 500); contrast[`dc${t}`] = await headerContrast(page); }
    record('header links keep ≥ 4.5:1 over every scene with no surface of its own (glyph pixels against the scene + halo behind them, worst pixel)', Object.values(contrast).every((c) => c >= 4.5), JSON.stringify(contrast));

    // The header is transparent everywhere: no background, blur, shadow, border or pseudo box.
    const surfaces = {};
    for (const [k, pos] of [['video', { intro: 0 }], ['module', { story: 0.72 }], ['field', { field: 0.94 }], ['dataCenters', { dc: 0.95 }]]) { await goTo(page, pos, 300); surfaces[k] = await headerSurface(page); }
    record('header has no background strip in any scene (transparent; no blur, shadow, border or pseudo-element)', Object.values(surfaces).every((v) => v.plain), JSON.stringify(Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, v.plain ? 'none' : v]))));

    // The removed controls are gone and leave no gaps: the bottom row holds only the opening's
    // cue and "Skip intro"; bottom-anchored copy sits where the row was.
    const removed = await page.evaluate(() => ({ chapterBar: document.querySelectorAll('.chapters, .chapters__item').length, motion: document.querySelectorAll('.motion-toggle').length, videoButtons: document.querySelectorAll('.intro-controls button, .intro-control__icon').length, footerItems: [...document.querySelectorAll('.stage__footer .scroll-cue, .stage__footer a, .stage__footer button')].map((e) => e.className) }));
    await goTo(page, { field: 0.94 }, 500);
    const fieldGap = await page.evaluate(() => Math.round(window.innerHeight - document.querySelector('.stage .chapter--field').getBoundingClientRect().bottom));
    record('chapter bar, Motion switch and Pause/Play are gone; the field copy uses the freed space', removed.chapterBar === 0 && removed.motion === 0 && removed.videoButtons === 0 && removed.footerItems.length === 2 && fieldGap <= 60, JSON.stringify({ ...removed, fieldCopyGapPx: fieldGap }));

    // The header stays over every scene, then leaves with the released stage (nothing scrolls
    // beneath it) and comes back with it.
    await goTo(page, { dc: 0.97 }, 400);
    const atEnd = await page.evaluate(() => Math.round(document.querySelector('.site-header').getBoundingClientRect().top));
    await goTo(page, { after: 0.45 }, 300);
    const released = await page.evaluate(() => { const r = document.querySelector('.site-header').getBoundingClientRect(); const end = document.querySelector('.story').getBoundingClientRect().bottom; return { top: Math.round(r.top), bottom: Math.round(r.bottom), stageBottom: Math.round(end) }; });
    await goTo(page, { bottom: true }, 300);
    const atFooter = await page.evaluate(() => Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom));
    await goTo(page, { dc: 0.97 }, 400);
    const backAgain = await page.evaluate(() => Math.round(document.querySelector('.site-header').getBoundingClientRect().top));
    record('the header stays at the top through the journey, leaves with the released stage and returns with it', atEnd === 0 && released.bottom <= 0 && atFooter <= 0 && backAgain === 0, JSON.stringify({ atEnd, released, atFooter, backAgain }));

    // Dark continuity: sampled frames from the data centers through the pin release to the footer.
    const frames = [];
    for (const pos of [{ dc: 0.1 }, { dc: 0.97 }, { after: 0.2 }, { after: 0.5 }, { el: '#portfolio' }, { el: '#company' }, { bottom: true }]) {
      await goTo(page, pos, 300);
      // Project photographs are content, not page surfaces: hidden for the ivory count.
      const hide = await page.addStyleTag({ content: '.lp-section img { visibility: hidden !important; }' });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const png = await page.screenshot();
      await hide.evaluate((el) => el.remove());
      const { data, info } = await sharp(png).removeAlpha().resize({ width: 240 }).raw().toBuffer({ resolveWithObject: true });
      let ivory = 0;
      for (let i = 0; i < data.length; i += 3) if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 215 && Math.abs(data[i] - data[i + 2]) < 20) ivory++;
      const scene = await page.evaluate(() => ({ scene: document.documentElement.dataset.scene, body: getComputedStyle(document.body).backgroundColor, html: getComputedStyle(document.documentElement).backgroundColor }));
      frames.push({ pos: JSON.stringify(pos), ivory: +(ivory / (info.width * info.height)).toFixed(4), ...scene });
    }
    record('dark from the data centers through the portfolio, company section and footer: no ivory areas, dark page and body, scene "dark"', frames.every((f) => f.ivory < 0.02 && f.scene === 'dark' && f.body === 'rgb(11, 18, 20)' && f.html === 'rgb(11, 18, 20)'), frames.map((f) => `${f.pos}:${(f.ivory * 100).toFixed(1)}%/${f.scene}`).join(' '));
    const footer = await page.evaluate(() => {
      const f = document.querySelector('.site-footer'); const r = f.getBoundingClientRect();
      return { bg: getComputedStyle(f).backgroundColor, gapBelow: Math.round(window.innerHeight - r.bottom), links: [...f.querySelectorAll('a')].map((a) => a.href), copyright: f.querySelector('.site-footer__legal p')?.textContent };
    });
    record('footer: dark, reaches the page bottom, verified links and legal line', footer.bg === 'rgb(11, 18, 20)' && footer.gapBelow <= 1 && footer.links.every((h) => /^https:\/\/www\.convalt\.com\//.test(h) || h.endsWith('/')) && /Convalt Energy, Inc\./.test(footer.copyright ?? ''), JSON.stringify({ bg: footer.bg, gapBelow: footer.gapBelow, links: footer.links.length, copyright: footer.copyright }));

    // Reverse: back up into the light scenes.
    await goTo(page, { field: 0.6 }, 700);
    const back = await page.evaluate(() => ({ scene: document.documentElement.dataset.scene, body: getComputedStyle(document.body).backgroundColor }));
    await goTo(page, { story: 0.72 }, 600);
    const backStory = await page.evaluate(() => ({ scene: document.documentElement.dataset.scene, onDark: document.querySelector('.site-header').style.getPropertyValue('--on-dark') }));
    record('scrolling back up restores the light scenes (body ivory, header colours follow)', back.scene === 'light' && back.body === 'rgb(245, 244, 238)' && backStory.scene === 'light' && Number(backStory.onDark) < 0.01, JSON.stringify({ back, backStory }));

    // Reload at the footer: back at the footer, dark from the very first paint.
    await goTo(page, { bottom: true }, 600);
    const before = await page.evaluate(() => Math.round(window.scrollY));
    await page.evaluate(() => { window.__firstScene = null; });
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => { window.__firstScene = document.documentElement.dataset.scene ?? 'none'; }, { once: true });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const firstScene = await page.evaluate(() => window.__firstScene);
    await waitReady(page);
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => ({ y: Math.round(window.scrollY), max: document.documentElement.scrollHeight - window.innerHeight, scene: document.documentElement.dataset.scene }));
    record('reload at the footer returns to the footer, dark from the first paint', firstScene === 'dark' && Math.abs(after.y - before) <= 2 && after.scene === 'dark', JSON.stringify({ firstScene, before, after }));
    record('no console errors / failed requests (header, dark lower page)', log.length === 0, log.join(' | '));
    await context.close();
  }
  if (want(9)) {
    // Jump cuts across the intro into and out of the dark lower page fade through charcoal, never
    // through the ivory page: rapid screenshots during a hash jump (#data-centers) and the jump back.
    const { context, page } = await newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitField(page);
    await waitDc(page);
    await waitFootage(page);
    await goTo(page, { intro: 0 }, 800);
    const ivoryShare = async () => {
      const { data, info } = await sharp(await page.screenshot()).removeAlpha().resize({ width: 160 }).raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += 3) if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 215 && Math.abs(data[i] - data[i + 2]) < 20) n++;
      return n / (info.width * info.height);
    };
    const burst = async (action) => {
      await action();
      const shares = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 1600) shares.push(+(await ivoryShare()).toFixed(3));
      return shares;
    };
    const into = await burst(() => page.evaluate(() => { location.hash = '#data-centers'; }));
    await page.waitForTimeout(1200);
    const landed = await dcState(page);
    const back = await burst(() => page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })));
    await page.waitForTimeout(800);
    record('jumps between the opening and the data centers fade through charcoal (no ivory frame either way)', Math.max(...into) < 0.05 && Math.max(...back) < 0.05 && landed.mode === 'datacenter',
      `into: max ivory ${(Math.max(...into) * 100).toFixed(1)}% over ${into.length} frames, landed ${landed.mode}; back: max ivory ${(Math.max(...back) * 100).toFixed(1)}% over ${back.length} frames`);
    await context.close();
  }
  if (want(9)) {
    // Phone: logo size, no horizontal overflow anywhere, the mobile menu over the dark lower page.
    const m = VIEWPORTS.mobile;
    const { context, page } = await newPage({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const logo = await page.evaluate(() => { const r = document.querySelector('.brand .logo').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), header: document.querySelector('.site-header').offsetHeight }; });
    const overflow = [];
    for (const pos of [{ intro: 0 }, { story: 0.72 }]) { await goTo(page, pos, 300); overflow.push(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)); }
    await waitField(page);
    await waitDc(page);
    for (const pos of [{ field: 0.94 }, { dc: 0.95 }, { bottom: true }]) { await goTo(page, pos, 300); overflow.push(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)); }
    record('phone: legible logo, header on the mobile target, no horizontal overflow on any section', logo.w >= 110 && logo.header >= 64 && logo.header <= 72 && overflow.every((o) => o === 0), JSON.stringify({ logo, overflow }));
    const surfaces = {};
    const menuContrast = {};
    for (const [k, pos] of [['video', { intro: 0 }], ['module', { story: 0.72 }], ['field0.6', { field: 0.6 }], ['field', { field: 0.94 }], ['dc0.45', { dc: 0.45 }], ['dataCenters', { dc: 0.95 }]]) {
      await goTo(page, pos, 300);
      menuContrast[k] = await headerTextContrast(page);
      if (!k.includes('0.')) surfaces[k] = await headerSurface(page);
    }
    record('phone: the "Menu" label keeps ≥ 4.5:1 over every scene (glyph pixels against the scene + halo behind them)', Object.values(menuContrast).every((c) => c >= 4.5), JSON.stringify(menuContrast));
    await goTo(page, { dc: 0.95 }, 300);
    const gaps = await page.evaluate(() => ({ dcCopy: Math.round(window.innerHeight - document.querySelector('.stage .chapter--dc').getBoundingClientRect().bottom) }));
    await goTo(page, { field: 0.94 }, 300);
    gaps.fieldCopy = await page.evaluate(() => Math.round(window.innerHeight - document.querySelector('.stage .chapter--field').getBoundingClientRect().bottom));
    record('phone: header has no background strip in any scene; the copy uses the space the bottom bar left', Object.values(surfaces).every((v) => v.plain) && gaps.dcCopy <= 40 && gaps.fieldCopy <= 40, JSON.stringify({ surfaces: Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, v.plain ? 'none' : v])), ...gaps }));
    await goTo(page, { dc: 0.95 }, 300);
    await page.tap('.menu-toggle');
    await page.waitForTimeout(400);
    const menu = await page.evaluate(() => {
      const panel = document.querySelector('#mobile-menu'); const a = panel.querySelector('a');
      return { open: !panel.hidden, bg: getComputedStyle(panel).backgroundColor, link: getComputedStyle(a).color, logoWhite: Number(getComputedStyle(document.querySelector('.brand__logos .logo:first-child')).opacity), focus: document.activeElement?.textContent?.trim() };
    });
    await shoot(page, path.join(OUT, 'mobile-menu-dark.png'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => document.querySelector('#mobile-menu').hidden);
    record('phone: the menu over the dark lower page is dark with light links and logo, opens and closes', menu.open && menu.bg === 'rgb(11, 18, 20)' && menu.link === 'rgb(242, 245, 242)' && menu.logoWhite > 0.99 && closed, JSON.stringify({ ...menu, closed }));
    await context.close();
  }

  // 10. The sections after the data centers: the scroll-driven project portfolio and the company.
  if (want(10)) {
    const PROJECTS = [
      ['project-solis', 'Project Solis', 'UNDER FINANCING', 'New Mexico, U.S.A.', '3.6 GW cells / 3.0 GW modules · Manufacturing', 'https://www.convalt.com/project-solis/index.html', 'A proposed advanced-manufacturing campus'],
      ['watertown-factory', 'Watertown Factory', 'ON HOLD', 'Watertown, New York, U.S.A.', '2 GW planned solar cell production · Manufacturing', 'https://www.convalt.com/projects/watertown-factory/index.html', 'A planned solar cell manufacturing facility'],
      ['river-drivers-solar', 'River Drivers Solar', 'UNDER DEVELOPMENT', 'East Millinocket, Maine, U.S.A.', '12 MW · Power Generation', 'https://www.convalt.com/projects/river-drivers-solar/index.html', 'Convalt is developing a 12 MW community solar project'],
      ['new-mexico-panel-recycling', 'New Mexico Panel Recycling', 'UNDER DEVELOPMENT', 'New Mexico, U.S.A.', '1 GW · Recycling', 'https://www.convalt.com/projects/new-mexico-panel-recycling/index.html', 'Convalt’s first recycling facility'],
      ['northern-maine-data-center', 'Northern Maine Data Center', 'UNDER DEVELOPMENT', 'Maine, U.S.A.', 'Integrated infrastructure · Data Centers', 'https://www.convalt.com/projects/northern-maine-data-center/index.html', 'Convalt Data Center is developing a major site'],
    ];
    const HOLD = 0.26; // --pf-hold (svh), see usePortfolioScroll
    /** The portfolio's state: layout, the project in focus, the rail, which image is on top, text placement. */
    const pfState = (page) => page.evaluate(() => {
      const s = document.querySelector('#portfolio');
      const items = [...s.querySelectorAll('.pf-item')];
      const activeIdx = items.findIndex((i) => i.dataset.active === 'true');
      const rail = [...s.querySelectorAll('.pf-rail a')].findIndex((a) => a.getAttribute('aria-current') === 'true');
      const media = items[0].querySelector('.pf-item__media').getBoundingClientRect();
      const hit = document.elementFromPoint(media.left + media.width / 2, window.innerHeight / 2);
      const onTop = items.findIndex((i) => i.contains(hit));
      const texts = items.map((i) => { const r = i.querySelector('.pf-item__text').getBoundingClientRect(); return { centre: Math.round((r.top + r.bottom) / 2 - window.innerHeight / 2), opacity: +getComputedStyle(i.querySelector('.pf-item__text')).opacity }; });
      return { mode: s.dataset.mode, active: activeIdx, rail, onTop, texts, y: Math.round(window.scrollY) };
    });
    /** Scroll position where project k is in focus: the middle of its image's hold. */
    const focusY = (page, k) => page.evaluate(([k, hold]) => {
      const it = document.querySelectorAll('#portfolio .pf-item')[k];
      return Math.round(it.getBoundingClientRect().top + window.scrollY + hold * window.innerHeight);
    }, [k, HOLD / 2]);
    const scrollToY = async (page, y) => { await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y); await page.waitForTimeout(700); };

    const { context, page } = await newPage();
    const log = [];
    watch(page, log);
    await context.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput && e.sources?.some((src) => src.node?.closest?.('.lp-section'))) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const order = await page.evaluate(() => {
      const main = document.querySelector('main');
      return { kids: [...main.children].map((e) => e.id || e.className.split(' ')[0]), afterMain: main.nextElementSibling?.className, companyFollows: document.querySelector('#portfolio').nextElementSibling?.id === 'company' };
    });
    record('sections in order: the journey (ending with the data centers), then the portfolio, then the company section, then the footer', order.kids.join(',') === 'story,portfolio,company' && order.companyFollows && order.afterMain === 'site-footer', JSON.stringify(order));

    await waitField(page);
    await waitDc(page);
    await goTo(page, { dc: 0.97 }, 400);
    await goTo(page, { el: '#portfolio' }, 300);
    const head = await page.evaluate(() => {
      const p = document.querySelector('#portfolio');
      const story = document.querySelector('.story').getBoundingClientRect();
      const eyebrow = p.querySelector('.lp-eyebrow').getBoundingClientRect();
      return { mode: p.dataset.mode, eyebrow: p.querySelector('.lp-eyebrow').textContent.trim(), title: p.querySelector('h2').innerText.replace(/\s+/g, ' ').trim(), gapAfterStage: Math.round(eyebrow.top - story.bottom), headerBottom: Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom), scene: document.documentElement.dataset.scene, bg: getComputedStyle(p).backgroundColor };
    });
    record('portfolio heading as supplied, scroll layout on a wide screen, close after the released stage; header clear; dark', head.mode === 'scroll' && head.eyebrow === 'Our project portfolio' && head.title === 'Local foundations. Global aspiration.' && head.gapAfterStage >= 0 && head.gapAfterStage <= 140 && head.headerBottom <= 0 && head.scene === 'dark' && head.bg === 'rgb(11, 18, 20)', JSON.stringify(head));

    // Content: the five projects in order, statuses as published, summaries from the official pages.
    const content = await page.evaluate(() => [...document.querySelectorAll('#portfolio .pf-item')].map((it) => {
      const link = it.querySelector('.pf-item__link'); const frame = it.querySelector('.pf-frame'); const img = frame.querySelector('img');
      return {
        id: it.id, title: it.querySelector('.pf-item__title').textContent.trim(),
        status: it.querySelector('.pf-status').textContent.replace('Status:', '').trim(),
        location: it.querySelector('.pf-item__location').textContent.trim(),
        scope: it.querySelector('.pf-item__scope').textContent.trim(),
        summary: it.querySelector('.pf-item__summary').textContent.trim(),
        href: link.getAttribute('href'), linkName: link.textContent.replace(/\s+/g, ' ').trim(),
        imageLink: { href: frame.getAttribute('href'), hidden: frame.getAttribute('aria-hidden') === 'true' && frame.tabIndex === -1 },
        img: img.getAttribute('src'), w: img.getAttribute('width'), h: img.getAttribute('height'),
        described: it.querySelector('[role="img"]')?.getAttribute('aria-label') ?? '',
      };
    }));
    const contentOk = content.length === 5 && PROJECTS.every(([id, t, st, loc, scope, href, lead], i) => {
      const c = content[i];
      return c && c.id === id && c.title === t && c.status === st && c.location === loc && c.scope === scope && c.href === href && c.summary.startsWith(lead) && c.linkName.includes(t) && c.imageLink.href === href && c.imageLink.hidden && c.img.includes(`/media/portfolio/${id}-`) && c.w && c.h && c.described.length > 8;
    });
    record('five projects in order: exact title, status, location, scope, official summary, one real link each (image link hidden from assistive tech), described image', contentOk, content.map((c) => `${c.title} [${c.status}] ${c.location} · ${c.scope} → ${c.href.replace('https://www.convalt.com', '')}`).join(' | '));

    // Forward through the projects, then back: the project in focus, its image on top, its text centred.
    const forward = [];
    for (let k = 0; k < 5; k++) { await scrollToY(page, await focusY(page, k)); forward.push(await pfState(page)); }
    const reverse = [];
    for (let k = 4; k >= 0; k--) { await scrollToY(page, await focusY(page, k)); reverse.push(await pfState(page)); }
    const inFocus = (st, k, vh) => st.active === k && st.rail === k && st.onTop === k && Math.abs(st.texts[k].centre) < vh * 0.15 && st.texts[k].opacity > 0.95 && st.texts.every((t, i) => i === k || t.opacity < 0.5);
    const vh = 900;
    record('scrolling forward, each project comes into focus in turn: its text centred and emphasized, its image on top, the rail marking it', forward.every((st, k) => inFocus(st, k, vh)), JSON.stringify(forward.map((st) => ({ active: st.active, rail: st.rail, onTop: st.onTop, centre: st.texts[Math.max(0, st.active)]?.centre }))));
    record('scrolling back up, the same states in reverse', reverse.every((st, i) => inFocus(st, 4 - i, vh)), JSON.stringify(reverse.map((st) => ({ active: st.active, onTop: st.onTop }))));

    // Mouse wheel through the whole portfolio and back: focus advances in order, and the page stays
    // exactly where the wheel leaves it (no snapping).
    await scrollToY(page, (await focusY(page, 0)) - 300);
    const wheelSeq = [];
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(700, 450);
      await page.mouse.wheel(0, 140);
      await page.waitForTimeout(160);
      const st = await pfState(page);
      if (wheelSeq.at(-1) !== st.active) wheelSeq.push(st.active);
    }
    const wheelBack = [];
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -140); await page.waitForTimeout(160); const st = await pfState(page); if (wheelBack.at(-1) !== st.active) wheelBack.push(st.active); }
    // No snapping: after a wheel step mid-transition, once the scroll has settled it stays put.
    let drift = 0;
    for (const k of [1, 3]) {
      await scrollToY(page, (await focusY(page, k)) - 200);
      await page.mouse.wheel(0, 90);
      await page.waitForTimeout(700);
      const y1 = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(900);
      const y2 = await page.evaluate(() => window.scrollY);
      drift = Math.max(drift, Math.abs(y2 - y1));
    }
    record('mouse wheel: focus advances 1 → 5 in order and back 5 → 1; no snapping (the page rests where the wheel leaves it)', wheelSeq.join() === '0,1,2,3,4' && wheelBack.join() === '4,3,2,1,0' && drift <= 1, JSON.stringify({ forward: wheelSeq, back: wheelBack, driftPx: drift }));

    // Keyboard: Tab from the rail through the project links; each focused link brings its project into focus.
    await scrollToY(page, (await focusY(page, 0)) - 200);
    await page.focus('#portfolio .pf-rail a');
    const kb = [];
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab'); // past the rail's five links
    for (let k = 0; k < 5; k++) {
      if (k) await page.keyboard.press('Tab');
      await page.waitForTimeout(500);
      const f = await page.evaluate(() => document.activeElement?.closest('.pf-item')?.dataset.index);
      const st = await pfState(page);
      kb.push({ focus: Number(f), active: st.active, onTop: st.onTop });
    }
    record('keyboard: Tab reaches each project link in order and brings that project into focus', kb.every((s, k) => s.focus === k && s.active === k && s.onTop === k), JSON.stringify(kb));

    // Rail: a click scrolls to the project and it comes into focus.
    await page.click('#portfolio .pf-rail li:nth-child(4) a');
    await page.waitForTimeout(2200);
    const railSt = await pfState(page);
    record('index rail: a project number scrolls to that project and it comes into focus', railSt.active === 3 && railSt.onTop === 3, JSON.stringify({ active: railSt.active, onTop: railSt.onTop }));

    // End of the portfolio: every image loaded, "View all projects", then the company section.
    const loaded = await page.evaluate(() => [...document.querySelectorAll('#portfolio .pf-frame img')].map((i) => i.complete && i.naturalWidth > 0));
    await goTo(page, { el: '#portfolio .pf-outro', offset: -300 }, 300);
    const outro = await page.evaluate(() => { const a = document.querySelector('#portfolio .pf-all'); const r = a.getBoundingClientRect(); return { text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href'), visible: r.top > 0 && r.bottom < window.innerHeight, last: !a.closest('.pf-outro').nextElementSibling }; });
    record('the portfolio ends with a visible "View all projects ↗"; all five images loaded', outro.text === 'View all projects ↗' && outro.href === 'https://www.convalt.com/projects/index.html' && outro.visible && loaded.length === 5 && loaded.every(Boolean), JSON.stringify({ ...outro, loaded }));

    // No WebGL frames while the portfolio alone is on screen (the released stage is out of view).
    await goTo(page, { el: '#portfolio .pf-item[data-index="1"]' }, 300);
    const r0 = await page.evaluate(() => window.__convaltPerf.render.count);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(150); }
    await page.waitForTimeout(800);
    const r1 = await page.evaluate(() => window.__convaltPerf.render.count);
    record('no 3D rendering within the portfolio (WebGL frames while scrolling through it)', r1 - r0 === 0, `frames rendered: ${r1 - r0}`);

    await goTo(page, { el: '#company' }, 300);
    const company = await page.evaluate(() => {
      const c = document.querySelector('#company'); const img = c.querySelector('img'); const cta = c.querySelector('.lp-cta');
      return { eyebrow: c.querySelector('.lp-eyebrow').textContent.trim(), title: c.querySelector('h2').innerText.replace(/\s+/g, ' ').trim(), body: c.querySelector('.lp-body').textContent.trim(), cta: cta.textContent.replace(/\s+/g, ' ').trim(), href: cta.getAttribute('href'), img: img.currentSrc, loaded: img.complete && img.naturalWidth > 0, bg: getComputedStyle(c).backgroundColor, scene: document.documentElement.dataset.scene, headerBottom: Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom) };
    });
    record('company section follows: eyebrow, headline, paragraph, "Meet our team ↗" and image as supplied; dark; header clear', company.eyebrow === 'Construct with capital and conscience' && company.title === 'Built for the next generation. And the one after that.' && company.body.startsWith('Founded in 2011, Convalt brings together more than 150 professionals') && company.cta === 'Meet our team ↗' && company.href === 'https://www.convalt.com/team/index.html' && company.img.includes('/media/portfolio/integrated-energy-infrastructure-') && company.loaded && company.bg === 'rgb(11, 18, 20)' && company.scene === 'dark' && company.headerBottom <= 0, JSON.stringify({ ...company, body: company.body.slice(0, 30) + '…' }));
    await goTo(page, { bottom: true }, 300);
    const cls = await page.evaluate(() => +window.__cls.toFixed(4));
    record('no layout shift in the portfolio and company sections (CLS contribution)', cls < 0.01, `cls=${cls}`);
    record('no console errors / failed requests (portfolio, company)', log.length === 0, log.join(' | '));
    await context.close();
  }
  if (want(10)) {
    // Touch: a tablet (scroll layout) driven by real touch scroll gestures, forward and back.
    const { context, page } = await newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await goTo(page, { el: '#portfolio .pf-item[data-index="0"]', offset: -100 }, 300);
    const cdp = await context.newCDPSession(page);
    // Real touch drags (touchstart, moves, touchend): the finger moving up scrolls the page down.
    const swipe = async (dy) => {
      const y0 = dy < 0 ? 620 : 150;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 512, y: y0 }] });
      for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 512, y: y0 + (dy * i) / 12 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const pf = () => page.evaluate(() => ({ mode: document.querySelector('#portfolio').dataset.mode, active: [...document.querySelectorAll('#portfolio .pf-item')].findIndex((i) => i.dataset.active === 'true'), y: Math.round(window.scrollY) }));
    const seq = [];
    const start = await pf();
    for (let i = 0; i < 12; i++) { await swipe(-260); await page.waitForTimeout(250); const s = await pf(); if (seq.at(-1) !== s.active) seq.push(s.active); }
    const back = [];
    for (let i = 0; i < 12; i++) { await swipe(260); await page.waitForTimeout(250); const s = await pf(); if (back.at(-1) !== s.active) back.push(s.active); }
    const end = await pf();
    record('touch (tablet, scroll layout): swipes move through the projects in order and back', start.mode === 'scroll' && seq.join() === '0,1,2,3,4' && back.at(-1) === 0 && end.y < start.y + 400, JSON.stringify({ mode: start.mode, forward: seq, back, from: start.y, to: end.y }));
    await context.close();
  }
  if (want(10)) {
    // Layouts: scroll layout on wide screens; a plain list on phones and with reduced motion.
    const layouts = [];
    for (const [name, opts] of [
      ['desktop', { viewport: { width: 1440, height: 900 } }],
      ['mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
      ['reduced', { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }],
    ]) {
      const { context, page } = await newPage(opts);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      await page.evaluate(() => window.scrollTo(0, document.querySelector('#portfolio .pf-item').getBoundingClientRect().top + window.scrollY - 40));
      await page.waitForTimeout(400);
      const l = await page.evaluate(() => {
        const s = document.querySelector('#portfolio'); const it = s.querySelector('.pf-item');
        const media = it.querySelector('.pf-item__media').getBoundingClientRect(); const text = it.querySelector('.pf-item__text').getBoundingClientRect();
        const reveal = [...s.querySelectorAll('[data-reveal]')].filter((e) => e.getBoundingClientRect().top < window.innerHeight).map((e) => getComputedStyle(e).opacity === '1' && getComputedStyle(e).transform === 'none');
        return {
          mode: s.dataset.mode, rail: getComputedStyle(s.querySelector('.pf-rail')).display !== 'none', sticky: getComputedStyle(it.querySelector('.pf-item__media')).position,
          arrangement: media.bottom <= text.top + 1 ? 'image above text' : Math.abs(media.top - text.top) < media.height ? 'side by side' : 'other',
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          still: reveal.every(Boolean), sectionH: Math.round(s.getBoundingClientRect().height / window.innerHeight * 10) / 10,
        };
      });
      layouts.push({ name, ...l });
      if (name !== 'desktop') await shoot(page, path.join(OUT, `portfolio-${name}-list.png`));
      await context.close();
    }
    const [d, m, r] = layouts;
    record('layouts: scroll layout (sticky images, rail) on a wide screen; simple list on a phone (image above text) and with reduced motion (side by side, no pinning, no animation); no overflow', d.mode === 'scroll' && d.rail && d.sticky === 'sticky' && m.mode === 'list' && !m.rail && m.sticky !== 'sticky' && m.arrangement === 'image above text' && r.mode === 'list' && !r.rail && r.sticky !== 'sticky' && r.arrangement === 'side by side' && r.still && layouts.every((l) => l.overflow === 0), JSON.stringify(layouts));
    record('the scroll layout is not excessively long (section height in screens)', d.sectionH <= 5.5, `desktop ${d.sectionH} screens for five projects (phone ${m.sectionH})`);
  }
  if (want(10)) {
    // A link to #portfolio lands on the section, dark from the first paint; the no-WebGL document has both sections.
    const { context, page } = await newPage();
    await context.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { window.__firstScene = document.documentElement.dataset.scene ?? 'none'; }, { once: true }); });
    await page.goto(BASE + '#portfolio', { waitUntil: 'domcontentloaded' });
    const firstScene = await page.evaluate(() => window.__firstScene);
    await waitReady(page);
    await page.waitForTimeout(1500);
    const deep = await page.evaluate(() => ({ top: Math.round(document.querySelector('#portfolio').getBoundingClientRect().top), scene: document.documentElement.dataset.scene }));
    record('a #portfolio link lands on the portfolio, dark from the first paint', firstScene === 'dark' && Math.abs(deep.top) <= 2 && deep.scene === 'dark', JSON.stringify({ firstScene, ...deep }));
    await page.goto(BASE + '?webgl=0', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.layout === 'static', null, { timeout: 15000 }).catch(() => undefined);
    const st = await page.evaluate(() => ({ layout: document.documentElement.dataset.layout, kids: [...document.querySelector('main').children].map((e) => e.id || e.className.split(' ')[0]), projects: document.querySelectorAll('#portfolio .pf-item').length }));
    record('no-WebGL document: the portfolio and company sections follow its data-center section', st.layout === 'static' && st.kids.slice(-2).join() === 'portfolio,company' && st.projects === 5, JSON.stringify(st));
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
}

// ---------------------------------------------------------------------------------------------
// Interface states for documentation
// ---------------------------------------------------------------------------------------------
async function ui() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const d = VIEWPORTS.desktop;
  {
    const page = await browser.newPage({ viewport: { width: d.width, height: d.height } });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(1500);
    for (let i = 0; i < 9; i++) await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await shoot(page, path.join(OUT, 'ui-keyboard-focus-desktop.png'));
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: d.width, height: d.height } });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await waitFootage(page);
    await goTo(page, { intro: 0.96 }, 300); // settle: light sweep across the cell face
    await shoot(page, path.join(OUT, 'ui-settle-light-sweep-desktop.png'));
    await page.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(1200);
    await shoot(page, path.join(OUT, 'ui-reduced-motion-opening-desktop.png'));
    await goTo(page, { story: 0.5 }, 800);
    await shoot(page, path.join(OUT, 'ui-reduced-motion-desktop.png'));
    await context.close();
  }
  {
    const m = VIEWPORTS.mobile;
    const context = await browser.newContext({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForTimeout(1200);
    await page.tap('.menu-toggle');
    await page.waitForTimeout(400);
    await shoot(page, path.join(OUT, 'ui-mobile-menu-over-footage.png'));
    await page.tap('.menu-toggle');
    await waitField(page);
    await waitDc(page);
    // The header leaves with the released stage, so the dark menu opens over the data centers.
    await goTo(page, { dc: 0.97 }, 600);
    await page.tap('.menu-toggle');
    await page.waitForTimeout(400);
    await shoot(page, path.join(OUT, 'ui-mobile-menu-dark.png'));
    await context.close();
  }
  await browser.close();
  console.log('ui states saved');
}

// ---------------------------------------------------------------------------------------------
// Continuous forward / reverse recording + filmstrip + per-frame log
// ---------------------------------------------------------------------------------------------
async function recordRun() {
  fs.mkdirSync(OUT, { recursive: true });
  const mobile = args.includes('--mobile');
  const [W, H] = opt('vp', mobile ? '390x844' : '1903x843').split('x').map(Number);
  const scale = Number(opt('scale', mobile ? '1' : '0.6'));
  const size = { width: Math.round((W * scale) / 2) * 2, height: Math.round((H * scale) / 2) * 2 };
  const tag = mobile ? 'mobile' : 'desktop';
  const tmp = path.join(OUT, '.raw');
  fs.mkdirSync(tmp, { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await waitFootage(page);
  await page.waitForTimeout(1500);
  const run = await page.evaluate(async () => {
    const el = document.querySelector('.story');
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = el.offsetHeight - window.innerHeight;
    const share = window.__convalt.journey.share();
    const t0 = performance.now();
    const marks = [];
    const log = [];
    let running = true;
    const mark = (label) => marks.push({ label, s: +((performance.now() - t0) / 1000).toFixed(2) });
    const sample = (t) => {
      const sc = window.__convaltPerf.scrub;
      const p = window.__convalt.story.progress;
      log.push([+((t - t0) / 1000).toFixed(3), +(p / share).toFixed(4), sc.desired, sc.presented]);
      if (running) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Wheel-like input: many small scroll steps, as a trackpad / wheel produces.
    const glide = async (fromJ, toJ, ms) => {
      const start = performance.now();
      while (performance.now() - start < ms) {
        const k = (performance.now() - start) / ms;
        window.scrollTo(0, top + (fromJ + (toJ - fromJ) * k) * range);
        await new Promise((r) => requestAnimationFrame(r));
      }
      window.scrollTo(0, top + toJ * range);
    };
    mark('opening loop');
    await sleep(1500);
    mark('forward: slow read-through of the intro');
    await glide(0, share * 1.04, 16000);
    await sleep(1200);
    mark('reverse to the opening');
    await glide(share * 1.04, 0, 12000);
    await sleep(1500);
    mark('hold midway');
    await glide(0, share * 0.45, 2500);
    await sleep(1500);
    mark('rapid reversals');
    for (const [a, b] of [[0.45, 0.2], [0.2, 0.62], [0.62, 0.35], [0.35, 0.9], [0.9, 0.7], [0.7, 1.0]]) await glide(a * share, b * share, 600);
    await sleep(1500);
    mark('back to the top');
    await glide(share, 0, 2500);
    await sleep(2000);
    mark('end');
    running = false;
    return { marks, log };
  });
  const media = await page.evaluate(() => window.__media);
  await context.close();
  await browser.close();
  const raw = fs.readdirSync(tmp).filter((f) => f.endsWith('.webm')).map((f) => path.join(tmp, f))[0];
  const video = path.join(OUT, `intro-scroll-${tag}.webm`);
  fs.copyFileSync(raw, video);
  fs.rmSync(tmp, { recursive: true, force: true });
  // Frame log: lag between the desired and the presented footage frame while it is on screen.
  const onScreen = run.log.filter((r) => r[1] > 0.12 && r[1] < 0.8 && r[3] >= 0);
  const lags = onScreen.map((r) => Math.abs(r[2] - r[3])).sort((a, b) => a - b);
  const q = (p) => lags[Math.min(lags.length - 1, Math.floor(p * lags.length))];
  const summary = { samples: lags.length, lagFrames: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: lags[lags.length - 1] }, media };
  fs.writeFileSync(path.join(OUT, `intro-scroll-${tag}.json`), JSON.stringify({ marks: run.marks, summary, log: run.log }, null, 1));
  const frames = await filmstrip(video, path.join(OUT, `intro-scroll-${tag}-filmstrip.webp`), mobile);
  console.log('recording', video, `${(fs.statSync(video).size / 1e6).toFixed(1)} MB`, 'frames', frames);
  console.log('marks', run.marks.map((m) => `${m.label}@${m.s}s`).join(', '));
  console.log('footage lag (desired − presented frames while on screen):', JSON.stringify(summary));
}

/** Tiles a recording into a filmstrip (2 frames per second). */
async function filmstrip(video, file, mobile) {
  const ffmpeg = (await import('ffmpeg-static')).default;
  const framesDir = path.join(OUT, '.frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  execFileSync(ffmpeg, ['-v', 'error', '-i', video, '-vf', `fps=2,scale=${mobile ? 200 : 480}:-2`, path.join(framesDir, 'f%03d.png')]);
  const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();
  const tiles = await Promise.all(frames.map(async (f, i) => {
    const img = await sharp(path.join(framesDir, f)).png().toBuffer({ resolveWithObject: true });
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${img.info.width}" height="20"><rect width="100%" height="20" fill="#123336"/><text x="6" y="14" font-family="sans-serif" font-size="12" fill="#fff">${(i / 2).toFixed(1)} s</text></svg>`);
    return sharp(img.data).extend({ top: 20, background: '#123336' }).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer({ resolveWithObject: true });
  }));
  const cols = mobile ? 14 : 8, gap = 6;
  const tw = tiles[0].info.width, th = tiles[0].info.height;
  const rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * tw + (cols + 1) * gap, height: rows * th + (rows + 1) * gap, channels: 3, background: '#d7deda' } })
    .composite(tiles.map((t, i) => ({ input: t.data, left: gap + (i % cols) * (tw + gap), top: gap + Math.floor(i / cols) * (th + gap) })))
    .webp({ quality: 80 }).toFile(file);
  fs.rmSync(framesDir, { recursive: true, force: true });
  return frames.length;
}

/**
 * Power generation, recorded: module → installation → reading interval, the same way back,
 * then rapid reversals. Logs field progress, reveal front, placed/arriving modules and draw cost.
 */
async function recordField() {
  fs.mkdirSync(OUT, { recursive: true });
  const mobile = args.includes('--mobile');
  const [W, H] = opt('vp', mobile ? '390x844' : '1903x843').split('x').map(Number);
  const scale = Number(opt('scale', mobile ? '1' : '0.6'));
  const size = { width: Math.round((W * scale) / 2) * 2, height: Math.round((H * scale) / 2) * 2 };
  const tag = mobile ? 'mobile' : 'desktop';
  const tmp = path.join(OUT, '.raw');
  fs.mkdirSync(tmp, { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const status = await waitField(page);
  await goTo(page, { story: 0.9 }, 1200);
  const run = await page.evaluate(async () => {
    const c = window.__convalt;
    const el = document.querySelector('.story');
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = el.offsetHeight - window.innerHeight;
    const J = (f) => c.journey.fromField(f);
    const start = c.journey.fromStory(0.9);
    const end = c.journey.storyEnd();
    const t0 = performance.now();
    const marks = [];
    const log = [];
    let running = true;
    const mark = (label) => marks.push({ label, s: +((performance.now() - t0) / 1000).toFixed(2) });
    const sample = (t) => {
      const f = (c.story.progress - end) / (1 - end);
      const live = window.__convaltField?.live ?? {};
      const r = window.__convaltPerf.render;
      log.push([+((t - t0) / 1000).toFixed(3), +f.toFixed(4), +(live.reveal ?? 0).toFixed(2), live.placed ?? 0, live.arriving ?? 0, r.calls, r.triangles]);
      if (running) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const glide = async (fromJ, toJ, ms) => {
      const s0 = performance.now();
      while (performance.now() - s0 < ms) {
        const k = (performance.now() - s0) / ms;
        window.scrollTo(0, top + (fromJ + (toJ - fromJ) * k) * range);
        await new Promise((r) => requestAnimationFrame(r));
      }
      window.scrollTo(0, top + toJ * range);
    };
    mark('module scene, reassembling');
    await sleep(1000);
    mark('forward: module → field → installation → text');
    await glide(start, J(1), 24000);
    await sleep(2000);
    mark('reverse to the module');
    await glide(J(1), start, 15000);
    await sleep(1500);
    mark('rapid reversals');
    for (const [a, b] of [[0, 0.5], [0.5, 0.25], [0.25, 0.8], [0.8, 0.4], [0.4, 1]]) await glide(J(a), J(b), 700);
    await sleep(2500);
    mark('end');
    running = false;
    return { marks, log };
  });
  await context.close();
  await browser.close();
  const raw = fs.readdirSync(tmp).filter((f) => f.endsWith('.webm')).map((f) => path.join(tmp, f))[0];
  const video = path.join(OUT, `field-scroll-${tag}.webm`);
  fs.copyFileSync(raw, video);
  fs.rmSync(tmp, { recursive: true, force: true });
  // Monotone reveal: while scrolling forward the placed count never decreases (and vice versa).
  const fwd = run.marks.find((m) => m.label.startsWith('forward')), rev = run.marks.find((m) => m.label.startsWith('reverse'));
  const seg = (a, b) => run.log.filter((r) => r[0] >= a && r[0] < b);
  const inc = seg(fwd.s, rev.s).every((r, i, arr) => !i || r[3] >= arr[i - 1][3]);
  const revEnd = run.marks.find((m) => m.label.startsWith('rapid')).s;
  const dec = seg(rev.s, revEnd).every((r, i, arr) => !i || r[3] <= arr[i - 1][3]);
  const calls = run.log.map((r) => r[5]).sort((a, b) => a - b), tris = run.log.map((r) => r[6]).sort((a, b) => a - b);
  const summary = { fieldStatus: status, monotoneForward: inc, monotoneReverse: dec, drawCalls: { p50: percentile(calls, 0.5), max: calls[calls.length - 1] }, triangles: { p50: percentile(tris, 0.5), max: tris[tris.length - 1] } };
  fs.writeFileSync(path.join(OUT, `field-scroll-${tag}.json`), JSON.stringify({ marks: run.marks, summary, columns: ['s', 'field', 'reveal', 'placed', 'arriving', 'calls', 'triangles'], log: run.log }, null, 1));
  const n = await filmstrip(video, path.join(OUT, `field-scroll-${tag}-filmstrip.webp`), mobile);
  console.log('recording', video, `${(fs.statSync(video).size / 1e6).toFixed(1)} MB`, 'frames', n);
  console.log('marks', run.marks.map((m) => `${m.label}@${m.s}s`).join(', '));
  console.log('summary', JSON.stringify(summary));
}

/**
 * Data centers, recorded: the end of the field reading interval → dark transition → close view →
 * pullback → copy, the same way back, then rapid reversals across the band. Logs section progress,
 * render mode, draw calls and the stage's mean brightness per frame (from the recording).
 */
async function recordDc() {
  fs.mkdirSync(OUT, { recursive: true });
  const mobile = args.includes('--mobile');
  const [W, H] = opt('vp', mobile ? '390x844' : '1903x843').split('x').map(Number);
  const scale = Number(opt('scale', mobile ? '1' : '0.6'));
  const size = { width: Math.round((W * scale) / 2) * 2, height: Math.round((H * scale) / 2) * 2 };
  const tag = mobile ? 'mobile' : 'desktop';
  const tmp = path.join(OUT, '.raw');
  fs.mkdirSync(tmp, { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await waitField(page);
  const status = await waitDc(page);
  await goTo(page, { field: 0.93 }, 1200);
  const run = await page.evaluate(async () => {
    const c = window.__convalt;
    const el = document.querySelector('.story');
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = el.offsetHeight - window.innerHeight;
    const D = (d) => c.journey.fromDc(d);
    const start = c.journey.fromField(0.93);
    const end = c.journey.fieldEnd();
    const t0 = performance.now();
    const marks = [];
    const log = [];
    let running = true;
    const mark = (label) => marks.push({ label, s: +((performance.now() - t0) / 1000).toFixed(2) });
    const sample = (t) => {
      const d = Math.max(0, (c.story.progress - end) / (1 - end));
      const r = window.__convaltPerf.render;
      log.push([+((t - t0) / 1000).toFixed(3), +d.toFixed(4), r.mode, r.calls, r.triangles]);
      if (running) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const glide = async (fromJ, toJ, ms) => {
      const s0 = performance.now();
      while (performance.now() - s0 < ms) {
        const k = (performance.now() - s0) / ms;
        window.scrollTo(0, top + (fromJ + (toJ - fromJ) * k) * range);
        await new Promise((r) => requestAnimationFrame(r));
      }
      window.scrollTo(0, top + toJ * range);
    };
    mark('field reading interval');
    await sleep(1000);
    mark('forward: dark transition → close view → pullback → copy');
    await glide(start, D(1), 20000);
    await sleep(2000);
    mark('reverse to the field');
    await glide(D(1), start, 13000);
    await sleep(1500);
    mark('rapid reversals across the band');
    for (const [a, b] of [[0, 0.12], [0.12, 0.01], [0.01, 0.5], [0.5, 0.03], [0.03, 1]]) await glide(D(a), D(b), 700);
    await sleep(2500);
    mark('end');
    running = false;
    return { marks, log };
  });
  await context.close();
  await browser.close();
  const raw = fs.readdirSync(tmp).filter((f) => f.endsWith('.webm')).map((f) => path.join(tmp, f))[0];
  const video = path.join(OUT, `dc-scroll-${tag}.webm`);
  fs.copyFileSync(raw, video);
  fs.rmSync(tmp, { recursive: true, force: true });
  const modes = [...new Set(run.log.map((r) => r[2]))];
  const calls = run.log.map((r) => r[3]).sort((a, b) => a - b);
  const summary = { dcStatus: status, modes, drawCalls: { p50: percentile(calls, 0.5), max: calls[calls.length - 1] } };
  fs.writeFileSync(path.join(OUT, `dc-scroll-${tag}.json`), JSON.stringify({ marks: run.marks, summary, columns: ['s', 'dc', 'mode', 'calls', 'triangles'], log: run.log }, null, 1));
  const n = await filmstrip(video, path.join(OUT, `dc-scroll-${tag}-filmstrip.webp`), mobile);
  console.log('recording', video, `${(fs.statSync(video).size / 1e6).toFixed(1)} MB`, 'frames', n);
  console.log('marks', run.marks.map((m) => `${m.label}@${m.s}s`).join(', '));
  console.log('summary', JSON.stringify(summary));
}

const run = { shots, posters, perf, checks, ui, record: FIELD_RECORD ? recordField : DC_RECORD ? recordDc : recordRun }[mode];
if (!run) { console.error(`Unknown mode ${mode}`); process.exit(1); }
await run();
