/**
 * Factory intro: media manifest, measured footage features and scroll choreography.
 *
 * Two videos share one 16:9 frame space of 1920 × 1080 px (= the 1080p derivatives; every
 * coordinate below is in these pixels):
 *   - loop      intro.zip › 1.mp4 — the ambient opening loop (plays, wide hall).
 *   - assembly  2.mp4 — scroll-controlled, never played: robot at the panel → forward move →
 *               (baked-in dissolve) → overhead push-in. Its frame 0 registers to the earlier 3.png
 *               (scale 1.000, < 1 px) and its last frame to 5.png (scale 0.997, ≈ 2 px), so the
 *               robot link calibrated between 2.png (= the loop framing) and 3.png still holds.
 * Features were measured with scripts/measure-panel.mjs and scripts/register-stills.mjs.
 *
 * Every value is a function of the intro progress (0–1) derived from the single journey
 * progress; nothing here is time-based.
 */
import type { Tier } from '../state/store';

export const FRAME = { w: 1920, h: 1080 } as const;

export type Vec2 = readonly [number, number];
export type Quad = readonly [Vec2, Vec2, Vec2, Vec2]; // TL, TR, BR, BL (frame px)
export type Rect = readonly [number, number, number, number]; // normalized x0, y0, x1, y1

/** Supplied footage → web derivatives (see scripts/prepare-intro.mjs, docs/intro-asset-report.json). */
export const INTRO_MEDIA = {
  loop: {
    source: 'intro.zip › 1.mp4 (3840×2160, 24 fps, 8 s, AAC audio)',
    landscape: { src: '/media/intro/factory-loop-1080.mp4', small: '/media/intro/factory-loop-720.mp4', poster: '/media/intro/factory-loop-720.webp' },
    portrait: { src: '/media/intro/factory-loop-portrait.mp4', poster: '/media/intro/factory-loop-portrait.webp' },
    /** Portrait derivative = 9:16 crop of the frame, centred on the conveyor axis. */
    portraitRect: [0.3378, 0, 0.6544, 1] as Rect,
  },
  assembly: {
    source: '2.mp4 (3840×2160, 24 fps, 143 frames, 5.96 s, AAC audio)',
    landscape: { src: '/media/intro/factory-assembly-1080.mp4', small: '/media/intro/factory-assembly-720.mp4' },
    portrait: { src: '/media/intro/factory-assembly-portrait.mp4' },
    portraitRect: [0.3417, 0, 0.6583, 1] as Rect,
    fps: 24,
    frames: 143,
  },
} as const;

export type LayerKey = 'loop' | 'assembly';
export const LAYER_ORDER: LayerKey[] = ['loop', 'assembly'];

/** 1672 × 941 (earlier stills) → frame px. The stills and the videos share the framing. */
const S = (x: number, y: number): Vec2 => [(x * FRAME.w) / 1672, (y * FRAME.h) / 941];

/** Measured features (frame px). */
export const FEATURES = {
  loop: {
    focus: S(830, 470), // opening framing: gripper over the conveyor axis
    focusMobile: S(836, 452),
    /** Robot column, lower wrist ring — the shared focal target of the departure. */
    robot: S(827, 361),
  },
  assembly: {
    robot: S(868, 440), // same robot, frame 0 (camera much closer and lower)
    /**
     * Last frame (142): cell-field corners measured at 4K (edge residual σ < 0.5 px). The panel
     * is seen from ≈ 25° off vertical (cells appear 1.12 : 1), so the model is posed to the
     * corners in 3D — not stretched.
     */
    endPanel: [
      [0.28717 * FRAME.w, 0.3261 * FRAME.h],
      [0.71498 * FRAME.w, 0.32626 * FRAME.h],
      [0.72323 * FRAME.w, 0.67188 * FRAME.h],
      [0.2786 * FRAME.w, 0.67205 * FRAME.h],
    ] as Quad,
    /**
     * Focal length of the footage camera at the last frame (frame px; principal point at the frame
     * centre). Fitted together with the pose of the model's rigid cell field to the four corners
     * above: 9408 px at 4K (23.1° × 13.1° field of view, panel tilted 25.9°), mean corner error
     * 0.2 px. The 3D camera adopts these intrinsics for the handoff, so the real model overlays the
     * filmed panel exactly instead of being bent to fit a wider lens.
     */
    endFocal: 9408 / 2,
  },
} as const;

