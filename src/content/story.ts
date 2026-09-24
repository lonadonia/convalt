/**
 * All visible copy and links for scenes 01–02. Keep wording here so content can change without
 * touching animation or geometry code.
 */
import type { LayerId } from '../state/store';

export const SITE = 'https://www.convalt.com';

export const NAV_LINKS = [
  { label: 'Projects', href: `${SITE}/projects/` },
  { label: 'Project Solis', href: `${SITE}/project-solis/index.html` },
  { label: 'Team', href: `${SITE}/team/index.html` },
  { label: 'Media', href: `${SITE}/media/index.html` },
  { label: 'Resources', href: `${SITE}/resources/index.html` },
] as const;

export const CONTACT_LINK = { label: 'Contact', href: `${SITE}/contact/index.html` } as const;

export const INTRO = {
  eyebrow: 'Convalt Energy',
  headline: ['Where energy', 'takes shape.'],
  body: 'Explore the components behind solar energy—and the infrastructure they help make possible.',
  skip: 'Skip intro',
  stageLabel: 'Factory footage: a solar-panel production line. A robot processes a panel, the view moves overhead, and the panel becomes the 3D model below.',
} as const;

export const HERO = {
  eyebrow: 'Convalt Energy',
  chapter: '01',
  chapterLabel: 'Overview',
  headline: 'Energy, connected.',
  body: 'Explore the components behind solar energy—and the infrastructure they help make possible.',
  primaryCta: 'Explore the module',
  secondaryCta: { label: 'View projects', href: `${SITE}/projects/` },
  scrollCue: 'Scroll to explore',
} as const;

export const MODULE = {
  chapter: '02',
  chapterLabel: 'Module',
  headline: 'Precision, layer by layer.',
  body: 'A closer look at the protective surfaces, cell assembly, and supporting structure of a solar module.',
  layersLabel: 'Module layers',
  hint: 'Select a layer to learn more.',
  anatomyLabel: 'Illustrative module anatomy',
  anatomyNote: 'Simplified for explanation — not a certified Convalt product, a specific cell technology or an engineering specification.',
  closing: {
    back: 'Back to overview',
    projects: { label: 'View projects', href: `${SITE}/projects/` },
  },
} as const;

/** Power generation (scene 03). Copy as supplied in the brief; no capacity or project claims. */
export const FIELD = {
  chapter: '03',
  chapterLabel: 'Power generation',
  headline: ['From one module.', 'To a field of possibility.'],
  body: 'Explore Convalt Energy’s approach to developing power-generation projects.',
  cta: { label: 'Explore our projects', href: `${SITE}/projects/` },
  illustration: 'Illustrative installation — not a specific Convalt project, site or yield design.',
  stillAlt: 'Rows of solar modules on ground-mounted tables in a green field, seen from above at a three-quarter angle.',
  stageLabel: 'A solar module settles onto a mounting table in a field; neighbouring modules and rows appear until a complete installation is seen from above.',
} as const;

/**
 * Data centers (scene 04). Copy as suggested in the brief. There is no dedicated data-centers page
 * on convalt.com, so the link opens the company's data-center project page (checked live; the
 * page itself states its status), and the label says so. No capacity, customer, certification or
 * uptime claims; the interior is illustrative.
 */
export const DATACENTER = {
  chapter: '04',
  chapterLabel: 'Data centers',
  headline: ['Infrastructure for', 'a connected world.'],
  body: 'Explore Convalt Energy’s approach to digital infrastructure.',
  cta: { label: 'Explore our data center project', href: `${SITE}/projects/northern-maine-data-center/` },
  illustration: 'Illustrative data-center interior — not a depiction of a Convalt facility.',
  stillAlt: 'Rows of server cabinets with green status lights on a tiled floor under rectangular ceiling lights, seen at a three-quarter angle in a dark room.',
  stageLabel: 'A close view of server cabinets with green status lights; the camera pulls back past the rows until the whole data-center installation is seen at a three-quarter angle.',
} as const;

export const LAYERS: ReadonlyArray<{ id: LayerId; index: string; title: string; text: string }> = [
  {
    id: 'protection',
    index: '01',
    title: 'Protection',
    text: 'A transparent front surface—typically glass over a clear encapsulant—shields the cells from weather and impact while letting sunlight through.',
  },
  {
    id: 'cells',
    index: '02',
    title: 'Cell assembly',
    text: 'Solar cells, connected in strings by thin conductive ribbons, turn sunlight into electricity. This illustration shows a 72-cell layout: six rows of twelve.',
  },
  {
    id: 'structure',
    index: '03',
    title: 'Structural support',
    text: 'A rear backsheet seals the module from behind, and the surrounding frame adds rigidity and provides points for mounting.',
  },
];

export const FALLBACK = {
  stageLabel: 'Illustration: a 72-cell solar module. Scrolling separates it into protection, cell assembly and structural support, then reassembles it.',
  heroAlt: 'A 72-cell solar module at a three-quarter angle on an ivory background.',
  moduleAlt: 'An illustrative exploded view of a solar module: front protection, cell assembly and structural support, separated along the module’s depth.',
  unavailable: 'The interactive 3D view is unavailable on this device, so still images are shown instead.',
  modelError: 'The 3D model could not be loaded. Still images are shown instead.',
  contextLost: 'The 3D view was interrupted. Still images are shown until it recovers.',
  fieldLoading: 'Loading the field view',
  fieldError: 'The field view could not be loaded, so the module is shown instead.',
  dcLoading: 'Loading the data-center view',
  dcError: 'The data-center view could not be loaded. The section text and link remain available.',
} as const;

/** Footer: navigation and legal line as on convalt.com (checked live; no address or social links there). */
export const FOOTER = {
  heading: 'Company',
  links: [
    { label: 'Projects', href: `${SITE}/projects/` },
    { label: 'Project Solis', href: `${SITE}/project-solis/index.html` },
    { label: 'Team', href: `${SITE}/team/index.html` },
    { label: 'Media', href: `${SITE}/media/index.html` },
    { label: 'Press Releases', href: `${SITE}/press-releases/index.html` },
    { label: 'Resources', href: `${SITE}/resources/index.html` },
  ],
  contactHeading: 'Get in touch',
  copyright: '© 2026 Convalt Energy, Inc. All rights reserved. A portfolio company of ACO Investment Group LLC',
  note: 'Prototype — scenes 01 to 04 of the Convalt Energy story.',
} as const;
