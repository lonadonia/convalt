/**
 * Factory-intro compositor: pure functions from (intro progress, viewport, tier) to per-layer
 * transforms, masks and opacities, the assembly video frame to show, and the filmed panel's
 * corners on screen for the model handoff. Used by the DOM journey driver (works before the 3D
 * chunk loads) and by the scene controller (handoff pose), so both always agree.
 *
 * Transform convention: a layer box is the 1920 × 1080 frame space; the screen position of frame
 * point p is  (tx, ty) + s·p  in CSS px of the stage.
 */
import { DEPARTURE_MASK, FEATURES, FRAME, INTRO_MEDIA, INTRO_RANGES as R, LAYER_ORDER, LINKS, NAV_TIMING, SCRUB, TRACKS, type LayerKey, type Quad, type Shot, type Vec2 } from '../config/intro';
import type { Tier } from '../state/store';
import { clamp, easeInOutSine, lerp, remap, smoothstep } from '../lib/math';

export type Xf = { s: number; tx: number; ty: number };
export type Viewport = { W: number; H: number };

export type LayerFrame = { xf: Xf; opacity: number; visible: boolean; mask: string };
export type IntroFrame = {
  layers: Record<LayerKey, LayerFrame>;
  /** Assembly video frame for this position (fractional; the scrubber shows the nearest frame). */
  assemblyFrame: number;
  /** The assembly fully covers the loop from here on (the loop may pause). */
  loopCovered: boolean;
  heroCopy: number;
  cue: number;
  skip: number;
  factory: number;
  navDark: number;
  /** Header/footer opacity (1 = normal); dips while their backdrop changes during the handoff. */
  navDim: number;
  modelVisible: boolean;
  modelOpacity: number;
  toOverview: number;
  shadow: number;
  sweep: number;
  overview: number;
  /** Cell-field corners of the filmed panel on screen (TL, TR, BR, BL), during the handoff. */
  panelCorners: Vec2[] | null;
};

const coverScale = (vp: Viewport) => Math.max(vp.W / FRAME.w, vp.H / FRAME.h);

/** Keeps a layer covering the viewport (never shows its edge while it is the backdrop). */
function clampCover(xf: Xf, vp: Viewport): Xf {
  const w = FRAME.w * xf.s, h = FRAME.h * xf.s;
  const tx = w >= vp.W ? clamp(xf.tx, vp.W - w, 0) : (vp.W - w) / 2;
  const ty = h >= vp.H ? clamp(xf.ty, vp.H - h, 0) : (vp.H - h) / 2;
  return { s: xf.s, tx, ty };
}

function fromSpec(shot: Shot, vp: Viewport): Xf {
  const s = coverScale(vp) * (shot.zoom ?? 1);
  const f = shot.focus ?? [FRAME.w / 2, FRAME.h / 2];
  const a = shot.anchor ?? [0.5, 0.5];
  return clampCover({ s, tx: a[0] * vp.W - f[0] * s, ty: a[1] * vp.H - f[1] * s }, vp);
}

function linked(layer: LayerKey, fromXf: Xf, k = LINKS[layer]!.k): Xf {
  const l = LINKS[layer]!;
  const s = fromXf.s * k;
  return { s, tx: fromXf.tx + fromXf.s * l.cFrom[0] - s * l.cThis[0], ty: fromXf.ty + fromXf.s * l.cFrom[1] - s * l.cThis[1] };
}

export const toScreen = (xf: Xf, p: Vec2): Vec2 => [xf.tx + xf.s * p[0], xf.ty + xf.s * p[1]];

/** Camera plan for one viewport: shots resolved to transforms (link hand-overs included). */
export type IntroPlan = {
  vp: Viewport;
  tier: Tier;
  resolved: Record<LayerKey, Array<{ t: number; xf: Xf; focus?: Vec2 }>>;
  /** Scale ratio reached at the end of a ramped link (see Track.linkRamp). */
  kEnd: Partial<Record<LayerKey, number>>;
};

