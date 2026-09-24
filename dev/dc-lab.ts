/**
 * Data-center lab (dev only): renders the scene-04 world exactly as the site builds it, from the
 * fitted reference camera or from any point of the camera path. Used for look development and to
 * compare with the reference screenshots.
 *
 *   /dev/dc-lab.html?mode=ref                 reference 170556 camera (fitted), reference lens
 *   /dev/dc-lab.html?mode=path&t=0.5&tier=desktop
 *   /dev/dc-lab.html?cam=px,py,pz,tx,ty,tz,fov
 */
import * as THREE from 'three';
import { DC_REFERENCE } from '../src/config/datacenter';
import { loadDcAssets } from '../src/three/datacenter/dcAssets';
import { DataCenterWorld } from '../src/three/datacenter/DataCenterWorld';
import type { Tier } from '../src/state/store';

const q = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, Number(q.get('dpr') ?? window.devicePixelRatio)));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = Number(q.get('exposure') ?? 1);
document.body.appendChild(renderer.domElement);

const assets = await loadDcAssets(8);
const world = new DataCenterWorld(renderer, assets);
await world.prepare();
const aspect = window.innerWidth / window.innerHeight;
const cam = world.camera;
const mode = q.get('mode') ?? 'ref';
if (q.get('cam')) {
  const [px, py, pz, tx, ty, tz, fov] = q.get('cam')!.split(',').map(Number);
  cam.fov = fov; cam.aspect = aspect; cam.near = 0.03; cam.far = 80;
  cam.position.set(px, py, pz); cam.lookAt(tx, ty, tz); cam.updateProjectionMatrix();
} else if (mode === 'ref') {
  // Fitted reference camera: position, yaw −120.28°, pitch −4.75°, lens 44.3°.
  const yaw = THREE.MathUtils.degToRad(-120.28), pitch = THREE.MathUtils.degToRad(-4.75);
  cam.fov = DC_REFERENCE.fov; cam.aspect = aspect; cam.near = 0.03; cam.far = 80;
  cam.position.set(...DC_REFERENCE.position);
  cam.lookAt(cam.position.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))));
  cam.updateProjectionMatrix();
} else {
  const tier = (q.get('tier') ?? 'desktop') as Tier;
  world.setFraming(tier, aspect, null);
  world.update(Number(q.get('t') ?? 0.8), aspect, 0, false);
}
cam.updateMatrixWorld();
world.renderReflection();
renderer.render(world.scene, cam);
renderer.info.autoReset = true;
hud.textContent = `${mode} · calls ${renderer.info.render.calls} · tris ${renderer.info.render.triangles} · cam ${cam.position.toArray().map((v) => v.toFixed(2)).join(',')} fov ${cam.fov.toFixed(1)}`;
(window as unknown as { __ready?: boolean }).__ready = true;
