import type { MediaId } from './portfolioMedia';

/**
 * Lower-page sections after the data centers: the project portfolio and the company section.
 *
 * Projects, statuses, locations, scope and links: as supplied for this page and checked against the
 * official convalt.com project pages on 2026-09-26 (each link answered HTTP 200; the statuses match
 * the published badges). The one-sentence summaries are each project page's own opening sentence,
 * only shortened where it did not stand alone — no capacity, date or milestone is added, and none of
 * the projects is described as built or operating.
 */

const SITE = 'https://www.convalt.com';

export type ProjectStatus = 'UNDER FINANCING' | 'ON HOLD' | 'UNDER DEVELOPMENT';

export type Project = {
  id: string;
  title: string;
  status: ProjectStatus;
  location: string;
  /** From the official project page. */
  summary: string;
  /** Capacity or scope, then the category (shown as "scope · category"). */
  scope: string;
  category: string;
  href: string;
  image: MediaId;
  alt: string;
};

export const PORTFOLIO = {
  id: 'portfolio',
  eyebrow: 'Our project portfolio',
  headline: ['Local foundations.', 'Global aspiration.'],
  allProjects: { label: 'View all projects', href: `${SITE}/projects/index.html` },
  projectLink: 'View project',
  projects: [
    {
      id: 'project-solis',
      title: 'Project Solis',
      status: 'UNDER FINANCING',
      location: 'New Mexico, U.S.A.',
      summary: 'A proposed advanced-manufacturing campus bringing solar-cell and solar-module production, hundreds of jobs, and long-term investment to Gallup, New Mexico.',
      scope: '3.6 GW cells / 3.0 GW modules',
      category: 'Manufacturing',
      href: `${SITE}/project-solis/index.html`,
      image: 'project-solis',
      alt: 'Rendering of a manufacturing campus beside a solar array in the New Mexico desert',
    },
    {
      id: 'watertown-factory',
      title: 'Watertown Factory',
      status: 'ON HOLD',
      location: 'Watertown, New York, U.S.A.',
      summary: 'A planned solar cell manufacturing facility featuring advanced heterojunction technology, with a rated capacity of 2 GW of solar cell production annually.',
      scope: '2 GW planned solar cell production',
      category: 'Manufacturing',
      href: `${SITE}/projects/watertown-factory/index.html`,
      image: 'watertown-factory',
      alt: 'Solar cell production line with rows of blue wafers',
    },
    {
      id: 'river-drivers-solar',
      title: 'River Drivers Solar',
      status: 'UNDER DEVELOPMENT',
      location: 'East Millinocket, Maine, U.S.A.',
      summary: 'Convalt is developing a 12 MW community solar project in East Millinocket, beginning with an initial 2 MW phase.',
      scope: '12 MW',
      category: 'Power Generation',
      href: `${SITE}/projects/river-drivers-solar/index.html`,
      image: 'river-drivers-solar',
      alt: 'Aerial view of a riverside industrial site with the project area outlined',
    },
    {
      id: 'new-mexico-panel-recycling',
      title: 'New Mexico Panel Recycling',
      status: 'UNDER DEVELOPMENT',
      location: 'New Mexico, U.S.A.',
      summary: 'Convalt’s first recycling facility, to be co-located with its solar cell and module manufacturing operations; the project is progressing through permitting and approvals.',
      scope: '1 GW',
      category: 'Recycling',
      href: `${SITE}/projects/new-mexico-panel-recycling/index.html`,
      image: 'new-mexico-panel-recycling',
      alt: 'Pile of broken, discarded solar panels',
    },
    {
      id: 'northern-maine-data-center',
      title: 'Northern Maine Data Center',
      status: 'UNDER DEVELOPMENT',
      location: 'Maine, U.S.A.',
      summary: 'Convalt Data Center is developing a major site in northern Maine spanning approximately 10,000 acres.',
      scope: 'Integrated infrastructure',
      category: 'Data Centers',
      href: `${SITE}/projects/northern-maine-data-center/index.html`,
      image: 'northern-maine-data-center',
      alt: 'Aisle between rows of server cabinets in a data center',
    },
  ] satisfies Project[],
};

export const COMPANY = {
  id: 'company',
  eyebrow: 'Construct with capital and conscience',
  headline: ['Built for the next generation.', 'And the one after that.'],
  body: 'Founded in 2011, Convalt brings together more than 150 professionals across regions and energy disciplines. We plan with a 50-year horizon, with a commitment to sustainable growth, meaningful employment, and opportunities for veterans and the military community.',
  cta: { label: 'Meet our team', href: `${SITE}/team/index.html` },
  image: 'integrated-energy-infrastructure' as MediaId,
  alt: 'Automated equipment moving silicon wafers along a production line',
};
