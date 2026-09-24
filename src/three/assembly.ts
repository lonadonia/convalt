import * as THREE from 'three';
import type { LayerId } from '../state/store';
import { enhanceMaterial, fadeUniforms } from './materials';
import type { PanelAsset } from './panelAsset';

/**
 * Lightweight explanatory assembly aligned with the supplied panel. The supplied model is a single
 * closed slab whose cells, busbars and frame lip exist only in its textures, so the layers are not
 * presented as separate geometry of that model. Instead:
 *
 *  - Cell assembly    = the supplied mesh's own front-face triangles with the panel material.
 *  - Structural support = the supplied mesh's back and sides, plus a procedural rim, inner walls and
 *                         a light backsheet that only become visible when the layers separate.
 *  - Protection       = a procedural glass sheet that fades in as it lifts away.
 *
 * Collapsed, the assembly renders exactly like the original mesh, so the controller can swap one
 * for the other without a visible change (and never renders both at once).
 */
export const TEAL = new THREE.Color('#008F89');

export type AssemblyGroup = {
  id: LayerId;
  group: THREE.Group;
  /** Direction of travel along the local normal when opening (+1 front, -1 back, 0 stays). */
  direction: number;
  /** Local z of this layer's top surface (for anchors). */
  topZ: number;
  outline: THREE.LineLoop;
  fadeMaterials: THREE.Material[];
  highlight: number;
};

export type Assembly = {
  root: THREE.Group;
  groups: Record<LayerId, AssemblyGroup>;
  update(explode: number, spread: number, dimmed: Record<LayerId, number>, outlined: Record<LayerId, number>): void;
  anchor(id: LayerId, side: -1 | 1, target: THREE.Vector3): THREE.Vector3;
  dispose(): void;
};

function rectWalls(hx: number, hy: number, z0: number, z1: number, inward: boolean) {
  // Four vertical quads around a rectangle; normals face outward (or inward).
  const s = inward ? -1 : 1;
  const quads: Array<[number, number, number, number, [number, number, number]]> = [
    [-hx, -hy, hx, -hy, [0, -s, 0]],
    [hx, -hy, hx, hy, [s, 0, 0]],
    [hx, hy, -hx, hy, [0, s, 0]],
    [-hx, hy, -hx, -hy, [-s, 0, 0]],
  ];
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const [ax, ay, bx, by, n] of quads) {
    const base = pos.length / 3;
    pos.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1);
    for (let k = 0; k < 4; k++) nor.push(...n);
    if (inward) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function ringGeometry(hx: number, hy: number, lip: number) {
  const shape = new THREE.Shape()
    .moveTo(-hx, -hy).lineTo(hx, -hy).lineTo(hx, hy).lineTo(-hx, hy).lineTo(-hx, -hy);
  const ix = hx - lip, iy = hy - lip;
  shape.holes.push(new THREE.Path().moveTo(-ix, -iy).lineTo(-ix, iy).lineTo(ix, iy).lineTo(ix, -iy).lineTo(-ix, -iy));
  return new THREE.ShapeGeometry(shape);
}

function glassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.fillStyle = 'rgba(226, 240, 237, 0.2)';
  g.fillRect(0, 0, 512, 256);
  const band = g.createLinearGradient(0, 0, 512, 256);
  band.addColorStop(0, 'rgba(255,255,255,0)');
  band.addColorStop(0.24, 'rgba(255,255,255,0)');
  band.addColorStop(0.33, 'rgba(255,255,255,0.34)');
  band.addColorStop(0.42, 'rgba(255,255,255,0.02)');
  band.addColorStop(0.55, 'rgba(255,255,255,0.1)');
  band.addColorStop(0.6, 'rgba(255,255,255,0)');
  band.addColorStop(1, 'rgba(255,255,255,0.06)');
  g.fillStyle = band;
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 509, 253);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function outlineLoop(hx: number, hy: number, z: number, material: THREE.LineBasicMaterial) {
  const g = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hx, -hy, z), new THREE.Vector3(hx, -hy, z), new THREE.Vector3(hx, hy, z), new THREE.Vector3(-hx, hy, z),
  ]);
  const line = new THREE.LineLoop(g, material);
  line.renderOrder = 3;
  return line;
}

