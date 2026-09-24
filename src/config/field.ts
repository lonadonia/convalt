/**
 * Power generation (scene 03): assets, installation design, reveal and camera choreography.
 *
 * Frames
 *  - field frame: the terrain asset's own metric frame (scan units × 10, Y up; see
 *    scripts/prepare-field.mjs and docs/field-asset-report.json).
 *  - site frame: origin at the installation centre, X along the rows, Z = the row normal the
 *    modules face (+Z), Y up. The layout generator works here.
 *  - world: the site frame shifted so the hero module's mount point lands at HERO_MOUNT — right
 *    below where the Module scene leaves the panel, so the same panel settles onto its table.
 *
 * Every value is a function of the field progress (0–1), derived from the one journey progress.
 * This is an illustrative installation, not a site-specific engineering or yield design.
 */
import type { Tier } from '../state/store';

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

export const FIELD_ASSETS = {
  module: { desktop: '/models/field-module-2k.glb', mobile: '/models/field-module-1k.glb' },
  terrain: { desktop: '/models/field/terrain-desktop.glb', mobile: '/models/field/terrain-mobile.glb' },
  layers: {
    inset: { desktop: '/models/field/terrain-inset-desktop.webp', mobile: '/models/field/terrain-inset-mobile.webp' },
    scan: { desktop: '/models/field/terrain-scan-desktop.webp', mobile: '/models/field/terrain-scan-mobile.webp' },
    apron: { desktop: '/models/field/terrain-apron.webp', mobile: '/models/field/terrain-apron.webp' },
  },
} as const;

/**
 * Deployment site in the field frame (metres). The installation sits in the large central field of
 * the scan, parallel to the lane in front of it (measured direction ≈ 12°), with the hedgerow to
 * its left, a walled field behind its right corner and the lane in front. The centre sits ≈ 10 m
 * further from the lane than the first 8-row layout did, so the 12-row array keeps its margins.
 */
export const SITE = {
  centre: [17, -35] as Vec2,
  /** Row axis: rotation from field +X toward field +Z (degrees). Modules face the lane. */
  rowAxisDeg: 12,
  /**
   * Usable area (field frame): the central field's boundary traced on the orthophoto — hedgerow,
   * lane, walls — the layout keeps `margin` inside it.
   */
  polygon: [
    [-50, -121], [-58, -92], [-69, -58], [-77, -29], [-81, -13], [-81, 5], [-43, 17], [15, 32],
    [72, 47], [111, 54], [111, -33], [78, -42], [76, -44], [94, -121],
  ] as ReadonlyArray<Vec2>,
  margin: 8,
  /** Largest terrain slope (rise/run) accepted under a mounting table. */
  maxSlope: 0.1,
};

/** Mounting tables and array layout (all derived from the module's measured dimensions). */
export const ARRAY = {
  /** Fixed tilt of every table (degrees from horizontal). */
  tiltDeg: 25,
  /** Modules per table: levels up the slope (landscape) × columns along the row. */
  levels: 2,
  columns: 7,
  /** Gap between neighbouring modules on a table (m). */
  moduleGap: 0.02,
  /** Lowest module edge above the terrain (m). */
  clearance: 0.75,
  /** Ground coverage ratio → row pitch = table depth along the slope / gcr. */
  gcr: 0.4,
  /** 12 rows × 4 tables × 14 modules = 672 modules (the first layout had 8 rows: 448). */
  rows: 12,
  tablesPerRow: 4,
  /** Gap between tables in a row (m); a service corridor replaces it after the listed tables. */
  tableGap: 0.8,
  corridorAfter: [1] as ReadonlyArray<number>,
  corridor: 5,
  /** Rows form blocks: an access corridor (extra spacing, m) follows the listed rows. */
  rowCorridorAfter: [5] as ReadonlyArray<number>,
  rowCorridor: 6,
  /** Tables follow the terrain along the row, limited to this slope (rise/run). */
  maxRoll: 0.045,
  /** Posts: roughly this spacing along a table; front and rear legs at these slope fractions. */
  postSpacing: 3.3,
  legFront: 0.16,
  legRear: 0.84,
  /** Legs are embedded this far below the sampled ground (m), so they never float. */
  embed: 0.12,
  /** Cross-sections (m): legs square, rafters (along the slope), rails (along the row). */
  legSize: 0.08,
  rafter: [0.07, 0.1] as Vec2,
  rail: [0.05, 0.06] as Vec2,
  /** The hero's slot: front row, the table right of the service corridor, lower level, centre column. */
  hero: { row: 0, table: 2, level: 0, column: 3 },
};

/** Hero mount point in world coordinates: just below the Module scene's panel position (origin). */
export const HERO_MOUNT: Vec3 = [0, -0.26, 0];

/**
 * Field progress windows. Treat as tuning values; everything re-derives.
 *  0.00–0.12  brief approach toward the centred panel
 *  0.05–0.24  ivory → outdoor light, sky and terrain
 *  0.10–0.26  the Module scene's panel hands over to the supplied field module (aligned crossfade,
 *             carried by the light change and the settle so the colour shift reads as light)
 *  0.15–0.30  the panel settles onto its mounting table (its structure appears just before)
 *  0.30–0.78  reveal: small group → table → row → rows → installation; camera retreats and rises
 *  0.78–0.88  camera settles; section text appears
 *  0.88–1.00  reading interval, then the page continues
 */
export const FIELD_RANGES = {
  approach: [0.0, 0.12],
  environment: [0.05, 0.24],
  handoff: [0.1, 0.26],
  settle: [0.15, 0.3],
  heroTable: [0.19, 0.28],
  studioOut: [0.05, 0.16],
  text: [0.8, 0.88],
  navLight: [0.05, 0.2],
  /** Without the 3D view: the reassembled-module poster gives way to the installation still. */
  poster: [0.0, 0.1],
} as const;

