import type { MediaId } from './portfolioMedia';

/**
 * Lower-page sections after the data centers: the project portfolio (by region) and the company
 * section.
 *
 * United States records and all section copy: as supplied for this page. Africa, India and
 * Southeast Asia: the official convalt.com homepage portfolio, read on 2026-09-24 — titles,
 * statuses, locations, descriptions and project links verbatim, nothing added. Every link was
 * checked live (HTTP 200). Statuses are shown exactly as published; none is restated.
 */

const SITE = 'https://www.convalt.com';

export type ProjectStatus = 'UNDER FINANCING' | 'ON HOLD' | 'UNDER DEVELOPMENT' | 'OPERATING' | 'SOLD';

export type Project = {
  title: string;
  status: ProjectStatus;
  location: string;
  /** Capacity or scope, then the category (shown as "description · category"). */
  description: string;
  category: string;
  href: string;
  image: MediaId;
  alt: string;
};

export type Region = { id: 'united-states' | 'africa' | 'india' | 'southeast-asia'; label: string; projects: Project[] };

export const PORTFOLIO = {
  id: 'portfolio',
  eyebrow: 'Our project portfolio',
  headline: ['Local foundations.', 'Global aspiration.'],
  allProjects: { label: 'View all projects', href: `${SITE}/projects/index.html` },
  regionsLabel: 'Projects by region',
  /** Shown only if a region ever has no verified records. */
  empty: 'No projects to show for this region yet.',
  regions: [
    {
      id: 'united-states',
      label: 'United States',
      projects: [
        {
          title: 'Project Solis',
          status: 'UNDER FINANCING',
          location: 'New Mexico, U.S.A.',
          description: '3.6 GW cells / 3.0 GW modules',
          category: 'Manufacturing',
          href: `${SITE}/project-solis/index.html`,
          image: 'project-solis',
          alt: 'Rendering of a manufacturing campus beside a solar array in the New Mexico desert',
        },
        {
          title: 'Watertown Factory',
          status: 'ON HOLD',
          location: 'Watertown, New York, U.S.A.',
          description: '2 GW planned solar cell production',
          category: 'Manufacturing',
          href: `${SITE}/projects/watertown-factory/index.html`,
          image: 'watertown-factory',
          alt: 'Solar cell production line with rows of blue wafers',
        },
        {
          title: 'River Drivers Solar',
          status: 'UNDER DEVELOPMENT',
          location: 'East Millinocket, Maine, U.S.A.',
          description: '12 MW',
          category: 'Power Generation',
          href: `${SITE}/projects/river-drivers-solar/index.html`,
          image: 'river-drivers-solar',
          alt: 'Aerial view of a riverside industrial site with the project area outlined',
        },
        {
          title: 'New Mexico Panel Recycling',
          status: 'UNDER DEVELOPMENT',
          location: 'New Mexico, U.S.A.',
          description: '1 GW',
          category: 'Recycling',
          href: `${SITE}/projects/new-mexico-panel-recycling/index.html`,
          image: 'new-mexico-panel-recycling',
          alt: 'Pile of broken, discarded solar panels',
        },
        {
          title: 'Northern Maine Data Center',
          status: 'UNDER DEVELOPMENT',
          location: 'Maine, U.S.A.',
          description: 'Integrated infrastructure',
          category: 'Data Centers',
          href: `${SITE}/projects/northern-maine-data-center/index.html`,
          image: 'northern-maine-data-center',
          alt: 'Aisle between rows of server cabinets in a data center',
        },
      ],
    },
    {
      id: 'africa',
      label: 'Africa',
      projects: [
        {
          title: 'Chad Solar',
          status: 'UNDER DEVELOPMENT',
          location: 'N’Djamena, Republic of Chad',
          description: '120 MW',
          category: 'Power Generation',
          href: `${SITE}/projects/chad-solar/index.html`,
          image: 'chad-solar',
          alt: 'Large solar array on sandy ground below a mountain range',
        },
        {
          title: 'Chad Rural Electrification',
          status: 'UNDER DEVELOPMENT',
          location: 'Multiple Locations, Republic of Chad',
          description: '30 MW',
          category: 'Power Generation',
          href: `${SITE}/projects/chad-rural-electrification/index.html`,
          image: 'chad-rural-electrification',
          alt: 'Rows of solar panels in a green field',
        },
        {
          title: 'Sierra Leone Solar',
          status: 'UNDER DEVELOPMENT',
          location: 'Seven Cities Across Sierra Leone',
          description: '60 MW',
          category: 'Power Generation',
          href: `${SITE}/projects/sierra-leone-solar/index.html`,
          image: 'sierra-leone-solar',
          alt: 'A person walking through a green field toward a solar panel',
        },
        {
          title: 'Kobong Hybrid Infrastructure',
          status: 'UNDER DEVELOPMENT',
          location: 'Katse Dam Region, Kingdom of Lesotho',
          description: 'Integrated infrastructure',
          category: 'Power Generation',
          href: `${SITE}/projects/kobong-hybrid-infrastructure/index.html`,
          image: 'kobong-hybrid-infrastructure',
          alt: 'River running through a green highland valley',
        },
      ],
    },
    {
      id: 'india',
      label: 'India',
      projects: [
        {
          title: 'Redan Waste-to-Energy',
          status: 'OPERATING',
          location: 'Andhra Pradesh, India',
          description: '7.5 MW',
          category: 'Power Generation',
          href: `${SITE}/projects/redan-waste-to-energy/index.html`,
          image: 'redan-waste-to-energy',
          alt: 'Aerial view of a waste-to-energy plant with a red-and-white chimney',
        },
        {
          title: 'Vizhag Waste-to-Energy',
          status: 'UNDER DEVELOPMENT',
          location: 'Andhra Pradesh, India',
          description: '7.5 MW',
          category: 'Power Generation',
          href: `${SITE}/projects/vizhag-waste-to-energy/index.html`,
          image: 'vizhag-waste-to-energy',
          alt: 'Waste-to-energy plant with a conveyor and a red-and-white chimney',
        },
      ],
    },
    {
      id: 'southeast-asia',
      label: 'Southeast Asia',
      projects: [
        {
          title: 'Mandalay Solar',
          status: 'SOLD',
          location: 'Mandalay Region, Republic of the Union of Myanmar',
          description: '300 MW',
          category: 'Power Generation',
          href: `${SITE}/projects/mandalay-solar/index.html`,
          image: 'mandalay-solar',
          alt: 'Wheel loader grading a dry, open site',
        },
        {
          title: 'Lao Solar',
          status: 'UNDER DEVELOPMENT',
          location: 'Attapue Province, Lao P.D.R.',
          description: '1,200 MW',
          category: 'Power Generation',
          href: `${SITE}/projects/lao-solar/index.html`,
          image: 'lao-solar',
          alt: 'Signing ceremony in front of a banner with the Convalt Energy, GE and Cathay United Bank logos',
        },
      ],
    },
  ] satisfies Region[],
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