const standard = (params: THREE.MeshStandardMaterialParameters) => enhanceMaterial(new THREE.MeshStandardMaterial(params));

export function buildAssembly(asset: PanelAsset): Assembly {
  const [sx, sy, sz] = asset.meta.size;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const lip = Math.max(0.008, asset.meta.frameLip);
  const root = new THREE.Group();
  root.name = 'ExplanatoryAssembly';
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(o: T) => { disposables.push(o); return o; };

  const outlineMaterial = () => track(new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0, depthWrite: false }));

  // --- Protection: glass sheet -------------------------------------------------------------
  // Stylized, unlit pane: a baked soft reflection band and bright edges read clearly as glass
  // without a transmission pass or real-time reflections.
  const glassT = 0.0032;
  const inset = 0.012;
  const glassTex = track(glassTexture());
  const glassFace = track(new THREE.MeshBasicMaterial({ map: glassTex, transparent: true, opacity: 0, depthWrite: false }));
  const glassEdge = track(new THREE.MeshStandardMaterial({
    color: '#3f9d96', metalness: 0, roughness: 0.25, transparent: true, opacity: 0, depthWrite: false,
  }));
  const glassGeo = track(new THREE.BoxGeometry(sx - 2 * inset, sy - 2 * inset, glassT));
  const glass = new THREE.Mesh(glassGeo, [glassEdge, glassEdge, glassEdge, glassEdge, glassFace, glassFace]);
  glass.position.z = hz - glassT / 2;
  glass.renderOrder = 2;
  const protection = new THREE.Group();
  protection.name = 'Protection';
  const protectionOutline = outlineLoop(hx - inset + 0.004, hy - inset + 0.004, hz + 0.0006, outlineMaterial());
  const glassHairlineMaterial = track(new THREE.LineBasicMaterial({ color: '#7dbab4', transparent: true, opacity: 0, depthWrite: false }));
  const glassHairline = outlineLoop(hx - inset, hy - inset, hz + 0.0003, glassHairlineMaterial);
  protection.add(glass, glassHairline, protectionOutline);

  // --- Cell assembly: the supplied front face + a thin edge so it reads as a sheet -------------
  const cells = new THREE.Group();
  cells.name = 'CellAssembly';
  const sheet = new THREE.Mesh(asset.frontGeometry, asset.cellMaterial);
  const sheetEdgeMaterial = track(standard({ color: '#1f2c35', metalness: 0.2, roughness: 0.6 }));
  const sheetEdge = new THREE.Mesh(track(rectWalls(hx - 0.004, hy - 0.004, hz - 0.004, hz - 0.0004, false)), sheetEdgeMaterial);
  const cellsOutline = outlineLoop(hx + 0.004, hy + 0.004, hz + 0.0006, outlineMaterial());
  cells.add(sheet, sheetEdge, cellsOutline);

  // --- Structural support: supplied back + sides, procedural rim, inner walls and backsheet ----
  const structure = new THREE.Group();
  structure.name = 'StructuralSupport';
  const shell = new THREE.Mesh(asset.shellGeometry, asset.shellMaterial);
  const aluminium = track(standard({ color: asset.meta.colors.frame, metalness: 0.7, roughness: 0.42, envMapIntensity: 1.2 }));
  const rim = new THREE.Mesh(track(ringGeometry(hx, hy, lip)), aluminium);
  rim.position.z = hz - 0.0009;
  const walls = new THREE.Mesh(track(rectWalls(hx - lip, hy - lip, -hz + 0.004, hz - 0.0009, true)), aluminium);
  const backsheetMaterial = track(standard({ color: '#d9dfdb', metalness: 0, roughness: 0.86 }));
  const backsheet = new THREE.Mesh(track(new THREE.PlaneGeometry(2 * (hx - lip), 2 * (hy - lip))), backsheetMaterial);
  backsheet.position.z = -hz + 0.004;
  const structureOutline = outlineLoop(hx + 0.004, hy + 0.004, hz + 0.0006, outlineMaterial());
  structure.add(shell, rim, walls, backsheet, structureOutline);

  // --- Alignment guides: thin dashed lines through the stack at the four corners --------------
  const guideGeo = track(new THREE.BufferGeometry());
  guideGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3));
  const guideMaterial = track(new THREE.LineDashedMaterial({ color: TEAL, dashSize: 0.012, gapSize: 0.009, transparent: true, opacity: 0, depthWrite: false }));
  const guides = new THREE.LineSegments(guideGeo, guideMaterial);
  guides.frustumCulled = false;
  guides.renderOrder = 1;

  root.add(structure, cells, protection, guides);

  const groups: Record<LayerId, AssemblyGroup> = {
    protection: { id: 'protection', group: protection, direction: 1, topZ: hz + 0.001, outline: protectionOutline, fadeMaterials: [], highlight: 0 },
    cells: { id: 'cells', group: cells, direction: 0, topZ: hz, outline: cellsOutline, fadeMaterials: [asset.cellMaterial, sheetEdgeMaterial], highlight: 0 },
    structure: { id: 'structure', group: structure, direction: -1, topZ: hz, outline: structureOutline, fadeMaterials: [asset.shellMaterial, aluminium, backsheetMaterial], highlight: 0 },
  };

  const gx = hx - inset + 0.002, gy = hy - inset + 0.002;
  const corners: Array<[number, number]> = [[-gx, -gy], [gx, -gy], [gx, gy], [-gx, gy]];

  return {
    root,
    groups,
    update(explode, spread, dimmed, outlined) {
      const e = Math.max(0, explode);
      for (const g of Object.values(groups)) {
        g.group.position.z = g.direction * spread * e;
        const dim = dimmed[g.id];
        for (const m of g.fadeMaterials) fadeUniforms(m).uFade.value = dim * 0.62;
        (g.outline.material as THREE.LineBasicMaterial).opacity = outlined[g.id] * 0.95;
        g.outline.visible = outlined[g.id] > 0.01;
      }
      // Glass appears as it lifts off; dims like the others when another layer is selected.
      const glassAlpha = Math.min(1, e * 3);
      const glassDim = 1 - dimmed.protection * 0.6;
      glassFace.opacity = glassAlpha * glassDim;
      glassEdge.opacity = 0.6 * glassAlpha * glassDim;
      glassHairlineMaterial.opacity = 0.75 * glassAlpha * glassDim;
      glassHairline.visible = glassAlpha > 0.002;
      glass.visible = glassAlpha > 0.002;
      // Guides span from the structure rim to the top of the glass.
      const zLow = hz - spread * e;
      const zHigh = hz + spread * e + 0.001;
      const arr = guideGeo.getAttribute('position') as THREE.BufferAttribute;
      corners.forEach(([x, y], i) => {
        arr.setXYZ(2 * i, x, y, zLow);
        arr.setXYZ(2 * i + 1, x, y, zHigh);
      });
      arr.needsUpdate = true;
      guides.computeLineDistances();
      guideMaterial.opacity = 0.34 * Math.max(0, (e - 0.35) / 0.65);
      guides.visible = guideMaterial.opacity > 0.01;
    },
    anchor(id, side, target) {
      const g = groups[id];
      return target.set(side * (hx + 0.01), 0, g.topZ + g.group.position.z);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      for (const g of Object.values(groups)) g.outline.geometry.dispose();
    },
  };
}
