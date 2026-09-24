import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { STORY } from '../config/choreography';
import { JOURNEY, JUMP, dcOf, journeyLayout, journeyOfDc, journeyOfField, journeyOfStory, fieldOf, storyOf, type JourneyLayout } from '../config/journey';
import { clamp } from './math';
import { story, ui } from '../state/store';

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

let trigger: ScrollTrigger | null = null;

/**
 * The reader's place in tier-independent terms: intro progress (factory sequence), story progress
 * (overview → module), field progress (power generation) or data-center progress. The section's scroll length is in vh
 * and its split depends on the tier, so pixels and even journey values change with the viewport —
 * places do not. They are kept across resizes, rotations, reloads and history navigation.
 */
export type Place = { intro: number } | { story: number } | { field: number } | { dc: number } | { after: number };

const layout = () => journeyLayout(ui.get().tier);
export const placeOf = (j: number, L: JourneyLayout = layout()): Place =>
  j < L.introShare ? { intro: j / L.introShare } : j < L.storyEnd ? { story: storyOf(j, L) } : j < L.fieldEnd ? { field: fieldOf(j, L) } : { dc: dcOf(j, L) };
export const journeyOfPlace = (p: Place, L: JourneyLayout = layout()) =>
  'intro' in p ? clamp(p.intro) * L.introShare : 'story' in p ? journeyOfStory(p.story, L) : 'field' in p ? journeyOfField(p.field, L) : 'dc' in p ? journeyOfDc(p.dc, L) : 1;
const isPlace = (v: unknown): v is Place =>
  typeof v === 'object' && v !== null &&
  ['intro', 'story', 'field', 'dc', 'after'].some((k) => typeof (v as Record<string, unknown>)[k] === 'number');

/** The reader's place, including positions below the pinned section (pixels past its end). */
function currentPlace(): Place {
  if (trigger && window.scrollY > trigger.end + 1) return { after: Math.round(window.scrollY - trigger.end) };
  return placeOf(story.target);
}

const PLACE_KEY = 'convalt:journey-place';

function savePlace() {
  try {
    sessionStorage.setItem(PLACE_KEY, JSON.stringify(currentPlace()));
  } catch {
    /* storage unavailable: a reload then starts at the top */
  }
}

function savedPlace(): Place | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(PLACE_KEY) ?? 'null');
    return isPlace(v) ? v : null;
  } catch {
    return null;
  }
}

/** Scroll position (px) that corresponds to a journey progress value. */
export function scrollTopFor(progress: number): number | null {
  if (!trigger) return null;
  return trigger.start + progress * (trigger.end - trigger.start);
}

export function scrollToProgress(progress: number, opts: { smooth?: boolean } = {}) {
  const top = scrollTopFor(progress);
  if (top === null) return;
  const smooth = opts.smooth ?? ui.get().motion;
  window.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
}

function scrollToPlace(place: Place) {
  const j = journeyOfPlace(place);
  const top = 'after' in place ? (trigger ? trigger.end + place.after : null) : scrollTopFor(j);
  if (top === null) return;
  if (Math.abs(window.scrollY - top) > 0.5) window.scrollTo({ top, behavior: 'instant' });
  story.target = j;
}

/**
 * Binds the journey section's scroll range to story.target (0–1). `keep` re-establishes a place
 * after the section is rebuilt (tier change). Returns a cleanup function.
 */
export function bindStoryScroll(section: HTMLElement, keep: Place | null = null): () => void {
  trigger?.kill();
  // The page restores the reader's place itself (below); the browser's pixel restoration would
  // land elsewhere whenever the viewport differs from the one the position was saved in.
  ScrollTrigger.clearScrollMemory('manual');
  // Viewport changes: between a resize and ScrollTrigger's (debounced) refresh the scroll offset
  // maps to stale positions, and the browser may clamp it. The place at the start of the resize is
  // frozen, scroll updates are ignored until the refresh, then the place is re-established.
  let frozen: Place | null = null;
  let pending: Place | null = null;
  let thaw = 0;
  const restore = (place: Place | null) => {
    window.clearTimeout(thaw);
    frozen = null;
    if (place) scrollToPlace(place);
    story.invalidate();
  };
  const onResize = () => {
    frozen ??= currentPlace();
    window.clearTimeout(thaw);
    thaw = window.setTimeout(() => restore(frozen), 700); // in case no refresh follows
  };

  trigger = ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate(self) {
      if (frozen) return;
      story.target = self.progress;
      story.invalidate();
    },
    onRefresh(self) {
      if (frozen) return;
      story.target = self.progress;
      story.invalidate();
    },
  });
  story.target = trigger.progress;
  if (keep) scrollToPlace(keep);

  const onRefreshInit = () => { pending = frozen ?? currentPlace(); };
  const onRefreshed = () => {
    const place = pending;
    pending = null;
    restore(place);
  };
  window.addEventListener('resize', onResize);
  ScrollTrigger.addEventListener('refreshInit', onRefreshInit);
  ScrollTrigger.addEventListener('refresh', onRefreshed);

  const onPageShow = () => ScrollTrigger.refresh();
  // History entries carry their place (see goToChapter); entries without one land on their hash.
  const onPopState = (e: PopStateEvent) => {
    const state: unknown = e.state;
    const place = typeof state === 'object' && state !== null ? (state as { place?: unknown }).place : null;
    if (isPlace(place)) scrollToPlace(place);
    else {
      const hash = location.hash.slice(1);
      if (isChapterHash(hash)) goToChapter(hash, { push: false, instant: true });
    }
    story.invalidate();
  };
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', savePlace);
  window.addEventListener('popstate', onPopState);
  return () => {
    window.clearTimeout(thaw);
    window.removeEventListener('resize', onResize);
    ScrollTrigger.removeEventListener('refreshInit', onRefreshInit);
    ScrollTrigger.removeEventListener('refresh', onRefreshed);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', savePlace);
    window.removeEventListener('popstate', onPopState);
    trigger?.kill();
    trigger = null;
  };
}

