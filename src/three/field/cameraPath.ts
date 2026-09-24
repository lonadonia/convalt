import * as THREE from 'three';

/**
 * One continuous camera path for the power-generation scene. Keys hold a target, an azimuth /
 * elevation / distance around it and a lens shift; each channel is interpolated with a monotone
 * cubic (Fritsch–Carlson), so the camera never overshoots a key and moves without jolts. Distance
 * is interpolated in log space (constant relative speed when pulling back). The first key is the
 * Module scene's final camera, so the handoff is exact. Up stays world +Y: the horizon is level.
 */
export type CameraKey = { t: number; target: THREE.Vector3; az: number; el: number; dist: number; shift: THREE.Vector2 };

export type CameraSample = { position: THREE.Vector3; target: THREE.Vector3; shift: THREE.Vector2; distance: number };

/** Monotone cubic interpolation of (xs, ys) at x. */
function monotone(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const d: number[] = [], m: number[] = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  let i = 0;
  while (x > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
}

export class CameraPath {
  private xs: number[] = [];
  private ch: Record<'tx' | 'ty' | 'tz' | 'az' | 'el' | 'ld' | 'sx' | 'sy', number[]> = { tx: [], ty: [], tz: [], az: [], el: [], ld: [], sx: [], sy: [] };

  constructor(keys: CameraKey[]) {
    for (const k of keys) {
      this.xs.push(k.t);
      this.ch.tx.push(k.target.x); this.ch.ty.push(k.target.y); this.ch.tz.push(k.target.z);
      this.ch.az.push(k.az); this.ch.el.push(k.el); this.ch.ld.push(Math.log(k.dist));
      this.ch.sx.push(k.shift.x); this.ch.sy.push(k.shift.y);
    }
  }

  sample(t: number, out: CameraSample): CameraSample {
    const v = (c: keyof CameraPath['ch']) => monotone(this.xs, this.ch[c], t);
    out.target.set(v('tx'), v('ty'), v('tz'));
    const az = THREE.MathUtils.degToRad(v('az')), el = THREE.MathUtils.degToRad(v('el'));
    out.distance = Math.exp(v('ld'));
    out.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(out.distance).add(out.target);
    out.shift.set(v('sx'), v('sy'));
    return out;
  }
}

/** Azimuth / elevation (degrees) of a direction from the target toward the camera. */
export function anglesOf(dir: THREE.Vector3): { az: number; el: number } {
  const d = dir.clone().normalize();
  return { az: THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z)), el: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))) };
}
