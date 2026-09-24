/**
 * The page's pinned journey = factory intro + story (overview → module) + power generation (field)
 * + data centers. One scroll range produces one authoritative progress value (story.progress, 0–1);
 * the intro, story, field and data-center sub-progress values are derived from it here. Tune the
 * scroll distances per tier.
 */
import type { Tier } from '../state/store';
import { clamp } from '../lib/math';

export const JOURNEY = {
  /** Scroll distance of the factory intro (viewport heights). */
  introVh: { desktop: 400, mobile: 280 } satisfies Record<Tier, number>,
  /** Scroll distance of the overview → module story (viewport heights). */
  storyVh: { desktop: 240, mobile: 200 } satisfies Record<Tier, number>,
  /** Scroll distance of the power-generation scene: reassembled panel → field installation. */
  fieldVh: { desktop: 480, mobile: 360 } satisfies Record<Tier, number>,
  /** Scroll distance of the data-center scene: dark transition → close view → pullback → copy. */
  dcVh: { desktop: 300, mobile: 240 } satisfies Record<Tier, number>,
  /** Story progress where "Skip intro" / "Back to overview" land: inside the overview hold. */
  overviewTarget: 0.02,
  /** Field progress where the "03" chapter link lands: the settled overview with its text. */
  fieldTarget: 0.9,
  /** Data-center progress where the "04" chapter link lands: the settled view with its copy. */
  dcTarget: 0.93,
  /**
   * Scroll smoothing (1/s) while in the factory intro. Tighter than the story's (STORY.smoothing)
   * so the scroll-controlled footage settles ≈ 0.3 s after the scroll stops instead of trailing.
   */
  introSmoothing: 9,
} as const;

/**
 * Discontinuous jumps that cross the factory intro (Skip intro, Home/End, a late scroll restore)
 * cut through a brief stage fade instead of fast-forwarding every still: the stage fades out, the
 * smoothed progress snaps to the scroll position, the stage fades back in. Normal scrolling never
 * lags the scroll position by this much. threshold: journey units; fades: seconds.
 */
export const JUMP = { threshold: 0.25, fadeOut: 0.16, fadeIn: 0.3 } as const;

export type JourneyLayout = {
  heightVh: number;
  /** Journey progress where the intro ends and the story begins. */
  introShare: number;
  /** Journey progress where the story ends and the field begins. */
  storyEnd: number;
  /** Journey progress where the field ends and the data centers begin. */
  fieldEnd: number;
};

export function journeyLayout(tier: Tier): JourneyLayout {
  const i = JOURNEY.introVh[tier], s = JOURNEY.storyVh[tier], f = JOURNEY.fieldVh[tier], d = JOURNEY.dcVh[tier];
  const total = i + s + f + d;
  return { heightVh: 100 + total, introShare: i / total, storyEnd: (i + s) / total, fieldEnd: (i + s + f) / total };
}

/** Journey progress → intro progress (0–1). */
export const introOf = (j: number, L: JourneyLayout) => clamp(j / L.introShare);
/** Journey progress → story progress (0–1). */
export const storyOf = (j: number, L: JourneyLayout) => clamp((j - L.introShare) / (L.storyEnd - L.introShare));
/** Journey progress → field progress (0–1). */
export const fieldOf = (j: number, L: JourneyLayout) => clamp((j - L.storyEnd) / (L.fieldEnd - L.storyEnd));
/** Journey progress → data-center progress (0–1). */
export const dcOf = (j: number, L: JourneyLayout) => clamp((j - L.fieldEnd) / (1 - L.fieldEnd));
/** Story progress → journey progress. */
export const journeyOfStory = (p: number, L: JourneyLayout) => L.introShare + clamp(p) * (L.storyEnd - L.introShare);
/** Field progress → journey progress. */
export const journeyOfField = (f: number, L: JourneyLayout) => L.storyEnd + clamp(f) * (L.fieldEnd - L.storyEnd);
/** Data-center progress → journey progress. */
export const journeyOfDc = (d: number, L: JourneyLayout) => L.fieldEnd + clamp(d) * (1 - L.fieldEnd);
