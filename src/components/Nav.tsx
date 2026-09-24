import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTACT_LINK, NAV_LINKS } from '../content/story';
import { overlay } from '../state/overlay';

export function Logo({ tone = 'petrol' }: { tone?: 'petrol' | 'white' }) {
  return (
    <img
      className="logo"
      src={`/brand/convalt-logo-${tone}.webp`}
      alt=""
      width={400}
      height={122}
      decoding="async"
    />
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const outside = document.querySelectorAll<HTMLElement>('main, footer');
    outside.forEach((el) => el.setAttribute('inert', ''));
    document.documentElement.classList.add('menu-open');
    panel?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const onResize = () => { if (window.matchMedia('(min-width: 1024px)').matches) close(false); };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      outside.forEach((el) => el.removeAttribute('inert'));
      document.documentElement.classList.remove('menu-open');
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  return (
    <header className="site-header" ref={(el) => { overlay.header = el; }}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <a className="brand" href="/" aria-label="Convalt Energy home">
        {/* Official white and petrol variants, cross-faded by contrast (never recoloured live). */}
        <span className="brand__logos">
          <Logo tone="white" />
          <Logo />
        </span>
      </a>
      <nav className="primary-nav" aria-label="Primary">
        <ul>
          {NAV_LINKS.map((l) => (
            <li key={l.href}><a href={l.href}>{l.label}</a></li>
          ))}
        </ul>
        <a className="btn btn--outline btn--compact" href={CONTACT_LINK.href}>{CONTACT_LINK.label}</a>
      </nav>
      <button
        ref={toggleRef}
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="menu-toggle__label">{open ? 'Close' : 'Menu'}</span>
        <span className="menu-toggle__icon" aria-hidden="true" data-open={open} />
      </button>
      <div
        id="mobile-menu"
        ref={panelRef}
        className="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        hidden={!open}
      >
        <ul>
          {NAV_LINKS.map((l) => (
            <li key={l.href}><a href={l.href} onClick={() => close(false)}>{l.label}</a></li>
          ))}
          <li><a href={CONTACT_LINK.href} onClick={() => close(false)}>{CONTACT_LINK.label}</a></li>
        </ul>
        <div className="mobile-menu__footer">
          <button type="button" className="btn btn--ghost btn--compact" onClick={() => close()}>Close menu</button>
        </div>
      </div>
    </header>
  );
}
