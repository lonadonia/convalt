import * as THREE from 'three';
import type { Vec2 } from '../config/intro';

/**
 * Rigid pose of a planar rectangle (the model's cell field, ±hx × ±hy on the panel's front face)
 * whose projection best matches four screen points (TL, TR, BR, BL). Closed-form planar
 * homography decomposition gives the start; a small Levenberg–Marquardt refinement minimizes the
 * corner reprojection error, because the photographed panel's proportions differ slightly from
 * the model's. The model is never scaled or distorted — only positioned and oriented.
 */
export type PanelPose = { position: THREE.Vector3; quaternion: THREE.Quaternion; errorPx: number };

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** Screen px → normalized pinhole coordinates (X/−Z, Y/−Z) for the camera's projection (incl. lens shift). */
function toPinhole(p: Vec2, W: number, H: number, proj: THREE.Matrix4): Vec2 {
  const e = proj.elements;
  const nx = (2 * p[0]) / W - 1, ny = 1 - (2 * p[1]) / H;
  return [(nx + e[8]) / e[0], (ny + e[9]) / e[5]];
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

/** Homography (h33 = 1) mapping plane points (u, v) to image points (x, y). */
function homography(src: Vec2[], dst: Vec2[]): number[] {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  return [...solveLinear(A, b), 1];
}

type Params = [number, number, number, number, number, number]; // rotation vector (3) + centre (3), camera space

function project(par: Params, pts: THREE.Vector3[]): Vec2[] {
  const rv = new THREE.Vector3(par[0], par[1], par[2]);
  const ang = rv.length();
  const q = ang > 1e-9 ? new THREE.Quaternion().setFromAxisAngle(rv.clone().divideScalar(ang), ang) : new THREE.Quaternion();
  return pts.map((p) => {
    const c = p.clone().applyQuaternion(q).add(new THREE.Vector3(par[3], par[4], par[5]));
    return [c.x / -c.z, c.y / -c.z] as Vec2;
  });
}

export function solvePanelPose(screen: Vec2[], W: number, H: number, camera: THREE.PerspectiveCamera, hx: number, hy: number): PanelPose {
  const proj = camera.projectionMatrix;
  const img = screen.map((p) => toPinhole(p, W, H, proj));
  const plane: Vec2[] = [[-hx, hy], [hx, hy], [hx, -hy], [-hx, -hy]];
  const h = homography(plane, img);
  // Columns of H ~ λ·[F·a, F·b, F·c] with F = diag(1, 1, −1) (camera looks down −Z).
  const h1 = new THREE.Vector3(h[0], h[3], h[6]), h2 = new THREE.Vector3(h[1], h[4], h[7]), h3 = new THREE.Vector3(h[2], h[5], h[8]);
  let lambda = 2 / (h1.length() + h2.length());
  if (h3.z * lambda < 0) lambda = -lambda;
  const flip = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.y, -v.z);
  const a = flip(h1.clone().multiplyScalar(lambda)).normalize();
  let b = flip(h2.clone().multiplyScalar(lambda));
  b = b.sub(a.clone().multiplyScalar(b.dot(a))).normalize();
  const n = new THREE.Vector3().crossVectors(a, b);
  const c = flip(h3.clone().multiplyScalar(lambda));
  const q0 = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(a, b, n));
  const rv0 = new THREE.Vector3(); let ang = 2 * Math.acos(Math.min(1, Math.abs(q0.w)));
  if (ang > 1e-9) { rv0.set(q0.x, q0.y, q0.z).normalize().multiplyScalar(q0.w < 0 ? -ang : ang); } else ang = 0;

  // Levenberg–Marquardt on the 8 reprojection residuals.
  const pts = plane.map(([u, v]) => new THREE.Vector3(u, v, 0));
  let par: Params = [rv0.x, rv0.y, rv0.z, c.x, c.y, c.z];
  const resid = (pp: Params) => project(pp, pts).flatMap((p, i) => [p[0] - img[i][0], p[1] - img[i][1]]);
  let r = resid(par), cost = r.reduce((s, x) => s + x * x, 0), mu = 1e-3;
  for (let it = 0; it < 30; it++) {
    const J: number[][] = r.map(() => new Array(6).fill(0));
    for (let k = 0; k < 6; k++) {
      const d = k < 3 ? 1e-5 : 1e-5 * Math.max(1, Math.abs(par[5]));
      const pp = [...par] as Params; pp[k] += d;
      const rk = resid(pp);
      for (let i = 0; i < r.length; i++) J[i][k] = (rk[i] - r[i]) / d;
    }
    const JtJ = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => J.reduce((s, row) => s + row[i] * row[j], 0)));
    const Jtr = Array.from({ length: 6 }, (_, i) => J.reduce((s, row, k) => s + row[i] * r[k], 0));
    for (let i = 0; i < 6; i++) JtJ[i][i] *= 1 + mu;
    const step = solveLinear(JtJ, Jtr.map((x) => -x));
    const cand = par.map((x, i) => x + step[i]) as Params;
    const rc = resid(cand), cc = rc.reduce((s, x) => s + x * x, 0);
    if (cc < cost) { par = cand; r = rc; cost = cc; mu *= 0.3; if (Math.abs(cost - cc) < 1e-14) break; } else mu *= 10;
    if (cost < 1e-12) break;
  }

  // Camera space → world.
  const rv = new THREE.Vector3(par[0], par[1], par[2]);
  const angle = rv.length();
  const qCam = angle > 1e-9 ? new THREE.Quaternion().setFromAxisAngle(rv.clone().divideScalar(angle), angle) : new THREE.Quaternion();
  const camQ = camera.getWorldQuaternion(new THREE.Quaternion());
  const quaternion = camQ.multiply(qCam);
  const position = _v.set(par[3], par[4], par[5]).applyMatrix4(camera.matrixWorld).clone();
  // Mean corner error in screen px.
  const reproj = project(par, pts);
  const e = proj.elements;
  const errorPx = reproj.reduce((s, p, i) => {
    const sx = ((p[0] * e[0] - e[8]) * 0.5 + 0.5) * W, sy = (0.5 - (p[1] * e[5] - e[9]) * 0.5) * H;
    return s + Math.hypot(sx - screen[i][0], sy - screen[i][1]);
  }, 0) / 4;
  return { position, quaternion, errorPx };
}
