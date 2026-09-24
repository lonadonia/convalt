import * as THREE from 'three';

/**
 * Procedural product-photography environment: a dark neutral cyclorama with a large key softbox,
 * an overhead soft light and a narrow rim strip. Rendered once into a PMREM (no HDR download, no
 * real-time reflections). The key produces the long gradient across the glass-like cell face; the
 * strip gives the frame its controlled edge highlight.
 */
export const STUDIO = {
  dome: { top: new THREE.Color(0.27, 0.275, 0.27), horizon: new THREE.Color(0.13, 0.14, 0.14), bottom: new THREE.Color(0.045, 0.05, 0.05) },
  key: { position: new THREE.Vector3(-5.5, 5.2, 6.5), size: [8.5, 5.2] as const, intensity: 5.6, color: new THREE.Color(1, 0.985, 0.96) },
  top: { position: new THREE.Vector3(0.5, 9, 1), size: [7, 5] as const, intensity: 1.6, color: new THREE.Color(1, 1, 1) },
  rim: { position: new THREE.Vector3(8, 1.8, -2.5), size: [0.9, 7] as const, intensity: 3.4, color: new THREE.Color(0.94, 0.98, 1) },
  fill: { position: new THREE.Vector3(1.5, 0.8, 9), size: [9, 3] as const, intensity: 0.45, color: new THREE.Color(1, 1, 1) },
};

function softbox(spec: { position: THREE.Vector3; size: readonly [number, number]; intensity: number; color: THREE.Color }) {
  const material = new THREE.MeshBasicMaterial({ color: spec.color.clone().multiplyScalar(spec.intensity), side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.size[0], spec.size[1]), material);
  mesh.position.copy(spec.position);
  mesh.lookAt(0, 0, 0);
  return mesh;
}

export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const domeMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uTop: { value: STUDIO.dome.top },
      uHorizon: { value: STUDIO.dome.horizon },
      uBottom: { value: STUDIO.dome.bottom },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(uHorizon, uTop, smoothstep(0.0, 0.7, y)) : mix(uHorizon, uBottom, smoothstep(0.0, 0.5, -y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), domeMaterial);
  scene.add(dome, softbox(STUDIO.key), softbox(STUDIO.top), softbox(STUDIO.rim), softbox(STUDIO.fill));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03, 0.1, 60);
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  });
  return target.texture;
}

/**
 * Ground shadow: signed distance to the panel footprint (projected along the key-light direction
 * onto the ground plane), softened with height. Two lobes: a soft core and a wide ambient halo.
 */
export class GroundShadow {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: {
    uQuad: { value: THREE.Vector2[] };
    uSoft: { value: number };
    uOpacity: { value: number };
    uHalo: { value: number };
    uHaloOpacity: { value: number };
    uColor: { value: THREE.Color };
  };
  private readonly corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  readonly lightDir = new THREE.Vector3(0.18, -1, -0.2).normalize();
  readonly groundY: number;

  constructor(groundY: number) {
    this.groundY = groundY;
    this.uniforms = {
      uQuad: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
      uSoft: { value: 0.1 },
      uOpacity: { value: 0.2 },
      uHalo: { value: 0.5 },
      uHaloOpacity: { value: 0.06 },
      // Deep petrol, used as-is in display space.
      uColor: { value: new THREE.Color().setRGB(0x12 / 255, 0x33 / 255, 0x36 / 255, THREE.LinearSRGBColorSpace) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vXZ = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uQuad[4];
        uniform float uSoft; uniform float uOpacity; uniform float uHalo; uniform float uHaloOpacity;
        uniform vec3 uColor;
        varying vec2 vXZ;
        float edgeDist(vec2 p, vec2 a, vec2 b, inout float s) {
          vec2 e = b - a; vec2 w = p - a;
          vec2 q = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
          bool c1 = p.y >= a.y; bool c2 = p.y < b.y; bool c3 = e.x * w.y > e.y * w.x;
          if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
          return dot(q, q);
        }
        void main() {
          float s = 1.0;
          float d = edgeDist(vXZ, uQuad[0], uQuad[3], s);
          d = min(d, edgeDist(vXZ, uQuad[1], uQuad[0], s));
          d = min(d, edgeDist(vXZ, uQuad[2], uQuad[1], s));
          d = min(d, edgeDist(vXZ, uQuad[3], uQuad[2], s));
          float sd = s * sqrt(d);
          float core = 1.0 - smoothstep(-uSoft, uSoft, sd);
          float halo = 1.0 - smoothstep(-uHalo * 0.4, uHalo, sd);
          float a = core * uOpacity + halo * uHaloOpacity;
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = groundY;
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** Updates the footprint from the panel's outline corners (world space). */
  update(worldCorners: THREE.Vector3[], strength = 1) {
    let height = 0;
    worldCorners.forEach((c, i) => {
      const t = (this.groundY - c.y) / this.lightDir.y;
      this.corners[i].copy(c).addScaledVector(this.lightDir, t);
      this.uniforms.uQuad.value[i].set(this.corners[i].x, this.corners[i].z);
      height += c.y - this.groundY;
    });
    height /= worldCorners.length;
    this.uniforms.uSoft.value = 0.05 + height * 0.32;
    this.uniforms.uHalo.value = 0.35 + height * 0.9;
    this.uniforms.uOpacity.value = (0.2 - Math.min(0.1, height * 0.1)) * strength;
    this.uniforms.uHaloOpacity.value = 0.05 * strength;
  }

  dispose = () => {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  };
}
