import { STORY, sampleStory, type StorySample } from '../config/choreography';
import { INTRO_RANGES } from '../config/intro';
import { dcOf, fieldOf, introOf, journeyLayout, storyOf, type JourneyLayout } from '../config/journey';
import { sampleDc, type DcSample } from '../datacenter/timeline';
import { sampleField, type FieldSample } from '../field/timeline';
import { planIntro, sampleIntro, type IntroFrame, type IntroPlan } from '../intro/compositor';
import { setLoopVisible } from '../intro/ambientVideo';
import { scrubState, scrubTo } from '../intro/scrubVideo';
import { overlay } from '../state/overlay';
import { story, ui } from '../state/store';
import { clamp } from './math';

/**
 * Journey driver: turns the single journey progress into DOM state — the two factory video
 * layers, the scrubbed footage position, scrims, intro copy/controls, navigation colour, the story
 * overlay, the power-generation and data-center text and the data-center dark treatment. Called by
 * the scene's frame loop every rendered frame, and directly
 * from the scroll handler before the 3D chunk has loaded, so the page always follows the scroll.
 */
export type JourneyFrame = {
  intro: IntroFrame;
  introT: number;
  storyP: number;
  sample: StorySample;
  share: number;
  layout: JourneyLayout;
  /** Power-generation progress (0 until the story ends) and its sample. */
  fieldT: number;
  field: FieldSample;
  /** Data-center progress (0 until the field ends) and its sample. */
  dcT: number;
  dc: DcSample;
  /** The filmed panel is on screen (footage decoded) — the model may align to it. */
  photoPanel: boolean;
};

/** Fade-in (ms) used only when the footage becomes ready while it is already needed (slow network). */
const READY_FADE_MS = 260;
/** Loop playback hysteresis: paused once covered, resumed only when clearly uncovered again. */
const LOOP_RESUME_BELOW = INTRO_RANGES.revealAssembly[1] - 0.012;

let plan: IntroPlan | null = null;
let planKey = '';
let loopVisible = true;
let rafPending = false;
const cache = new WeakMap<Element, Record<string, string>>();

function css(el: Element | null | undefined, prop: string, value: string) {
  if (!el) return;
  let c = cache.get(el);
  if (!c) { c = {}; cache.set(el, c); }
  if (c[prop] === value) return;
  c[prop] = value;
  (el as HTMLElement).style.setProperty(prop, value);
}

function fade(el: HTMLElement | null, opacity: number, translateY = 0) {
  if (!el) return;
  css(el, 'opacity', opacity.toFixed(3));
  css(el, 'transform', translateY ? `translate3d(0, ${translateY.toFixed(2)}px, 0)` : 'none');
  // Invisible blocks never intercept pointers; focus still reveals them (see useRevealOnFocus).
  css(el, 'pointer-events', opacity > 0.6 ? 'auto' : 'none');
  // Only ever force 'hidden'; otherwise defer to the stylesheet (e.g. the phone layout hides the
  // anatomy note while a layer description is open).
  css(el, 'visibility', opacity < 0.002 ? 'hidden' : '');
}

/**
 * Page scene (html[data-scene]): 'dark' from the data centers through the footer. Drives the body
 * background, the mobile menu and the browser UI colour. Scroll-derived only — never stored, and
 * no site-wide theme preference is read or written.
 */
let scene = '';
export function setScene(next: 'dark' | 'light') {
  if (next === scene) return;
  scene = next;
  document.documentElement.dataset.scene = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#0B1214' : '#F5F4EE');
}

/** One more frame soon (time-based readiness fades). Never re-enters synchronously. */
function requestRender() {
  if (overlay.sceneActive) { story.invalidate(); return; }
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; applyJourney(story.target); });
}

export function currentPlan(): IntroPlan {
  const tier = ui.get().tier;
  const W = overlay.stage?.clientWidth || window.innerWidth;
  const H = overlay.stage?.clientHeight || window.innerHeight;
  const key = `${W}×${H}:${tier}`;
  if (!plan || key !== planKey) { plan = planIntro({ W, H }, tier); planKey = key; }
  return plan;
}

const matrix = (xf: { s: number; tx: number; ty: number }) => `matrix(${xf.s.toFixed(5)}, 0, 0, ${xf.s.toFixed(5)}, ${xf.tx.toFixed(2)}, ${xf.ty.toFixed(2)})`;

