import * as THREE from 'three';
import { OUTDOOR, REVEAL } from '../../config/field';
import { buildLayout, type FieldLayout } from '../../field/layout';
import type { Tier } from '../../state/store';
import { clamp, easeOutCubic, smoothstep } from '../../lib/math';
import { compileWhenReady } from '../compile';
import { EnvironmentBlend } from './environmentBlend';
import type { FieldAssets } from './fieldAssets';
import { createSky, createTerrainMaterial, withInstanceOpacity, type SkyUniforms } from './fieldMaterials';

/** Per-frame inputs from the scene controller (all derived from the journey progress). */
export type FieldFrame = {
  /** 0 = studio, 1 = outdoors (light, sky, reflections, haze). */
  environment: number;
  /** Exponential-squared haze density. */
  fog: number;
  /** Field progress (0–1); the reveal front is resolved against this layout. */
  t: number;
  /** Progress of the hero table's structure (appears just before the panel settles). */
  heroTable: number;
  /** Hero crossfade: 0 = Module scene's panel, 1 = supplied field module. */
  heroSwap: number;
  camera: THREE.Camera;
};

export type FieldLights = { studioKey: THREE.DirectionalLight; studioFill: THREE.HemisphereLight; sun: THREE.DirectionalLight; sky: THREE.HemisphereLight };

const FADE_CAPACITY = 96;
const IVORY = new THREE.Color('#f5f4ee');
const HORIZON = new THREE.Color(OUTDOOR.sky.horizon);
const STUDIO_KEY = 1.15, STUDIO_FILL = 0.35;

type InstanceSet = {
  opaque: THREE.InstancedMesh;
  fading: THREE.InstancedMesh;
  opacity: THREE.InstancedBufferAttribute;
  lastOpaque: number;
};

function instanceSet(geometry: THREE.BufferGeometry, base: THREE.MeshStandardMaterial, total: number, name: string): InstanceSet {
  const opaque = new THREE.InstancedMesh(geometry, base, Math.max(1, total));
  opaque.name = `${name}-placed`;
  opaque.count = 0;
  opaque.castShadow = true;
  const { material, depth } = withInstanceOpacity(base);
  const fadeGeometry = geometry.clone();
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(FADE_CAPACITY), 1);
  opacity.setUsage(THREE.DynamicDrawUsage);
  fadeGeometry.setAttribute('instanceOpacity', opacity);
  const fading = new THREE.InstancedMesh(fadeGeometry, material, FADE_CAPACITY);
  fading.name = `${name}-arriving`;
  fading.count = 0;
  fading.castShadow = true;
  fading.customDepthMaterial = depth;
  fading.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return { opaque, fading, opacity, lastOpaque: -1 };
}

/**
 * The outdoor scene: terrain, sky, the installation (instanced modules and supports) and the hero
 * module that takes over from the Module scene's panel. Built once when its assets arrive; the
 * controller drives it with one FieldFrame per rendered frame.
 */
export class FieldWorld {
  readonly root = new THREE.Group();
  readonly layout: FieldLayout;
  /** The supplied module as the hero (child of the pose root; registered to the Module scene's panel). */
  readonly hero: THREE.Mesh;
  /** Pose-root pose at which the hero module sits exactly in its slot. */
  readonly heroRootPose: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  /** World bounds of the complete installation (modules and structure down to the ground). */
  readonly bounds = new THREE.Box3();
  readonly stats: {
    modules: number; tables: number; supports: number; rejected: number; clearance: [number, number]; legs: [number, number];
    /** What the last frame showed (validation): reveal front, placed / arriving modules and support boxes. */
    live: { reveal: number; placed: number; arriving: number; supportsPlaced: number; supportsArriving: number; heroSwap: number };
  };

