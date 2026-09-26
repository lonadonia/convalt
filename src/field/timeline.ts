import { FIELD_RANGES, OUTDOOR } from '../config/field';
import { clamp, easeInOutCubic, lerp, remap, smoothstep } from '../lib/math';

/**
 * Everything the power-generation scene shows, as a pure function of its progress (0–1). Used by
 * the scene controller (3D) and the journey driver (text), so both always agree; reversing the
 * scroll reproduces every state exactly.
 */
export type FieldSample = {
  t: number;
  /** Studio → outdoors (light, sky, reflections). */
  environment: number;
  /** Exponential-squared haze density: dense ivory at first, subtle atmosphere after. */
  fog: number;
  /** > 0 once the field's copy of the panel has taken over (same mesh, same pose: invisible). */
  heroSwap: number;
  /** The panel's settle onto its table (0 = centred in the studio, 1 = mounted). */
  settle: number;
  /** The hero table's structure appearing under the panel. */
  heroTable: number;
  /** Studio ground shadow fading out as real ground appears. */
  studioOut: number;
  /** Section text and its legibility gradient. */
  text: number;
  /** Installation still over the reassembled-module poster (only when the 3D view is unavailable). */
  poster: number;
};

const range = (t: number, r: readonly [number, number]) => remap(t, r[0], r[1]);

export function sampleField(t: number): FieldSample {
  const env = range(t, FIELD_RANGES.environment);
  return {
    t,
    environment: easeInOutCubic(env),
    fog: Math.exp(lerp(Math.log(OUTDOOR.fog.start), Math.log(OUTDOOR.fog.end), smoothstep(clamp(env * 1.1)))),
    heroSwap: smoothstep(range(t, FIELD_RANGES.handoff)),
    settle: easeInOutCubic(range(t, FIELD_RANGES.settle)),
    heroTable: smoothstep(range(t, FIELD_RANGES.heroTable)),
    studioOut: smoothstep(range(t, FIELD_RANGES.studioOut)),
    text: smoothstep(range(t, FIELD_RANGES.text)),
    poster: smoothstep(range(t, FIELD_RANGES.poster)),
  };
}
