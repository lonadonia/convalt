import { useEffect } from 'react';
import { resolveMotion } from '../lib/motionPreference';
import { story, ui } from '../state/store';

/**
 * Keeps the motion preference current (the store starts with it already resolved — see
 * lib/motionPreference): follows changes of prefers-reduced-motion while the page is open.
 */
export function useMotionPreference() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      ui.set({ motion: resolveMotion() });
      story.invalidate();
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
}
