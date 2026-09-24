import * as THREE from 'three';
import { STUDIO } from '../studio';

/**
 * Reflection environment that moves from the product studio (dark cyclorama, softboxes) to the
 * outdoors (sky gradient, sun, ground) as one blend value b ∈ [0, 1]. The blend scene contains both
 * and is re-rendered into a PMREM only when b has moved by a visible step, so reflections on the
 * glossy panels change gradually with the light instead of switching. b = 0 and b = 1 are cached.
 */
export class EnvironmentBlend {
  private readonly scene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly uniforms = {
    uBlend: { value: 0 },
    uStudioTop: { value: STUDIO.dome.top.clone() },
    uStudioHorizon: { value: STUDIO.dome.horizon.clone() },
    uStudioBottom: { value: STUDIO.dome.bottom.clone() },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
  };
  private readonly softboxes: Array<{ mesh: THREE.Mesh; color: THREE.Color }> = [];
  private readonly sun: THREE.Mesh;
  private readonly sunColor: THREE.Color;
  private readonly cache = new Map<'studio' | 'outdoor', THREE.WebGLRenderTarget>();
  private dynamic: THREE.WebGLRenderTarget | null = null;
  private lastB = -1;
  private current: THREE.Texture | null = null;
  readonly step: number;

  constructor(renderer: THREE.WebGLRenderer, sky: { zenith: string; horizon: string; ground: string }, sunDir: THREE.Vector3, sunColor: string, opts: { step?: number } = {}) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.step = opts.step ?? 1 / 40;
    this.uniforms.uZenith.value.set(sky.zenith);
    this.uniforms.uHorizon.value.set(sky.horizon);
    this.uniforms.uGround.value.set(sky.ground);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(40, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uBlend; uniform vec3 uStudioTop; uniform vec3 uStudioHorizon; uniform vec3 uStudioBottom;
          uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
          varying vec3 vDir;
          void main() {
            float y = vDir.y;
            vec3 studio = y > 0.0 ? mix(uStudioHorizon, uStudioTop, smoothstep(0.0, 0.7, y)) : mix(uStudioHorizon, uStudioBottom, smoothstep(0.0, 0.5, -y));
            vec3 sky = y > 0.0 ? mix(uHorizon, uZenith, smoothstep(0.0, 0.6, y)) : mix(uHorizon, uGround, smoothstep(0.0, 0.2, -y));
            gl_FragColor = vec4(mix(studio, sky, uBlend), 1.0);
          }`,
      }),
    );
    this.scene.add(dome);
    for (const spec of [STUDIO.key, STUDIO.top, STUDIO.rim, STUDIO.fill]) {
      const color = spec.color.clone().multiplyScalar(spec.intensity);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.size[0], spec.size[1]), new THREE.MeshBasicMaterial({ color: color.clone(), side: THREE.DoubleSide, toneMapped: false }));
      mesh.position.copy(spec.position);
      mesh.lookAt(0, 0, 0);
      this.scene.add(mesh);
      this.softboxes.push({ mesh, color });
    }
    this.sunColor = new THREE.Color(sunColor).multiplyScalar(30);
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, toneMapped: false }));
    this.sun.position.copy(sunDir).normalize().multiplyScalar(30);
    this.sun.lookAt(0, 0, 0);
    this.scene.add(this.sun);
  }

  private render(b: number): THREE.WebGLRenderTarget {
    this.uniforms.uBlend.value = b;
    for (const s of this.softboxes) (s.mesh.material as THREE.MeshBasicMaterial).color.copy(s.color).multiplyScalar(1 - b);
    (this.sun.material as THREE.MeshBasicMaterial).color.copy(this.sunColor).multiplyScalar(b);
    return this.pmrem.fromScene(this.scene, 0.03, 0.1, 60);
  }

  /** Environment texture for blend b (re-rendered only when b moved by ≥ step). */
  texture(b: number): THREE.Texture {
    const key = b <= 0.001 ? 'studio' : b >= 0.999 ? 'outdoor' : null;
    if (key) {
      if (!this.cache.has(key)) this.cache.set(key, this.render(key === 'studio' ? 0 : 1));
      this.lastB = key === 'studio' ? 0 : 1;
      this.current = this.cache.get(key)!.texture;
      return this.current;
    }
    if (!this.current || Math.abs(b - this.lastB) >= this.step) {
      const target = this.render(b);
      this.dynamic?.dispose();
      this.dynamic = target;
      this.lastB = b;
      this.current = target.texture;
    }
    return this.current;
  }

  /** Pre-renders both ends (call while loading, not during the transition). */
  warm() {
    this.texture(0);
    this.texture(1);
  }

  dispose() {
    this.dynamic?.dispose();
    for (const t of this.cache.values()) t.dispose();
    this.pmrem.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
  }
}
