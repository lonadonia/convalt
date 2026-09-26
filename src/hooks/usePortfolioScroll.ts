import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { useUI } from '../state/store';

/** How long (svh) each image holds alone before the next covers it — also set in CSS (--pf-hold). */
const HOLD_SVH = 26;
/** The scroll layout needs room for text beside a large image: wide screens, motion allowed. */
const SCROLL_MIN_WIDTH = 900;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The portfolio's scroll-driven presentation (wide screens with motion).
 *
 * Positions come from CSS alone — each project's image is sticky and the next one slides up over it
 * — so wheel, trackpad, touch, keyboard and reverse scrolling all behave natively, with no snapping
 * and nothing to fall out of step. Timing per project (CSS): the image holds alone for --pf-hold,
 * then the next image covers it over exactly its own height (--pf-h, measured here). This adds the
 * finish, per frame while the section is on screen:
 *  - arrival: the incoming image settles (a slight scale-down and upward drift inside its frame);
 *  - cover: the image being covered recedes (scales back, dims) and is hidden once fully covered;
 *  - focus: once the next image covers more than half of the current one it becomes the project in
 *    focus — its text is emphasized, and the index rail and progress follow.
 * Returns the layout mode and the active project index. Phones, reduced motion and any failure keep
 * the plain stacked list.
 */
export function usePortfolioScroll(root: RefObject<HTMLElement | null>, count: number) {
  const motion = useUI((s) => s.motion);
  const [mode, setMode] = useState<'list' | 'scroll'>('list');
  const [active, setActive] = useState(0);

  // Layout mode before paint (the section is far below the fold, so the change is never seen).
  useLayoutEffect(() => {
    const decide = () => setMode(motion && window.innerWidth >= SCROLL_MIN_WIDTH ? 'scroll' : 'list');
    decide();
    window.addEventListener('resize', decide);
    return () => window.removeEventListener('resize', decide);
  }, [motion]);

  // Image height drives the timing (CSS --pf-h), measured before paint and on every resize.
  useLayoutEffect(() => {
    const section = root.current;
    const first = section?.querySelector<HTMLElement>('.pf-frame');
    if (!section || !first || mode !== 'scroll') return;
    const measure = () => section.style.setProperty('--pf-h', `${Math.round(first.getBoundingClientRect().height)}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(first);
    return () => {
      ro.disconnect();
      section.style.removeProperty('--pf-h');
    };
  }, [root, mode]);

  useEffect(() => {
    const section = root.current;
    if (!section || mode !== 'scroll') return;
    const media = [...section.querySelectorAll<HTMLElement>('.pf-item__media')];
    const frames = media.map((m) => m.querySelector<HTMLElement>('.pf-frame'));
    if (media.length !== count) return;
    let raf = 0;
    let visible = false;
    let last = -1;
    const frame = () => {
      raf = 0;
      const vh = window.innerHeight;
      const h = Math.max(1, frames[0]?.getBoundingClientRect().height ?? vh / 2);
      const tops = media.map((m) => m.getBoundingClientRect().top);
      let current = 0;
      for (let k = 0; k < count; k++) {
        // Arrival: 0 while its sticky wrapper is below the screen, 1 once stuck at the top.
        const arrive = clamp01(1 - tops[k] / vh);
        // Cover: how much of this image the next one hides (it rises over exactly one image height).
        const cover = k + 1 < count ? clamp01(1 - tops[k + 1] / h) : 0;
        const f = frames[k];
        if (f) {
          f.style.setProperty('--arrive', arrive.toFixed(4));
          f.style.setProperty('--cover', cover.toFixed(4));
          // Fully covered: hidden, so it never shows while its own sticky range ends underneath.
          f.style.visibility = cover >= 0.999 ? 'hidden' : '';
        }
        if (k > 0 && clamp01(1 - tops[k] / h) >= 0.5) current = k;
      }
      const partial = current + 1 < count ? clamp01(1 - tops[current + 1] / h) : 1;
      section.style.setProperty('--pf-progress', ((current + partial) / count).toFixed(4));
      if (current !== last) {
        last = current;
        setActive(current);
      }
      if (visible) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(section);
    // Keyboard: a focused project link brings its project into focus (its hold, text centred).
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const item = target.closest<HTMLElement>('.pf-item');
      if (!item || !target.matches(':focus-visible')) return; // keyboard focus only, not clicks
      const want = focusTop(item);
      if (Math.abs(window.scrollY - want) > 4) window.scrollTo({ top: want, behavior: 'instant' });
    };
    section.addEventListener('focusin', onFocus);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      section.removeEventListener('focusin', onFocus);
      for (const f of frames) {
        if (!f) continue;
        f.style.removeProperty('--arrive');
        f.style.removeProperty('--cover');
        f.style.visibility = '';
      }
    };
  }, [root, mode, count]);

  /** Scroll position at which a project is in focus: the middle of its image's hold. */
  const focusTop = (item: HTMLElement) => item.getBoundingClientRect().top + window.scrollY + (HOLD_SVH / 200) * window.innerHeight;

  /** Scrolls so project k is in focus (index rail). */
  const goTo = (k: number) => {
    const item = root.current?.querySelectorAll<HTMLElement>('.pf-item')[k];
    if (!item) return;
    const top = mode === 'scroll' ? focusTop(item) : item.getBoundingClientRect().top + window.scrollY - 24;
    window.scrollTo({ top, behavior: motion ? 'smooth' : 'instant' });
  };

  return { mode, active: mode === 'scroll' ? active : -1, goTo };
}
