import * as THREE from 'three';
import { DC_BAND } from '../../config/datacenter';
import type { DcSample } from '../../datacenter/timeline';
import type { DataCenterWorld } from './DataCenterWorld';

/**
 * The scroll-driven change of scene between power generation and data centers, on the one
 * renderer:
 *  - before the band: the field scene only;
 *  - in the band: the field darkens to charcoal (a full-screen layer), and while both are dim the
 *    server close-up — rendered into a reduced-size target — rises out of the charcoal over it;
 *  - after the band: the data-center scene only (the field is no longer rendered at all).
 * The two scenes are only ever composited while both are dark, so they are never readable together,
 * and the close-up already glows faintly before the last of the field has gone.
 */
export class SceneBlend {
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly charcoalScene = new THREE.Scene();
  private readonly compositeScene = new THREE.Scene();
  private readonly charcoal: THREE.MeshBasicMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly size = new THREE.Vector2();
  /** Which scenes the last frame rendered (validation / perf logs). */
  mode: 'field' | 'band' | 'datacenter' | 'charcoal' = 'field';

  constructor() {
    const c = new THREE.Color(DC_BAND.charcoal);
    this.charcoal = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    this.charcoalScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.charcoal));
    const linear = c.clone(); // THREE.Color stores linear values; the composite mixes in linear light
    this.composite = new THREE.ShaderMaterial({
      uniforms: { uScene: { value: null }, uGain: { value: 0 }, uAlpha: { value: 0 }, uCharcoal: { value: new THREE.Vector3(linear.r, linear.g, linear.b) } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uScene; uniform float uGain; uniform float uAlpha; uniform vec3 uCharcoal;
        varying vec2 vUv;
        void main() {
          vec3 c = mix(uCharcoal, texture2D(uScene, vUv).rgb, uGain);
          gl_FragColor = vec4(c, uAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.compositeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite));
  }

  /** Allocates the band target and compiles the two quads ahead of time (no stall mid-scroll). */
  prepare(gl: THREE.WebGLRenderer) {
    this.ensureTarget(gl);
    gl.compile(this.charcoalScene, this.quadCamera);
    gl.compile(this.compositeScene, this.quadCamera);
  }

  render(gl: THREE.WebGLRenderer, main: { scene: THREE.Scene; camera: THREE.Camera }, dc: DataCenterWorld | null, s: DcSample) {
    const u = s.band;
    const { dcIn, fieldOut } = DC_BAND;
    if (u <= 0) {
      this.mode = 'field';
      gl.render(main.scene, main.camera);
      return;
    }
    if (!dc) {
      // No data-center scene (still loading, or failed): the field darkens into charcoal and stays.
      this.mode = u >= fieldOut ? 'charcoal' : 'band';
      if (u < fieldOut) gl.render(main.scene, main.camera);
      this.overlay(gl, u < fieldOut ? 1 - s.fieldGain : 1);
      return;
    }
    if (u < fieldOut) {
      this.mode = 'band';
      gl.render(main.scene, main.camera);
      this.overlay(gl, 1 - s.fieldGain);
      if (u > dcIn) {
        // Overlap (both dim): the close-up, rendered off screen, rises over the darkened field.
        const target = this.ensureTarget(gl);
        dc.renderReflection();
        const prev = gl.getRenderTarget();
        gl.setRenderTarget(target);
        gl.clear();
        gl.render(dc.scene, dc.camera);
        gl.setRenderTarget(prev);
        const w = (u - dcIn) / (fieldOut - dcIn);
        this.composite.uniforms.uScene.value = target.texture;
        this.composite.uniforms.uGain.value = s.dcGain;
        this.composite.uniforms.uAlpha.value = w * w * (3 - 2 * w);
        gl.autoClear = false;
        gl.render(this.compositeScene, this.quadCamera);
        gl.autoClear = true;
      }
      return;
    }
    this.mode = 'datacenter';
    dc.renderReflection();
    gl.render(dc.scene, dc.camera);
    if (s.dcGain < 1) this.overlay(gl, 1 - s.dcGain);
  }

  dispose() {
    this.target?.dispose();
    this.charcoal.dispose();
    this.composite.dispose();
  }

  /** Charcoal layer over what is already on screen. */
  private overlay(gl: THREE.WebGLRenderer, opacity: number) {
    if (opacity <= 0.001) return;
    this.charcoal.opacity = Math.min(1, opacity);
    gl.autoClear = false;
    gl.render(this.charcoalScene, this.quadCamera);
    gl.autoClear = true;
  }

  private ensureTarget(gl: THREE.WebGLRenderer) {
    gl.getDrawingBufferSize(this.size);
    // Reduced size: this target is only ever seen while the frame is dim.
    const w = Math.max(64, Math.round(this.size.x * 0.75)), h = Math.max(64, Math.round(this.size.y * 0.75));
    if (!this.target) this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
    else if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    return this.target;
  }
}
