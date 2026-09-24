import * as THREE from 'three';

/**
 * Small, cached shader injections on top of MeshStandardMaterial:
 *  - fade: mixes the final (display-space) colour toward the page background, used to
 *    de-emphasize inactive layers without switching opaque parts to expensive transparency;
 *  - sweep: one soft band of light that crosses the cell face during the opening.
 * Uniform values live on material.userData so the frame loop can update them without recompiling.
 */
export type FadeUniforms = { uFade: { value: number }; uFadeColor: { value: THREE.Color } };
export type SweepUniforms = {
  uSweep: { value: number };
  uSweepStrength: { value: number };
  uSweepColor: { value: THREE.Color };
  uFrontRect: { value: THREE.Vector4 };
};

export function fadeUniforms(material: THREE.Material): FadeUniforms {
  return material.userData.fade as FadeUniforms;
}

export function sweepUniforms(material: THREE.Material): SweepUniforms | undefined {
  return material.userData.sweep as SweepUniforms | undefined;
}

/** Adds the fade injection (and optionally the sweep) to a standard material. */
export function enhanceMaterial(material: THREE.MeshStandardMaterial, opts: { sweepRect?: readonly number[] } = {}) {
  const fade: FadeUniforms = {
    uFade: { value: 0 },
    // The mix runs after colour-space conversion, so the uniform holds display (sRGB) values
    // as-is; LinearSRGBColorSpace here means "store these numbers without conversion".
    uFadeColor: { value: new THREE.Color().setRGB(0xf5 / 255, 0xf4 / 255, 0xee / 255, THREE.LinearSRGBColorSpace) },
  };
  material.userData.fade = fade;
  let sweep: SweepUniforms | undefined;
  if (opts.sweepRect) {
    const r = opts.sweepRect;
    sweep = {
      uSweep: { value: -2 },
      uSweepStrength: { value: 0 },
      uSweepColor: { value: new THREE.Color(1, 1, 1) },
      uFrontRect: { value: new THREE.Vector4(r[0], r[1], r[2], r[3]) },
    };
    material.userData.sweep = sweep;
  }
  const hasSweep = Boolean(sweep);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fade, sweep ?? {});
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uFade;
uniform vec3 uFadeColor;
${hasSweep ? 'uniform float uSweep;\nuniform float uSweepStrength;\nuniform vec3 uSweepColor;\nuniform vec4 uFrontRect;' : ''}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `${hasSweep ? `#ifdef USE_MAP
  {
    vec2 f = (vMapUv - uFrontRect.xy) / (uFrontRect.zw - uFrontRect.xy);
    if (f.x >= 0.0 && f.x <= 1.0 && f.y >= 0.0 && f.y <= 1.0 && uSweepStrength > 0.0) {
      float s = f.x * 0.82 - f.y * 0.36;
      float band = exp(-pow((s - uSweep) / 0.05, 2.0)) + 0.4 * exp(-pow((s - uSweep + 0.11) / 0.025, 2.0));
      outgoingLight += uSweepColor * band * uSweepStrength;
    }
  }
#endif` : ''}
#include <opaque_fragment>`,
      )
      .replace('#include <colorspace_fragment>', '#include <colorspace_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, uFade);');
  };
  material.customProgramCacheKey = () => (hasSweep ? 'convalt-fade-sweep' : 'convalt-fade');
  material.needsUpdate = true;
  return material;
}
