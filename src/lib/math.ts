export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/** Maps v from [a, b] to [0, 1], clamped. */
export const remap = (v: number, a: number, b: number) => clamp((v - a) / (b - a));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const smoothstep = (t: number) => t * t * (3 - 2 * t);

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Rises across [a, b] and falls across [c, d]: a trapezoid window with eased edges. */
export const window4 = (v: number, a: number, b: number, c: number, d: number) =>
  smoothstep(remap(v, a, b)) * (1 - smoothstep(remap(v, c, d)));
