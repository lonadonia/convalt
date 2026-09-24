import { HERO } from '../content/story';
import { overlay } from '../state/overlay';

/** "Scroll to explore" at the opening and when the overview settles (desktop). */
export function ScrollCue() {
  return (
    <p className="scroll-cue" aria-hidden="true" ref={(el) => { overlay.cue = el; }}>
      <span className="scroll-cue__line" />
      {HERO.scrollCue}
    </p>
  );
}
