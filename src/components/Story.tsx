import { useEffect, useLayoutEffect, useRef } from 'react';
import { STORY } from '../config/choreography';
import { INTRO_MEDIA } from '../config/intro';
import { JOURNEY, journeyLayout, journeyOfDc, journeyOfField, journeyOfStory, type JourneyLayout } from '../config/journey';
import type { QualityProfile } from '../config/quality';
import { DATACENTER, FALLBACK, FIELD, INTRO, MODULE } from '../content/story';
import { hasMedia, MEDIA, mediaUrl } from '../lib/media';
import { applyJourney, setScene } from '../lib/journeyDriver';
import { bindStoryScroll, landInitialPlace, placeOf } from '../lib/scroll';
import { overlay } from '../state/overlay';
import { story, useUI } from '../state/store';
import { DataCenterChapter, FieldChapter, HeroChapter, ModuleChapter } from './Chapters';
import { FactoryStage } from './intro/FactoryStage';
import { IntroControls, IntroHero } from './intro/IntroHero';
import { MotionStudy } from './MotionStudy';
import { ScrollCue } from './ScrollCue';
import { AnatomyLabel, Leader, StageMedia } from './StageMedia';

/**
 * Pinned journey: one tall section whose sticky stage holds the factory layers, the single 3D
 * canvas and the HTML overlay. Scrolling the section produces the one journey progress value
 * (factory intro → overview → module → power generation → data centers). Anchors #overview,
 * #module, #power-generation and #data-centers sit at the scroll offsets of their resting states,
 * so plain links, reloads and history navigation land correctly.
 */
export function PinnedStory({ quality }: { quality: QualityProfile }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const tier = useUI((s) => s.tier);
  const layout = journeyLayout(tier);
  const { heightVh } = layout;
  const scrollVh = heightVh - 100;
  const boundLayout = useRef<JourneyLayout | null>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    // A tier change (rotation, resize across the breakpoint) rebuilds the section with another
    // height and split: keep the reader's place, not the pixel offset.
    const prev = boundLayout.current;
    const keep = prev === null ? null : placeOf(story.target, prev);
    // Until the 3D chunk takes over the frame loop, scroll updates drive the page directly
    // (never replace the scene's own invalidate when the section is rebuilt on a tier change).
    if (!overlay.sceneActive) story.invalidate = () => applyJourney(story.target);
    const unbind = bindStoryScroll(section, keep);
    // The header's track spans the same height, so the header leaves together with the stage.
    document.documentElement.style.setProperty('--journey-h', `${heightVh}vh`);
    boundLayout.current = journeyLayout(tier);
    if (prev === null) landInitialPlace();
    story.progress = story.target;
    applyJourney(story.target);
    story.invalidate();
    return unbind;
  }, [heightVh]);

  return (
    <div className="story" ref={sectionRef} style={{ height: `${heightVh}vh` }}>
      <span id="overview" className="story__anchor" style={{ top: `${journeyOfStory(JOURNEY.overviewTarget, layout) * scrollVh}vh` }} />
      <span id="module" className="story__anchor" style={{ top: `${journeyOfStory(STORY.exploreTarget, layout) * scrollVh}vh` }} />
      <span id="power-generation" className="story__anchor" style={{ top: `${journeyOfField(JOURNEY.fieldTarget, layout) * scrollVh}vh` }} />
      <span id="data-centers" className="story__anchor" style={{ top: `${journeyOfDc(JOURNEY.dcTarget, layout) * scrollVh}vh` }} />
      <div className="stage" ref={(el) => { overlay.stage = el; }}>
        <div className="stage__visual" role="img" aria-label={INTRO.stageLabel}>
          <FactoryStage />
        </div>
        {/* Data centers: the stage itself turns charcoal under the canvas (never an ivory flash). */}
        <div className="dc-backdrop" aria-hidden="true" ref={(el) => { overlay.dcBackdrop = el; }} />
        <StageMedia quality={quality} />
        {/* Legibility for the power-generation text: a soft ivory haze rising from the bottom. */}
        <div className="field-scrim" aria-hidden="true" ref={(el) => { overlay.fieldScrim = el; }} />
        {/* …and for the data-center copy: a soft charcoal falloff behind the text column. */}
        <div className="dc-scrim" aria-hidden="true" ref={(el) => { overlay.dcScrim = el; }} />
        <Leader />
        <div className="stage__content" id="main-content" ref={(el) => { overlay.content = el; }}>
          <IntroHero />
          <HeroChapter pinned />
          <ModuleChapter pinned />
          <FieldChapter pinned />
          <DataCenterChapter pinned />
        </div>
        <AnatomyLabel />
        <div className="stage__footer" ref={(el) => { overlay.stageFooter = el; }}>
          <ScrollCue />
          <div className="stage__footer-center">
            <IntroControls />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Prefer the tightly cropped still; fall back to the full-frame poster; undefined if neither exists. */
const stillFor = (still: string, poster: string) => (hasMedia(still) ? still : hasMedia(poster) ? poster : undefined);

/** Static opening for the document layout: the factory loop (or its poster) behind the headline. */
function StaticIntro() {
  const motion = useUI((s) => s.motion);
  const videoRef = useRef<HTMLVideoElement>(null);
  const portrait = typeof window !== 'undefined' && window.innerWidth / window.innerHeight <= 0.57;
  const media = portrait ? INTRO_MEDIA.loop.portrait : { src: INTRO_MEDIA.loop.landscape.small, poster: INTRO_MEDIA.loop.landscape.poster };
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    el.setAttribute('muted', '');
    if (motion) void el.play().catch(() => undefined);
    else el.pause();
  }, [motion]);
  return (
    <section className="static-intro" aria-labelledby="intro-title">
      <video ref={videoRef} className="static-intro__video" src={media.src} poster={media.poster} muted playsInline loop preload="metadata" aria-hidden="true" tabIndex={-1} />
      <div className="static-intro__scrim" aria-hidden="true" />
      <IntroHero />
      <a className="intro-control intro-control--skip static-intro__skip" href="#overview">{INTRO.skip}</a>
    </section>
  );
}

