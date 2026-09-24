#!/usr/bin/env node
/**
 * Whole-page review frames: the (transparent) header over each scene, the data-center pullback and
 * exit, the pin release into the project portfolio (United States and Africa), the company section
 * and the footer, on desktop and phone (with the mobile menu open over a light and a dark scene).
 * Each frame logs the header's computed surface.
 *   node scripts/serve.mjs node scripts/page-frames.mjs [--out dir] [--vp 1440x900] [--mobile]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, opt('out', 'docs/page'));
const mobile = args.includes('--mobile');
const [W, H] = opt('vp', mobile ? '390x844' : '1440x900').split('x').map(Number);
const tag = mobile ? 'mobile' : `desktop-${W}`;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
const page = await context.newPage();
const issues = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') issues.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => issues.push('pageerror ' + e.message));
await page.goto(opt('url', 'http://localhost:4173/'), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__convalt?.ui.get().status === 'ready', null, { timeout: 45000 });
await page.waitForFunction(() => window.__convaltPerf?.scrub?.ready === true, null, { timeout: 20000 }).catch(() => undefined);

const settle = async (ms = 500) => {
  await page.waitForFunction(() => {
    const s = window.__convalt.story; const c = document.querySelector('.stage__content');
    const sc = window.__convaltPerf?.scrub; const v = document.querySelector('[data-layer="assembly"] video');
    return Math.abs(s.progress - s.target) < 0.0004 && (!c || c.style.opacity === '') && (!sc || !sc.ready || (sc.requested === sc.desired && !v?.seeking));
  }, null, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
};
const toJourney = async (fn, v) => {
  await page.evaluate(([fn, v]) => {
    const el = document.querySelector('.story');
    const j = fn === 'intro' ? v * window.__convalt.journey.share() : window.__convalt.journey[fn](v);
    window.scrollTo(0, Math.round(el.getBoundingClientRect().top + window.scrollY + j * (el.offsetHeight - window.innerHeight)));
  }, [fn, v]);
  await settle();
};
const past = async (px) => {
  // px below the end of the pinned section (negative: above the page bottom when px = 'bottom').
  await page.evaluate((px) => {
    const el = document.querySelector('.story');
    const end = el.getBoundingClientRect().top + window.scrollY + el.offsetHeight - window.innerHeight;
    window.scrollTo(0, px === 'bottom' ? document.documentElement.scrollHeight : Math.round(end + px));
  }, px);
  await page.waitForTimeout(900);
};
/** Scrolls an element to the top of the viewport; waits for its visible images and entrance. */
const toSection = async (selector, offset = 0) => {
  await page.evaluate(([sel, off]) => {
    const el = document.querySelector(sel);
    window.scrollTo(0, Math.round(el.getBoundingClientRect().top + window.scrollY + off));
  }, [selector, offset]);
  await page.waitForFunction(() => [...document.querySelectorAll('.lp-section img')]
    .filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight; })
    .every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1300);
};
const snap = async (name) => {
  const file = path.join(OUT, `${tag}-${name}.png`);
  fs.writeFileSync(file, await page.screenshot());
  const header = await page.evaluate(() => {
    const h = document.querySelector('.site-header');
    const logo = h.querySelector('.brand .logo');
    const r = logo.getBoundingClientRect();
    const cs = getComputedStyle(h);
    const boxes = ['::before', '::after'].filter((p) => !['none', 'normal'].includes(getComputedStyle(h, p).content));
    const surface = cs.backgroundColor === 'rgba(0, 0, 0, 0)' && (cs.backdropFilter ?? 'none') === 'none' && cs.boxShadow === 'none' && cs.borderBottomWidth === '0px' && boxes.length === 0 ? 'none' : `${cs.backgroundColor} ${cs.backdropFilter} ${cs.boxShadow} ${boxes}`;
    return { scene: document.documentElement.dataset.scene, onDark: h.style.getPropertyValue('--on-dark'), surface, headerTop: Math.round(h.getBoundingClientRect().top), headerH: h.offsetHeight, logo: [Math.round(r.width), Math.round(r.height)], color: cs.color };
  });
  console.log(name.padEnd(22), JSON.stringify(header));
};

await toJourney('intro', 0); await page.waitForTimeout(800); await snap('01-header-video');
await toJourney('fromStory', 0.72); await snap('02-header-module');
await page.waitForFunction(() => ['ready', 'error'].includes(window.__convalt.ui.get().fieldStatus), null, { timeout: 60000 }).catch(() => undefined);
await toJourney('fromField', 0.6); await snap('03-header-field');
await toJourney('fromField', 0.94); await snap('03b-field-final');
await page.waitForFunction(() => ['ready', 'error'].includes(window.__convalt.ui.get().dcStatus), null, { timeout: 60000 }).catch(() => undefined);
await toJourney('fromDc', 0.45); await snap('04a-dc-pullback');
await toJourney('fromDc', 0.97); await snap('04-dc-ending');
await past(Math.round(H * 0.45)); await snap('05-pin-release');
await toSection('#portfolio'); await snap('06-portfolio');
await toSection('#portfolio .regions', -24); await snap('07-portfolio-grid');
await page.evaluate(() => document.querySelector('#region-tab-africa').click());
await toSection('#portfolio .regions', -24); await snap('07b-portfolio-africa');
await page.evaluate(() => document.querySelector('#region-tab-united-states').click());
await toSection('#company'); await snap('08-company');
await past('bottom'); await snap('09-footer');
if (mobile) {
  // The header leaves with the released stage, so the dark menu is opened over the data centers.
  await toJourney('fromDc', 0.97);
  await page.tap('.menu-toggle');
  await page.waitForTimeout(400);
  await snap('10-menu-dark');
  await page.tap('.menu-toggle');
  await toJourney('fromStory', 0.72);
  await page.tap('.menu-toggle');
  await page.waitForTimeout(400);
  await snap('11-menu-light');
}
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('horizontal overflow px:', overflow);
await browser.close();
console.log('issues:', issues.length ? [...new Set(issues)].join(' | ') : 'none');
