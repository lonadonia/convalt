#!/usr/bin/env node
/**
 * Recovers the camera of the supplied data-center reference screenshot 170556 (1347×752) from
 * model ↔ pixel correspondences picked on it: three platform corners and the four corners of the
 * front row's end panel (model units of the source FBX, before the metre conversion). A pinhole
 * camera (position, yaw, pitch, vertical field of view; centred principal point, no roll) is
 * fitted with Nelder–Mead; the nine ceiling fixtures — not used in the fit — are then projected
 * as an independent check. Result (config/datacenter.ts › DC_REFERENCE): rms 2.4 px, fixtures within
 * 1.5–6 px; camera at (4763, 976, 2919) units = (8.43, 1.73, 5.17) m, lens 44.3°.
 *
 *   node scripts/dc-reference-fit.mjs
 */
import * as THREE from 'three';

const W = 1347, H = 752;
const pts = [
  [[-2200, 0, 2200], [259.5, 440]],
  [[2200, 0, 2200], [442, 641.5]],
  [[2200, 0, -2200], [1268.75, 485]],
  [[1557, 1130, 2015], [434, 254.5]],
  [[1557, 1130, 1655], [531, 257.5]],
  [[1557, 0, 2015], [434, 574]],
  [[1557, 0, 1655], [532.5, 559]],
];
const lamps = [];
for (const x of [-1750, 0, 1756]) for (const z of [-1700, -28, 1644]) lamps.push([x, 1780, z]);
const lampPx = [[548, 52], [413, 135], [345, 176], [696, 162], [574, 190], [755, 204], [910, 110], [903, 181], [1145, 143]];

const cam = new THREE.PerspectiveCamera(45, W / H, 1, 100000);
const v = new THREE.Vector3();
function setCam(p) {
  const [px, py, pz, yaw, pitch, fov] = p;
  cam.fov = fov; cam.aspect = W / H; cam.updateProjectionMatrix();
  cam.position.set(px, py, pz);
  const f = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  cam.up.set(0, 1, 0);
  cam.lookAt(v.copy(cam.position).add(f));
  cam.updateMatrixWorld();
}
function proj(X) {
  v.set(...X).project(cam);
  return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H, v.z];
}
function cost(p) {
  if (p[5] < 10 || p[5] > 90) return 1e12;
  setCam(p);
  let s = 0;
  for (const [X, [u, w]] of pts) { const [a, b, z] = proj(X); if (z > 1 || z < -1) return 1e12; s += (a - u) ** 2 + (b - w) ** 2; }
  return s;
}
// Nelder–Mead.
function nm(f, x0, steps, iters = 6000) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += steps[i]; simplex.push(x); }
  let vals = simplex.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((val, i) => [val, i]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    simplex = order.map((i) => simplex[i]); vals = order.map((i) => vals[i]);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const refl = c.map((cj, j) => cj + (cj - worst[j]));
    const fr = f(refl);
    if (fr < vals[0]) {
      const exp = c.map((cj, j) => cj + 2 * (cj - worst[j]));
      const fe = f(exp);
      if (fe < fr) { simplex[n] = exp; vals[n] = fe; } else { simplex[n] = refl; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { simplex[n] = refl; vals[n] = fr; }
    else {
      const con = c.map((cj, j) => cj + 0.5 * (worst[j] - cj));
      const fc = f(con);
      if (fc < vals[n]) { simplex[n] = con; vals[n] = fc; }
      else { for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((x, j) => simplex[0][j] + 0.5 * (x - simplex[0][j])); vals[i] = f(simplex[i]); } }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], f: vals[best] };
}
let best = null;
for (const fov0 of [25, 35, 45, 55]) for (const yaw0 of [-2.2, -2.4, -2.6]) for (const h of [600, 1200]) {
  const r = nm(cost, [4500, h, 4500, yaw0, -0.3, fov0], [800, 400, 800, 0.2, 0.1, 5]);
  const r2 = nm(cost, r.x, [200, 100, 200, 0.05, 0.03, 2]);
  if (!best || r2.f < best.f) best = r2;
}
setCam(best.x);
const [px, py, pz, yaw, pitch, fov] = best.x;
console.log('rms px', Math.sqrt(best.f / pts.length).toFixed(2));
console.log('camera', { px: +px.toFixed(0), py: +py.toFixed(0), pz: +pz.toFixed(0), yawDeg: +(yaw * 180 / Math.PI).toFixed(2), pitchDeg: +(pitch * 180 / Math.PI).toFixed(2), fov: +fov.toFixed(2) });
for (const [X, uv] of pts) { const [a, b] = proj(X); console.log('  pt', X.join(','), '→', a.toFixed(1), b.toFixed(1), 'ref', uv.join(',')); }
console.log('lamps (projected):');
for (const L of lamps) { const [a, b] = proj(L); const near = lampPx.map((q) => Math.hypot(q[0] - a, q[1] - b)); const k = near.indexOf(Math.min(...near)); console.log('  ', L.join(','), '→', a.toFixed(0), b.toFixed(0), 'nearest ref lamp', lampPx[k].join(','), 'd', near[k].toFixed(1)); }
// Direction from the platform centre toward the camera (azimuth from +Z toward +X, elevation).
const target = new THREE.Vector3(); cam.getWorldDirection(target);
const toCam = new THREE.Vector3(-target.x, -target.y, -target.z);
console.log('view dir (toward camera) az', (Math.atan2(toCam.x, toCam.z) * 180 / Math.PI).toFixed(2), 'el', (Math.asin(toCam.y) * 180 / Math.PI).toFixed(2));
// Where the optical axis meets the floor.
const t = -cam.position.y / target.y; const hit = cam.position.clone().addScaledVector(target, t);
console.log('axis hits floor at', hit.toArray().map((x) => x.toFixed(0)).join(','), 'distance', t.toFixed(0));
