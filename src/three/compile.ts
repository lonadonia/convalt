import type * as THREE from 'three';

type Programs = { get(material: THREE.Material): { currentProgram?: { isReady(): boolean | null } } };

/**
 * `WebGLRenderer.compileAsync` without its two failure modes. It polls every material's program on
 * a timer and (1) throws, uncaught inside that timer, when a material is disposed meanwhile (a
 * tier change swapping assets that are still compiling), and (2) never settles after a context
 * loss, where readiness reads null forever. This starts the same compile, polls the same
 * programs, drops materials that no longer have one, and settles on context loss or as soon as
 * `alive()` turns false. Errors are ignored, as before: the first render then compiles instead.
 */
export function compileWhenReady(gl: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, alive: () => boolean = () => true): Promise<void> {
  let pending: Set<THREE.Material>;
  try {
    pending = gl.compile(scene, camera);
  } catch {
    return Promise.resolve();
  }
  const programs = (gl as unknown as { properties: Programs }).properties;
  return new Promise((resolve) => {
    const check = () => {
      if (!alive() || gl.getContext().isContextLost()) { resolve(); return; }
      for (const material of pending) {
        const program = programs.get(material).currentProgram;
        if (!program || program.isReady()) pending.delete(material);
      }
      if (pending.size === 0) resolve();
      else setTimeout(check, 10);
    };
    check();
  });
}
