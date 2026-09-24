#!/usr/bin/env node
/**
 * Brute-force similarity registration between two stills (scale + translation, no rotation):
 * finds s, tx, ty such that a point p in image A maps to  s·p + (tx, ty)  in image B, by
 * minimizing the mean absolute grey difference over a region of A (optionally excluding a box).
 *
 *   node scripts/register-stills.mjs <A.png> <B.png> <ax0 ay0 ax1 ay1 region of A>
 *        <sMin sMax> <txMin txMax tyMin tyMax> [ex0 ey0 ex1 ey1 exclude box in A]
 *
 * Coarse-to-fine: a coarse grid search followed by two refinement passes.
 */
import sharp from 'sharp';

const args = process.argv.slice(2);
const [fa, fb] = args;
const [ax0, ay0, ax1, ay1, sMin, sMax, txMin, txMax, tyMin, tyMax, ...ex] = args.slice(2).map(Number);
const load = async (f) => {
  const { data, info } = await sharp(f).greyscale().blur(0.8).raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
};
const A = await load(fa), B = await load(fb);
const bil = (I, x, y) => {
  if (x < 0 || y < 0 || x >= I.w - 1 || y >= I.h - 1) return -1;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * I.w + x0;
  return I.d[i] * (1 - fx) * (1 - fy) + I.d[i + 1] * fx * (1 - fy) + I.d[i + I.w] * (1 - fx) * fy + I.d[i + I.w + 1] * fx * fy;
};
const excluded = (x, y) => ex.length === 4 && x >= ex[0] && x <= ex[2] && y >= ex[1] && y <= ex[3];

function cost(s, tx, ty, step) {
  let sum = 0, n = 0;
  for (let y = ay0; y <= ay1; y += step) for (let x = ax0; x <= ax1; x += step) {
    if (excluded(x, y)) continue;
    const g = bil(B, s * x + tx, s * y + ty);
    if (g < 0) continue;
    sum += Math.abs(g - A.d[y * A.w + x]); n++;
  }
  return n > 50 ? sum / n : 1e9;
}

let best = { c: 1e9 };
const sSteps = 40, tSteps = 40;
for (let i = 0; i <= sSteps; i++) {
  const s = sMin + ((sMax - sMin) * i) / sSteps;
  for (let j = 0; j <= tSteps; j++) for (let k = 0; k <= tSteps; k++) {
    const tx = txMin + ((txMax - txMin) * j) / tSteps, ty = tyMin + ((tyMax - tyMin) * k) / tSteps;
    const c = cost(s, tx, ty, 12);
    if (c < best.c) best = { c, s, tx, ty };
  }
}
for (const [ds, dt, step] of [[(sMax - sMin) / sSteps, (txMax - txMin) / tSteps, 6], [(sMax - sMin) / sSteps / 8, (txMax - txMin) / tSteps / 8, 3]]) {
  const b0 = { ...best };
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) for (let k = -8; k <= 8; k++) {
    const s = b0.s + (ds * i) / 4, tx = b0.tx + (dt * j) / 4, ty = b0.ty + (dt * k) / 4;
    const c = cost(s, tx, ty, step);
    if (c < best.c) best = { c, s, tx, ty };
  }
}
const identity = cost(1, 0, 0, 3);
console.log(JSON.stringify({ A: fa, B: fb, scale: +best.s.toFixed(5), tx: +best.tx.toFixed(2), ty: +best.ty.toFixed(2), meanAbsDiff: +best.c.toFixed(2), identityDiff: +identity.toFixed(2) }));
