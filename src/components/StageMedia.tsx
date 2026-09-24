import { lazy, Suspense, useEffect, useRef, type RefObject } from 'react';
import { useRevealOnFocus } from '../hooks/useRevealOnFocus';
import { chapterProgress } from '../lib/scroll';
import type { QualityProfile } from '../config/quality';
import { DATACENTER, FALLBACK, FIELD, MODULE } from '../content/story';
import { hasMedia, MEDIA, mediaUrl } from '../lib/media';
import { overlay } from '../state/overlay';
import { useUI } from '../state/store';
import { CanvasBoundary } from './CanvasBoundary';
import { MotionStudyToggle } from './MotionStudy';

const StoryCanvas = lazy(() => import('../three/StoryCanvas'));

function Poster({ name, mobileName, register, hidden = false }: { name: string; mobileName: string; register: (el: HTMLElement | null) => void; hidden?: boolean }) {
  if (!hasMedia(name)) return null;
  return (
    <picture className="poster" ref={register} style={hidden ? { opacity: 0 } : undefined}>
      {hasMedia(mobileName) && <source media="(max-width: 760px)" srcSet={mediaUrl(mobileName)} type="image/webp" />}
      <img src={mediaUrl(name)} alt="" decoding="async" fetchPriority={name === MEDIA.heroPoster ? 'high' : 'low'} />
    </picture>
  );
}

function StatusNote() {
  const status = useUI((s) => s.status);
  const progress = useUI((s) => s.loadProgress);
  const chapter = useUI((s) => s.chapter);
  const fieldStatus = useUI((s) => s.fieldStatus);
  const dcStatus = useUI((s) => s.dcStatus);
  // The factory intro is the visual during loading; the note only matters once the 3D view is due.
  if (chapter === 'intro') return null;
  if (status === 'ready' && chapter === 'datacenter') {
    // Data centers load after the field; meanwhile (or on failure) the copy and link still work.
    if (dcStatus === 'ready') return null;
    const failed = dcStatus === 'error';
    return (
      <div className={failed ? 'stage-status stage-status--field stage-status--dark stage-status--note' : 'stage-status stage-status--field stage-status--dark'} role="status">
        <span className="stage-status__text">{failed ? FALLBACK.dcError : FALLBACK.dcLoading}</span>
      </div>
    );
  }
  if (status === 'ready') {
    // Power generation loads its own assets after the module; mention them only where they are due.
    // Meanwhile (or if they fail) the module stays in view and the section text works as usual.
    if (chapter !== 'field' || fieldStatus === 'ready') return null;
    const failed = fieldStatus === 'error';
    return (
      <div className={failed ? 'stage-status stage-status--field stage-status--note' : 'stage-status stage-status--field'} role="status">
        <span className="stage-status__text">{failed ? FALLBACK.fieldError : FALLBACK.fieldLoading}</span>
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className="stage-status" role="status">
        <span className="stage-status__bar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} /></span>
        <span className="stage-status__text">Loading 3D view{progress > 0.02 ? ` · ${Math.round(progress * 100)}%` : ''}</span>
      </div>
    );
  }
  return (
    <div className="stage-status stage-status--note" role="status">
      <span className="stage-status__text">{status === 'context-lost' ? FALLBACK.contextLost : FALLBACK.modelError}</span>
    </div>
  );
}

/**
 * The installation still is a full-screen image: fetched only when the 3D view is unavailable near
 * its section, and mounted transparent (the scroll then sets its opacity).
 */
function FieldPoster() {
  const due = useUI((s) => s.status !== 'ready' && (s.chapter === 'module' || s.chapter === 'field' || s.chapter === 'datacenter'));
  if (!due) return null;
  return <Poster name={MEDIA.fieldPoster} mobileName={MEDIA.fieldPosterMobile} hidden register={(el) => { overlay.posterField = el; }} />;
}

/** The data-center still, on the same terms as the installation still. */
function DcPoster() {
  const due = useUI((s) => s.status !== 'ready' && (s.chapter === 'field' || s.chapter === 'datacenter'));
  if (!due) return null;
  return <Poster name={MEDIA.dcPoster} mobileName={MEDIA.dcPosterMobile} hidden register={(el) => { overlay.posterDc = el; }} />;
}

/** Keeps the stage's accessible description in step with the chapter (without re-rendering the stage). */
function StageLabel({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const chapter = useUI((s) => (s.chapter === 'field' || s.chapter === 'datacenter' ? s.chapter : 'story'));
  useEffect(() => {
    target.current?.setAttribute('aria-label', chapter === 'field' ? FIELD.stageLabel : chapter === 'datacenter' ? DATACENTER.stageLabel : FALLBACK.stageLabel);
  }, [chapter, target]);
  return null;
}

/** Posters (decorative duplicates here) and the canvas share one labelled image region. */
export function StageMedia({ quality }: { quality: QualityProfile }) {
  const media = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className="stage-media" role="img" aria-label={FALLBACK.stageLabel} ref={media}>
        <Poster name={MEDIA.heroPoster} mobileName={MEDIA.heroPosterMobile} register={(el) => { overlay.posterHero = el; }} />
        <Poster name={MEDIA.modulePoster} mobileName={MEDIA.modulePosterMobile} register={(el) => { overlay.posterModule = el; }} />
        <FieldPoster />
        <DcPoster />
        <div className="canvas-wrap" ref={(el) => { overlay.canvasWrap = el; }} style={{ opacity: 0 }}>
          <CanvasBoundary>
            <Suspense fallback={null}>
              <StoryCanvas quality={quality} />
            </Suspense>
          </CanvasBoundary>
        </div>
      </div>
      <StageLabel target={media} />
      <StatusNote />
    </>
  );
}

export function Leader() {
  return (
    <svg className="leader" aria-hidden="true" focusable="false">
      <path ref={(el) => { overlay.leader = el; }} />
      <circle r="3.5" ref={(el) => { overlay.leaderDot = el; }} />
    </svg>
  );
}

const atModule = () => chapterProgress('module');

export function AnatomyLabel() {
  const ref = useRef<HTMLDivElement>(null);
  useRevealOnFocus(ref, atModule, true);
  return (
    <div className="anatomy" style={{ pointerEvents: 'none' }} ref={(el) => { ref.current = el; overlay.anatomy = el; }}>
      <p className="anatomy__label"><span className="anatomy__rule" aria-hidden="true" />{MODULE.anatomyLabel}</p>
      <p className="anatomy__note">{MODULE.anatomyNote}</p>
      <MotionStudyToggle />
    </div>
  );
}
