import * as THREE from 'three';
import { ARRAY, HERO_MOUNT, REVEAL, SITE } from '../config/field';
import type { TerrainSampler } from './terrainSampler';

/**
 * Deterministic installation layout, derived from:
 *  - the module's measured dimensions (from the module GLB),
 *  - the tilt, modules per table, gaps and ground-coverage ratio (row pitch),
 *  - the usable field polygon and slope limit,
 *  - the rendered terrain (heights sampled under every leg and along every lower edge).
 *
 * Tables are planar: fixed tilt about the row axis, following the terrain along the row within
 * ARRAY.maxRoll; legs are vertical and cut to the ground below them. Everything is computed in the
 * site frame, then shifted into world coordinates so the hero's mount point lands on HERO_MOUNT.
 */
export type ModuleDims = { width: number; height: number; thickness: number };

export type ModuleSlot = {
  row: number;
  table: number;
  level: number;
  column: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Reveal distance (m): hero neighbours first, then its table, its row, then row after row. */
  reveal: number;
};

export type SupportBox = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };

export type TableLayout = {
  row: number;
  index: number;
  /** Reveal distance of the table's first module. */
  reveal: number;
  supports: SupportBox[];
  /** Lower-edge clearance range and leg lengths (m), for validation. */
  clearance: [number, number];
  legs: [number, number];
  roll: number;
};

export type FieldLayout = {
  hero: ModuleSlot;
  /** All other modules, sorted by reveal distance. */
  modules: ModuleSlot[];
  tables: TableLayout[];
  rejected: Array<{ row: number; index: number; reason: string }>;
  /** Field frame → world. */
  worldFromField: THREE.Matrix4;
  /** Installation centre (world) and extent (site frame half sizes). */
  siteCentre: THREE.Vector3;
  halfExtent: THREE.Vector2;
  dims: { tableLength: number; slopeLength: number; pitch: number; rowWidth: number; depth: number };
};

const pointInPolygon = (x: number, z: number, poly: ReadonlyArray<readonly [number, number]>) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

const distanceToPolygonEdge = (x: number, z: number, poly: ReadonlyArray<readonly [number, number]>) => {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const ex = bx - ax, ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
};

