import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { enhanceMaterial } from './materials';

export type PanelMeta = {
  size: [number, number, number];
  frameLip: number;
  uvRects: { front: [number, number, number, number]; back: [number, number, number, number] };
  colors: { frame: string; back: string };
};

export type PanelAsset = {
  /** Original supplied mesh (normalized by scripts/prepare-assets.mjs). */
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** The original mesh split into its front face and its shell (back + sides), same attributes. */
  frontGeometry: THREE.BufferGeometry;
  shellGeometry: THREE.BufferGeometry;
  /** Independent clones of the panel material (shared textures) for the explanatory groups. */
  cellMaterial: THREE.MeshStandardMaterial;
  shellMaterial: THREE.MeshStandardMaterial;
  meta: PanelMeta;
  dispose(): void;
};

const LOAD_TIMEOUT_MS = 25000;

function splitByFaceNormal(geometry: THREE.BufferGeometry) {
  const index = geometry.getIndex();
  const normal = geometry.getAttribute('normal');
  if (!index) throw new Error('Panel geometry must be indexed');
  const front: number[] = [];
  const shell: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const nz = (normal.getZ(a) + normal.getZ(b) + normal.getZ(c)) / 3;
    (nz > 0.99 ? front : shell).push(a, b, c);
  }
  const make = (ids: number[]) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geometry.attributes)) g.setAttribute(name, attr);
    g.setIndex(ids);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };
  return { front: make(front), shell: make(shell) };
}

export function loadPanelAsset(
  url: string,
  anisotropy: number,
  onProgress: (fraction: number) => void,
): Promise<PanelAsset> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) { settled = true; reject(new Error(`Timed out loading ${url}`)); }
    }, LOAD_TIMEOUT_MS);
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        try {
          let mesh: THREE.Mesh | undefined;
          let meta: PanelMeta | undefined;
          gltf.scene.traverse((o) => {
            if ((o as THREE.Mesh).isMesh && !mesh) mesh = o as THREE.Mesh;
            if (o.userData?.uvRects) meta = o.userData as PanelMeta;
          });
          if (!mesh || !meta) throw new Error('Unexpected model structure');
          const material = mesh.material as THREE.MeshStandardMaterial;
          for (const t of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
            if (t) t.anisotropy = anisotropy;
          }
          // Studio balance: the supplied maps are kept as authored (no recolouring); only the
          // environment response is tuned. The front face is authored as tinted metal.
          material.envMapIntensity = 1;
          const cellMaterial = material.clone();
          const shellMaterial = material.clone();
          enhanceMaterial(material, { sweepRect: meta.uvRects.front });
          enhanceMaterial(cellMaterial);
          enhanceMaterial(shellMaterial);
          const geometry = mesh.geometry;
          const { front, shell } = splitByFaceNormal(geometry);
          onProgress(1);
          resolve({
            geometry,
            material,
            frontGeometry: front,
            shellGeometry: shell,
            cellMaterial,
            shellMaterial,
            meta,
            dispose() {
              geometry.dispose();
              front.dispose();
              shell.dispose();
              for (const t of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) t?.dispose();
              material.dispose();
              cellMaterial.dispose();
              shellMaterial.dispose();
            },
          });
        } catch (err) {
          reject(err);
        }
      },
      (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(Math.min(0.99, event.loaded / event.total));
      },
      (err) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
