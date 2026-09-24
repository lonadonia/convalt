const files = new Set(__MEDIA_FILES__);

export const hasMedia = (name: string) => files.has(name);

export const mediaUrl = (name: string) => `/media/${name}`;

export const MEDIA = {
  heroPoster: 'hero-poster.webp',
  heroPosterMobile: 'hero-poster-mobile.webp',
  modulePoster: 'module-detail.webp',
  modulePosterMobile: 'module-detail-mobile.webp',
  heroStill: 'hero-still.webp',
  moduleStill: 'module-still.webp',
  // Power generation: rendered from the live scene (capture posters) — loading/fallback stand-ins.
  fieldPoster: 'field-poster.webp',
  fieldPosterMobile: 'field-poster-mobile.webp',
  fieldStill: 'field-still.webp',
  // Data centers: rendered from the live scene (capture posters) — loading/fallback stand-ins.
  dcPoster: 'datacenter-poster.webp',
  dcPosterMobile: 'datacenter-poster-mobile.webp',
  dcStill: 'datacenter-still.webp',
  // Studies may be MP4 (H.264) or WebM; the first file found is used.
  lightStudy: ['panel-light-study.mp4', 'panel-light-study.webm'],
  layersStudy: ['module-layers-study.mp4', 'module-layers-study.webm'],
} as const;
