import { useEffect, type RefObject } from 'react';
import { scrollToProgress } from '../lib/scroll';

/**
 * Pinned blocks fade in and out with scroll. When keyboard focus lands inside a block that is
 * currently faded out, scroll the journey to where that block is visible so focus is never hidden.
 * `progress` returns the journey progress (0–1) at which the block is fully visible.
 */
export function useRevealOnFocus(ref: RefObject<HTMLElement | null>, progress: () => number, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const onFocusIn = () => {
      const style = el.style;
      const hidden = style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') < 0.6;
      if (hidden) scrollToProgress(progress());
    };
    el.addEventListener('focusin', onFocusIn);
    return () => el.removeEventListener('focusin', onFocusIn);
  }, [ref, progress, enabled]);
}
