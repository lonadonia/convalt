#!/usr/bin/env node
/**
 * Measures the cell field of a landscape 72-cell panel (6 rows × 12 columns) in a factory still.
 *
 *   node scripts/measure-panel.mjs <image> <tlx> <tly> <trx> <try> <brx> <bry> <blx> <bly> [window]
 *
 * Takes rough corners, then refines each edge: samples are taken through the middle of cell rows
 * (for left/right edges) and cell columns (for top/bottom edges) — away from the white inter-cell
 * gaps — and the boundary is the bright-frame → dark-cell transition inside a small window
 * around the rough edge. Lines are least-squares fitted per edge and intersected.
 * Output: sub-pixel corners in pixels and normalized image coordinates.
 */
import sharp from 'sharp';

const [file, ...rest] = process.argv.slice(2);
const rough = rest.slice(0, 8).map(Number);
const WIN = Number(rest[8] ?? 28);
const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = (x, y) => data[Math.round(y) * W + Math.round(x)];
const [tl, tr, br, bl] = [0, 2, 4, 6].map((i) => [rough[i], rough[i + 1]]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Along a scan line from `outside` toward `inside` (unit direction), find the frame→cell edge. */
function edgeAlong(p, dir) {
  // Smooth with a 3-px average perpendicular-free 1D profile.
  const prof = [];
  for (let k = -WIN; k <= WIN; k++) {
    const x = p[0] + dir[0] * k, y = p[1] + dir[1] * k;
    prof.push((px(x, y) + px(x + dir[1], y + dir[0]) + px(x - dir[1], y - dir[0])) / 3);
  }
  // Largest negative step (bright → dark) where the next 6 samples stay dark.
  let best = -1, bestDrop = 0;
  for (let i = 2; i < prof.length - 8; i++) {
    const drop = prof[i - 2] - prof[i + 1];
    let dark = true;
    for (let j = 1; j <= 6; j++) if (prof[i + j] > 80) { dark = false; break; }
    if (dark && drop > bestDrop) { bestDrop = drop; best = i; }
  }
  if (best < 0 || bestDrop < 60) return null;
  return [p[0] + dir[0] * (best - WIN), p[1] + dir[1] * (best - WIN)];
}

function fitLine(points, vertical) {
  // vertical: x = a + b·y ; horizontal: y = a + b·x
  const u = points.map((p) => (vertical ? p[1] : p[0])), v = points.map((p) => (vertical ? p[0] : p[1]));
  let idx = u.map((_, i) => i);
  let a = 0, b = 0, sd = 0;
  for (let it = 0; it < 5; it++) {
    const n = idx.length;
    const su = idx.reduce((s, i) => s + u[i], 0), sv = idx.reduce((s, i) => s + v[i], 0);
    const suu = idx.reduce((s, i) => s + u[i] * u[i], 0), suv = idx.reduce((s, i) => s + u[i] * v[i], 0);
    b = (n * suv - su * sv) / (n * suu - su * su); a = (sv - b * su) / n;
    const res = idx.map((i) => v[i] - (a + b * u[i]));
    sd = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / n);
    const keep = idx.filter((_, k) => Math.abs(res[k]) <= Math.max(0.8, 2.2 * sd));
    if (keep.length === idx.length || keep.length < 6) break;
    idx = keep;
  }
  return { a, b, sd, n: idx.length };
}

const samples = { left: [], right: [], top: [], bottom: [] };
for (let r = 0; r < 6; r++) for (const f of [0.3, 0.5, 0.7]) {
  const t = (r + f) / 6;
  const pl = lerp(tl, bl, t), pr = lerp(tr, br, t);
  const el = edgeAlong(pl, [1, 0]); if (el) samples.left.push(el);
  const er = edgeAlong(pr, [-1, 0]); if (er) samples.right.push(er);
}
for (let c = 0; c < 12; c++) for (const f of [0.3, 0.5, 0.7]) {
  const t = (c + f) / 12;
  const pt = lerp(tl, tr, t), pb = lerp(bl, br, t);
  const et = edgeAlong(pt, [0, 1]); if (et) samples.top.push(et);
  const eb = edgeAlong(pb, [0, -1]); if (eb) samples.bottom.push(eb);
}
const L = fitLine(samples.left, true), R = fitLine(samples.right, true);
const T = fitLine(samples.top, false), B = fitLine(samples.bottom, false);
const meet = (v, h) => { const y = (h.a + h.b * v.a) / (1 - h.b * v.b); return [v.a + v.b * y, y]; };
const c = { tl: meet(L, T), tr: meet(R, T), br: meet(R, B), bl: meet(L, B) };

console.log(`${file}  ${W}×${H}`);
for (const [k, l] of Object.entries({ left: L, right: R, top: T, bottom: B })) console.log(`  ${k.padEnd(6)} slope ${l.b.toFixed(5)}  residual σ ${l.sd.toFixed(2)} px  (${l.n} samples)`);
for (const [k, p] of Object.entries(c)) console.log(`  ${k}: (${p[0].toFixed(1)}, ${p[1].toFixed(1)})  norm (${(p[0] / W).toFixed(5)}, ${(p[1] / H).toFixed(5)})`);
const topW = c.tr[0] - c.tl[0], botW = c.br[0] - c.bl[0], lH = c.bl[1] - c.tl[1], rH = c.br[1] - c.tr[1];
console.log(`  widths top ${topW.toFixed(1)} bottom ${botW.toFixed(1)} | heights left ${lH.toFixed(1)} right ${rH.toFixed(1)} | mean aspect ${((topW + botW) / (lH + rH)).toFixed(4)}`);
console.log('  json', JSON.stringify(Object.fromEntries(Object.entries(c).map(([k, p]) => [k, [+(p[0] / W).toFixed(5), +(p[1] / H).toFixed(5)]]))));
