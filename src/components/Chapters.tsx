import { useRef, type MouseEvent } from 'react';
import { DATACENTER, FIELD, HERO, MODULE } from '../content/story';
import { useRevealOnFocus } from '../hooks/useRevealOnFocus';
import { chapterProgress, goToChapter } from '../lib/scroll';
import { overlay } from '../state/overlay';
import { LayerControls } from './LayerControls';

type Mode = { pinned: boolean };

const ArrowDown = () => (
  <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M10 4v12m0 0 5-5m-5 5-5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ArrowRight = () => (
  <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M4 10h12m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ArrowUp = () => (
  <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M10 16V4m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const atOverview = () => chapterProgress('overview');
const atModule = () => chapterProgress('module');
const atField = () => chapterProgress('field');
const atDc = () => chapterProgress('datacenter');

const chapterLink = (id: 'overview' | 'module' | 'power-generation') => (e: MouseEvent) => {
  e.preventDefault();
  goToChapter(id);
};

export function HeroChapter({ pinned }: Mode) {
  const ref = useRef<HTMLDivElement>(null);
  useRevealOnFocus(ref, atOverview, pinned);
  return (
    <div
      className="chapter chapter--hero"
      ref={(el) => { ref.current = el; if (pinned) overlay.hero = el; }}
    >
      <p className="eyebrow">
        <span className="eyebrow__index">{HERO.chapter}</span>
        <span className="eyebrow__rule" aria-hidden="true" />
        {HERO.chapterLabel}
      </p>
      <h2 id="hero-title" className="display" tabIndex={-1}>
        Energy, <span className="display__accent">connected.</span>
      </h2>
      <p className="lede">{HERO.body}</p>
      <div className="cta-row">
        <a className="btn btn--primary" href="#module" onClick={chapterLink('module')}>
          {HERO.primaryCta}
          <ArrowDown />
        </a>
        <a className="btn btn--text" href={HERO.secondaryCta.href}>
          {HERO.secondaryCta.label}
          <ArrowRight />
        </a>
      </div>
    </div>
  );
}

export function ModuleChapter({ pinned }: Mode) {
  const ref = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  useRevealOnFocus(ref, atModule, pinned);
  useRevealOnFocus(controlsRef, atModule, pinned);
  return (
    <div
      className="chapter chapter--module"
      ref={(el) => { ref.current = el; if (pinned) overlay.module = el; }}
    >
      <p className="eyebrow">
        <span className="eyebrow__index">{MODULE.chapter}</span>
        <span className="eyebrow__rule" aria-hidden="true" />
        {MODULE.chapterLabel}
      </p>
      <h2 id="module-title" className="display display--section" tabIndex={-1}>
        {MODULE.headline}
      </h2>
      <p className="lede">{MODULE.body}</p>
      <div className="swap">
        <div className="swap__item" ref={(el) => { controlsRef.current = el; if (pinned) overlay.controls = el; }}>
          <LayerControls />
        </div>
        {/* In the pinned journey the module scene continues into power generation; the document
            layout keeps its closing links. */}
        {!pinned && (
          <div className="swap__item closing">
            <div className="cta-row">
              <a className="btn btn--primary" href="#overview" onClick={chapterLink('overview')}>
                <ArrowUp />
                {MODULE.closing.back}
              </a>
              <a className="btn btn--text" href={MODULE.closing.projects.href}>
                {MODULE.closing.projects.label}
                <ArrowRight />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Power generation: text near the bottom once the installation's scale is established. */
export function FieldChapter({ pinned }: Mode) {
  const ref = useRef<HTMLDivElement>(null);
  useRevealOnFocus(ref, atField, pinned);
  return (
    <div className="chapter chapter--field" ref={(el) => { ref.current = el; if (pinned) overlay.field = el; }}>
      <p className="eyebrow">
        <span className="eyebrow__index">{FIELD.chapter}</span>
        <span className="eyebrow__rule" aria-hidden="true" />
        {FIELD.chapterLabel}
      </p>
      <h2 id="field-title" className="display display--section" tabIndex={-1}>
        {FIELD.headline[0]}
        <br />
        <span className="display__accent">{FIELD.headline[1]}</span>
      </h2>
      <p className="lede">{FIELD.body}</p>
      <div className="cta-row">
        <a className="btn btn--primary" href={FIELD.cta.href}>
          {FIELD.cta.label}
          <ArrowRight />
        </a>
      </div>
      <p className="chapter__note">{FIELD.illustration}</p>
    </div>
  );
}

export function DataCenterChapter({ pinned }: Mode) {
  const ref = useRef<HTMLDivElement>(null);
  useRevealOnFocus(ref, atDc, pinned);
  return (
    <div className="chapter chapter--dc" ref={(el) => { ref.current = el; if (pinned) overlay.dc = el; }}>
      <p className="eyebrow">
        <span className="eyebrow__index">{DATACENTER.chapter}</span>
        <span className="eyebrow__rule" aria-hidden="true" />
        {DATACENTER.chapterLabel}
      </p>
      <h2 id="dc-title" className="display display--section" tabIndex={-1}>
        {DATACENTER.headline[0]}
        <br />
        <span className="display__accent">{DATACENTER.headline[1]}</span>
      </h2>
      <p className="lede">{DATACENTER.body}</p>
      <div className="cta-row">
        <a className="btn btn--primary" href={DATACENTER.cta.href}>
          {DATACENTER.cta.label}
          <ArrowRight />
        </a>
      </div>
      <p className="chapter__note">{DATACENTER.illustration}</p>
    </div>
  );
}
