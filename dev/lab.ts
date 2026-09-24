// Dev-only asset inspection page. Not part of the production build.
// Query params:
//   src=fbx|glb            model source (fbx = original FBX from asset-source, glb = optimized output)
//   mode=fbx|smooth|flat|flatmap|rebaked|glb
//   view=front34|grazing|back|side|top
//   light=neutral|studio
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'fbx';
const view = q.get('view') ?? 'front34';
const glbUrl = q.get('glb') ?? '/models/solar-panel-2k.glb';
const hud = document.getElementById('hud')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 1;

const key = new THREE.DirectionalLight(0xffffff, q.get('light') === 'studio' ? 2.5 : 0);
key.position.set(-2, 3, 2.5);
scene.add(key);

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 50);
const views: Record<string, [number, number, number]> = {
  front34: [1.9, 1.4, 3.2],
  grazing: [3.4, 0.35, 1.2],
  back: [-1.6, -1.0, -3.2],
  side: [3.6, 0.05, 0.05],
  top: [0, 0.01, 3.6],
};
camera.position.set(...(views[view] ?? views.front34));
camera.lookAt(0, 0, 0);

const tex = new THREE.TextureLoader();
const T = '/asset-source/solar-panel/textures/';
function loadMaps() {
  const map = tex.load(T + 'solar_panel_diffuse.png');
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = tex.load(T + 'solar_panel_normal.png');
  const roughnessMap = tex.load(T + 'solar_panel_roughness.png');
  const metalnessMap = tex.load(T + 'solar_panel_metalness.png');
  for (const t of [map, normalMap, roughnessMap, metalnessMap]) t.anisotropy = 8;
  return { map, normalMap, roughnessMap, metalnessMap };
}

function frameStanding(obj: THREE.Object3D) {
  // FBX native pose lies flat (front = +Y). Stand it up so the front faces +Z for inspection.
  obj.rotation.set(0, 0, 0);
  obj.updateMatrixWorld(true);
}

async function main() {
  let mesh: THREE.Mesh;
  if (mode === 'glb') {
    const gltf = await new GLTFLoader().loadAsync(glbUrl);
    mesh = gltf.scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
    scene.add(gltf.scene);
  } else {
    const fbx = await new FBXLoader().loadAsync('/asset-source/solar-panel/source/extracted/solar panel.fbx');
    mesh = fbx.getObjectByProperty('isMesh', true) as THREE.Mesh;
    // Normalize: drop the node transform (Blender export: -90° X, ×100) so local meters, front = +Z.
    mesh.removeFromParent();
    mesh.position.set(0, 0, 0.0073);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.setScalar(1);
    scene.add(mesh);
    const maps = loadMaps();
    if (mode === 'smooth') {
      mesh.material = new THREE.MeshStandardMaterial({ ...maps });
    } else if (mode === 'flat' || mode === 'flatmap') {
      const g = mesh.geometry.clone();
      g.deleteAttribute('normal');
      g.computeVertexNormals(); // non-indexed geometry -> flat face normals
      mesh.geometry = g;
      mesh.material = new THREE.MeshStandardMaterial({ ...maps, normalMap: mode === 'flatmap' ? maps.normalMap : null });
    } else if (mode === 'rebaked') {
      const g = mesh.geometry.clone();
      g.deleteAttribute('normal');
      g.computeVertexNormals();
      mesh.geometry = g;
      const rebaked = tex.load('/asset-source/work/normal_flat_rebaked.png');
      rebaked.anisotropy = 8;
      mesh.material = new THREE.MeshStandardMaterial({ ...maps, normalMap: rebaked });
    }
    frameStanding(mesh);
  }
  const box = new THREE.Box3().setFromObject(mesh);
  hud.textContent = `mode=${mode} view=${view}\nbbox size ${box.getSize(new THREE.Vector3()).toArray().map((n) => n.toFixed(3)).join(' × ')} m`;
  THREE.DefaultLoadingManager.onLoad = () => requestAnimationFrame(render);
  setTimeout(render, 1500);
  render();
}

function render() {
  renderer.render(scene, camera);
  (window as unknown as { __labReady: boolean }).__labReady = true;
}

main().catch((e) => { hud.textContent = 'ERROR: ' + (e as Error).message; console.error(e); });
