import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DC_ASSET } from '../../config/datacenter';

type Rect = { x0: number; x1: number; z0: number; z1: number };

/** Measurements written by scripts/prepare-datacenter.mjs (metres, model frame). */
export type DcMeta = {
  bounds: { min: [number, number, number]; max: [number, number, number] };
  platform: { half: number; tiles: number; tile: number };
  cabinet: { width: number; height: number; depth: number; frontWidth: number };
  rows: Array<Rect & { h: number }>;
  fronts: Array<{ x0: number; x1: number; y0: number; y1: number; z: number }>;
  fixtures: Array<{ cx: number; cz: number; w: number; d: number; y: number }>;
};

export type DcAssets = {
  root: THREE.Group;
  meta: DcMeta;
  /** Materials by name (RackCase, RackFront, LedGreen, LedAmber, FloorTile, FloorGrout, FixtureCase, FixtureLight). */
  materials: Map<string, THREE.MeshStandardMaterial>;
  dispose(): void;
};

/** Generous, as for the field: slow connections still get the scene (the page stays usable meanwhile). */
const TIMEOUT_MS = 120000;

export async function loadDcAssets(anisotropy: number): Promise<DcAssets> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('Timed out loading the data-center model')), TIMEOUT_MS);
    loader.loadAsync(DC_ASSET).then((g) => { window.clearTimeout(t); resolve(g); }, (e) => { window.clearTimeout(t); reject(e); });
  });
  const root = gltf.scene as THREE.Group;
  let meta: DcMeta | undefined;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    if (o.userData?.rows) meta = o.userData as DcMeta;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    materials.set(m.name, m);
    for (const t of [m.map, m.emissiveMap]) if (t) t.anisotropy = anisotropy;
  });
  if (!meta || materials.size < 8) throw new Error('Unexpected data-center model structure');
  return {
    root,
    meta,
    materials,
    dispose() {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
      });
      for (const m of materials.values()) { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); }
    },
  };
}
