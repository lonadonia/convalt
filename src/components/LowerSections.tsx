import { useRef, type CSSProperties } from 'react';
import { COMPANY, PORTFOLIO } from '../content/portfolio';
import { PORTFOLIO_MEDIA } from '../content/portfolioMedia';
import { usePortfolioScroll } from '../hooks/usePortfolioScroll';
import { useReveal } from '../hooks/useReveal';

const statusKey = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

/** Project portfolio: one article per project; CSS chooses the stacked list or the scroll layout. */
export function Portfolio() {
  const root = useRef<HTMLElement>(null);
  const projects = PORTFOLIO.projects;
  const { mode, active, goTo } = usePortfolioScroll(root, projects.length);
  useReveal(root);
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <section className="lp-section pf" id={PORTFOLIO.id} aria-labelledby="portfolio-title" data-mode={mode} ref={root}>
      <div className="lp-inner pf-intro" data-reveal>
        <p className="eyebrow lp-eyebrow">
          <span className="eyebrow__rule" aria-hidden="true" />
          {PORTFOLIO.eyebrow}
        </p>
        <h2 id="portfolio-title" className="display display--section lp-title">
          <span className="lp-line">{PORTFOLIO.headline[0]}</span>
          <span className="lp-line display__accent">{PORTFOLIO.headline[1]}</span>
        </h2>
      </div>
      <div className="lp-inner pf-body">
        {/* Which project is in focus (scroll layout): an index that follows the scroll. */}
        <nav className="pf-rail" aria-label="Projects in this section">
          <ol>
            {projects.map((p, i) => (
              <li key={p.id}>
                <a
                  href={`#${p.id}`}
                  aria-current={active === i ? 'true' : undefined}
                  onClick={(e) => { e.preventDefault(); goTo(i); }}
                >
                  <span className="pf-rail__num">{pad(i + 1)}</span>
                  <span className="pf-rail__name">{p.title}</span>
                </a>
              </li>
            ))}
          </ol>
          <span className="pf-rail__meter" aria-hidden="true"><span /></span>
        </nav>
        <ol className="pf-list">
          {projects.map((p, i) => {
            const img = PORTFOLIO_MEDIA[p.image];
            return (
              <li key={p.id} id={p.id} className="pf-item" data-index={i} data-active={active === i ? 'true' : undefined}>
                <article className="pf-item__text" aria-labelledby={`${p.id}-title`} data-reveal>
                  <p className="pf-item__num" aria-hidden="true">
                    {pad(i + 1)} <span>/ {pad(projects.length)}</span>
                  </p>
                  <p className="pf-status" data-status={statusKey(p.status)}>
                    <span className="visually-hidden">Status: </span>
                    {p.status}
                  </p>
                  <h3 id={`${p.id}-title`} className="pf-item__title">{p.title}</h3>
                  <p className="pf-item__location">{p.location}</p>
                  <p className="pf-item__summary">{p.summary}</p>
                  <p className="pf-item__scope">
                    {p.scope} · <span className="pf-item__category">{p.category}</span>
                  </p>
                  <a className="lp-link pf-item__link" href={p.href}>
                    {PORTFOLIO.projectLink}
                    <span className="visually-hidden">: {p.title}</span> <span aria-hidden="true">↗</span>
                  </a>
                </article>
                <div className="pf-item__media">
                  {/* The image opens the project too (pointer convenience; the link above is the real one). */}
                  <a className="pf-frame" href={p.href} tabIndex={-1} aria-hidden="true">
                    <img
                      src={img.src}
                      srcSet={img.srcSet}
                      sizes="(min-width: 900px) 58vw, 92vw"
                      width={img.width}
                      height={img.height}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  </a>
                  <span className="visually-hidden" role="img" aria-label={p.alt} />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="lp-inner pf-outro" data-reveal>
        <a className="pf-all" href={PORTFOLIO.allProjects.href}>
          {PORTFOLIO.allProjects.label} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}

/** Company and people: the infrastructure image beside the headline, the paragraph and the CTA. */
export function Company() {
  const root = useRef<HTMLElement>(null);
  const img = PORTFOLIO_MEDIA[COMPANY.image];
  useReveal(root);
  return (
    <section className="lp-section company" id={COMPANY.id} aria-labelledby="company-title" ref={root}>
      <div className="lp-inner company__inner">
        <div className="company__media" data-reveal>
          <img src={img.src} srcSet={img.srcSet} sizes="(min-width: 900px) 52vw, 92vw" width={img.width} height={img.height} alt={COMPANY.alt} loading="lazy" decoding="async" />
        </div>
        <div className="company__copy" data-reveal style={{ '--reveal-i': 1 } as CSSProperties}>
          <p className="eyebrow lp-eyebrow">
            <span className="eyebrow__rule" aria-hidden="true" />
            {COMPANY.eyebrow}
          </p>
          <h2 id="company-title" className="display display--section lp-title">
            <span className="lp-line">{COMPANY.headline[0]}</span>
            <span className="lp-line display__accent">{COMPANY.headline[1]}</span>
          </h2>
          <p className="lp-body">{COMPANY.body}</p>
          <a className="btn btn--primary lp-cta" href={COMPANY.cta.href}>
            {COMPANY.cta.label} <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}
