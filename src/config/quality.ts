import type { Tier } from '../state/store';

export type QualityProfile = {
  tier: Tier;
  modelUrl: string;
  /** Device-pixel-ratio range for the canvas; adaptive quality moves within it. */
  dpr: [number, number];
  anisotropy: number;
  antialias: boolean;
};

/** Layout tier: stacked composition on phones and portrait tablets, side by side otherwise. */
const STACKED_QUERY = '(max-width: 759px), (max-width: 1023px) and (orientation: portrait)';

export function detectTier(): Tier {
  if (typeof window === 'undefined') return 'desktop';
  return window.matchMedia(STACKED_QUERY).matches ? 'mobile' : 'desktop';
}

/** Texture budget: 1K maps on touch-first devices, small screens or Save-Data; 2K otherwise. */
function prefersLightAssets(): boolean {
  return window.matchMedia('(pointer: coarse), (max-width: 759px)').matches || saveData();
}

function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(c?.saveData);
}

export function qualityFor(tier: Tier): QualityProfile {
  const device = Math.max(1, window.devicePixelRatio || 1);
  const light = prefersLightAssets();
  return {
    tier,
    modelUrl: light ? '/models/solar-panel-1k.glb' : '/models/solar-panel-2k.glb',
    // Clamp: never above 2×; phones start at 1.75× (their panels are small on screen).
    dpr: [1, Math.min(device, light ? 1.75 : 2)],
    anisotropy: light ? 4 : 8,
    antialias: true,
  };
}

/** Adaptive resolution: step the DPR down when frames are slow, back up when there is headroom. */
export const ADAPTIVE = {
  slowFrameMs: 21,
  fastFrameMs: 11,
  sampleFrames: 45,
  stepDown: 0.85,
  stepUp: 1.1,
} as const;

export type WebGLCheck = { ok: boolean; reason?: string; renderer?: string };

/** Detects WebGL 2 and flags software rasterizers, which cannot run the scene smoothly. */
export function checkWebGL(): WebGLCheck {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { ok: false, reason: 'no-webgl2' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return { ok: false, reason: 'software-renderer', renderer };
    return { ok: true, renderer };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