/**
 * Where the page opens: a reload or history traversal returns to the saved place; a link with
 * #overview / #module lands on that chapter; #portfolio / #company land on those sections below
 * the journey (its end state, dark); anything else starts at the opening.
 */
export function landInitialPlace() {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const returning = nav?.type === 'reload' || nav?.type === 'back_forward';
  const saved = returning ? savedPlace() : null;
  const hash = location.hash.slice(1);
  if (saved) {
    scrollToPlace(saved);
    // Below the journey the page's height depends on its text: the web font arriving after this
    // first restore makes it taller, and a place near the bottom was clamped. Restore once more
    // when fonts are ready, unless the visitor has scrolled in the meantime.
    if ('after' in saved) {
      const y = window.scrollY;
      document.fonts?.ready.then(() => { if (Math.abs(window.scrollY - y) <= 1) scrollToPlace(saved); }).catch(() => undefined);
    }
  } else if (isChapterHash(hash)) goToChapter(hash, { push: false, focus: false, instant: true });
  else if (LOWER_SECTIONS.includes(hash) && trigger && document.getElementById(hash)) {
    window.scrollTo({ top: document.getElementById(hash)!.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    story.target = 1;
  } else scrollToPlace({ intro: 0 });
  story.progress = story.target;
}

/** Sections in ordinary flow below the pinned journey (project portfolio, company). */
const LOWER_SECTIONS = ['portfolio', 'company'];

export type ChapterId = 'intro' | 'overview' | 'module' | 'field' | 'datacenter';
/** In-page chapters with anchors (#overview, #module, #power-generation, #data-centers). */
export type ChapterLink = 'overview' | 'module' | 'power-generation' | 'data-centers';
const isChapterHash = (h: string): h is ChapterLink => h === 'overview' || h === 'module' || h === 'power-generation' || h === 'data-centers';

/** Journey progress for each chapter's resting state (depends on the layout tier). */
export function chapterProgress(id: ChapterId): number {
  const L = layout();
  if (id === 'intro') return 0;
  if (id === 'overview') return journeyOfStory(JOURNEY.overviewTarget, L);
  if (id === 'module') return journeyOfStory(STORY.exploreTarget, L);
  if (id === 'field') return journeyOfField(JOURNEY.fieldTarget, L);
  return journeyOfDc(JOURNEY.dcTarget, L);
}

const CHAPTER: Record<ChapterLink, ChapterId> = { overview: 'overview', module: 'module', 'power-generation': 'field', 'data-centers': 'datacenter' };
const HEADING: Record<ChapterLink, string> = { overview: 'hero-title', module: 'module-title', 'power-generation': 'field-title', 'data-centers': 'dc-title' };

/** Moves focus to an element once its pinned block has faded in (a hidden element cannot take focus). */
function focusWhenShown(id: string) {
  const origin = document.activeElement;
  let frames = 0;
  const attempt = () => {
    const el = document.getElementById(id);
    const current = document.activeElement;
    // Stop if the visitor has moved focus somewhere else in the meantime.
    if (!el || (current !== origin && current !== document.body && current !== el)) return;
    el.focus({ preventScroll: true });
    if (document.activeElement === el || ++frames > 120) return;
    requestAnimationFrame(attempt);
  };
  attempt();
}

/**
 * In-page chapter navigation: scrolls, records history (each entry carries its place, so Back
 * returns exactly) and moves focus to the heading. `instant` jumps without native smooth
 * scrolling; a jump across the intro then cuts through a brief stage fade (config/journey JUMP).
 * Links that would cause that cut always jump instantly: a native smooth scroll would move the
 * destination while the stage is faded out, and the cut would land in (and then sweep through)
 * whatever scene lies halfway — the ivory module on the way to the dark data centers.
 */
export function goToChapter(id: ChapterLink, opts: { push?: boolean; focus?: boolean; instant?: boolean } = {}) {
  const pinned = Boolean(trigger);
  if (opts.push !== false && location.hash !== `#${id}`) {
    if (pinned) history.replaceState({ ...(history.state ?? {}), place: currentPlace() }, '');
    history.pushState(pinned ? { place: placeOf(chapterProgress(CHAPTER[id])) } : null, '', `#${id}`);
  }
  if (pinned) {
    const to = chapterProgress(CHAPTER[id]);
    const cut = Math.abs(to - story.progress) > JUMP.threshold && Math.min(to, story.progress) < layout().introShare;
    scrollToProgress(to, opts.instant || cut ? { smooth: false } : {});
  }
  else document.getElementById(id)?.scrollIntoView({ behavior: ui.get().motion ? 'smooth' : 'auto', block: 'start' });
  if (opts.focus !== false) focusWhenShown(HEADING[id]);
}