/** No-WebGL / failed-start layout: an ordinary document with still images and every explanation. */
export function StaticStory() {
  const darkRef = useRef<HTMLDivElement>(null);
  // Dark from the data-center section on: the header, body and mobile menu follow the scroll.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = darkRef.current;
      const header = document.querySelector<HTMLElement>('.site-header')?.offsetHeight ?? 0;
      setScene(el && el.getBoundingClientRect().top <= header ? 'dark' : 'light');
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div className="static-story" id="main-content">
      <StaticIntro />
      <section id="overview" className="static-chapter" aria-labelledby="hero-title">
        <HeroChapter pinned={false} />
        {stillFor(MEDIA.heroStill, MEDIA.heroPoster) && (
          <figure className="static-figure">
            <img src={mediaUrl(stillFor(MEDIA.heroStill, MEDIA.heroPoster)!)} alt={FALLBACK.heroAlt} decoding="async" />
          </figure>
        )}
      </section>
      <section id="module" className="static-chapter static-chapter--module" aria-labelledby="module-title">
        <ModuleChapter pinned={false} />
        <figure className="static-figure">
          {stillFor(MEDIA.moduleStill, MEDIA.modulePoster) && (
            <img src={mediaUrl(stillFor(MEDIA.moduleStill, MEDIA.modulePoster)!)} alt={FALLBACK.moduleAlt} loading="lazy" decoding="async" />
          )}
          <figcaption>
            <strong>{MODULE.anatomyLabel}.</strong> {MODULE.anatomyNote}
          </figcaption>
        </figure>
        <MotionStudy />
      </section>
      <section id="power-generation" className="static-chapter static-chapter--field" aria-labelledby="field-title">
        <FieldChapter pinned={false} />
        {hasMedia(MEDIA.fieldStill) && (
          <figure className="static-figure">
            <img src={mediaUrl(MEDIA.fieldStill)} alt={FIELD.stillAlt} loading="lazy" decoding="async" />
          </figure>
        )}
      </section>
      <div className="static-dark" ref={darkRef}>
        <section id="data-centers" className="static-chapter static-chapter--dc" aria-labelledby="dc-title">
          <DataCenterChapter pinned={false} />
          {hasMedia(MEDIA.dcStill) && (
            <figure className="static-figure static-figure--dark">
              <img src={mediaUrl(MEDIA.dcStill)} alt={DATACENTER.stillAlt} loading="lazy" decoding="async" />
            </figure>
          )}
        </section>
        <p className="static-note" role="note">{FALLBACK.unavailable}</p>
      </div>
    </div>
  );
}