export function buildLayout(terrain: TerrainSampler, dims: ModuleDims): FieldLayout {
  const tilt = THREE.MathUtils.degToRad(ARRAY.tiltDeg);
  const theta = THREE.MathUtils.degToRad(SITE.rowAxisDeg);
  const [cxF, czF] = SITE.centre;
  // Site frame ⇄ field frame (rotation about Y by the row-axis angle, about the site centre).
  const toField = (x: number, z: number): [number, number] => [cxF + x * Math.cos(theta) - z * Math.sin(theta), czF + x * Math.sin(theta) + z * Math.cos(theta)];
  const groundS = (x: number, z: number) => { const [fx, fz] = toField(x, z); return terrain.heightAt(fx, fz); };
  const slopeS = (x: number, z: number) => { const [fx, fz] = toField(x, z); return terrain.slopeAt(fx, fz); };
  const usable = (x: number, z: number) => {
    const [fx, fz] = toField(x, z);
    return pointInPolygon(fx, fz, SITE.polygon) && distanceToPolygonEdge(fx, fz, SITE.polygon) >= SITE.margin;
  };

  const { width: mw, height: mh, thickness: mt } = dims;
  const gap = ARRAY.moduleGap;
  const slopeLength = ARRAY.levels * mh + (ARRAY.levels - 1) * gap;
  const tableLength = ARRAY.columns * mw + (ARRAY.columns - 1) * gap;
  const pitch = slopeLength / ARRAY.gcr;
  const depthH = slopeLength * Math.cos(tilt);
  const gaps: number[] = [];
  for (let i = 0; i < ARRAY.tablesPerRow - 1; i++) gaps.push(ARRAY.corridorAfter.includes(i) ? ARRAY.corridor : ARRAY.tableGap);
  const rowWidth = ARRAY.tablesPerRow * tableLength + gaps.reduce((a, b) => a + b, 0);
  // Access corridors between row blocks add to the spacing of every row behind them.
  const rowOffset = (r: number) => ARRAY.rowCorridorAfter.filter((k) => r > k).length * ARRAY.rowCorridor;
  const depth = (ARRAY.rows - 1) * pitch + depthH + rowOffset(ARRAY.rows - 1);
  const tableX: number[] = [];
  let cursor = -rowWidth / 2;
  for (let i = 0; i < ARRAY.tablesPerRow; i++) { tableX.push(cursor + tableLength / 2); cursor += tableLength + (gaps[i] ?? 0); }
  const frontZ = (r: number) => depth / 2 - r * pitch - rowOffset(r); // lower (front) edge of row r

  const modulesS: Array<Omit<ModuleSlot, 'reveal'> & { xS: number }> = [];
  const tables: TableLayout[] = [];
  const rejected: FieldLayout['rejected'] = [];
  const eU = new THREE.Vector3(), eV = new THREE.Vector3(), n = new THREE.Vector3(), tmp = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);

  for (let r = 0; r < ARRAY.rows; r++) {
    for (let t = 0; t < ARRAY.tablesPerRow; t++) {
      const x0 = tableX[t], zf = frontZ(r);
      // Terrain along the table's centre line → roll (following the ground along the row).
      const samples = 9;
      let su = 0, sy = 0, suu = 0, suy = 0;
      for (let k = 0; k < samples; k++) {
        const u = -tableLength / 2 + (tableLength * k) / (samples - 1);
        const y = groundS(x0 + u, zf - depthH / 2);
        su += u; sy += y; suu += u * u; suy += u * y;
      }
      const rollRaw = (samples * suy - su * sy) / (samples * suu - su * su);
      const roll = THREE.MathUtils.clamp(Number.isFinite(rollRaw) ? rollRaw : 0, -ARRAY.maxRoll, ARRAY.maxRoll);
      eU.set(1, roll, 0).normalize();
      eV.set(0, Math.sin(tilt), -Math.cos(tilt));
      eV.addScaledVector(eU, -eU.dot(eV)).normalize();
      n.crossVectors(eU, eV).normalize();
      basis.makeBasis(eU, eV, n);
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);

      // Validity: inside the usable polygon, acceptable slope.
      const corners: Array<[number, number]> = [[-tableLength / 2, 0], [tableLength / 2, 0], [-tableLength / 2, depthH], [tableLength / 2, depthH]];
      let reason = '';
      for (const [u, d] of corners) if (!usable(x0 + u, zf - d)) reason = 'outside usable area';
      for (const [u, d] of [...corners, [0, depthH / 2] as [number, number]]) if (!reason && slopeS(x0 + u, zf - d) > SITE.maxSlope) reason = 'slope';
      if (reason) { rejected.push({ row: r, index: t, reason }); continue; }

      // Height: the lowest module edge keeps ARRAY.clearance above the ground everywhere along it.
      let y0 = -Infinity;
      for (let k = 0; k < 13; k++) {
        const u = -tableLength / 2 + (tableLength * k) / 12;
        const x = x0 + u * eU.x, y = u * eU.y;
        y0 = Math.max(y0, groundS(x, zf) + ARRAY.clearance - y);
      }
      const origin = new THREE.Vector3(x0, y0, zf); // table plane (module backs), lower edge centre
      const at = (u: number, v: number, off = 0, out = new THREE.Vector3()) => out.copy(origin).addScaledVector(eU, u).addScaledVector(eV, v).addScaledVector(n, off);
      let minClear = Infinity, maxClear = -Infinity;
      for (let k = 0; k < 13; k++) {
        const p = at(-tableLength / 2 + (tableLength * k) / 12, 0, 0, tmp);
        const c = p.y - groundS(p.x, p.z);
        minClear = Math.min(minClear, c); maxClear = Math.max(maxClear, c);
      }

      // Modules (landscape): X along the row, Y up the slope, front (+Z) along the table normal.
      for (let l = 0; l < ARRAY.levels; l++) for (let c = 0; c < ARRAY.columns; c++) {
        const u = -tableLength / 2 + mw / 2 + c * (mw + gap);
        const v = mh / 2 + l * (mh + gap);
        modulesS.push({ row: r, table: t, level: l, column: c, position: at(u, v, mt / 2), quaternion: q.clone(), xS: x0 + u * eU.x });
      }

      // Supports: rails under each level, a rafter and a vertical front/rear leg pair per post.
      const supports: SupportBox[] = [];
      const [railW, railH] = ARRAY.rail, [rafW, rafH] = ARRAY.rafter;
      for (let l = 0; l < ARRAY.levels; l++) for (const f of [0.2, 0.8]) {
        supports.push({ position: at(0, l * (mh + gap) + mh * f, -railH / 2), quaternion: q.clone(), scale: new THREE.Vector3(tableLength + 0.08, railW, railH) });
      }
      const posts = Math.max(2, Math.round(tableLength / ARRAY.postSpacing) + 1);
      let minLeg = Infinity, maxLeg = -Infinity;
      for (let k = 0; k < posts; k++) {
        const u = -tableLength / 2 + 0.35 + (k * (tableLength - 0.7)) / (posts - 1);
        supports.push({ position: at(u, slopeLength / 2, -railH - rafH / 2), quaternion: q.clone(), scale: new THREE.Vector3(rafW, slopeLength - 0.1, rafH) });
        for (const f of [ARRAY.legFront, ARRAY.legRear]) {
          const top = at(u, slopeLength * f, -railH - rafH);
          const bottom = groundS(top.x, top.z) - ARRAY.embed;
          const len = top.y - bottom;
          minLeg = Math.min(minLeg, len - ARRAY.embed); maxLeg = Math.max(maxLeg, len - ARRAY.embed);
          supports.push({ position: new THREE.Vector3(top.x, (top.y + bottom) / 2, top.z), quaternion: new THREE.Quaternion().setFromAxisAngle(up, 0), scale: new THREE.Vector3(ARRAY.legSize, len, ARRAY.legSize) });
        }
      }
      tables.push({ row: r, index: t, reveal: 0, supports, clearance: [minClear, maxClear], legs: [minLeg, maxLeg], roll });
    }
  }

  const heroSpec = ARRAY.hero;
  const heroS = modulesS.find((m) => m.row === heroSpec.row && m.table === heroSpec.table && m.level === heroSpec.level && m.column === heroSpec.column);
  if (!heroS) throw new Error('Hero slot rejected by the layout — adjust SITE or ARRAY.hero');
  const reveal = (m: (typeof modulesS)[number]) => Math.abs(m.xS - heroS.xS) + REVEAL.levelWeight * m.level + REVEAL.rowWeight * m.row;

  // Site frame → world: shift so the hero mount lands on HERO_MOUNT.
  const offset = new THREE.Vector3(...HERO_MOUNT).sub(heroS.position);
  const toWorld = (p: THREE.Vector3) => p.add(offset);
  const slots: ModuleSlot[] = modulesS.map((m) => ({ row: m.row, table: m.table, level: m.level, column: m.column, position: toWorld(m.position), quaternion: m.quaternion, reveal: reveal(m) }));
  const hero = slots.find((m) => m.row === heroSpec.row && m.table === heroSpec.table && m.level === heroSpec.level && m.column === heroSpec.column)!;
  const modules = slots.filter((m) => m !== hero).sort((a, b) => a.reveal - b.reveal);
  for (const tb of tables) {
    tb.reveal = Math.min(...slots.filter((m) => m.row === tb.row && m.table === tb.index).map((m) => m.reveal));
    for (const s of tb.supports) toWorld(s.position);
  }
  tables.sort((a, b) => a.reveal - b.reveal);

  // Field frame → site frame → world.
  const worldFromField = new THREE.Matrix4()
    .makeTranslation(offset.x, offset.y, offset.z)
    .multiply(new THREE.Matrix4().makeRotationY(theta))
    .multiply(new THREE.Matrix4().makeTranslation(-cxF, 0, -czF));
  const siteCentre = new THREE.Vector3(0, groundS(0, 0), 0).add(offset);

  return {
    hero,
    modules,
    tables,
    rejected,
    worldFromField,
    siteCentre,
    halfExtent: new THREE.Vector2(rowWidth / 2, depth / 2),
    dims: { tableLength, slopeLength, pitch, rowWidth, depth },
  };
}