/**
 * Reveal front (metres of reveal distance) over field progress. A module's reveal distance =
 * |Δx along the row from the hero| + levelWeight·level + rowWeight·row, so the order is: the hero's
 * neighbours, its table, its row, then row after row — spatially coherent, no checkerboard.
 */
export const REVEAL = {
  levelWeight: 1.1,
  rowWeight: 24,
  /** Width of the fade band (reveal distance, m) and the settle drop along the table normal (m). */
  band: 2.6,
  drop: 0.32,
  /** Supports appear this far (reveal distance) ahead of their table's first module. */
  supportLead: 3.5,
  /**
   * Reveal front over field progress. Numbers are reveal distances (m); named stops resolve against
   * the generated layout: 'table' = the hero's table complete, 'row' = the hero's row complete,
   * 'rows3' / 'rows6' = the first three / six rows complete (the first block), 'all' = everything
   * (so the last module always lands).
   */
  front: [[0.3, 0], [0.36, 2.9], [0.44, 'table'], [0.52, 'row'], [0.6, 'rows3'], [0.69, 'rows6'], [0.78, 'all']] as ReadonlyArray<readonly [number, number | 'table' | 'row' | 'rows3' | 'rows6' | 'all']>,
};

/**
 * Camera keyframes after the Module scene. `target` is relative to HERO_MOUNT (hero) or to the
 * installation centre (site). Azimuth is measured from world +Z (the direction the modules face)
 * toward +X; elevation above the horizon. Distances in metres; `shift` = lens shift (NDC), used to
 * keep the subject clear of the lower text. The first key is the Module scene's final camera.
 */
export type FieldKey = { t: number; anchor: 'hero' | 'site'; target: Vec3; az: number; el: number; dist: number; shift?: Vec2 };

/**
 * The brief approach: the Module scene's final camera moves straight in toward the centred panel
 * (same direction, lens shift returning to centre) until `t`, reaching `scale` × its distance.
 * Portrait screens see a narrow horizontal angle, so the approach there stays gentler.
 */
export const FIELD_APPROACH: Record<Tier, { t: number; scale: number }> = {
  desktop: { t: 0.12, scale: 0.82 },
  mobile: { t: 0.12, scale: 0.94 },
};

/**
 * The lens never changes: the section keeps the Module scene's field of view (26° desktop, 30°
 * mobile, vertical), so the whole move is camera travel, not zoom.
 */
/**
 * Final overview on desktop-tier screens: the installation's bounds are fitted (distance and lens
 * shift, direction from the last key) into the screen area beside the section text — above it on
 * portrait screens — measured from the rendered text, so the composition holds at any aspect ratio.
 * Region values are 0–1 of the stage (top-left origin). Phones use their last key as given.
 */
export const FIELD_FINAL_FIT = { top: 0.14, bottom: 0.8, right: 0.97, left: 0.04, gap: 0.035, maxLeft: 0.62, portraitAspect: 1.15 } as const;

export const FIELD_CAMERA: Record<Tier, { keys: FieldKey[] }> = {
  desktop: {
    keys: [
      { t: 0.3, anchor: 'hero', target: [0, 0.12, 0], az: 12, el: 22, dist: 5.4 },
      { t: 0.4, anchor: 'hero', target: [0.4, 0, -0.5], az: 18, el: 26, dist: 9.5 },
      { t: 0.52, anchor: 'hero', target: [-4, 0, -2], az: 24, el: 29, dist: 27 },
      { t: 0.66, anchor: 'site', target: [4, 0, 6], az: 29, el: 31, dist: 62 },
      // Final overview: direction only — distance, target and lens shift are fitted (FIELD_FINAL_FIT);
      // the values here are the reference-screen result, used if the text cannot be measured.
      { t: 0.82, anchor: 'site', target: [0, 0, 1], az: 28, el: 30, dist: 132, shift: [0.36, 0.12] },
    ],
  },
  // Portrait: the horizontal angle is only ≈ 14°, so every key sits further back than on desktop.
  mobile: {
    keys: [
      { t: 0.3, anchor: 'hero', target: [0, 0.12, 0], az: 10, el: 24, dist: 11 },
      { t: 0.4, anchor: 'hero', target: [0.2, 0, -0.4], az: 14, el: 28, dist: 17 },
      { t: 0.52, anchor: 'hero', target: [-4, 0, -3], az: 18, el: 31, dist: 48 },
      { t: 0.66, anchor: 'site', target: [2, 0, 4], az: 20, el: 33, dist: 120, shift: [0, 0.2] },
      { t: 0.82, anchor: 'site', target: [0, 0, 0], az: 21, el: 35, dist: 215, shift: [0, 0.36] },
    ],
  },
};

/** Outdoor light, sky and haze (display-referred colours). */
export const OUTDOOR = {
  sun: { color: '#fff3e2', intensity: 3.0, /** direction toward the sun, world */ dir: [-0.42, 0.72, 0.55] as Vec3 },
  /** Sky light is mostly the reflection environment; the hemisphere only lifts shadowed ground a touch. */
  hemi: { sky: '#e6ebe8', ground: '#6d7a58', intensity: 0.35 },
  sky: { zenith: '#9fbad2', horizon: '#dde6e8', ground: '#cfd8d3', sunGlow: '#fff4dc' },
  /** Exponential-squared haze: dense ivory at the start of the reveal, subtle atmospheric depth after. */
  fog: { start: 0.09, end: 0.0016 },
  /** Shadow region (site frame, metres) and map size per tier. */
  shadow: { halfExtent: 50, mapSize: { desktop: 2048, mobile: 1024 } },
};