const quadCentre = (q: Quad): Vec2 => [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
export const END_PANEL_CENTRE = quadCentre(FEATURES.assembly.endPanel);
const FRAME_CENTRE: Vec2 = [FRAME.w / 2, FRAME.h / 2];

/**
 * Layer link: a point p of the assembly frame corresponds to  c_from + k·(p − c_this)  in the loop
 * frame. Robot column: 26 px wide in the loop framing, 123 px in assembly frame 0. The camera moved
 * a long way between the two, so nothing else shares this scale; the link only holds at the start
 * of the departure (see Track.linkRamp).
 */
export type ImageLink = { from: LayerKey; cFrom: Vec2; cThis: Vec2; k: number };
export const LINKS: Partial<Record<LayerKey, ImageLink>> = {
  assembly: { from: 'loop', cFrom: FEATURES.loop.robot, cThis: FEATURES.assembly.robot, k: 26 / 123 },
};

/** Intro progress windows. Tuning values — adjust freely; everything re-derives. */
export const INTRO_RANGES = {
  heroOut: [0.0, 0.05],
  cueOut: [0.0, 0.03],
  /** Departure: the loop's current frame zooms toward the robot while assembly frame 6 grows in. */
  revealAssembly: [0.025, 0.12],
  /** The assembly video follows the scroll across this window (frame mapping: SCRUB). */
  scrub: [0.12, 0.74],
  /** Restrained push-in on the last frame, continuing the footage's own push-in. */
  pushIn: [0.7, 0.8],
  // Handoff, strictly in sequence: model over the filmed panel → factory to ivory around it →
  // only then does the model travel to the overview pose (never two readable panels).
  modelIn: [0.8, 0.84],
  factoryOut: [0.84, 0.89],
  toOverview: [0.89, 0.97],
  shadowIn: [0.91, 1.0],
  sweep: [0.92, 1.0],
  overviewIn: [0.93, 1.0],
  skipOut: [0.82, 0.88],
} as const;

/**
 * Scroll → assembly frame. Piecewise linear over the scrub window ([u, frame] knots, u = 0–1).
 *  - Frames 0–6 are a static lead-in (identical within noise), so the scrub starts at frame 6.
 *  - The footage accelerates towards the panel (frames 60–104), dissolves to the overhead view
 *    (≈ 106–110; baked in) and decelerates in the push-in; the dissolve gets a short stretch of
 *    scroll so its ghosting passes quickly, the rest roughly follows the pacing of the action.
 */
export const SCRUB = {
  knots: [[0, 6], [0.34, 60], [0.72, 104], [0.78, 112], [1, 142]] as ReadonlyArray<readonly [number, number]>,
};

/**
 * Header/footer contrast during the handoff: they dim while their backdrop changes and switch
 * white → petrol at the bottom of the dip. Desktop: the filmed panel sits behind the header
 * until the model starts to travel. Mobile: only the factory is behind it.
 */
export const NAV_TIMING: Record<Tier, { dip: readonly [number, number]; toLight: readonly [number, number] }> = {
  desktop: { dip: [0.868, 0.94], toLight: [0.9, 0.925] },
  mobile: { dip: [0.842, 0.9], toLight: [0.86, 0.882] },
};

/**
 * Camera shots per layer: at intro progress t the frame point `focus` is placed at the normalized
 * screen point `anchor`, with `zoom` × the cover scale. A `linkRange` derives the layer's transform
 * from the linked layer (keeps the shared feature aligned).
 *  - `matchLink`: this shot places `focus` exactly where the named layer's link point sits in that
 *    layer's shot at the same t (the two videos meet on their shared feature).
 *  - `linkRamp`: during the link range the scale ratio eases from the image link (features
 *    matched) to the layer's own first shot — the near subject (robot) grows faster than the
 *    outgoing footage around it, as it would in a forward dolly.
 */
export type Shot = { t: number; focus?: Vec2; zoom?: number; anchor?: Vec2; matchLink?: LayerKey };
export type Track = { shots: Shot[]; linkRange?: readonly [number, number]; linkRamp?: boolean };

const R = INTRO_RANGES;
export const TRACKS: Record<Tier, Record<LayerKey, Track>> = {
  desktop: {
    loop: {
      shots: [
        { t: 0, focus: FEATURES.loop.focus, zoom: 1, anchor: [0.5, 0.5] },
        { t: R.revealAssembly[0], focus: FEATURES.loop.focus, zoom: 1.02, anchor: [0.5, 0.503] },
        { t: R.revealAssembly[1], focus: FEATURES.loop.robot, zoom: 1.8, matchLink: 'assembly' },
      ],
    },
    assembly: {
      linkRange: R.revealAssembly,
      linkRamp: true,
      shots: [
        // Arrives at the footage's own full-frame composition; the footage then carries the motion.
        { t: R.revealAssembly[1], focus: FRAME_CENTRE, zoom: 1, anchor: [0.5, 0.5] },
        { t: R.pushIn[0], focus: END_PANEL_CENTRE, zoom: 1, anchor: [0.5, 0.5] },
        { t: R.pushIn[1], focus: END_PANEL_CENTRE, zoom: 1.24, anchor: [0.5, 0.5] },
      ],
    },
  },
  mobile: {
    // Portrait crops: the panel already fills the width in the last frame, so no push-in.
    loop: {
      shots: [
        { t: 0, focus: FEATURES.loop.focusMobile, zoom: 1, anchor: [0.5, 0.44] },
        { t: R.revealAssembly[0], focus: FEATURES.loop.focusMobile, zoom: 1.02, anchor: [0.5, 0.443] },
        { t: R.revealAssembly[1], focus: FEATURES.loop.robot, zoom: 1.7, matchLink: 'assembly' },
      ],
    },
    assembly: {
      linkRange: R.revealAssembly,
      linkRamp: true,
      shots: [
        { t: R.revealAssembly[1], focus: FRAME_CENTRE, zoom: 1, anchor: [0.5, 0.5] },
        { t: R.pushIn[0], focus: END_PANEL_CENTRE, zoom: 1, anchor: [0.5, 0.5] },
        { t: R.pushIn[1], focus: END_PANEL_CENTRE, zoom: 1, anchor: [0.5, 0.5] },
      ],
    },
  },
};

/**
 * Departure mask (assembly frame px): a soft ellipse grown from the robot. While the smaller
 * assembly frame's own border is inside the viewport it is feathered (`edge` × min(viewport side)
 * px), so no rectangle ever shows.
 */
export const DEPARTURE_MASK = { center: S(862, 400), from: S(300, 340), to: S(2400, 1600), soft: 0.45, edge: 0.12 } as const;

/** Model cell field (metres, panel-local front face): the model's 3D counterpart of FEATURES.assembly.endPanel. */
export const MODEL_CELL_FIELD = { hx: 0.932 - 0.0105, hy: 0.4675 - 0.0105 } as const;
