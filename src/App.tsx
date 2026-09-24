import { useEffect, useMemo } from 'react';
import { checkWebGL, detectTier, qualityFor } from './config/quality';
import { CONTACT_LINK, FOOTER } from './content/story';
import { useMotionPreference } from './hooks/useMotionPreference';
import { debug } from './lib/debug';
import { story, ui, useUI } from './state/store';
import { Logo, Nav } from './components/Nav';
import { PinnedStory, StaticStory } from './components/Story';
import { Company, Portfolio } from './components/LowerSections';

function usePlatformState() {
  useEffect(() => {
    const webgl = debug.forceStatic ? { ok: false, reason: 'forced' } : checkWebGL();
    ui.set({ webgl: webgl.ok, tier: detectTier() });
    if (!webgl.ok) console.info('[convalt] static layout:', webgl.reason);
    const onResize = () => ui.set({ tier: detectTier() });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Desktop pointer parallax input (only renders a frame when parallax is currently allowed).
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const onMove = (e: PointerEvent) => {
      story.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      story.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (story.parallaxWeight > 0.01) story.invalidate();
    };
    const onLeave = () => { story.pointer.x = 0; story.pointer.y = 0; story.invalidate(); };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);
}

export default function App() {
  useMotionPreference();
  usePlatformState();
  const webgl = useUI((s) => s.webgl);
  const tier = useUI((s) => s.tier);
  const motion = useUI((s) => s.motion);
  const activeLayer = useUI((s) => s.activeLayer);
  // Texture resolution is chosen once per visit (resizing does not trigger a second download).
  const quality = useMemo(() => qualityFor(detectTier()), []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motion = motion ? 'on' : 'off';
    root.dataset.tier = tier;
    root.dataset.layout = webgl ? 'pinned' : 'static';
    if (debug.capture) root.dataset.capture = 'on';
    if (activeLayer) root.dataset.activeLayer = activeLayer;
    else delete root.dataset.activeLayer;
  }, [motion, tier, webgl, activeLayer]);

  return (
    <>
      <div className="header-track">
        <Nav />
      </div>
      <main>
        {webgl ? <PinnedStory quality={quality} /> : <StaticStory />}
        <Portfolio />
        <Company />
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <a className="site-footer__brand" href="/" aria-label="Convalt Energy home"><Logo tone="white" /></a>
          <nav className="site-footer__nav" aria-label="Footer">
            <div>
              <p className="site-footer__heading">{FOOTER.heading}</p>
              <ul className="site-footer__links site-footer__links--cols">
                {FOOTER.links.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}
              </ul>
            </div>
            <div>
              <p className="site-footer__heading">{FOOTER.contactHeading}</p>
              <ul className="site-footer__links">
                <li><a href={CONTACT_LINK.href}>{CONTACT_LINK.label}</a></li>
              </ul>
            </div>
          </nav>
        </div>
        <div className="site-footer__legal">
          <p>{FOOTER.copyright}</p>
          <p>{FOOTER.note}</p>
        </div>
      </footer>
    </>
  );
}
