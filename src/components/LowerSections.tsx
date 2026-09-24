import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { COMPANY, PORTFOLIO, type Project } from '../content/portfolio';
import { PORTFOLIO_MEDIA } from '../content/portfolioMedia';
import { useReveal } from '../hooks/useReveal';

const statusKey = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

/**
 * One project: the image with its status, then location, title and scope. The title is the only
 * link; its hit area covers the whole card (no nested interactive elements).
 */
function ProjectCard({ project: p }: { project: Project }) {
  const img = PORTFOLIO_MEDIA[p.image];
  const cut = p.title.lastIndexOf(' ');
  const lead = cut > 0 ? p.title.slice(0, cut + 1) : '';
  const last = p.title.slice(cut + 1);
  return (
    <article className="project-card">
      <div className="project-card__media">
        <img
          src={img.src}
          srcSet={img.srcSet}
          sizes="(min-width: 1100px) 30vw, (min-width: 640px) 46vw, 92vw"
          width={img.width}
          height={img.height}
          alt={p.alt}
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="project-card__body">
        <h3 className="project-card__title">
          <a className="project-card__link" href={p.href}>
            {lead}
            {/* The arrow stays with the last word (never alone on a line). */}
            <span className="project-card__last">
              {last}
              <span className="project-card__arrow" aria-hidden="true">↗</span>
            </span>
          </a>
        </h3>
        <p className="project-card__status" data-status={statusKey(p.status)}>
          <span className="visually-hidden">Status: </span>
          {p.status}
        </p>
        <p className="project-card__location">{p.location}</p>
        <p className="project-card__desc">
          {p.description} · <span className="project-card__category">{p.category}</span>
        </p>
      </div>
    </article>
  );
}

/**
 * Project portfolio: regional tabs (WAI-ARIA tabs, automatic activation: arrow keys, Home and
 * End move and select; Tab moves into the projects). United States is selected at first.
 */
export function Portfolio() {
  const root = useRef<HTMLElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const regions = PORTFOLIO.regions;
  useReveal(root);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = regions.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <section className="lp-section portfolio" id={PORTFOLIO.id} aria-labelledby="portfolio-title" ref={root}>
      <div className="lp-inner">
        <div className="lp-head" data-reveal>
          <div>
            <p className="eyebrow lp-eyebrow">
              <span className="eyebrow__rule" aria-hidden="true" />
              {PORTFOLIO.eyebrow}
            </p>
            <h2 id="portfolio-title" className="display display--section lp-title">
              <span className="lp-line">{PORTFOLIO.headline[0]}</span>
              <span className="lp-line display__accent">{PORTFOLIO.headline[1]}</span>
            </h2>
          </div>
          <a className="lp-link" href={PORTFOLIO.allProjects.href}>
            {PORTFOLIO.allProjects.label} <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="regions" role="tablist" aria-label={PORTFOLIO.regionsLabel} data-reveal>
          {regions.map((r, i) => (
            <button
              key={r.id}
              ref={(el) => { tabs.current[i] = el; }}
              type="button"
              role="tab"
              id={`region-tab-${r.id}`}
              className="regions__tab"
              aria-selected={i === active}
              aria-controls={`region-panel-${r.id}`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {regions.map((r, i) => (
          <div key={r.id} role="tabpanel" id={`region-panel-${r.id}`} aria-labelledby={`region-tab-${r.id}`} className="regions__panel" hidden={i !== active}>
            {r.projects.length > 0 ? (
              <ul className="project-grid">
                {r.projects.map((p, k) => (
                  <li key={p.href} data-reveal style={{ '--reveal-i': k % 3 } as CSSProperties}>
                    <ProjectCard project={p} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="regions__empty">
                {PORTFOLIO.empty} <a className="lp-link" href={PORTFOLIO.allProjects.href}>{PORTFOLIO.allProjects.label} <span aria-hidden="true">↗</span></a>
              </p>
            )}
          </div>
        ))}
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
