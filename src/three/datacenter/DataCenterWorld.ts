import * as THREE from 'three';
import { DC_CAMERA, DC_FINAL_FIT, DC_LOOK } from '../../config/datacenter';
import type { LayoutMetrics } from '../../state/overlay';
import type { Tier } from '../../state/store';
import { compileWhenReady } from '../compile';
import { CameraPath, type CameraKey, type CameraSample } from '../field/cameraPath';
import { applyLensShift, fitToRegion } from '../framing';
import type { DcAssets, DcMeta } from './dcAssets';

const IDENTITY = new THREE.Quaternion();
/** Share of the final lens shift reached at each key: the composition arrives during the pullback. */
const SHIFT_SHARE = [0, 0, 0.15, 0.45, 0.8, 1];

/** Screen area for the final view: beside the copy, or above it on portrait screens. */
function finalRegion(aspect: number, m: LayoutMetrics | null): [number, number, number, number] {
  const R = DC_FINAL_FIT;
  if (aspect < R.portraitAspect) return [R.left, R.top, R.right, Math.max(R.top + 0.25, (m?.dcTop ?? 0.55) - R.gap)];
  return [Math.min(R.maxLeft, (m?.dcRight ?? 0.36) + R.gap), R.top, R.right, R.bottom];
}

/**
 * The data-center scene (scene 04): the supplied model in its own scene, a dark-room light rig,
 * a glossy floor with a planar reflection, and one continuous camera path from a close view of a
 * cabinet to the reference three-quarter view. Built once when the model arrives; the controller
 * drives it with the section progress.
 */
