/**
 * Data centers (scene 04): asset, look, camera path and timing.
 *
 * The model is in metres (scripts/prepare-datacenter.mjs): origin = centre of the tiled platform on
 * the floor, Y up, rack fronts face +Z; 5 rows × 6 cabinets, cabinets 2.0 m tall. It is rendered
 * in its own scene with its own camera; the field and this scene meet only inside the short dark
 * transition band. Every value is a function of the section progress (0–1), derived from the one
 * journey progress.
 */
import type { Tier } from '../state/store';

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

export const DC_ASSET = '/models/datacenter.glb';

/**
 * Section progress windows. Treat as tuning values; everything re-derives.
 *  0.00–0.035  the power-generation copy leaves
 *  0.02–0.075  dark transition band: field → charcoal → server close-up (scroll-driven)
 *  0.075–0.22  the close-up holds (a slow drift): racks, slots, green indicators
 *  0.22–0.68   the camera pulls back and rises: adjacent racks → aisles and floor → the installation
 *  0.68–0.82   settle into the reference three-quarter view (decelerating)
 *  0.82–0.90   the data-center copy appears
 *  0.90–1.00   reading interval; the page then continues
 */
export const DC_RANGES = {
  fieldTextOut: [0.0, 0.035],
  band: [0.02, 0.075],
  /** Header and chapter bar switch to light-on-dark around the middle of the band. */
  nav: [0.03, 0.06],
  text: [0.82, 0.9],
} as const;

/**
 * Inside the band (u = 0–1): the field darkens to charcoal, the server close-up rises out of it.
 * They overlap only while both are dim (never two readable scenes), and the close-up is already
 * glowing faintly before the last of the field is gone.
 */
export const DC_BAND = {
  /** Field brightness falls to 0 over u ∈ [0, fieldOut]. */
  fieldOut: 0.56,
  /** Close-up brightness rises over u ∈ [dcIn, 1] (an eased-in curve lifted early, so the
   * indicators already glow at the band's darkest point — never an empty black frame). */
  dcIn: 0.3,
  dcRise: 0.6,
  /** Composite window (both scenes rendered): u ∈ [dcIn, fieldOut]. */
  /** Deep charcoal of the dark treatment (page, clear colour, band). */
  charcoal: '#0b1214',
} as const;

/**
 * Camera path (model metres). Keys hold a target, an azimuth / elevation / distance around it (az
 * from +Z toward +X, the side the racks face and the reference camera stands) and a lens shift.
 * One continuous path: close to the front-right cabinet of the front row → several racks → aisles
 * and platform → the whole installation → the reference view. It stays in the open space in front
 * of the rows (never through geometry), level horizon, fixed lens.
 */
export type DcKey = { t: number; target: Vec3; az: number; el: number; dist: number; shift?: Vec2 };

/**
 * Reference 170556 (fitted from 7 picked points, rms 2.4 px; the nine fixtures, not used in the fit,
 * land within 1.5–6 px): camera at (8.43, 1.73, 5.17) m — eye height — looking toward the installation,
 * vertical field of view 44.3°. From the centre of the model bounds (0, 1.61, 0): azimuth 58.5°,
 * elevation 0.7°, 9.9 m.
 */
export const DC_REFERENCE = { position: [8.43, 1.727, 5.166] as Vec3, fov: 44.3, az: 58.5, el: 0.7 } as const;