/** Shot whose transform puts the link point where `other`'s shot (same t) has its own. */
function matchedSpec(shot: Shot, other: LayerKey, tier: Tier, vp: Viewport): Xf {
  const link = LINKS[other]!;
  const target = TRACKS[tier][other].shots.find((s) => s.t === shot.t);
  if (!target) throw new Error(`matchLink: ${other} has no shot at t=${shot.t}`);
  const p = toScreen(fromSpec(target, vp), link.cThis);
  const s = coverScale(vp) * (shot.zoom ?? 1);
  return { s, tx: p[0] - s * link.cFrom[0], ty: p[1] - s * link.cFrom[1] };
}

export function planIntro(vp: Viewport, tier: Tier): IntroPlan {
  const plan: IntroPlan = { vp, tier, resolved: {} as IntroPlan['resolved'], kEnd: {} };
  for (const key of LAYER_ORDER) {
    plan.resolved[key] = TRACKS[tier][key].shots.map((shot) => ({
      t: shot.t,
      focus: shot.focus,
      xf: shot.matchLink ? matchedSpec(shot, shot.matchLink, tier, vp) : fromSpec(shot, vp),
    }));
  }
  for (const key of LAYER_ORDER) {
    const track = TRACKS[tier][key];
    if (track.linkRamp && track.linkRange && LINKS[key]) {
      plan.kEnd[key] = plan.resolved[key][0].xf.s / layerXf(plan, LINKS[key]!.from, track.linkRange[1]).s;
    }
  }
  return plan;
}

/** Transform of a layer at intro progress t. */
export function layerXf(plan: IntroPlan, key: LayerKey, t: number): Xf {
  const track = TRACKS[plan.tier][key];
  if (track.linkRange && t <= track.linkRange[1] && LINKS[key]) {
    const from = layerXf(plan, LINKS[key]!.from, t);
    const kEnd = plan.kEnd[key];
    if (kEnd === undefined) return linked(key, from);
    const e = easeInOutSine(remap(t, track.linkRange[0], track.linkRange[1]));
    return linked(key, from, Math.exp(lerp(Math.log(LINKS[key]!.k), Math.log(kEnd), e)));
  }
  const shots = plan.resolved[key];
  if (t <= shots[0].t) return shots[0].xf;
  for (let i = 0; i < shots.length - 1; i++) {
    const a = shots[i], b = shots[i + 1];
    if (t > b.t) continue;
    const e = easeInOutSine(remap(t, a.t, b.t));
    const s = Math.exp(lerp(Math.log(a.xf.s), Math.log(b.xf.s), e));
    // Move the destination focus along a straight screen path while scaling around it.
    const f = b.focus ?? [FRAME.w / 2, FRAME.h / 2];
    const p0: Vec2 = [a.xf.tx + a.xf.s * f[0], a.xf.ty + a.xf.s * f[1]];
    const p1: Vec2 = [b.xf.tx + b.xf.s * f[0], b.xf.ty + b.xf.s * f[1]];
    return clampCover({ s, tx: lerp(p0[0], p1[0], e) - s * f[0], ty: lerp(p0[1], p1[1], e) - s * f[1] }, plan.vp);
  }
  return shots[shots.length - 1].xf;
}

const reveal = (t: number, range: readonly [number, number]) => remap(t, range[0], range[1]);
const px = (v: number) => `${v.toFixed(1)}px`;

/**
 * Feather widths (frame px) for the borders of a layer that is smaller than the viewport: a full
 * feather while a border is on screen, collapsing smoothly as it moves off screen.
 */
function borderFeathers(xf: Xf, vp: Viewport, edgePx: number) {
  const f = (margin: number) => (edgePx * smoothstep(clamp((margin + edgePx) / edgePx))) / xf.s;
  return { l: f(xf.tx), r: f(vp.W - (xf.tx + FRAME.w * xf.s)), t: f(xf.ty), b: f(vp.H - (xf.ty + FRAME.h * xf.s)) };
}

