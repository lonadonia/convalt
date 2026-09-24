#!/usr/bin/env node
/**
 * Seek benchmark for the scroll-controlled assembly video (run after scripts/prepare-intro.mjs).
 *
 *   node scripts/seek-benchmark.mjs [--headed]
 *
 * Encodes 1080p comparison variants of 2.mp4 that differ only in GOP structure (CRF 27, as
 * delivered) into asset-source/seek-bench/, serves them and the delivered files over HTTP with
 * byte-range support, and measures in the installed Chrome (Playwright):
 *   - seek → presented-frame latency (requestVideoFrameCallback) for forward single-frame steps,
 *     backward single-frame steps and random jumps, and whether the presented frame is exact;
 *   - a scripted scrub (fast forward, fast reverse, hold, flick, immediate reversal, hold) driven
 *     by a coalescing controller (one seek in flight, always to the latest desired frame).
 * Writes docs/intro-seek-benchmark.json.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = path.join(ROOT, 'asset-source', 'seek-bench');
const MEDIA = path.join(ROOT, 'public', 'media', 'intro');
const headed = process.argv.includes('--headed');
fs.mkdirSync(BENCH, { recursive: true });

const common = ['-an', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-preset', 'slow', '-crf', '27', '-sc_threshold', '0', '-bf', '0', '-movflags', '+faststart'];
const scale = 'scale=1920:1080:flags=lanczos:out_color_matrix=bt709:out_range=tv';
const variants = [
  { name: 'gop1', gop: 1 },
  { name: 'gop12', gop: 12 },
  { name: 'gop24', gop: 24 },
  { name: 'gop12-bframes', gop: 12, bframes: true },
];
for (const v of variants) {
  const file = path.join(BENCH, `${v.name}.mp4`);
  if (fs.existsSync(file)) continue;
  const args = ['-hide_banner', '-v', 'error', '-y', '-i', path.join(ROOT, '2.mp4'), '-vf', scale, '-c:v', 'libx264', ...common, '-g', String(v.gop), '-keyint_min', String(v.gop), file];
  if (v.bframes) args.splice(args.indexOf('-bf'), 2, '-bf', '3');
  execFileSync(ffmpegPath, args);
  console.log('encoded', v.name);
}

const PAGE = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#222}video{width:960px;height:540px;display:block}</style>
<video id="v" muted playsinline preload="auto"></video>
<script>
const FPS = 24, v = document.getElementById('v');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frameOf = (t) => Math.round(t * FPS);
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2) : null; };
const summary = (a) => ({ n: a.length, p50: pct(a, 0.5), p90: pct(a, 0.9), p99: pct(a, 0.99), max: a.length ? +Math.max(...a).toFixed(2) : null });
function seek(frame) {
  return new Promise((resolve) => {
    const t0 = performance.now(); let seekedAt = 0;
    v.addEventListener('seeked', () => { seekedAt = performance.now() - t0; }, { once: true });
    const want = frame / FPS;
    const onFrame = (now, meta) => {
      if (Math.abs(meta.mediaTime - want) > 0.5 / FPS) { v.requestVideoFrameCallback(onFrame); return; }
      resolve({ seeked: seekedAt || performance.now() - t0, presented: performance.now() - t0, shown: frameOf(meta.mediaTime) });
    };
    v.requestVideoFrameCallback(onFrame);
    v.currentTime = (frame + 0.5) / FPS;
    setTimeout(() => resolve({ seeked: NaN, presented: NaN, shown: -1 }), 3000);
  });
}
window.bench = async (url) => {
  const out = { url };
  const caps = await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, bitrate: 8e6, framerate: 24 } }).catch(() => null);
  out.decoding = caps && { supported: caps.supported, smooth: caps.smooth, powerEfficient: caps.powerEfficient };
  const t0 = performance.now();
  v.src = url;
  await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
  out.firstFrameMs = +(performance.now() - t0).toFixed(1);
  while (!(v.buffered.length && v.buffered.end(v.buffered.length - 1) >= v.duration - 0.05)) await sleep(40);
  out.fullyBufferedMs = +(performance.now() - t0).toFixed(1);
  const frames = Math.round(v.duration * FPS); out.frames = frames;
  await seek(0);
  let wrong = 0; const fwd = [], back = [], rnd = [];
  for (let f = 1; f < frames; f++) { const r = await seek(f); fwd.push(r.presented); if (r.shown !== f) wrong++; }
  for (let f = frames - 2; f >= 0; f--) { const r = await seek(f); back.push(r.presented); if (r.shown !== f) wrong++; }
  let seed = 7;
  for (let i = 0; i < 60; i++) { seed = (seed * 16807) % 2147483647; const f = seed % frames; const r = await seek(f); rnd.push(r.presented); if (r.shown !== f) wrong++; }
  out.scrub = await new Promise((resolve) => {
    let desired = 0, requested = -1, shown = -1, seeks = 0; const lags = [], shownSet = new Set();
    v.requestVideoFrameCallback(function cb(now, meta) { shown = frameOf(meta.mediaTime); shownSet.add(shown); v.requestVideoFrameCallback(cb); });
    const pump = () => { if (v.seeking || desired === requested) return; requested = desired; seeks++; v.currentTime = (desired + 0.5) / FPS; };
    v.addEventListener('seeked', pump);
    const plan = [[2400, 0, frames - 1], [900, frames - 1, 40], [300, 40, 40], [600, 40, 120], [250, 120, 60], [800, 60, 60]];
    let seg = 0, segStart = performance.now(), settle = null;
    const tick = (now) => {
      while (seg < plan.length && now - segStart > plan[seg][0]) { segStart += plan[seg][0]; seg++; }
      if (seg >= plan.length) { v.removeEventListener('seeked', pump); resolve({ seeks, distinctFramesShown: shownSet.size, lagFrames: summary(lags), finalShown: shown, finalDesired: desired, settleMs: settle }); return; }
      const [d, a, b] = plan[seg]; const k = Math.min(1, (now - segStart) / d);
      desired = Math.round(a + (b - a) * k);
      if (shown >= 0) lags.push(Math.abs(desired - shown));
      if (seg === plan.length - 1 && shown === desired && settle === null) settle = +(now - segStart).toFixed(1);
      pump(); requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  Object.assign(out, { forwardStepMs: summary(fwd), backwardStepMs: summary(back), randomJumpMs: summary(rnd), wrongFrames: wrong });
  return out;
};
</script>`;

let ranges = 0, full = 0;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
  const [, dir, name] = url.split('/');
  const file = path.join(dir === 'bench' ? BENCH : MEDIA, name ?? '');
  if (!name || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(file).size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (m) {
    ranges++;
    const start = m[1] ? Number(m[1]) : size - Number(m[2]);
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    full++;
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': size });
    fs.createReadStream(file).pipe(res);
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const runs = [
  ...variants.map((v) => ({ label: `1080p GOP ${v.gop}${v.bframes ? ' + B-frames' : ''} (comparison)`, url: `/bench/${v.name}.mp4`, file: path.join(BENCH, `${v.name}.mp4`) })),
  { label: '1080p GOP 6 — delivered', url: '/media/factory-assembly-1080.mp4', file: path.join(MEDIA, 'factory-assembly-1080.mp4') },
  { label: '720p GOP 6 — delivered', url: '/media/factory-assembly-720.mp4', file: path.join(MEDIA, 'factory-assembly-720.mp4') },
  { label: '720×1280 portrait GOP 6 — delivered', url: '/media/factory-assembly-portrait.mp4', file: path.join(MEDIA, 'factory-assembly-portrait.mp4') },
];
const browser = await chromium.launch({ channel: 'chrome', headless: !headed, args: ['--ignore-gpu-blocklist'] });
const results = [];
for (const run of runs) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  await page.goto(`${base}/`);
  const r = await page.evaluate((u) => window.bench(u), run.url);
  const row = { label: run.label, kilobytes: +(fs.statSync(run.file).size / 1024).toFixed(0), ...r };
  results.push(row);
  const f = (s) => `${s.p50}/${s.p90}/${s.max}`;
  console.log(`${run.label.padEnd(38)} ${String(row.kilobytes).padStart(6)} KB | step fwd ${f(r.forwardStepMs)} back ${f(r.backwardStepMs)} rand ${f(r.randomJumpMs)} ms | wrong ${r.wrongFrames} | scrub ${r.scrub.distinctFramesShown} frames, lag p90 ${r.scrub.lagFrames.p90}, final ${r.scrub.finalShown}/${r.scrub.finalDesired}`);
  await page.close();
}
const meta = { date: new Date().toISOString(), chrome: browser.version(), headless: !headed, rangeRequests: ranges, fullRequests: full, note: 'Latency = time from setting currentTime to the requested frame being presented (requestVideoFrameCallback); quantized to the 60 Hz display. Files fully buffered before measuring.' };
await browser.close();
server.close();
fs.writeFileSync(path.join(ROOT, 'docs', 'intro-seek-benchmark.json'), JSON.stringify({ meta, results }, null, 2));
console.log('wrote docs/intro-seek-benchmark.json', JSON.stringify({ rangeRequests: ranges, fullRequests: full }));
