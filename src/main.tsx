import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/intro.css';
import './styles/field.css';
import './styles/datacenter.css';
import './styles/sections.css';
import App from './App';
import { story, ui } from './state/store';
import { journeyLayout, journeyOfDc, journeyOfField, journeyOfStory } from './config/journey';
import { assemblyFrameAt } from './intro/compositor';

// Read by scripts/capture.mjs for automated screenshots, checks and frame-time logs.
(window as unknown as { __convalt: unknown }).__convalt = {
  story,
  ui,
  journey: {
    share: () => journeyLayout(ui.get().tier).introShare,
    storyEnd: () => journeyLayout(ui.get().tier).storyEnd,
    fromStory: (p: number) => journeyOfStory(p, journeyLayout(ui.get().tier)),
    fromField: (f: number) => journeyOfField(f, journeyLayout(ui.get().tier)),
    fieldEnd: () => journeyLayout(ui.get().tier).fieldEnd,
    fromDc: (d: number) => journeyOfDc(d, journeyLayout(ui.get().tier)),
    /** Assembly footage frame shown at an intro position (0–1). */
    frameAt: (intro: number) => Math.round(assemblyFrameAt(intro)),
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
