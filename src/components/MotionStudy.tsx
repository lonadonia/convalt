import { useEffect, useId, useRef, useState } from 'react';
import { hasMedia, MEDIA, mediaUrl } from '../lib/media';
import { useUI } from '../state/store';

/** First supplied study video, if any (detected at build time — nothing is requested otherwise). */
export function studyVideo(): string | undefined {
  return [...MEDIA.layersStudy, ...MEDIA.lightStudy].find(hasMedia);
}

const NOTE = 'Conceptual visualization — not footage of Convalt facilities.';

/**
 * Optional "Motion study" for scene 02 (rendered only when a study video exists in public/media).
 * Muted, inline, poster first, explicit play/pause; never autoplays. Playback pauses when the
 * panel closes, when the story leaves the module chapter (so video and the 3D transitions never
 * run together), when scrolled out of view, and when the tab is hidden.
 */
function StudyVideo({ name, active }: { name: string; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const pause = () => video.pause();
    const io = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) pause(); }, { threshold: 0.2 });
    io.observe(video);
    const onVisibility = () => { if (document.hidden) pause(); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    document.addEventListener('visibilitychange', onVisibility);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      pause();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [name]);

  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  const poster = hasMedia(MEDIA.modulePoster) ? mediaUrl(MEDIA.modulePoster) : undefined;
  return (
    <figure className="motion-study">
      <video ref={videoRef} src={mediaUrl(name)} poster={poster} muted playsInline loop preload="none" aria-label="Motion study of the module layers" />
      <figcaption>
        <button
          type="button"
          className="btn btn--text btn--compact"
          aria-pressed={playing}
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) void v.play().catch(() => undefined);
            else v.pause();
          }}
        >
          {playing ? 'Pause motion study' : 'Play motion study'}
        </button>
        <span className="motion-study__note">{NOTE}</span>
      </figcaption>
    </figure>
  );
}

/** Static (document) layout: the study sits inline with the module chapter. */
export function MotionStudy() {
  const name = studyVideo();
  if (!name) return null;
  return <StudyVideo name={name} active />;
}

/** Pinned scene: a small disclosure next to the anatomy caption; the panel opens on demand. */
export function MotionStudyToggle() {
  const name = studyVideo();
  const [open, setOpen] = useState(false);
  const chapter = useUI((s) => s.chapter);
  const closing = useUI((s) => s.closing);
  const panelId = useId();
  const inChapter = chapter === 'module' && !closing;

  useEffect(() => {
    if (!inChapter) setOpen(false);
  }, [inChapter]);

  if (!name) return null;
  return (
    <div className="motion-study-toggle">
      <button type="button" className="btn btn--text btn--compact" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        {open ? 'Close motion study' : 'Motion study'}
      </button>
      <div id={panelId} className="motion-study-panel" hidden={!open}>
        {open && <StudyVideo name={name} active={open && inChapter} />}
      </div>
    </div>
  );
}
