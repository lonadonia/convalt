import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { FIELD_ASSETS } from '../../config/field';
import { createTerrainSampler, type TerrainSampler } from '../../field/terrainSampler';
import type { Tier } from '../../state/store';

type Rect = { x0: number; z0: number; x1: number; z1: number };

export type FieldModuleAsset = {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  size: [number, number, number];
  frontZ: number;
  glassZ: number;
  cellField: { hx: number; hy: number; cx: number; cy: number };
};

export type FieldAssets = {
  module: FieldModuleAsset;
  terrain: {
    geometry: THREE.BufferGeometry;
    /** Quantized mesh local → field frame (the glTF node transform). */
    localToField: THREE.Matrix4;
    sampler: TerrainSampler;
    meta: { scan: Rect; extent: Rect; layers: { inset: Rect; scan: Rect; apron: Rect }; site: { x: number; z: number } };
  };
  layers: { inset: THREE.Texture; scan: THREE.Texture; apron: THREE.Texture };
  dispose(): void;
};

const TIMEOUT_MS = 45000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`Timed out loading ${label}`)), TIMEOUT_MS);
    p.then((v) => { window.clearTimeout(t); resolve(v); }, (e) => { window.clearTimeout(t); reject(e); });
  });
}

export async function loadFieldAssets(tier: Tier, anisotropy: number, onProgress?: (f: number) => void): Promise<FieldAssets> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const textures = new THREE.TextureLoader();
  let done = 0;
  const step = <T,>(p: Promise<T>) => p.then((v) => { done++; onProgress?.(done / 5); return v; });

  const [moduleGltf, terrainGltf, inset, scan, apron] = await Promise.all([
    step(withTimeout(loader.loadAsync(FIELD_ASSETS.module[tier]), 'field module')),
    step(withTimeout(loader.loadAsync(FIELD_ASSETS.terrain[tier]), 'terrain')),
    ...(['inset', 'scan', 'apron'] as const).map((k) => step(withTimeout(textures.loadAsync(FIELD_ASSETS.layers[k][tier]), `terrain ${k}`))),
  ]);

  // Module (one mesh, one material; dimensions and cell field measured by the asset pipeline).
  let moduleMesh: THREE.Mesh | undefined;
  let extras: Record<string, unknown> | undefined;
  moduleGltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !moduleMesh) moduleMesh = o as THREE.Mesh;
    if (o.userData?.cellField) extras = o.userData;
  });
  if (!moduleMesh || !extras) throw new Error('Unexpected field module structure');
  const moduleMaterial = moduleMesh.material as THREE.MeshStandardMaterial;
  for (const t of [moduleMaterial.map, moduleMaterial.normalMap, moduleMaterial.roughnessMap, moduleMaterial.metalnessMap]) if (t) t.anisotropy = anisotropy;

  // Terrain (quantized + meshopt): keep the node transform; decode field-frame positions for sampling.
  let terrainMesh: THREE.Mesh | undefined;
  let meta: FieldAssets['terrain']['meta'] | undefined;
  terrainGltf.scene.updateMatrixWorld(true);
  terrainGltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !terrainMesh) terrainMesh = o as THREE.Mesh;
    if (o.userData?.layers) meta = o.userData as FieldAssets['terrain']['meta'];
  });
  if (!terrainMesh || !meta) throw new Error('Unexpected terrain structure');
  const localToField = terrainMesh.matrixWorld.clone();
  const posAttr = terrainMesh.geometry.getAttribute('position');
  const positions = new Float32Array(posAttr.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i).applyMatrix4(localToField);
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
  }
  const index = terrainMesh.geometry.getIndex();
  if (!index) throw new Error('Terrain must be indexed');
  const sampler = createTerrainSampler(positions, index.array);

  for (const t of [inset, scan, apron]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false; // row 0 of each layer image is its rect's z0 edge (see the terrain shader)
    t.anisotropy = anisotropy;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }

  return {
    module: {
      geometry: moduleMesh.geometry,
      material: moduleMaterial,
      size: extras.size as [number, number, number],
      frontZ: extras.frontZ as number,
      glassZ: extras.glassZ as number,
      cellField: extras.cellField as FieldModuleAsset['cellField'],
    },
    terrain: { geometry: terrainMesh.geometry, localToField, sampler, meta },
    layers: { inset, scan, apron },
    dispose() {
      moduleMesh?.geometry.dispose();
      for (const t of [moduleMaterial.map, moduleMaterial.normalMap, moduleMaterial.roughnessMap, moduleMaterial.metalnessMap]) t?.dispose();
      moduleMaterial.dispose();
      terrainMesh?.geometry.dispose();
      for (const t of [inset, scan, apron]) t.dispose();
    },
  };
}
