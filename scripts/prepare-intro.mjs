#!/usr/bin/env node
/**
 * Factory-intro media preparation.
 *
 *   node scripts/prepare-intro.mjs          (or: npm run assets:intro)
 *
 * Sources (preserved untouched):
 *   intro.zip › 1.mp4  opening footage (3840×2160, 24 fps, 8 s, AAC audio) — ambient loop.
 *   2.mp4              assembly footage (3840×2160, 24 fps, 143 frames, 5.96 s, AAC audio) —
 *                      scroll-controlled: robot at the panel → forward move → overhead push-in.
 *
 * 1. Extracts intro.zip (zip-slip safe) into asset-source/intro/.
 * 2. Loop: the source has no naturally seamless point (its end→start jump differs ~12× more than a
 *    normal frame step). Frames 16…181 are used and frames 166…181 are crossfaded into 0…15, so
 *    the last frame flows into the first: 166 frames (6.92 s). Normal playback GOP (1 s).
 * 3. Assembly: encoded for frequent forward AND backward seeking — a keyframe every 6 frames
 *    (0.25 s) and no B-frames, so any frame decodes from at most 5 predecessors, in display
 *    order. Chosen by measurement (docs/intro-asset-report.json › seekBenchmark): all-intra
 *    seeks fastest but is 2.6× larger; GOP 12/24 double/triple the seek latency.
 * 4. Every derivative: H.264 High, yuv420p, BT.709 tagged (the sources are untagged), audio
 *    removed, MP4 fast-start (moov first), 1080p / 720p / 720×1280 portrait crop.
 * 5. Posters are the exact first frame of the loop derivatives, converted with the same BT.709
 *    matrix the browser uses for the tagged video, so poster → video never shifts.
 * 6. Writes docs/intro-asset-report.json (mapping, sizes, keyframes, seam and footage analysis).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = path.join(ROOT, 'intro.zip');
const ASSEMBLY_SRC = path.join(ROOT, '2.mp4');
const SRC = path.join(ROOT, 'asset-source', 'intro');
const OUT = path.join(ROOT, 'public', 'media', 'intro');
const DOCS = path.join(ROOT, 'docs');
const log = (...a) => console.log('•', ...a);

const LOOP = { start: 16, jumpFrom: 182, blend: 16, fps: 24 };
/** Portrait crops (9:16 of the 2160-px-high source), centred on the conveyor axis. */
const CROP_W = Math.round((2160 * 9) / 16 / 2) * 2;
const cropX = (centre) => Math.round(centre * 3840 - CROP_W / 2);
const LOOP_CROP_X = cropX(0.496);
const ASSEMBLY_CROP_X = cropX(0.5);

const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
/** Scale in linear-safe order and write BT.709 limited-range YUV. */
const scaleTo = (w, h, crop) => `${crop ? `crop=${CROP_W}:2160:${crop}:0,` : ''}scale=${w}:${h}:flags=lanczos:out_color_matrix=bt709:out_range=tv`;

function extract() {
  if (fs.existsSync(path.join(SRC, '1.mp4'))) {
    log('Sources already extracted:', path.relative(ROOT, SRC));
    return;
  }
  if (!fs.existsSync(ZIP)) throw new Error('Missing intro.zip');
  fs.mkdirSync(SRC, { recursive: true });
  const entries = unzipSync(new Uint8Array(fs.readFileSync(ZIP)));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const n = path.normalize(name);
    if (path.isAbsolute(n) || n.split(path.sep).includes('..')) throw new Error(`Unsafe entry ${name}`);
    fs.writeFileSync(path.join(SRC, n), data);
  }
  log('Extracted', Object.keys(entries).length, 'entries from intro.zip');
}