  private readonly fieldGroup = new THREE.Group();
  private readonly terrain: THREE.Mesh;
  private readonly terrainUniforms: ReturnType<typeof createTerrainMaterial>['uniforms'];
  private readonly sky: THREE.Mesh;
  private readonly skyUniforms: SkyUniforms;
  private readonly modules: InstanceSet;
  private readonly supports: InstanceSet;
  private readonly moduleNormals: THREE.Vector3[];
  private readonly moduleReveal: Float32Array;
  private readonly supportTableEnd: number[];
  private readonly supportMatrices: THREE.Matrix4[];
  private readonly heroMaterial: THREE.MeshStandardMaterial;
  private readonly heroFade: THREE.MeshStandardMaterial;
  private readonly env: EnvironmentBlend;
  private readonly fog: THREE.FogExp2;
  private disposed = false;
  private readonly horizon = new THREE.Color();
  private readonly rgb = { r: 0, g: 0, b: 0 };
  private readonly sunDir: THREE.Vector3;
  private last = { reveal: NaN, heroTable: NaN, heroSwap: NaN };
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3(1, 1, 1);
  private order: Array<{ i: number; d: number }> = [];
  private readonly front: Array<[number, number]>;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly lights: FieldLights;
  private readonly studioEnvironment: () => THREE.Texture | null;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    lights: FieldLights,
    studioEnvironment: () => THREE.Texture | null,
    assets: FieldAssets,
    heroOriginalThickness: number,
    tier: Tier,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.lights = lights;
    this.studioEnvironment = studioEnvironment;
    const mod = assets.module;
    this.layout = buildLayout(assets.terrain.sampler, { width: mod.size[0], height: mod.size[1], thickness: mod.size[2] });
    const L = this.layout;
    this.root.name = 'PowerGeneration';
    this.root.visible = false;

    // Terrain in the field frame (quantized node transform kept), placed into the world.
    this.fieldGroup.matrixAutoUpdate = false;
    this.fieldGroup.matrix.copy(L.worldFromField);
    const farCentre = new THREE.Vector2(assets.terrain.meta.site.x, assets.terrain.meta.site.z);
    const scan = assets.terrain.meta.scan;
    const farStart = Math.min(scan.x1 - scan.x0, scan.z1 - scan.z0) * 0.5 + 40;
    const t = createTerrainMaterial({ textures: assets.layers, rects: assets.terrain.meta.layers, localToField: assets.terrain.localToField, farCentre, far: [farStart, farStart + 190] });
    this.terrainUniforms = t.uniforms;
    this.terrain = new THREE.Mesh(assets.terrain.geometry, t.material);
    this.terrain.name = 'Terrain';
    this.terrain.matrixAutoUpdate = false;
    this.terrain.matrix.copy(assets.terrain.localToField);
    this.terrain.receiveShadow = true;
    this.fieldGroup.add(this.terrain);
    this.root.add(this.fieldGroup);

    // Sky.
    const sky = createSky(1500);
    this.sky = sky.mesh;
    this.skyUniforms = sky.uniforms;
    this.sunDir = new THREE.Vector3(...OUTDOOR.sun.dir).normalize();
    sky.uniforms.uZenith.value.set(OUTDOOR.sky.zenith);
    sky.uniforms.uHorizon.value.set(OUTDOOR.sky.horizon);
    sky.uniforms.uGround.value.set(OUTDOOR.sky.ground);
    sky.uniforms.uSunGlow.value.set(OUTDOOR.sky.sunGlow);
    sky.uniforms.uSunDir.value.copy(this.sunDir);
    this.root.add(this.sky);

