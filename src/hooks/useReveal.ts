import { useEffect, type RefObject } from 'react';

/**
 * Restrained entrance for the lower-page sections: elements marked `data-reveal` inside `root`
 * fade and rise a little the first time they scroll into view. Only transform and opacity change
 * (no layout shift). With reduced motion — or before this runs, or without IntersectionObserver —
 * everything is simply visible (the hidden state exists only under html[data-motion='on']).
 * Elements in hidden tab panels reveal when their panel is shown.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const items = [...el.querySelectorAll<HTMLElement>('[data-reveal]')];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.reveal = 'in';
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    for (const item of items) {
      if (item.dataset.reveal !== 'in') item.dataset.reveal = 'pending';
      io.observe(item);
    }
    return () => io.disconnect();
  }, [root]);
}