const ff = (args) => execFileSync(ffmpegPath, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 });
const probe = (file) => JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,color_space', '-of', 'json', file]).toString());
/** Indices of keyframes (display order). */
const keyframes = (file) => execFileSync(ffprobe.path, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=key_frame', '-of', 'csv=p=0', file])
  .toString().trim().split(/\r?\n/).map((l, i) => (l.trim().startsWith('1') ? i : -1)).filter((i) => i >= 0);

/** Frame-difference analysis on 320×180 greyscale frames. */
function frameSteps(file) {
  const raw = ff(['-i', file, '-vf', 'scale=320:180,format=gray', '-f', 'rawvideo', '-']);
  const size = 320 * 180, n = raw.length / size;
  const d = (a, b) => { let s = 0; for (let k = 0; k < size; k += 2) s += Math.abs(raw[a * size + k] - raw[b * size + k]); return s / (size / 2); };
  const steps = []; for (let i = 0; i < n - 1; i++) steps.push(d(i, i + 1));
  return { n, steps, wrap: d(n - 1, 0) };
}

function seamReport(file) {
  const { n, steps, wrap } = frameSteps(file);
  const s = steps.slice().sort((a, b) => a - b);
  return { frames: n, medianStep: +s[Math.floor(s.length / 2)].toFixed(3), maxStep: +s[s.length - 1].toFixed(3), wrap: +wrap.toFixed(3) };
}

function loopFilter(scaleFilter) {
  const { start, jumpFrom, blend, fps } = LOOP;
  const mainEnd = jumpFrom - blend; // frames start..mainEnd-1 play plainly
  const dur = (blend / fps).toFixed(6);
  return [
    `[0:v]split=3[a][b][c]`,
    `[a]trim=start_frame=${start}:end_frame=${mainEnd},setpts=PTS-STARTPTS[main]`,
    `[b]trim=start_frame=${mainEnd}:end_frame=${jumpFrom},setpts=PTS-STARTPTS[tail]`,
    `[c]trim=start_frame=${start - blend}:end_frame=${start},setpts=PTS-STARTPTS[head]`,
    `[tail][head]xfade=transition=fade:duration=${dur}:offset=0[seam]`,
    `[main][seam]concat=n=2:v=1:a=0,${scaleFilter},format=yuv420p[out]`,
  ].join(';');
}

function encodeLoop(name, scaleFilter, crf) {
  const file = path.join(OUT, name);
  ff([
    '-i', path.join(SRC, '1.mp4'),
    '-filter_complex', loopFilter(scaleFilter),
    '-map', '[out]', '-an',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(crf), '-tune', 'film',
    '-g', '24', '-keyint_min', '24', '-sc_threshold', '0', '-r', String(LOOP.fps),
    '-pix_fmt', 'yuv420p', ...BT709, '-movflags', '+faststart',
    file,
  ]);
  return file;
}

/** Scrub-optimized encode: keyframe every 6 frames, no B-frames (decode order = display order). */
function encodeAssembly(name, scaleFilter, crf) {
  const file = path.join(OUT, name);
  ff([
    '-i', ASSEMBLY_SRC,
    '-vf', `${scaleFilter},format=yuv420p`,
    '-an',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(crf),
    '-g', '6', '-keyint_min', '6', '-bf', '0', '-sc_threshold', '0', '-fps_mode', 'passthrough',
    '-pix_fmt', 'yuv420p', ...BT709, '-movflags', '+faststart',
    file,
  ]);
  return file;
}

async function posterFrom(video, name) {
  const png = ff(['-i', video, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709:in_range=tv,format=rgb24', '-f', 'image2pipe', '-vcodec', 'png', '-']);
  const file = path.join(OUT, name);
  await sharp(png).webp({ quality: 70, effort: 6 }).toFile(file);
  return file;
}

const kb = (f) => +(fs.statSync(f).size / 1024).toFixed(1);
const describe = (file) => {
  const p = probe(file);
  const v = p.streams.find((s) => s.codec_type === 'video');
  return {
    kilobytes: kb(file),
    size: `${v.width}×${v.height}`,
    frames: Number(v.nb_frames),
    duration: +(+p.format.duration).toFixed(3),
    kbps: Math.round(Number(p.format.bit_rate) / 1000),
    streams: p.streams.map((s) => s.codec_type),
    colorSpace: v.color_space ?? 'untagged',
  };
};

async function main() {
  extract();
  if (!fs.existsSync(ASSEMBLY_SRC)) throw new Error('Missing 2.mp4 (assembly footage) in the project root');
  fs.mkdirSync(OUT, { recursive: true });

  // Stills from the earlier intro are no longer part of the site.
  for (const f of fs.readdirSync(OUT)) if (/^factory-[2-6]-.*\.webp$/.test(f)) { fs.rmSync(path.join(OUT, f)); log('Removed obsolete', f); }

  // ---- Loop ------------------------------------------------------------------------------
  const loopSrc = probe(path.join(SRC, '1.mp4'));
  const loopSourceSeam = seamReport(path.join(SRC, '1.mp4'));
  const loops = [
    { name: 'factory-loop-720.mp4', scale: scaleTo(1280, 720), crf: 26, poster: 'factory-loop-720.webp', use: 'small landscape screens, Save-Data' },
    { name: 'factory-loop-1080.mp4', scale: scaleTo(1920, 1080), crf: 27, poster: null, use: 'desktop / tablet landscape' },
    { name: 'factory-loop-portrait.mp4', scale: scaleTo(720, 1280, LOOP_CROP_X), crf: 26, poster: 'factory-loop-portrait.webp', use: 'phones / portrait' },
  ];
  const loopReport = [];
  for (const v of loops) {
    const file = encodeLoop(v.name, v.scale, v.crf);
    // The 720p poster (same first frame) also serves 1080p: it is only visible until the first
    // decoded frame and keeps the LCP image within the 250 KB budget.
    const poster = v.poster ? await posterFrom(file, v.poster) : path.join(OUT, 'factory-loop-720.webp');
    const seam = seamReport(file);
    loopReport.push({ file: `public/media/intro/${v.name}`, use: v.use, ...describe(file), gop: 24, poster: `public/media/intro/${path.basename(poster)}`, posterKilobytes: kb(poster), seam });
    log(`${v.name}: ${kb(file)} KB, seam ${JSON.stringify(seam)}`);
  }

  // ---- Assembly (scroll-scrubbed) ----------------------------------------------------------
  const asmSrc = probe(ASSEMBLY_SRC);
  const asmKeys = keyframes(ASSEMBLY_SRC);
  const { steps } = frameSteps(ASSEMBLY_SRC);
  const assemblies = [
    { name: 'factory-assembly-1080.mp4', scale: scaleTo(1920, 1080), crf: 27, use: 'desktop / tablet landscape' },
    { name: 'factory-assembly-720.mp4', scale: scaleTo(1280, 720), crf: 28, use: 'small landscape screens, Save-Data' },
    { name: 'factory-assembly-portrait.mp4', scale: scaleTo(720, 1280, ASSEMBLY_CROP_X), crf: 28, use: 'phones / portrait' },
  ];
  const asmReport = [];
  for (const v of assemblies) {
    const file = encodeAssembly(v.name, v.scale, v.crf);
    const keys = keyframes(file);
    const gaps = [...new Set(keys.slice(1).map((k, i) => k - keys[i]))];
    asmReport.push({ file: `public/media/intro/${v.name}`, use: v.use, ...describe(file), crf: v.crf, keyframeInterval: gaps, bFrames: 0 });
    log(`${v.name}: ${kb(file)} KB, keyframes every ${gaps.join('/')} frames, streams ${describe(file).streams.join('+')}`);
  }

  const sourceOf = (p, extra) => {
    const v = p.streams.find((s) => s.codec_type === 'video');
    return { codec: v.codec_name, size: `${v.width}×${v.height}`, fps: v.r_frame_rate, frames: Number(v.nb_frames), duration: +(+p.format.duration).toFixed(3), audio: p.streams.some((s) => s.codec_type === 'audio'), kilobytes: +(Number(p.format.size) / 1024).toFixed(1), ...extra };
  };

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, 'intro-asset-report.json'), JSON.stringify({
    generated: new Date().toISOString(),
    colour: 'Sources are untagged; derivatives are encoded and tagged BT.709 limited range; posters converted with the same matrix.',
    loop: {
      source: { file: 'intro.zip › 1.mp4 (preserved; extracted to asset-source/intro/)', ...sourceOf(loopSrc, { seam: loopSourceSeam }) },
      loop: { ...LOOP, note: 'Loop = frames 16…181 with frames 166…181 crossfaded into frames 0…15, so the last frame flows into the first.' },
      portraitCrop: { x: LOOP_CROP_X, width: CROP_W, rect: [+(LOOP_CROP_X / 3840).toFixed(4), 0, +((LOOP_CROP_X + CROP_W) / 3840).toFixed(4), 1] },
      derivatives: loopReport,
    },
    assembly: {
      source: { file: '2.mp4 (preserved at the project root)', ...sourceOf(asmSrc, { keyframes: asmKeys }) },
      footage: {
        registration: 'Frame 0 matches intro.zip › 3.png (scale 1.000, offset < 1 px); the last frame matches 5.png (scale 0.997, offset ≈ 2 px).',
        staticLeadIn: 'Frames 0–6 are practically identical (step ≈ 0.6); motion starts at frame 7.',
        dissolve: 'A cross-dissolve is baked into the footage (perspective → overhead), visible in frames ≈ 106–110.',
        motion: 'Camera accelerates towards the panel (step 1 → 27 by frame 100), then decelerates in the overhead push-in (24 → 9.5).',
        steps: steps.map((s) => +s.toFixed(2)),
      },
      portraitCrop: { x: ASSEMBLY_CROP_X, width: CROP_W, rect: [+(ASSEMBLY_CROP_X / 3840).toFixed(4), 0, +((ASSEMBLY_CROP_X + CROP_W) / 3840).toFixed(4), 1] },
      derivatives: asmReport,
    },
    // Measured by scripts/seek-benchmark.mjs (run after this script, on the files above).
    seekBenchmark: 'docs/intro-seek-benchmark.json',
  }, null, 2));
  log('Wrote docs/intro-asset-report.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