    // Installation: modules sorted by reveal distance; supports grouped by table in reveal order.
    this.modules = instanceSet(mod.geometry, mod.material, L.modules.length, 'Modules');
    const m = new THREE.Matrix4();
    L.modules.forEach((slot, i) => this.modules.opaque.setMatrixAt(i, m.compose(slot.position, slot.quaternion, new THREE.Vector3(1, 1, 1))));
    this.modules.opaque.instanceMatrix.needsUpdate = true;
    this.moduleNormals = L.modules.map((slot) => new THREE.Vector3(0, 0, 1).applyQuaternion(slot.quaternion));
    this.moduleReveal = Float32Array.from(L.modules.map((slot) => slot.reveal));
    const steel = new THREE.MeshStandardMaterial({ color: '#8c9497', metalness: 0.55, roughness: 0.52, envMapIntensity: 0.7 });
    const boxes = L.tables.flatMap((tb) => tb.supports);
    this.supports = instanceSet(new THREE.BoxGeometry(1, 1, 1), steel, boxes.length, 'Supports');
    this.supportMatrices = boxes.map((b) => new THREE.Matrix4().compose(b.position, b.quaternion, b.scale));
    this.supportMatrices.forEach((mx, i) => this.supports.opaque.setMatrixAt(i, mx));
    this.supports.opaque.instanceMatrix.needsUpdate = true;
    let acc = 0;
    this.supportTableEnd = L.tables.map((tb) => (acc += tb.supports.length));
    const reach = new THREE.Vector3().setScalar(Math.hypot(mod.size[0], mod.size[1]) / 2);
    for (const slot of [...L.modules, L.hero]) this.bounds.union(new THREE.Box3(slot.position.clone().sub(reach), slot.position.clone().add(reach)));
    for (const b of boxes) this.bounds.union(new THREE.Box3().setFromCenterAndSize(b.position, b.scale));
    for (const set of [this.modules, this.supports]) this.root.add(set.opaque, set.fading);

    // Hero: the supplied module, registered to the Module scene's panel (cell-field centres, its glass
    // 1 mm in front of the old front face so the crossfade blends over it without z-fighting).
    this.heroMaterial = mod.material;
    this.heroFade = mod.material.clone();
    this.heroFade.transparent = true;
    this.heroFade.opacity = 0;
    this.hero = new THREE.Mesh(mod.geometry, this.heroFade);
    this.hero.name = 'HeroFieldModule';
    this.hero.castShadow = true;
    this.hero.visible = false;
    this.hero.renderOrder = 2;
    const align = new THREE.Vector3(-mod.cellField.cx, -mod.cellField.cy, heroOriginalThickness / 2 + 0.001 - mod.glassZ);
    this.hero.position.copy(align);
    this.heroRootPose = {
      quaternion: L.hero.quaternion.clone(),
      position: L.hero.position.clone().sub(align.clone().applyQuaternion(L.hero.quaternion)),
    };

    // Lights: sun shadow covers the installation only (one map).
    const sun = lights.sun;
    const ext = OUTDOOR.shadow.halfExtent;
    sun.shadow.mapSize.setScalar(OUTDOOR.shadow.mapSize[tier]);
    // The light exists from the start, so three may already hold a map at the default size; a map
    // is only (re)allocated when missing (a size mismatch renders into the wrong viewport). Re-create
    // it on the very next render: until then its shadow sampler would have no depth texture bound.
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    renderer.shadowMap.needsUpdate = true;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 420 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3; // PCF (Vogel disk) softening
    sun.shadow.intensity = 0.9;
    sun.position.copy(L.siteCentre).addScaledVector(this.sunDir, 180);
    sun.target.position.copy(L.siteCentre);
    sun.target.updateMatrixWorld();
    sun.color.set(OUTDOOR.sun.color);
    lights.sky.color.set(OUTDOOR.hemi.sky);
    lights.sky.groundColor.set(OUTDOOR.hemi.ground);

    this.env = new EnvironmentBlend(renderer, OUTDOOR.sky, this.sunDir, OUTDOOR.sun.color);
    this.env.warm();
    this.fog = scene.fog instanceof THREE.FogExp2 ? scene.fog : new THREE.FogExp2(IVORY.getHex(), 0);
    scene.fog = this.fog;

    // Reveal stops: symbolic ones measured on this layout.
    const maxOf = (pred: (m: FieldLayout['modules'][number]) => boolean) => Math.max(0, ...L.modules.filter(pred).map((m) => m.reveal)) + REVEAL.band + 0.01;
    const heroTable = (m: FieldLayout['modules'][number]) => m.row === L.hero.row && m.table === L.hero.table;
    const named = { table: maxOf(heroTable), row: maxOf((m) => m.row === L.hero.row), rows3: maxOf((m) => m.row <= L.hero.row + 2), rows6: maxOf((m) => m.row <= L.hero.row + 5), all: maxOf(() => true) };
    this.front = REVEAL.front.map(([t, v]) => [t, typeof v === 'number' ? v : named[v]]);

