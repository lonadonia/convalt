import { useEffect, useRef, useState } from 'react';
import { FRAME, INTRO_MEDIA, type Rect } from '../../config/intro';
import { attachAmbientVideo } from '../../intro/ambientVideo';
import { attachScrubVideo } from '../../intro/scrubVideo';
import { overlay } from '../../state/overlay';
import { story, ui, useUI } from '../../state/store';

type LoopSource = { src: string; poster: string; rect: Rect };
type AssemblySource = { src: string; rect: Rect };
const FULL: Rect = [0, 0, 1, 1];

/** The 9:16 crops are used only where they cover everything the frame shows (narrow portrait screens). */
const portrait = () => window.innerWidth / window.innerHeight <= 0.57;
/** 720p on small screens or with Save-Data, 1080p elsewhere. The 4K originals are never served. */
function small() {
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  return saveData || Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2) <= 1400;
}

function pickLoop(): LoopSource {
  const m = INTRO_MEDIA.loop;
  if (portrait()) return { src: m.portrait.src, poster: m.portrait.poster, rect: m.portraitRect };
  return { src: small() ? m.landscape.small : m.landscape.src, poster: m.landscape.poster, rect: FULL };
}

function pickAssembly(): AssemblySource {
  const m = INTRO_MEDIA.assembly;
  if (portrait()) return { src: m.portrait.src, rect: m.portraitRect };
  return { src: small() ? m.landscape.small : m.landscape.src, rect: FULL };
}

const rectStyle = (r: Rect) => ({ left: r[0] * FRAME.w, top: r[1] * FRAME.h, width: (r[2] - r[0]) * FRAME.w, height: (r[3] - r[1]) * FRAME.h });

/** Muted is set as a property, a default and an attribute: iOS needs the attribute for inline playback. */
function silence(el: HTMLVideoElement) {
  el.muted = true;
  el.defaultMuted = true;
  el.setAttribute('muted', '');
  el.setAttribute('playsinline', '');
}

/**
 * Factory layers (DOM, beneath the transparent 3D canvas), both in one 1920 × 1080 frame space
 * that the journey driver moves with a scale/translate "camera", masks and opacity:
 *  - loop: the ambient opening video over its own first-frame poster (fallback in place);
 *  - assembly: the scroll-controlled footage (never played; see intro/scrubVideo).
 */
export function FactoryStage() {
  const loopRef = useRef<HTMLVideoElement>(null);
  const asmRef = useRef<HTMLVideoElement>(null);
  const motion = useUI((s) => s.motion);
  const [loop, setLoop] = useState<LoopSource>(pickLoop);
  const [assembly, setAssembly] = useState<AssemblySource>(pickAssembly);
  // Critical media first: the loop and its poster load at once. The footage starts when the page
  // has loaded and is idle, as soon as the visitor scrolls, or at once when the page opens further
  // along the journey. With reduced motion the path goes straight to the overview, so it is only
  // fetched if motion is switched on.
  const [assemblyLoad, setAssemblyLoad] = useState(false);

  useEffect(() => {
    const onResize = () => {
      const l = pickLoop(), a = pickAssembly();
      setLoop((cur) => (cur.src === l.src ? cur : l));
      setAssembly((cur) => (cur.src === a.src ? cur : a));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (assemblyLoad || !motion) return;
    const go = () => setAssemblyLoad(true);
    if (story.target > 0.001) { go(); return; }
    // Safari has no requestIdleCallback.
    const ric = typeof window.requestIdleCallback === 'function';
    let idle = 0;
    const schedule = () => { idle = ric ? window.requestIdleCallback(go, { timeout: 1500 }) : window.setTimeout(go, 500); };
    const onScroll = () => { if (story.target > 0) go(); };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('load', schedule);
      window.removeEventListener('scroll', onScroll);
      if (ric) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [assemblyLoad, motion]);

  useEffect(() => {
    const el = loopRef.current;
    if (!el) return;
    silence(el);
    ui.set({ videoState: 'loading' });
    return attachAmbientVideo(el);
  }, [loop.src]);

  useEffect(() => {
    const el = asmRef.current;
    if (!el || !assemblyLoad) return;
    silence(el);
    return attachScrubVideo(el, { fps: INTRO_MEDIA.assembly.fps, frames: INTRO_MEDIA.assembly.frames });
  }, [assembly.src, assemblyLoad]);

  return (
    <div className="factory" ref={(el) => { overlay.factory = el; }}>
      <div className="factory__layer" data-layer="loop" style={{ width: FRAME.w, height: FRAME.h }} ref={(el) => { if (el) overlay.factoryLayers.loop = el; }}>
        <img className="factory__poster" src={loop.poster} alt="" width={1280} height={720} style={rectStyle(loop.rect)} />
        <video
          key={loop.src}
          ref={loopRef}
          className="factory__video"
          data-ready="false"
          src={loop.src}
          muted
          playsInline
          loop
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          tabIndex={-1}
          style={rectStyle(loop.rect)}
          onLoadedData={(e) => { e.currentTarget.dataset.ready = 'true'; }}
        />
      </div>
      <div className="factory__layer" data-layer="assembly" style={{ width: FRAME.w, height: FRAME.h, opacity: 0 }} ref={(el) => { if (el) overlay.factoryLayers.assembly = el; }}>
        <video
          key={assembly.src}
          ref={asmRef}
          className="factory__video"
          src={assemblyLoad ? assembly.src : undefined}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          tabIndex={-1}
          style={rectStyle(assembly.rect)}
        />
      </div>
      <div className="factory__scrim factory__scrim--top" ref={(el) => { overlay.topScrim = el; }} />
      <div className="factory__scrim factory__scrim--hero" ref={(el) => { overlay.heroScrim = el; }} />
    </div>
  );
}
