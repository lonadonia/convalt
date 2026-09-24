/**
 * Test hooks (URL parameters), used by scripts/capture.mjs and for manual QA:
 *   ?webgl=0          force the no-WebGL static layout
 *   ?model=fail       simulate a model loading failure
 *   ?lose=3000        lose the WebGL context after N ms, restore 2.5 s later
 *   ?capture=1        poster capture mode (UI hidden, transparent page, drawing buffer kept)
 *   ?motion=0|1       override the motion preference for this visit
 *   ?perf=1           GPU/CPU frame timers for scripts/capture.mjs perf (validation only)
 *   ?fieldcam=az,el,dist,tx,tz,sx,sy   override the final power-generation camera key (composition)
 *   ?inspect=1        expose the renderer and scene as window.__three (validation only)
 */
const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

export const debug = {
  forceStatic: params.get('webgl') === '0',
  failModel: params.get('model') === 'fail',
  loseContext: Number(params.get('lose')) || 0,
  capture: params.get('capture') === '1',
  motion: params.has('motion') ? params.get('motion') !== '0' : null,
  perf: params.get('perf') === '1',
  fieldCam: params.get('fieldcam')?.split(',').map(Number) ?? null,
  inspect: params.get('inspect') === '1',
};