export const DC_CAMERA: Record<Tier, { fov: number; keys: DcKey[] }> = {
  desktop: {
    fov: 44,
    keys: [
      // Eye height rises steadily: ≈ 1.25 m at the close view → 1.73 m (the reference) at the end.
      { t: 0.06, target: [2.3, 1.18, 3.52], az: 44, el: 4, dist: 1.4 },
      { t: 0.22, target: [2.2, 1.18, 3.5], az: 46, el: 5, dist: 1.28 },
      { t: 0.38, target: [1.6, 1.12, 3.1], az: 50, el: 5, dist: 2.6 },
      { t: 0.52, target: [0.9, 1.2, 1.9], az: 54, el: 4, dist: 5.2 },
      { t: 0.66, target: [0.3, 1.45, 0.8], az: 57, el: 1.8, dist: 8.2 },
      // Final: direction only — distance, target and lens shift are fitted beside the copy.
      { t: 0.8, target: [0, 1.6, 0], az: 58.5, el: 0.7, dist: 10 },
    ],
  },
  // Portrait: the camera stays below the fixtures (their lit faces show), further back overall.
  mobile: {
    fov: 58,
    keys: [
      { t: 0.06, target: [2.3, 1.18, 3.52], az: 44, el: 4, dist: 1.6 },
      { t: 0.22, target: [2.2, 1.18, 3.5], az: 46, el: 5, dist: 1.45 },
      { t: 0.38, target: [1.6, 1.12, 3.1], az: 50, el: 5, dist: 3.4 },
      { t: 0.52, target: [0.9, 1.25, 1.9], az: 54, el: 5, dist: 7 },
      { t: 0.66, target: [0.3, 1.45, 0.8], az: 57, el: 3, dist: 11 },
      // Final: fitted above the copy (distance, lens shift); ≈ 23 m back, so 2° keeps the eye
      // (≈ 2.4 m) below the fixtures.
      { t: 0.8, target: [0, 1.6, 0], az: 58.5, el: 2, dist: 16 },
    ],
  },
};

/**
 * Final framing: the installation's silhouette (platform, racks, fixtures) is fitted into the area
 * beside the copy (distance + lens shift, the key's direction kept) — measured from the rendered
 * text, so it holds at any aspect ratio. Portrait screens place it above the copy. 0–1 of the stage.
 */
export const DC_FINAL_FIT = { top: 0.13, bottom: 0.9, right: 0.975, left: 0.04, gap: 0.04, maxLeft: 0.5, portraitAspect: 1.15 } as const;

/** Look (display-referred colours; intensities in three's physical units). */
export const DC_LOOK = {
  background: '#0b1214',
  materials: {
    RackCase: { color: '#1c1f22', metalness: 0.4, roughness: 0.4, envMapIntensity: 1.2 },
    RackFront: { color: '#ffffff', metalness: 0.2, roughness: 0.42, envMapIntensity: 1.0, emissive: '#8fd0b4', emissiveIntensity: 0.65 },
    LedGreen: { color: '#04140a', metalness: 0, roughness: 0.4, envMapIntensity: 0.3, emissive: '#27f27a', emissiveIntensity: 1.25 },
    LedAmber: { color: '#140e04', metalness: 0, roughness: 0.4, envMapIntensity: 0.3, emissive: '#ffb43c', emissiveIntensity: 1.4 },
    FloorTile: { color: '#a3a8ab', metalness: 0, roughness: 0.2, envMapIntensity: 0.45 },
    FloorGrout: { color: '#0b0c0d', metalness: 0, roughness: 0.6, envMapIntensity: 0.4 },
    FixtureCase: { color: '#1b1d20', metalness: 0.5, roughness: 0.45, envMapIntensity: 0.9 },
    FixtureLight: { color: '#ffffff', metalness: 0, roughness: 0.9, envMapIntensity: 0, emissive: '#f5f8ff', emissiveIntensity: 3.2 },
  } as Record<string, { color: string; metalness: number; roughness: number; envMapIntensity: number; emissive?: string; emissiveIntensity?: number }>,
  /** Overhead key (the fixtures' combined light), a soft front fill toward the racks, sky/ground fill. */
  overhead: { color: '#eef3ff', intensity: 1.6, dir: [0.25, 1, 0.35] as Vec3 },
  front: { color: '#dfe6ea', intensity: 0.9, dir: [0.83, 0.42, 0.5] as Vec3 },
  hemi: { sky: '#2a3036', ground: '#0a0b0c', intensity: 0.6 },
  /** Reflection environment: a dark room lit only by the nine fixtures (+ two soft side panels). */
  env: { room: '#0b0c0d', fixture: 12, side: 1.6 },
  /** Contact darkening on the floor around the rack bases (analytic, per row rectangle). */
  floorAo: { strength: 0.55, radius: 0.45 },
  /**
   * Planar floor reflection: the scene mirrored in the floor, rendered at a fraction of the canvas
   * resolution and blurred through its mip chain (tiles are glossy, not mirrors).
   */
  mirror: { resolution: 0.5, strength: 0.55, blur: 2.2 },
};