    const clear = L.tables.map((tb) => tb.clearance);
    const legs = L.tables.map((tb) => tb.legs);
    this.stats = {
      modules: L.modules.length + 1,
      tables: L.tables.length,
      supports: boxes.length,
      rejected: L.rejected.length,
      clearance: [Math.min(...clear.map((c) => c[0])), Math.max(...clear.map((c) => c[1]))],
      legs: [Math.min(...legs.map((l) => l[0])), Math.max(...legs.map((l) => l[1]))],
      live: { reveal: 0, placed: 0, arriving: 0, supportsPlaced: 0, supportsArriving: 0, heroSwap: 0 },
    };
  }

  /** Upload textures and compile programs before the scene is first seen. */
  async prepare(camera: THREE.Camera) {
    for (const tex of Object.values(this.terrainUniforms).map((u) => (u as { value: unknown }).value).filter((v): v is THREE.Texture => v instanceof THREE.Texture)) this.renderer.initTexture(tex);
    const wasVisible = this.root.visible;
    this.root.visible = true;
    this.hero.visible = true;
    this.modules.opaque.count = 1; this.modules.fading.count = 1; this.supports.opaque.count = 1; this.supports.fading.count = 1;
    await compileWhenReady(this.renderer, this.scene, camera, () => !this.disposed);
    this.modules.opaque.count = 0; this.modules.fading.count = 0; this.supports.opaque.count = 0; this.supports.fading.count = 0;
    this.modules.lastOpaque = -1; this.supports.lastOpaque = -1;
    this.hero.visible = false;
    this.root.visible = wasVisible;
  }

  /** Applies one frame. Returns whether the shadow map needs re-rendering. */
  update(f: FieldFrame): boolean {
    const active = f.environment > 0.0005 || f.heroSwap > 0;
    this.root.visible = active;
    // Light and reflections: studio → outdoors.
    const b = f.environment;
    this.lights.studioKey.intensity = STUDIO_KEY * (1 - b);
    this.lights.studioFill.intensity = STUDIO_FILL * (1 - b);
    this.lights.sun.intensity = OUTDOOR.sun.intensity * b;
    this.lights.sky.intensity = OUTDOOR.hemi.intensity * b;
    this.scene.environment = b > 0.0005 ? this.env.texture(b) : this.studioEnvironment();
    // Sky, haze and the terrain's far fade share one colour at every step of the transition.
    const reveal = smoothstep(clamp(b * 1.15));
    this.skyUniforms.uReveal.value = reveal;
    this.horizon.copy(IVORY).lerp(HORIZON, reveal);
    this.fog.color.copy(this.horizon);
    this.horizon.getRGB(this.rgb, THREE.SRGBColorSpace);
    this.terrainUniforms.uHorizon.value.set(this.rgb.r, this.rgb.g, this.rgb.b);
    this.fog.density = active ? f.fog : 0;
    this.sky.position.copy((f.camera as THREE.PerspectiveCamera).position);

    // Hero crossfade (the new module blends over the Module scene's panel, then replaces it).
    const swap = clamp(f.heroSwap);
    this.hero.visible = swap > 0.001;
    if (swap >= 0.999) { this.hero.material = this.heroMaterial; this.hero.renderOrder = 0; }
    else { this.hero.material = this.heroFade; this.heroFade.opacity = swap; this.hero.renderOrder = 2; }

    const R = this.revealAt(f.t), band = REVEAL.band;
    let shadowDirty = active && (R !== this.last.reveal || f.heroTable !== this.last.heroTable || swap !== this.last.heroSwap);
    this.last = { reveal: R, heroTable: f.heroTable, heroSwap: swap };
    if (!active) {
      Object.assign(this.stats.live, { reveal: R, placed: 0, arriving: 0, supportsPlaced: 0, supportsArriving: 0, heroSwap: swap });
      return false;
    }

    // Modules: fully revealed prefix in the opaque mesh; the band in transition in the fading mesh.
    let placed = 0;
    while (placed < this.moduleReveal.length && this.moduleReveal[placed] <= R - band) placed++;
    this.setOpaqueCount(this.modules, placed);
    this.order.length = 0;
    for (let i = placed; i < this.moduleReveal.length && this.moduleReveal[i] < R && this.order.length < FADE_CAPACITY; i++) {
      this.order.push({ i, d: this.tmpV.copy(this.layout.modules[i].position).distanceToSquared(f.camera.position) });
    }
    this.order.sort((a, c) => c.d - a.d);
    this.order.forEach(({ i }, k) => {
      const p = clamp((R - this.moduleReveal[i]) / band);
      const slot = this.layout.modules[i];
      this.tmpV.copy(slot.position).addScaledVector(this.moduleNormals[i], REVEAL.drop * (1 - easeOutCubic(p)));
      this.modules.fading.setMatrixAt(k, this.tmpM.compose(this.tmpV, slot.quaternion, this.tmpS));
      this.modules.opacity.setX(k, smoothstep(p));
    });
    this.commitFading(this.modules, this.order.length);

    // Supports: the hero table's structure on its own schedule, the rest just ahead of their modules.
    let tablesPlaced = 0, supportFade = 0;
    const tables = this.layout.tables;
    const progressOf = (k: number) => (k === 0 ? f.heroTable : clamp((R + REVEAL.supportLead - tables[k].reveal) / 3));
    while (tablesPlaced < tables.length && progressOf(tablesPlaced) >= 1) tablesPlaced++;
    this.setOpaqueCount(this.supports, tablesPlaced ? this.supportTableEnd[tablesPlaced - 1] : 0);
    for (let k = tablesPlaced; k < tables.length; k++) {
      const p = progressOf(k);
      if (p <= 0) break;
      const start = k ? this.supportTableEnd[k - 1] : 0;
      for (let s = start; s < this.supportTableEnd[k] && supportFade < FADE_CAPACITY; s++) {
        this.supports.fading.setMatrixAt(supportFade, this.supportMatrices[s]);
        this.supports.opacity.setX(supportFade, smoothstep(p));
        supportFade++;
      }
    }
    this.commitFading(this.supports, supportFade);
    Object.assign(this.stats.live, { reveal: R, placed, arriving: this.order.length, supportsPlaced: this.supports.lastOpaque, supportsArriving: supportFade, heroSwap: swap });
    shadowDirty ||= this.order.length > 0 || supportFade > 0;
    return shadowDirty;
  }

  /** Reveal front (m) at field progress t: smooth first step, then linear segments between stops. */
  private revealAt(t: number) {
    const k = this.front;
    if (t <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) {
      if (t <= k[i][0]) {
        const u = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
        return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (i === 1 ? u * u * (3 - 2 * u) : u);
      }
    }
    return k[k.length - 1][1];
  }

  private setOpaqueCount(set: InstanceSet, count: number) {
    if (count === set.lastOpaque) return;
    set.opaque.count = count;
    set.lastOpaque = count;
    set.opaque.visible = count > 0;
    // Bounds follow the growing installation, so frustum culling stays correct.
    if (count > 0) set.opaque.computeBoundingSphere();
  }

  private commitFading(set: InstanceSet, count: number) {
    set.fading.count = count;
    set.fading.visible = count > 0;
    if (!count) return;
    set.fading.instanceMatrix.needsUpdate = true;
    set.opacity.needsUpdate = true;
    set.fading.computeBoundingSphere();
  }

  dispose() {
    this.disposed = true;
    this.env.dispose();
    for (const set of [this.modules, this.supports]) {
      set.opaque.dispose();
      set.fading.geometry.dispose();
      (set.fading.material as THREE.Material).dispose();
      set.fading.customDepthMaterial?.dispose();
      set.fading.dispose();
    }
    this.supports.opaque.geometry.dispose();
    (this.supports.opaque.material as THREE.Material).dispose();
    (this.terrain.material as THREE.Material).dispose();
    (this.sky.material as THREE.Material).dispose();
    this.sky.geometry.dispose();
    this.heroFade.dispose();
    this.root.removeFromParent();
    this.hero.removeFromParent();
  }
}