/** Returns whether the filmed panel is on screen. */
function applyFactory(intro: IntroFrame, t: number, dcDark: number): boolean {
  // The footage follows the scroll; before and after its window it rests on its first and last
  // usable frame, decoded and ready for either direction.
  scrubTo(intro.assemblyFrame);
  const asm = scrubState();
  const wanted = intro.layers.assembly.visible;
  // Never reveal the footage before it has a decoded frame. If it only becomes ready while it is
  // already needed, it fades in over the loop, which stays in place meanwhile (no blank frame).
  let ready = 0;
  if (asm.ready && !asm.failed) {
    ready = clamp((performance.now() - asm.readyAt) / READY_FADE_MS);
    if (ready < 1 && wanted) requestRender();
  }
  const asmOpacity = intro.layers.assembly.opacity * ready;
  const covered = t >= INTRO_RANGES.revealAssembly[1] && ready >= 1;
  const showLoop = !covered;

  const { loop, assembly } = overlay.factoryLayers;
  if (loop) {
    css(loop, 'display', showLoop ? 'block' : 'none');
    if (showLoop) css(loop, 'transform', matrix(intro.layers.loop.xf));
  }
  if (assembly) {
    // Kept composited (opacity 0) while the factory is shown, so its current frame is on screen
    // the moment it is revealed.
    css(assembly, 'transform', matrix(intro.layers.assembly.xf));
    css(assembly, 'opacity', asmOpacity.toFixed(3));
    const mask = asmOpacity > 0 ? intro.layers.assembly.mask : 'none';
    css(assembly, 'mask-image', mask);
    css(assembly, '-webkit-mask-image', mask);
  }

  // Loop playback: through the departure while visible; paused once covered. The hysteresis
  // avoids repeated play/pause calls while the scroll hovers at the boundary.
  if (loopVisible && covered) loopVisible = false;
  else if (!loopVisible && !covered && (t <= LOOP_RESUME_BELOW || ready < 1)) loopVisible = true;
  setLoopVisible(loopVisible);

  css(overlay.factory, 'opacity', intro.factory.toFixed(3));
  css(overlay.factory, 'display', intro.factory < 0.001 ? 'none' : 'block');
  css(overlay.heroScrim, 'opacity', intro.heroCopy.toFixed(3));
  css(overlay.topScrim, 'opacity', (intro.navDark * intro.factory).toFixed(3));
  const lift = ui.get().motion ? 28 : 0;
  fade(overlay.introHero, intro.heroCopy, -(1 - intro.heroCopy) * lift);
  fade(overlay.skip, intro.skip);
  // Navigation and footer contrast over the footage (white → existing petrol-on-ivory), and again
  // light-on-dark over the data-center scene.
  const dark = Math.max(intro.navDark, dcDark).toFixed(3);
  const dim = intro.navDim.toFixed(3);
  css(overlay.header, '--on-dark', dark);
  css(overlay.header, '--nav-dim', dim);
  css(overlay.stageFooter, '--on-dark', dark);
  css(overlay.stageFooter, '--nav-dim', dim);
  return ready > 0;
}

function applyStory(p: number, sample: StorySample, intro: IntroFrame, introT: number, field: FieldSample, dc: DcSample) {
  const gate = introT >= 1 ? 1 : intro.overview;
  const lift = ui.get().motion ? 22 : 0;
  fade(overlay.hero, sample.heroText * gate, -(1 - sample.heroText) * lift + (1 - gate) * lift);
  fade(overlay.module, sample.moduleText, (1 - sample.moduleText) * lift);
  fade(overlay.controls, sample.controls, 0);
  // Power generation: text near the bottom once the installation's scale is established; it
  // leaves as the data-center section begins.
  const fieldText = field.text * dc.fieldText;
  fade(overlay.field, fieldText, (1 - fieldText) * lift);
  css(overlay.fieldScrim, 'opacity', fieldText.toFixed(3));
  // Data centers: the dark treatment of the stage, then the copy as the camera settles.
  css(overlay.dcBackdrop, 'opacity', dc.dark.toFixed(3));
  setScene(dc.dark > 0.5 ? 'dark' : 'light');
  fade(overlay.dc, dc.text, (1 - dc.text) * lift);
  css(overlay.dcScrim, 'opacity', dc.text.toFixed(3));
  // The footer cue invites scrolling at the opening and again when the overview settles.
  fade(overlay.cue, Math.max(intro.cue, sample.cue * gate));
  fade(overlay.anatomy, sample.anatomy);
  // Before the 3D chunk runs, the loading posters stand in for the model — but only once the
  // factory has faded (they sit above it in the stage).
  if (!overlay.sceneActive) {
    const v = 1 - intro.factory;
    css(overlay.posterHero, 'opacity', (v * (1 - sample.moduleText) * (1 - field.poster)).toFixed(3));
    css(overlay.posterModule, 'opacity', (v * sample.moduleText).toFixed(3));
    css(overlay.posterField, 'opacity', (v * field.poster * (1 - dc.band)).toFixed(3));
    css(overlay.posterDc, 'opacity', (v * dc.band).toFixed(3));
  }
  const chapter = introT < 1 && gate < 0.5 ? 'intro' : dc.t > 0.035 ? 'datacenter' : field.t > 0.02 ? 'field' : p < STORY.chapterBoundary ? 'overview' : 'module';
  const closing = p >= STORY.closingFrom || field.t > 0;
  const state = ui.get();
  if (chapter !== state.chapter || closing !== state.closing) ui.set({ chapter, closing });
}

/** Applies the journey at progress j (0–1) and returns the derived frame for the scene. */
export function applyJourney(j: number): JourneyFrame {
  const layout = journeyLayout(ui.get().tier);
  const introT = introOf(j, layout);
  const storyP = storyOf(j, layout);
  const fieldT = fieldOf(j, layout);
  const dcT = dcOf(j, layout);
  const intro = sampleIntro(currentPlan(), introT);
  const sample = sampleStory(storyP);
  const field = sampleField(fieldT);
  const dc = sampleDc(dcT);
  const photoPanel = applyFactory(intro, introT, dc.dark);
  applyStory(storyP, sample, intro, introT, field, dc);
  return { intro, introT, storyP, sample, share: layout.introShare, layout, fieldT, field, dcT, dc, photoPanel };
}
