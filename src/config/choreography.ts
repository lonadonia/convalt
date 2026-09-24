/**
 * Scroll choreography. Everything visual is a pure function of one normalized story progress
 * (0–1) produced by scrolling the story section. Tune ranges and key poses here.
 *
 *   0.00–0.18  hero holds for reading
 *   0.18–0.38  camera and composition transition (hero text out, module text in)
 *   0.38–0.62  explanatory assembly opens
 *   0.62–0.81  stable inspection state
 *   0.81–1.00  reassembly; the module text clears and the intact panel moves to the centre, where
 *              the power-generation scene (config/field.ts) picks it up
 */
import type { Tier } from '../state/store';
import { easeInOutCubic, remap, smoothstep, window4 } from '../lib/math';

export const STORY = {
  /** Where "Explore the module" and the chapter link land: inside the stable inspection state. */
  exploreTarget: 0.72,
  /** Exponential smoothing of scroll progress (1/s). Higher = tighter to the scrollbar. */
  smoothing: 6.5,
  /** Progress at which the chapter indicator switches from 01 to 02. */
  chapterBoundary: 0.3,
  /** The module chapter is over from here on (reassembled, text clearing toward the field scene). */
  closingFrom: 0.9,
} as const;

export const RANGES = {
  cueOut: [0.015, 0.08],
  heroTextOut: [0.14, 0.22],
  transition: [0.18, 0.38],
  moduleTextIn: [0.29, 0.37],
  explode: [0.4, 0.6],
  controlsIn: [0.46, 0.54],
  anatomyIn: [0.44, 0.52],
  controlsOut: [0.81, 0.85],
  reassemble: [0.82, 0.93],
  /** Toward the centred presentation pose (the handoff to the field scene). */
  toFinal: [0.82, 1.0],
  moduleTextOut: [0.9, 0.985],
} as const;

/** Distance each explanatory group travels along the panel's local normal at full separation. */
export const EXPLODE_SPREAD: Record<Tier, number> = { desktop: 0.24, mobile: 0.17 };

export type KeyPose = {
  /** Panel orientation, Euler order YXZ: [pitch (x), yaw (y), roll (z)] in radians. */
  rotation: readonly [number, number, number];
  /** Camera direction around the subject centre, degrees. */
  azimuth: number;
  elevation: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Screen region (0–1, CSS space, top-left origin) the subject's projected bounds must fit. */
  region: readonly [number, number, number, number];
  /** Separation used for the framing bounds (1 = fully exploded). */
  explode: number;
};

export const POSES: Record<Tier, { hero: KeyPose; inspect: KeyPose; final: KeyPose }> = {
  desktop: {
    hero: { rotation: [-0.12, -0.62, 0], azimuth: 0, elevation: 10, fov: 26, region: [0.5, 0.2, 0.94, 0.8], explode: 0 },
    inspect: { rotation: [-1.36, 0.46, 0], azimuth: 0, elevation: 24, fov: 26, region: [0.43, 0.14, 0.96, 0.86], explode: 1 },
    // Centred, gently leaning back and turned: the intact module, ready to move outdoors.
    final: { rotation: [-0.2, -0.2, 0], azimuth: 0, elevation: 10, fov: 26, region: [0.29, 0.25, 0.71, 0.75], explode: 0 },
  },
  mobile: {
    hero: { rotation: [-0.12, -0.55, 0], azimuth: 0, elevation: 10, fov: 30, region: [0.08, 0.56, 0.92, 0.86], explode: 0 },
    inspect: { rotation: [-1.36, 0.46, 0], azimuth: 0, elevation: 26, fov: 30, region: [0.05, 0.33, 0.95, 0.63], explode: 1 },
    final: { rotation: [-0.2, -0.18, 0], azimuth: 0, elevation: 10, fov: 30, region: [0.1, 0.36, 0.9, 0.64], explode: 0 },
  },
};

/** Pointer parallax limits (radians) and when it is allowed (it never competes with scroll motion). */
export const PARALLAX = { yaw: 0.045, pitch: 0.025, lambda: 3.2 } as const;

export type StorySample = {
  /** Blend weights between key poses. */
  toInspect: number;
  toFinal: number;
  /** 0 = assembled, 1 = fully separated. */
  explode: number;
  heroText: number;
  moduleText: number;
  controls: number;
  cue: number;
  anatomy: number;
  /** How much pointer parallax is allowed right now (0–1). */
  parallax: number;
};

/** Pure mapping from progress to every choreographed quantity. */
export function sampleStory(p: number): StorySample {
  const explodeOpen = easeInOutCubic(remap(p, RANGES.explode[0], RANGES.explode[1]));
  const explodeClose = easeInOutCubic(remap(p, RANGES.reassemble[0], RANGES.reassemble[1]));
  return {
    toInspect: easeInOutCubic(remap(p, RANGES.transition[0], RANGES.transition[1])),
    toFinal: easeInOutCubic(remap(p, RANGES.toFinal[0], RANGES.toFinal[1])),
    explode: explodeOpen * (1 - explodeClose),
    heroText: 1 - smoothstep(remap(p, RANGES.heroTextOut[0], RANGES.heroTextOut[1])),
    moduleText: smoothstep(remap(p, RANGES.moduleTextIn[0], RANGES.moduleTextIn[1])) * (1 - smoothstep(remap(p, RANGES.moduleTextOut[0], RANGES.moduleTextOut[1]))),
    controls: window4(p, RANGES.controlsIn[0], RANGES.controlsIn[1], RANGES.controlsOut[0], RANGES.controlsOut[1]),
    cue: 1 - smoothstep(remap(p, RANGES.cueOut[0], RANGES.cueOut[1])),
    anatomy: window4(p, RANGES.anatomyIn[0], RANGES.anatomyIn[1], RANGES.controlsOut[0], RANGES.controlsOut[1]),
    parallax: Math.max(1 - smoothstep(remap(p, 0.1, 0.18)), window4(p, 0.6, 0.66, 0.8, 0.84)),
  };
}

/**
 * Reduced-motion mode: the story snaps between still compositions instead of flying the camera.
 * Returns the representative progress for the state that contains `p` (overview or module); the
 * power-generation scene has its own still composition (see StoryController).
 */
export function steppedProgress(p: number): number {
  return p < 0.28 ? 0 : STORY.exploreTarget;
}
