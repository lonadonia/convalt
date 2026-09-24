import { useLayoutEffect, useRef } from 'react';

/**
 * Frees GPU resources when a component really unmounts. Disposal is deferred by one task and
 * cancelled if the component mounts again immediately — which is what React StrictMode's
 * development-time remount does — so resources are never freed while still in use.
 */
export function useDisposeOnUnmount(dispose: () => void) {
  const timer = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    window.clearTimeout(timer.current);
    return () => {
      timer.current = window.setTimeout(dispose, 0);
    };
  }, [dispose]);
}
