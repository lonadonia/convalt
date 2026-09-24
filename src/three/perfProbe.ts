import type * as THREE from 'three';

/**
 * Validation-only probe (enabled with ?perf=1). Wraps renderer.render with a GPU timer query
 * (EXT_disjoint_timer_query_webgl2) and a CPU timer, so scripts/capture.mjs can report real
 * per-frame GPU and CPU cost rather than only vsync-limited frame intervals.
 */
export function installPerfProbe(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const store = ((window as unknown as { __convaltPerf?: { gpu?: number[]; cpu?: number[] } }).__convaltPerf ??= {});
  store.gpu = [];
  store.cpu = [];
  const pending: WebGLQuery[] = [];
  const render = renderer.render.bind(renderer);

  const poll = () => {
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift()!;
      const disjoint = ext ? gl.getParameter(ext.GPU_DISJOINT_EXT) : true;
      if (!disjoint) store.gpu!.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
  };

  renderer.render = (scene, camera) => {
    poll();
    const q = ext ? gl.createQuery() : null;
    if (q && ext && pending.length < 8) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    const t0 = performance.now();
    render(scene, camera);
    store.cpu!.push(performance.now() - t0);
    if (q && ext && pending.length < 8) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
    else if (q) gl.deleteQuery(q);
  };
}
