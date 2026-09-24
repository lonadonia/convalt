import { useRef, type MouseEvent } from 'react';
import { INTRO } from '../../content/story';
import { useRevealOnFocus } from '../../hooks/useRevealOnFocus';
import { goToChapter } from '../../lib/scroll';
import { overlay } from '../../state/overlay';

/** Opening headline over the factory footage (accessible HTML, fades out as the journey starts). */
export function IntroHero() {
  const ref = useRef<HTMLDivElement>(null);
  useRevealOnFocus(ref, () => 0, true);
  return (
    <div className="intro-hero" ref={(el) => { ref.current = el; overlay.introHero = el; }}>
      <p className="eyebrow eyebrow--on-dark">{INTRO.eyebrow}</p>
      <h1 id="intro-title" className="display display--intro" tabIndex={-1}>
        {INTRO.headline[0]}
        <br />
        {INTRO.headline[1]}
      </h1>
      <p className="lede lede--on-dark">{INTRO.body}</p>
    </div>
  );
}

/** "Skip intro" (lands on the product overview). */
export function IntroControls() {
  const onSkip = (e: MouseEvent) => {
    e.preventDefault();
    // Straight to the overview: one short cut instead of fast-forwarding the whole factory.
    goToChapter('overview', { instant: true });
  };
  return (
    <div className="intro-controls">
      <a className="intro-control intro-control--skip" href="#overview" onClick={onSkip} ref={(el) => { overlay.skip = el; }}>
        {INTRO.skip}
        <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M10 4v12m0 0 5-5m-5 5-5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </div>
  );
}
