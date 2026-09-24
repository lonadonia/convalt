// Inspect the supplied FBX: hierarchy, transforms, bounds, attributes, normals and texture references.
// Usage: node scripts/inspect-fbx.mjs [path/to/model.fbx]
import fs from 'node:fs';
import path from 'node:path';

// Minimal DOM shim: FBXLoader tries to create <img> elements for referenced textures.
// We only need geometry and metadata here, so image loads are silently ignored.
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_) {} }),
};
globalThis.self = globalThis;

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const file = process.argv[2] ?? 'asset-source/solar-panel/source/extracted/solar panel.fbx';
const buf = fs.readFileSync(file);
const raw = buf.toString('latin1');

// Texture paths referenced inside the binary FBX (usually absolute paths from the author's machine).
const refs = [...new Set(raw.match(/[A-Za-z]:[\/][^\0\x01-\x1f"]{3,200}?\.(png|jpe?g|tga|tif)/gi) ?? [])];
const rel = [...new Set(raw.match(/[\w\- .\/]{1,120}\.(png|jpe?g|tga|tif)/gi) ?? [])];
console.log('Absolute texture refs:', refs);
console.log('All texture-like refs:', rel);

const loader = new FBXLoader();
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const root = loader.parse(ab, path.dirname(file) + '/');
root.updateMatrixWorld(true);

root.traverse((o) => {
  const pad = '  '.repeat(depth(o));
  console.log(`${pad}${o.type} "${o.name}" pos=${fmt(o.position)} rot=${fmt(o.rotation)} scale=${fmt(o.scale)}`);
  if (o.isMesh) {
    const g = o.geometry;
    console.log(`${pad}  attributes:`, Object.fromEntries(Object.entries(g.attributes).map(([k, v]) => [k, `${v.count}x${v.itemSize}`])));
    console.log(`${pad}  index:`, g.index ? g.index.count : 'none', 'groups:', JSON.stringify(g.groups));
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      console.log(`${pad}  material: ${m.type} "${m.name}"`, {
        color: m.color?.getHexString(), map: m.map?.name ?? !!m.map, normalMap: !!m.normalMap,
        specularMap: !!m.specularMap, bumpMap: !!m.bumpMap, shininess: m.shininess, emissive: m.emissive?.getHexString(),
        transparent: m.transparent, opacity: m.opacity, side: m.side,
      });
    }
    g.computeBoundingBox();
    const lb = g.boundingBox;
    console.log(`${pad}  local bbox min=${fmt(lb.min)} max=${fmt(lb.max)} size=${fmt(lb.getSize(new THREE.Vector3()))}`);
    const wb = new THREE.Box3().setFromObject(o);
    console.log(`${pad}  world bbox min=${fmt(wb.min)} max=${fmt(wb.max)} size=${fmt(wb.getSize(new THREE.Vector3()))}`);
    const uv = g.attributes.uv;
    if (uv) {
      let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
      for (let i = 0; i < uv.count; i++) { umin = Math.min(umin, uv.getX(i)); umax = Math.max(umax, uv.getX(i)); vmin = Math.min(vmin, uv.getY(i)); vmax = Math.max(vmax, uv.getY(i)); }
      console.log(`${pad}  uv range u=[${umin.toFixed(4)}, ${umax.toFixed(4)}] v=[${vmin.toFixed(4)}, ${vmax.toFixed(4)}]`);
    }
    // Normal smoothness: for coincident positions, do normals differ?
    const pos = g.attributes.position, nor = g.attributes.normal;
    const byPos = new Map();
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      if (!byPos.has(k)) byPos.set(k, []);
      byPos.get(k).push(i);
    }
    let split = 0, shared = 0;
    for (const idx of byPos.values()) {
      if (idx.length < 2) continue;
      const n0 = new THREE.Vector3().fromBufferAttribute(nor, idx[0]);
      const differs = idx.some((j) => new THREE.Vector3().fromBufferAttribute(nor, j).angleTo(n0) > 0.01);
      differs ? split++ : shared++;
    }
    console.log(`${pad}  unique positions=${byPos.size}, coincident groups with split normals=${split}, with identical normals=${shared}`);
    // Normal direction histogram (dominant axis)
    const hist = {};
    for (let i = 0; i < nor.count; i++) {
      const n = new THREE.Vector3().fromBufferAttribute(nor, i);
      const a = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 'x' : 'z') : (Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z');
      const s = n[a] > 0 ? '+' : '-';
      const tilt = (Math.acos(Math.min(1, Math.abs(n[a]))) * 180 / Math.PI);
      const key = `${s}${a}` + (tilt > 5 ? ` (tilted ${Math.round(tilt / 5) * 5}°)` : '');
      hist[key] = (hist[key] ?? 0) + 1;
    }
    console.log(`${pad}  normal dominant-axis histogram:`, hist);
  }
});

function depth(o) { let d = 0; while (o.parent) { d++; o = o.parent; } return d; }
function fmt(v) { return `(${[v.x, v.y, v.z].map((n) => (+n).toFixed(4)).join(', ')})`; }