/** Assembly layer during the departure: soft ellipse from the robot, border-feathered. */
function departureMask(t: number, xf: Xf, vp: Viewport): { opacity: number; mask: string } {
  const p = reveal(t, R.revealAssembly);
  if (p >= 1) return { opacity: 1, mask: 'none' };
  const m = DEPARTURE_MASK;
  const e = easeInOutSine(p);
  const rx = lerp(m.from[0], m.to[0], e), ry = lerp(m.from[1], m.to[1], e);
  const b = borderFeathers(xf, vp, m.edge * Math.min(vp.W, vp.H));
  const ellipse = `radial-gradient(ellipse ${px(rx)} ${px(ry)} at ${px(m.center[0])} ${px(m.center[1])}, #000 ${((1 - m.soft) * 100).toFixed(1)}%, transparent 100%)`;
  const across = `linear-gradient(to right, transparent 0px, #000 ${px(b.l)}, #000 ${px(FRAME.w - b.r)}, transparent ${px(FRAME.w)})`;
  const down = `linear-gradient(to bottom, transparent 0px, #000 ${px(b.t)}, #000 ${px(FRAME.h - b.b)}, transparent ${px(FRAME.h)})`;
  // Layers are intersected (CSS: mask-composite), so the ellipse never reaches a hard border.
  return { opacity: smoothstep(clamp(p / 0.3)), mask: `${ellipse}, ${across}, ${down}` };
}

/** Scroll → assembly frame (piecewise-linear SCRUB knots over the scrub window). */
export function assemblyFrameAt(t: number): number {
  const u = reveal(t, R.scrub);
  const k = SCRUB.knots;
  for (let i = 1; i < k.length; i++) {
    if (u <= k[i][0]) return lerp(k[i - 1][1], k[i][1], remap(u, k[i - 1][0], k[i][0]));
  }
  return Math.min(k[k.length - 1][1], INTRO_MEDIA.assembly.frames - 1);
}

export function sampleIntro(plan: IntroPlan, t: number): IntroFrame {
  const loopXf = layerXf(plan, 'loop', t);
  const asmXf = layerXf(plan, 'assembly', t);
  const dep = t >= R.revealAssembly[0] ? departureMask(t, asmXf, plan.vp) : { opacity: 0, mask: 'none' };
  const loopCovered = t >= R.revealAssembly[1];
  const handoff = t >= R.modelIn[0] - 0.03 && t <= R.toOverview[1];
  const nav = NAV_TIMING[plan.tier];
  return {
    layers: {
      loop: { xf: loopXf, opacity: 1, visible: !loopCovered, mask: 'none' },
      assembly: { xf: asmXf, opacity: dep.opacity, visible: dep.opacity > 0.001, mask: dep.mask },
    },
    assemblyFrame: assemblyFrameAt(t),
    loopCovered,
    heroCopy: 1 - smoothstep(reveal(t, R.heroOut)),
    cue: 1 - smoothstep(reveal(t, R.cueOut)),
    skip: 1 - smoothstep(reveal(t, R.skipOut)),
    factory: 1 - smoothstep(reveal(t, R.factoryOut)),
    navDark: 1 - smoothstep(reveal(t, nav.toLight)),
    navDim: 1 - 0.65 * Math.sin(Math.PI * reveal(t, nav.dip)) ** 2,
    modelVisible: t >= R.modelIn[0] - 0.02,
    modelOpacity: smoothstep(reveal(t, R.modelIn)),
    toOverview: easeInOutSine(reveal(t, R.toOverview)),
    shadow: smoothstep(reveal(t, R.shadowIn)),
    sweep: reveal(t, R.sweep),
    overview: smoothstep(reveal(t, R.overviewIn)),
    panelCorners: handoff ? (FEATURES.assembly.endPanel as Quad).map((p) => toScreen(asmXf, p)) : null,
  };
}
