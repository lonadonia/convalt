import { debug } from './debug';

/**
 * The motion preference: the operating system's prefers-reduced-motion setting (a `?motion=0|1`
 * URL override exists for testing). There is no on-page switch. Resolved synchronously, so the
 * store's initial state (and with it the first render and the opening loop's first play decision)
 * already respects it: resolving it in an effect was too late, because child effects run first
 * and the loop had started playing before reduced motion was known.
 */
export function resolveMotion(): boolean {
  if (typeof window === 'undefined') return true;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return debug.motion ?? !reduce;
}
