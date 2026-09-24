import { useSyncExternalStore } from 'react';
import { resolveMotion } from '../lib/motionPreference';

export type LayerId = 'protection' | 'cells' | 'structure';
export type SceneStatus = 'loading' | 'ready' | 'error' | 'context-lost';
export type Tier = 'desktop' | 'mobile';
/**
 * Ambient video: 'idle' = held by the page (off the opening, hidden tab) and resumes by itself;
 * 'paused' = held for reduced motion (its poster shows).
 */
export type VideoState = 'loading' | 'playing' | 'idle' | 'paused' | 'blocked' | 'error';
/** Power-generation scene assets (terrain, field module, textures). */
export type FieldStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * High-frequency values. Mutated in place by the scroll listener and the frame loop; they never
 * trigger React renders. `progress` is the single source of truth for every animated property.
 */
export const story = {
  /** Raw scroll progress over the story section (0–1), written by ScrollTrigger. */
  target: 0,
  /** Smoothed progress used by the scene and the overlay (0–1). */
  progress: 0,
  /** Pointer position in the viewport, -1…1 on both axes (desktop parallax). */
  pointer: { x: 0, y: 0 },
  /** How much pointer parallax the current story position allows (0–1); gates pointer renders. */
  parallaxWeight: 0,
  /** Requests one rendered frame (the canvas renders on demand). Replaced by the canvas. */
  invalidate: () => {},
};

/** Low-frequency UI state shared between React components and the frame loop. */
export type UIState = {
  activeLayer: LayerId | null;
  motion: boolean;
  status: SceneStatus;
  loadProgress: number;
  chapter: 'intro' | 'overview' | 'module' | 'field' | 'datacenter';
  videoState: VideoState;
  fieldStatus: FieldStatus;
  /** Data-center model (scene 04): loads after the field. */
  dcStatus: FieldStatus;
  closing: boolean;
  webgl: boolean;
  tier: Tier;
};

type Listener = () => void;

function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      let changed = false;
      for (const key in patch) {
        if (!Object.is(state[key], patch[key])) { changed = true; break; }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const ui = createStore<UIState>({
  activeLayer: null,
  motion: resolveMotion(),
  status: 'loading',
  loadProgress: 0,
  chapter: 'intro',
  videoState: 'loading',
  fieldStatus: 'idle',
  dcStatus: 'idle',
  closing: false,
  webgl: true,
  tier: 'desktop',
});

export function useUI<S>(selector: (s: UIState) => S): S {
  return useSyncExternalStore(ui.subscribe, () => selector(ui.get()), () => selector(ui.get()));
}
