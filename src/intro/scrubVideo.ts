import { story } from '../state/store';

/**
 * Scroll-controlled video (the assembly footage). It is never played: the frame on screen is
 * chosen by seeking, driven by the one journey progress.
 *
 *  - Coalesced: at most one seek is in flight; when it completes ('seeked') the element moves to
 *    the *latest* desired frame. Fast scrolling therefore lands on the right frame without working
 *    through a queue of outdated seeks, and currentTime is never written while a seek is pending.
 *  - Frame-quantized: targets are frame centres ((i + 0.5) / fps) — robust against rounding at
 *    frame boundaries and valid up to the last displayable frame. A seek is issued only when the
 *    desired frame differs from the one requested, so imperceptible changes cost nothing.
 *  - Always precise (currentTime), never keyframe-approximate (fastSeek); the delivery encode
 *    has a keyframe every 6 frames and no B-frames, so a precise seek decodes ≤ 5 predecessors.
 *  - The element keeps showing its current decoded frame while the next one is prepared.
 *  - Readiness = a decoded frame at a requested position (readyState ≥ HAVE_CURRENT_DATA after
 *    'seeked'); events work whether or not the layer is on screen.
 */
const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;

type Diagnostics = {
  desired: number;
  requested: number;
  presented: number;
  seeks: number;
  ready: boolean;
  failed: boolean;
  /** Last seek → 'seeked' durations (ms), most recent last. */
  seekMs: number[];
};

let el: HTMLVideoElement | null = null;
let fps = 24;
let frames = 1;
let desired = 0;
let requested = -1;
let seekStart = 0;
let ready = false;
let failed = false;
let readyAt = -1;
let generation = 0;

const perfHost = window as unknown as { __convaltPerf?: Record<string, unknown> };
const diag: Diagnostics = ((perfHost.__convaltPerf ??= {}).scrub = {
  desired: 0, requested: -1, presented: -1, seeks: 0, ready: false, failed: false, seekMs: [],
}) as Diagnostics;

function pump() {
  if (!el || failed || el.readyState < HAVE_METADATA) return;
  if (el.seeking) return; // one seek in flight; 'seeked' pumps again
  if (desired === requested) return;
  requested = desired;
  seekStart = performance.now();
  diag.requested = requested;
  diag.seeks++;
  el.currentTime = (desired + 0.5) / fps;
}

function setReady(value: boolean) {
  if (ready === value) return;
  ready = value;
  diag.ready = value;
  if (value && readyAt < 0) readyAt = performance.now();
  story.invalidate();
}

/** Attaches the scrubbed element. Returns a detach function. */
export function attachScrubVideo(video: HTMLVideoElement, opts: { fps: number; frames: number }): () => void {
  const gen = ++generation;
  el = video;
  fps = opts.fps;
  frames = opts.frames;
  requested = -1;
  ready = false;
  failed = false;
  readyAt = -1;
  Object.assign(diag, { requested: -1, presented: -1, ready: false, failed: false });

  const onMeta = () => pump();
  const onSeeked = () => {
    diag.seekMs.push(+(performance.now() - seekStart).toFixed(1));
    if (diag.seekMs.length > 40) diag.seekMs.shift();
    if (video.readyState >= HAVE_CURRENT_DATA) setReady(true);
    if (!('requestVideoFrameCallback' in video)) diag.presented = requested;
    pump();
  };
  const onError = () => {
    failed = true;
    diag.failed = true;
    setReady(false);
    story.invalidate();
  };
  video.addEventListener('loadedmetadata', onMeta);
  video.addEventListener('loadeddata', onMeta);
  video.addEventListener('seeked', onSeeked);
  video.addEventListener('error', onError);
  // Presented-frame tracking where supported (diagnostics; the scrub never depends on it).
  const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number }).requestVideoFrameCallback;
  if (rvfc) {
    const onFrame = (_: number, meta: { mediaTime: number }) => {
      if (gen !== generation) return;
      diag.presented = Math.round(meta.mediaTime * fps);
      rvfc.call(video, onFrame);
    };
    rvfc.call(video, onFrame);
  }
  if (video.error) onError();
  pump();
  return () => {
    video.removeEventListener('loadedmetadata', onMeta);
    video.removeEventListener('loadeddata', onMeta);
    video.removeEventListener('seeked', onSeeked);
    video.removeEventListener('error', onError);
    if (el === video) {
      el = null;
      ready = false;
      diag.ready = false;
    }
  };
}

/** Desired frame for the current journey position (fractional frames are rounded). */
export function scrubTo(frame: number) {
  const f = Math.min(frames - 1, Math.max(0, Math.round(frame)));
  if (f === desired && requested === desired) return;
  desired = f;
  diag.desired = f;
  pump();
}

export function scrubState() {
  return { ready, failed, readyAt };
}
