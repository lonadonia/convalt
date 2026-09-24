import * as THREE from 'three';

/**
 * Bounds-based framing. Given an oriented box (the panel or the opened assembly) and a camera
 * direction, finds the camera distance at which the box's projected bounds fit a screen region,
 * and the off-axis lens shift that moves the projection into that region. Perspective is not
 * distorted by the shift, so the object keeps the same look wherever the layout places it.
 */
export type Framing = {
  /** Unit vector from subject centre toward the camera. */
  direction: THREE.Vector3;
  distance: number;
  /** Projection-matrix shift in NDC units. */
  shift: THREE.Vector2;
  fov: number;
};

export type FitInput = {
  halfExtents: THREE.Vector3;
  orientation: THREE.Quaternion;
  azimuthDeg: number;
  elevationDeg: number;
  fov: number;
  aspect: number;
  /** x0, y0, x1, y1 in 0–1 CSS space (top-left origin). */
  region: readonly [number, number, number, number];
  /**
   * Optional silhouette points (offsets from the subject centre, world orientation) used instead of
   * the box corners — a tighter fit for subjects that do not fill their bounding box.
   */
  points?: THREE.Vector3[];
};

const UP = new THREE.Vector3(0, 1, 0);
const _corner = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export function directionFrom(azimuthDeg: number, elevationDeg: number, target = new THREE.Vector3()) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return target.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

function projectedBounds(input: FitInput, dir: THREE.Vector3, distance: number) {
  const tanY = Math.tan(THREE.MathUtils.degToRad(input.fov) / 2);
  const tanX = tanY * input.aspect;
  _fwd.copy(dir).negate();
  _right.crossVectors(_fwd, UP).normalize();
  _up.crossVectors(_right, _fwd).normalize();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const h = input.halfExtents;
  const n = input.points?.length ?? 8;
  for (let i = 0; i < n; i++) {
    if (input.points) _corner.copy(input.points[i]);
    else _corner.set(i & 1 ? h.x : -h.x, i & 2 ? h.y : -h.y, i & 4 ? h.z : -h.z).applyQuaternion(input.orientation);
    // camera sits at dir * distance, looking at the origin
    const rel = _corner.clone().sub(_fwd.clone().multiplyScalar(-distance));
    const depth = rel.dot(_fwd);
    const x = rel.dot(_right) / (depth * tanX);
    const y = rel.dot(_up) / (depth * tanY);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

export function fitToRegion(input: FitInput): Framing {
  const direction = directionFrom(input.azimuthDeg, input.elevationDeg);
  const [x0, y0, x1, y1] = input.region;
  const regionW = (x1 - x0) * 2;
  const regionH = (y1 - y0) * 2;
  const regionCx = (x0 + x1) - 1; // NDC centre x
  const regionCy = 1 - (y0 + y1); // NDC centre y (flip)
  let distance = (input.points ? Math.max(...input.points.map((p) => p.length())) : input.halfExtents.length()) * 3;
  for (let i = 0; i < 6; i++) {
    const b = projectedBounds(input, direction, distance);
    const scale = Math.max((b.maxX - b.minX) / regionW, (b.maxY - b.minY) / regionH);
    distance *= scale;
  }
  const b = projectedBounds(input, direction, distance);
  const shift = new THREE.Vector2(regionCx - (b.minX + b.maxX) / 2, regionCy - (b.minY + b.maxY) / 2);
  return { direction, distance, shift, fov: input.fov };
}

/** Applies an NDC shift to a perspective camera's projection (off-axis lens shift). */
/** Focal length and principal point (CSS px, top-left origin) of the camera's current projection. */
export function intrinsicsOf(camera: THREE.PerspectiveCamera, W: number, H: number) {
  const e = camera.projectionMatrix.elements;
  return { focal: (e[5] * H) / 2, ppx: (W * (1 - e[8])) / 2, ppy: (H * (1 + e[9])) / 2 };
}

/**
 * Pinhole projection from a focal length and principal point in CSS px (square pixels), keeping
 * the camera's near/far. Used to reproduce the footage camera as framed on screen.
 */
export function applyIntrinsics(camera: THREE.PerspectiveCamera, focal: number, ppx: number, ppy: number, W: number, H: number) {
  camera.updateProjectionMatrix();
  const e = camera.projectionMatrix.elements;
  e[0] = (2 * focal) / W;
  e[5] = (2 * focal) / H;
  e[8] = 1 - (2 * ppx) / W;
  e[9] = (2 * ppy) / H - 1;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export function applyLensShift(camera: THREE.PerspectiveCamera, shift: THREE.Vector2) {
  camera.updateProjectionMatrix();
  const e = camera.projectionMatrix.elements;
  // clip.x += e[8] * z_view; ndc.x = clip.x / -z_view  →  ndc shift = -e[8]
  e[8] = -shift.x;
  e[9] = -shift.y;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
