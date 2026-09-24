/**
 * Exact height queries on the rendered terrain mesh (field frame, metres).
 *
 * The layout places table legs on the ground the visitor actually sees, so heights come from the
 * same (simplified) triangles that are drawn — not from a different heightfield. Triangles are
 * bucketed on a uniform XZ grid; a query tests only its bucket's triangles.
 */
export type TerrainSampler = {
  heightAt(x: number, z: number): number;
  /** Largest slope (rise/run) of the triangle under the point. */
  slopeAt(x: number, z: number): number;
  bounds: { x0: number; z0: number; x1: number; z1: number };
};

export function createTerrainSampler(positions: Float32Array, index: ArrayLike<number>, cellSize = 4): TerrainSampler {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    x0 = Math.min(x0, positions[i]); x1 = Math.max(x1, positions[i]);
    z0 = Math.min(z0, positions[i + 2]); z1 = Math.max(z1, positions[i + 2]);
  }
  const cols = Math.ceil((x1 - x0) / cellSize) + 1, rows = Math.ceil((z1 - z0) / cellSize) + 1;
  const counts = new Uint32Array(cols * rows + 1);
  const triCount = index.length / 3;
  const cellRange = (t: number) => {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const minX = Math.min(positions[a], positions[b], positions[c]), maxX = Math.max(positions[a], positions[b], positions[c]);
    const minZ = Math.min(positions[a + 2], positions[b + 2], positions[c + 2]), maxZ = Math.max(positions[a + 2], positions[b + 2], positions[c + 2]);
    return [Math.floor((minX - x0) / cellSize), Math.floor((maxX - x0) / cellSize), Math.floor((minZ - z0) / cellSize), Math.floor((maxZ - z0) / cellSize)];
  };
  for (let t = 0; t < triCount; t++) {
    const [i0, i1, j0, j1] = cellRange(t);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) counts[j * cols + i + 1]++;
  }
  for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
  const items = new Uint32Array(counts[counts.length - 1]);
  const fill = counts.slice(0, -1);
  for (let t = 0; t < triCount; t++) {
    const [i0, i1, j0, j1] = cellRange(t);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) items[fill[j * cols + i]++] = t;
  }

  /** Barycentric hit on a triangle containing (x, z); returns [height, slope] or null. */
  const hit = (t: number, x: number, z: number): [number, number] | null => {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const ax = positions[a], az = positions[a + 2], bx = positions[b], bz = positions[b + 2], cx = positions[c], cz = positions[c + 2];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-12) return null;
    const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
    const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) return null;
    const ay = positions[a + 1], by = positions[b + 1], cy = positions[c + 1];
    // Plane gradient → slope.
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const slope = Math.abs(ny) > 1e-9 ? Math.hypot(nx, nz) / Math.abs(ny) : Infinity;
    return [w0 * ay + w1 * by + w2 * cy, slope];
  };

  const query = (x: number, z: number): [number, number] => {
    const i = Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / cellSize)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor((z - z0) / cellSize)));
    const k = j * cols + i;
    for (let n = counts[k]; n < counts[k + 1]; n++) {
      const r = hit(items[n], x, z);
      if (r) return r;
    }
    return [NaN, NaN];
  };

  return {
    heightAt: (x, z) => query(x, z)[0],
    slopeAt: (x, z) => query(x, z)[1],
    bounds: { x0, z0, x1, z1 },
  };
}
