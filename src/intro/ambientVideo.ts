import { ui, type VideoState } from '../state/store';

/**
 * Ambient opening loop. Plays (muted, inline) only while its layer is visible — through the
 * departure, until the assembly footage covers it — and while the tab is visible, the element is
 * on screen and motion is enabled (prefers-reduced-motion keeps it on its poster).
 *
 * Once covered it is paused where it is: no seek, no reset. Scrolling back uncovers that same
 * frame and playback resumes from it. play()/pause() calls are idempotent and the visibility
 * signal has hysteresis (journey driver), so scroll reversals near the boundary cannot cause
 * repeated calls. If autoplay is refused, the matching poster stays.
 */

let video: HTMLVideoElement | null = null;
let loopVisible = true;
let inView = true;
let pending: Promise<void> | null = null;
let io: IntersectionObserver | null = null;

function setState(videoState: VideoState) {
  if (ui.get().videoState !== videoState) ui.set({ videoState });
}

function shouldPlay() {
  const state = ui.get().videoState;
  // A refused autoplay is not retried (no retry loop): the poster stays.
  return Boolean(video) && loopVisible && inView && !document.hidden && ui.get().motion && state !== 'error' && state !== 'blocked';
}

function update() {
  if (!video) return;
  if (shouldPlay()) {
    if (video.paused && !pending) {
      const el = video;
      pending = el.play()
        .then(() => { if (video === el) setState('playing'); })
        .catch((e: unknown) => {
          if (video !== el) return; // element replaced (source switch) — not a playback verdict
          setState((e as DOMException)?.name === 'NotAllowedError' ? 'blocked' : 'error');
        })
        .finally(() => {
          pending = null;
          update(); // the view may have changed while play() was pending
        });
    }
  } else if (!video.paused && !pending) {
    video.pause();
  }
  // Not playing by design. Held by the page (covered, off screen, hidden tab) → 'idle', resumes by
  // itself; held for reduced motion → 'paused'.
  const state = ui.get().videoState;
  if (!shouldPlay() && !pending && (state === 'playing' || state === 'loading' || state === 'idle')) {
    setState(ui.get().motion ? 'idle' : 'paused');
  }
}

export function attachAmbientVideo(el: HTMLVideoElement): () => void {
  video = el;
  const onVisibility = () => update();
  const onMotion = ui.subscribe(update);
  const onError = () => setState('error');
  const onPlaying = () => { if (!pending) setState('playing'); };
  document.addEventListener('visibilitychange', onVisibility);
  el.addEventListener('error', onError);
  el.addEventListener('playing', onPlaying);
  io = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting && entry.intersectionRatio > 0.02; update(); }, { threshold: [0, 0.02, 0.5] });
  io.observe(el);
  update();
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    el.removeEventListener('error', onError);
    el.removeEventListener('playing', onPlaying);
    onMotion();
    io?.disconnect();
    io = null;
    el.pause();
    if (video === el) video = null;
  };
}

/** Called by the journey driver every frame with whether the loop layer is visible (hysteresis applied there). */
export function setLoopVisible(visible: boolean) {
  if (visible === loopVisible) return;
  loopVisible = visible;
  update();
}
