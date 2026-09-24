import type { LayerKey } from '../config/intro';
import type { LayerId } from './store';

/**
 * DOM nodes the frame loop writes to directly (opacity/transform/path data). React owns their
 * content; the loop owns only these high-frequency style properties.
 */
/** Text-layout constraints for the 3D framing, normalized to the stage (0–1). */
export type LayoutMetrics = {
  /** Right edge of the widest text element in the side-by-side layout. */
  textRight: number;
  /** Bottom of the hero text block (stacked layout). */
  heroBottom: number;
  /** Bottom of the module headline + lede (stacked layout). */
  moduleTextBottom: number;
  /** Top of the controls / closing area (stacked layout). */
  controlsTop: number;
  /** Power generation: right edge of the rendered text lines and top of the text block. */
  fieldRight: number;
  fieldTop: number;
  /** Data centers: the same measurements for its copy. */
  dcRight: number;
  dcTop: number;
  key: string;
};

export const overlay = {
  stage: null as HTMLElement | null,
  /** Stage copy container (chapter text); fades with the stage on jump cuts. */
  content: null as HTMLElement | null,
  metrics: null as LayoutMetrics | null,
  hero: null as HTMLElement | null,
  module: null as HTMLElement | null,
  controls: null as HTMLElement | null,
  closing: null as HTMLElement | null,
  /** Power-generation text and its legibility gradient. */
  field: null as HTMLElement | null,
  fieldScrim: null as HTMLElement | null,
  /** Data-centers text and its legibility gradient. */
  dc: null as HTMLElement | null,
  dcScrim: null as HTMLElement | null,
  /** Dark treatment of the data-center section (charcoal layer over the page, under the canvas). */
  dcBackdrop: null as HTMLElement | null,
  cue: null as HTMLElement | null,
  anatomy: null as HTMLElement | null,
  canvasWrap: null as HTMLElement | null,
  posterHero: null as HTMLElement | null,
  posterModule: null as HTMLElement | null,
  /** Still of the completed installation: stands in for the field when the 3D view is unavailable. */
  posterField: null as HTMLElement | null,
  /** Still of the data-center view: stands in when the 3D view is unavailable. */
  posterDc: null as HTMLElement | null,
  leader: null as SVGPathElement | null,
  leaderDot: null as SVGCircleElement | null,
  layerButtons: {} as Partial<Record<LayerId, HTMLElement>>,
  /** Cached layout (CSS px, relative to the stage) — refreshed on resize / selection. */
  layerButtonRects: {} as Partial<Record<LayerId, DOMRect>>,
  stageRect: null as DOMRect | null,
  /** Factory intro nodes (see components/intro). */
  factory: null as HTMLElement | null,
  /** The two video layers (opening loop, scroll-controlled assembly footage). */
  factoryLayers: {} as Partial<Record<LayerKey, HTMLElement>>,
  introHero: null as HTMLElement | null,
  heroScrim: null as HTMLElement | null,
  topScrim: null as HTMLElement | null,
  skip: null as HTMLElement | null,
  header: null as HTMLElement | null,
  stageFooter: null as HTMLElement | null,
  /** True once the 3D frame loop runs; until then the journey driver owns the poster opacity. */
  sceneActive: false,
  /** Set when layout may have changed (resize, fonts, accordion); the frame loop re-measures lazily. */
  layoutDirty: true,
};

export function markOverlayLayoutDirty() {
  overlay.layoutDirty = true;
}

/** Layout box relative to the stage, ignoring transforms (fades translate the blocks). */
function boxIn(stage: HTMLElement, el: HTMLElement) {
  let x = 0, y = 0;
  let e: HTMLElement | null = el;
  while (e && e !== stage) {
    x += e.offsetLeft;
    y += e.offsetTop;
    e = e.offsetParent as HTMLElement | null;
  }
  return { left: x, top: y, right: x + el.offsetWidth, bottom: y + el.offsetHeight };
}

/** Right edge of an element's rendered content (its text lines, not the block's full width). */
function contentRight(stage: HTMLElement, el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  return r.width ? r.right - stage.getBoundingClientRect().left : boxIn(stage, el).right;
}

export function measureLayout(): LayoutMetrics | null {
  const stage = overlay.stage;
  if (!stage || !overlay.hero || !overlay.module) return overlay.metrics;
  const W = stage.clientWidth || 1, H = stage.clientHeight || 1;
  const textEls = [
    ...overlay.hero.querySelectorAll<HTMLElement>('.eyebrow, .display, .lede, .cta-row > *'),
    ...overlay.module.querySelectorAll<HTMLElement>('.eyebrow, .display, .lede, .layers__list, .closing .cta-row > *'),
  ];
  let right = 0;
  for (const el of textEls) right = Math.max(right, boxIn(stage, el).right);
  const lede = overlay.module.querySelector<HTMLElement>('.lede');
  const swap = overlay.module.querySelector<HTMLElement>('.swap');
  const extent = (block: HTMLElement | null) => {
    const els = block ? [...block.querySelectorAll<HTMLElement>('.eyebrow, .display, .lede, .cta-row > *, .chapter__note')] : [];
    let r = 0, t = H;
    for (const el of els) { r = Math.max(r, contentRight(stage, el)); t = Math.min(t, boxIn(stage, el).top); }
    return { right: r, top: t };
  };
  const { right: fieldRight, top: fieldTop } = extent(overlay.field);
  const dcText = extent(overlay.dc);
  const m: LayoutMetrics = {
    textRight: right / W,
    heroBottom: boxIn(stage, overlay.hero).bottom / H,
    moduleTextBottom: lede ? boxIn(stage, lede).bottom / H : 0.3,
    controlsTop: swap ? boxIn(stage, swap).top / H : 0.7,
    // Not laid out (poster capture hides the copy): the text column's usual extent.
    fieldRight: fieldRight > 0 ? fieldRight / W : 0.44,
    fieldTop: fieldRight > 0 ? fieldTop / H : 0.55,
    dcRight: dcText.right > 0 ? dcText.right / W : 0.36,
    dcTop: dcText.right > 0 ? dcText.top / H : 0.55,
    key: '',
  };
  m.key = [m.textRight, m.heroBottom, m.moduleTextBottom, m.controlsTop, m.fieldRight, m.fieldTop, m.dcRight, m.dcTop].map((v) => v.toFixed(3)).join('|');
  overlay.metrics = m;
  return m;
}

export function refreshOverlayLayout() {
  overlay.layoutDirty = false;
  const stage = overlay.canvasWrap?.parentElement;
  overlay.stageRect = stage ? stage.getBoundingClientRect() : null;
  for (const [id, el] of Object.entries(overlay.layerButtons)) {
    if (el) overlay.layerButtonRects[id as LayerId] = el.getBoundingClientRect();
  }
}