export class DataCenterWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 1, 0.05, 80);
  readonly meta: DcMeta;
  /** World bounds of the installation (racks, platform, fixtures). */
  readonly bounds = new THREE.Box3();
  readonly stats: {
    triangles: number;
    drawCalls: number;
    /** Camera path audit (metres): nearest approach to any rack row or fixture, eye-height range. */
    path: { clearance: number; minHeight: number; maxHeight: number; startDistance: number };
  };

  private path: CameraPath | null = null;
  private pathKey = '';
  private disposed = false;
  private readonly sample: CameraSample = { position: new THREE.Vector3(), target: new THREE.Vector3(), shift: new THREE.Vector2(), distance: 1 };
  /** Silhouette of the installation (platform corners, rack tops, fixtures), relative to the bounds centre. */
  private readonly silhouette: THREE.Vector3[] = [];
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly env: THREE.WebGLRenderTarget;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly assets: DcAssets;
  private readonly ledUniforms = { uTime: { value: 0 }, uActivity: { value: 0 } };
  private readonly mirror = {
    target: new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter }),
    camera: new THREE.PerspectiveCamera(),
    matrix: new THREE.Matrix4(),
    floors: [] as THREE.Object3D[],
    size: new THREE.Vector2(),
    fwd: new THREE.Vector3(),
    up: new THREE.Vector3(),
    look: new THREE.Vector3(),
  };

  constructor(renderer: THREE.WebGLRenderer, assets: DcAssets) {
    this.renderer = renderer;
    this.assets = assets;
    this.meta = assets.meta;
    this.scene.name = 'DataCenters';
    this.scene.background = new THREE.Color(DC_LOOK.background);
    this.scene.add(assets.root);
    this.bounds.set(new THREE.Vector3(...this.meta.bounds.min), new THREE.Vector3(...this.meta.bounds.max));
    const centre = this.bounds.getCenter(new THREE.Vector3());
    const P = this.meta.platform.half;
    for (const [x, z] of [[-P, -P], [P, -P], [P, P], [-P, P]]) this.silhouette.push(new THREE.Vector3(x, 0, z).sub(centre));
    for (const r of this.meta.rows) for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]]) this.silhouette.push(new THREE.Vector3(x, r.h, z).sub(centre));
    for (const f of this.meta.fixtures) for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) this.silhouette.push(new THREE.Vector3(f.cx + (dx * f.w) / 2, f.y + 0.05, f.cz + (dz * f.d) / 2).sub(centre));

    // Materials: the model's own maps and colour spaces are kept; values tuned for a dark room.
    for (const [name, spec] of Object.entries(DC_LOOK.materials)) {
      const m = assets.materials.get(name);
      if (!m) continue;
      m.color.set(spec.color);
      m.metalness = spec.metalness;
      m.roughness = spec.roughness;
      m.envMapIntensity = spec.envMapIntensity;
      if (spec.emissive) { m.emissive.set(spec.emissive); m.emissiveIntensity = spec.emissiveIntensity ?? 1; }
    }
    this.addFloorShading(assets.materials.get('FloorTile'), true);
    this.addFloorShading(assets.materials.get('FloorGrout'), false);
    this.addIndicatorActivity(assets.materials.get('LedGreen'));
    assets.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && /^Floor/.test((mesh.material as THREE.Material).name)) this.mirror.floors.push(mesh);
    });

    // Reflections: a dark room lit only by the nine fixtures (+ two faint side panels for edges).
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.env = this.pmrem.fromScene(this.environmentScene(), 0.02, 0.1, 100);
    this.scene.environment = this.env.texture;

    // Light: the fixtures' combined overhead light, a soft fill toward the fronts, sky/ground fill.
    const L = DC_LOOK;
    const overhead = new THREE.DirectionalLight(L.overhead.color, L.overhead.intensity);
    overhead.position.set(...L.overhead.dir).multiplyScalar(10);
    const front = new THREE.DirectionalLight(L.front.color, L.front.intensity);
    front.position.set(...L.front.dir).multiplyScalar(10);
    const hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
    this.scene.add(overhead, front, hemi);

    let triangles = 0, drawCalls = 0;
    assets.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      drawCalls++;
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    });
    this.stats = { triangles, drawCalls, path: { clearance: 0, minHeight: 0, maxHeight: 0, startDistance: 0 } };
  }

  /** Rebuilds the camera path for a viewport (tier lens, aspect, measured copy). */
  setFraming(tier: Tier, aspect: number, metrics: LayoutMetrics | null) {
    const key = `${tier}|${aspect.toFixed(4)}|${metrics?.key ?? ''}`;
    if (key === this.pathKey && this.path) return;
    this.pathKey = key;
    const cfg = DC_CAMERA[tier];
    this.camera.fov = cfg.fov;
    const keys: CameraKey[] = cfg.keys.map((k) => ({ t: k.t, target: new THREE.Vector3(...k.target), az: k.az, el: k.el, dist: k.dist, shift: new THREE.Vector2(...(k.shift ?? [0, 0])) }));
    const last = keys[keys.length - 1];
    {
      // Final view on every screen: the whole installation (platform and fixtures included) fitted
      // beside the copy — or above it on portrait screens — with the key's direction kept.
      const f = fitToRegion({ halfExtents: new THREE.Vector3(), orientation: IDENTITY, points: this.silhouette, azimuthDeg: last.az, elevationDeg: last.el, fov: cfg.fov, aspect, region: finalRegion(aspect, metrics) });
      this.bounds.getCenter(last.target);
      last.dist = f.distance;
      last.shift.copy(f.shift);
    }
    keys.forEach((k, i) => { if (i < keys.length - 1) k.shift.copy(last.shift).multiplyScalar(SHIFT_SHARE[i] ?? 1); });
    this.path = new CameraPath(keys);
    this.auditPath();
  }

  /** Samples the whole path: the camera must stay in open space (never inside or through geometry). */
  private auditPath() {
    if (!this.path) return;
    const boxes = [
      ...this.meta.rows.map((r) => new THREE.Box3(new THREE.Vector3(r.x0, 0, r.z0), new THREE.Vector3(r.x1, r.h, r.z1))),
      ...this.meta.fixtures.map((f) => new THREE.Box3(new THREE.Vector3(f.cx - f.w / 2, f.y - 0.02, f.cz - f.d / 2), new THREE.Vector3(f.cx + f.w / 2, f.y + 0.06, f.cz + f.d / 2))),
    ];
    const s: CameraSample = { position: new THREE.Vector3(), target: new THREE.Vector3(), shift: new THREE.Vector2(), distance: 1 };
    let clearance = Infinity, minHeight = Infinity, maxHeight = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const c = this.path.sample(i / 200, s);
      for (const b of boxes) clearance = Math.min(clearance, b.distanceToPoint(c.position));
      minHeight = Math.min(minHeight, c.position.y);
      maxHeight = Math.max(maxHeight, c.position.y);
    }
    const start = this.path.sample(DC_CAMERA.desktop.keys[0].t, s);
    this.stats.path = { clearance: +clearance.toFixed(3), minHeight: +minHeight.toFixed(3), maxHeight: +maxHeight.toFixed(3), startDistance: +start.distance.toFixed(3) };
  }

  /** Camera for section progress t; indicator activity (quiet, optional). */
  update(t: number, aspect: number, time: number, activity: boolean) {
    if (!this.path) return;
    const c = this.path.sample(t, this.sample);
    const cam = this.camera;
    cam.aspect = aspect;
    cam.position.copy(c.position);
    cam.up.set(0, 1, 0);
    cam.lookAt(c.target);
    cam.near = Math.max(0.03, Math.min(0.25, c.distance * 0.04));
    cam.far = 80;
    applyLensShift(cam, c.shift);
    cam.updateMatrixWorld();
    this.ledUniforms.uTime.value = time;
    this.ledUniforms.uActivity.value = activity ? 1 : 0;
  }

  /**
   * Renders the floor reflection for the current camera (call before rendering the scene): the
   * camera mirrored in the floor plane, the floor itself hidden, at a fraction of the canvas size.
   */
  renderReflection() {
    const r = this.renderer, M = this.mirror, cam = this.camera;
    r.getDrawingBufferSize(M.size);
    const w = Math.max(64, Math.round(M.size.x * DC_LOOK.mirror.resolution)), h = Math.max(64, Math.round(M.size.y * DC_LOOK.mirror.resolution));
    if (M.target.width !== w || M.target.height !== h) M.target.setSize(w, h);
    // Mirror about y = 0: reflect position, forward and up; keep the (shifted) projection.
    const mc = M.camera;
    mc.position.set(cam.position.x, -cam.position.y, cam.position.z);
    const fwd = M.fwd.set(0, 0, -1).transformDirection(cam.matrixWorld);
    const up = M.up.set(0, 1, 0).transformDirection(cam.matrixWorld);
    fwd.y = -fwd.y; up.y = -up.y;
    mc.up.copy(up);
    mc.lookAt(M.look.copy(mc.position).add(fwd));
    mc.updateMatrixWorld();
    mc.projectionMatrix.copy(cam.projectionMatrix);
    mc.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    M.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse);
    for (const f of M.floors) f.visible = false;
    const prev = r.getRenderTarget();
    r.setRenderTarget(M.target);
    r.clear();
    r.render(this.scene, mc);
    r.setRenderTarget(prev);
    for (const f of M.floors) f.visible = true;
  }

  /** Upload textures and compile programs before the scene is first seen. */
  async prepare() {
    for (const m of this.assets.materials.values()) for (const tx of [m.map, m.emissiveMap]) if (tx) this.renderer.initTexture(tx);
    await compileWhenReady(this.renderer, this.scene, this.camera, () => !this.disposed);
  }

  dispose() {
    this.disposed = true;
    this.env.dispose();
    this.pmrem.dispose();
    this.mirror.target.dispose();
    this.scene.remove(this.assets.root);
  }

  private environmentScene() {
    const s = new THREE.Scene();
    const L = DC_LOOK.env;
    const room = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 26), new THREE.MeshBasicMaterial({ color: L.room, side: THREE.BackSide }));
    room.position.y = 3;
    s.add(room);
    const light = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.99, 0.97).multiplyScalar(L.fixture), side: THREE.DoubleSide });
    for (const f of this.meta.fixtures) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.d), light);
      p.rotation.x = Math.PI / 2;
      p.position.set(f.cx, f.y - 0.005, f.cz);
      s.add(p);
    }
    const side = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.85, 0.9).multiplyScalar(L.side), side: THREE.DoubleSide });
    for (const x of [-12.5, 12.5]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), side);
      p.rotation.y = Math.PI / 2;
      p.position.set(x, 2.2, 0);
      s.add(p);
    }
    // Capture from mid-height, not from the floor.
    s.position.y = -1.2;
    return s;
  }

  /**
   * Floor shading: soft contact darkening around each rack row (analytic, no extra pass) and, on
   * the glossy tiles, the planar reflection sampled through its mip chain (softened, Fresnel-weighted).
   */
  private addFloorShading(material: THREE.MeshStandardMaterial | undefined, mirror: boolean) {
    if (!material) return;
    const rows = this.meta.rows.map((r) => new THREE.Vector4(r.x0, r.z0, r.x1, r.z1));
    const { strength, radius } = DC_LOOK.floorAo;
    const M = this.mirror;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRows = { value: rows };
      if (mirror) {
        shader.uniforms.uMirror = { value: M.target.texture };
        shader.uniforms.uMirrorMatrix = { value: M.matrix };
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vDcWorld;${mirror ? '\nuniform mat4 uMirrorMatrix;\nvarying vec4 vMirrorUv;' : ''}`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvDcWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;${mirror ? '\nvMirrorUv = uMirrorMatrix * vec4(vDcWorld, 1.0);' : ''}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vDcWorld;\nuniform vec4 uRows[${rows.length}];${mirror ? '\nuniform sampler2D uMirror;\nvarying vec4 vMirrorUv;' : ''}`)
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
  {
    float contact = 1.0;
    for (int i = 0; i < ${rows.length}; i++) {
      vec2 c = (uRows[i].xy + uRows[i].zw) * 0.5, h = (uRows[i].zw - uRows[i].xy) * 0.5;
      float d = length(max(abs(vDcWorld.xz - c) - h, 0.0));
      contact *= 1.0 - ${strength.toFixed(3)} * (1.0 - smoothstep(0.0, ${radius.toFixed(3)}, d));
    }
    reflectedLight.directDiffuse *= contact;
    reflectedLight.indirectDiffuse *= contact;
    reflectedLight.directSpecular *= contact;
    reflectedLight.indirectSpecular *= mix(1.0, contact, 0.8);${mirror ? `
    float facing = clamp(dot(normalize(vViewPosition), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
    vec3 mirrored = textureProj(uMirror, vMirrorUv, ${DC_LOOK.mirror.blur.toFixed(2)}).rgb;
    reflectedLight.indirectSpecular += mirrored * ${DC_LOOK.mirror.strength.toFixed(3)} * mix(0.35, 1.0, fresnel) * mix(1.0, contact, 0.5);` : ''}
  }`,
        );
    };
    material.customProgramCacheKey = () => `dc-floor-${mirror ? 'mirror' : 'plain'}-${material.name}`;
    material.needsUpdate = true;
  }

  /**
   * Quiet indicator activity: a sparse few green indicators dim briefly, driven by a position hash
   * and a slow clock (never the whole room). Off for reduced motion and whenever the scene is still.
   */
  private addIndicatorActivity(material: THREE.MeshStandardMaterial | undefined) {
    if (!material) return;
    const u = this.ledUniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLedPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLedPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vLedPos; uniform float uTime; uniform float uActivity;
float ledHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec2 cell = floor(vLedPos.xy * vec2(9.0, 14.0)) + floor(vLedPos.z * 1.1) * 17.0;
    float phase = ledHash(cell) * 40.0;
    float on = step(0.975, ledHash(cell + floor(uTime * 0.6 + phase)));
    totalEmissiveRadiance *= 1.0 - 0.7 * on * uActivity;
  }`);
    };
    material.customProgramCacheKey = () => 'dc-led-activity';
    material.needsUpdate = true;
  }
}
