import * as THREE from 'three';

type Rect = { x0: number; z0: number; x1: number; z1: number };
const rect4 = (r: Rect) => new THREE.Vector4(r.x0, r.z0, r.x1, r.z1);

const NOISE = /* glsl */ `
float cvHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float cvNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cvHash(i), cvHash(i + vec2(1.0, 0.0)), u.x), mix(cvHash(i + vec2(0.0, 1.0)), cvHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

export type TerrainUniforms = {
  uFarAmount: { value: number };
  uHorizon: { value: THREE.Vector3 };
  uDetail: { value: number };
};

/**
 * Terrain: three orthophoto layers resampled from the scan (site inset → full scan → apron),
 * selected by field-frame position with soft edges, times the standard lit/shadowed shading.
 *
 * The scan was photographed under an overcast sky: its colours already contain that flat light
 * and read grey-green once lit again by a sun. A fixed grade (saturation, a fresher green, a
 * little density) turns the photo into a plausible sunlit albedo; it is the same for every pixel,
 * so hedges, lane and wheel tracks keep their relative look. Near the camera a procedural grass
 * grain (no photo texture) keeps close ground from looking like a blurred print; far away the
 * terrain fades into the horizon haze, so no edge shows.
 */
export function createTerrainMaterial(opts: {
  textures: { inset: THREE.Texture; scan: THREE.Texture; apron: THREE.Texture };
  rects: { inset: Rect; scan: Rect; apron: Rect };
  localToField: THREE.Matrix4;
  farCentre: THREE.Vector2;
  far: [number, number];
}) {
  // The sky environment is tuned for the glossy modules' reflections; as diffuse fill on open ground
  // it is too strong (clear-sky light is roughly a third of the sun's), so the terrain takes less.
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.42 });
  const uniforms = {
    uInset: { value: opts.textures.inset },
    uScan: { value: opts.textures.scan },
    uApron: { value: opts.textures.apron },
    uInsetRect: { value: rect4(opts.rects.inset) },
    uScanRect: { value: rect4(opts.rects.scan) },
    uApronRect: { value: rect4(opts.rects.apron) },
    uLocalToField: { value: opts.localToField },
    uDetail: { value: 0.16 },
    /** Grade of the overcast orthophoto: saturation, per-channel gain (linear), density exponent. */
    uGrade: { value: new THREE.Vector4(1.7, 0.76, 0.74, 0.61) },
    uDensity: { value: 1.08 },
    uFarCentre: { value: opts.farCentre },
    uFar: { value: new THREE.Vector2(...opts.far) },
    uFarAmount: { value: 1 },
    // Display-referred (applied after the colour-space conversion, like three's fog colour).
    uHorizon: { value: new THREE.Vector3(0.87, 0.9, 0.91) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uLocalToField;\nvarying vec2 vFieldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFieldXZ = (uLocalToField * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uInset; uniform sampler2D uScan; uniform sampler2D uApron;
uniform vec4 uInsetRect; uniform vec4 uScanRect; uniform vec4 uApronRect;
uniform float uDetail; uniform vec4 uGrade; uniform float uDensity; uniform vec2 uFarCentre; uniform vec2 uFar; uniform float uFarAmount; uniform vec3 uHorizon;
varying vec2 vFieldXZ;
${NOISE}
vec2 cvRectUV(vec2 p, vec4 r) { return (p - r.xy) / (r.zw - r.xy); }
float cvEdge(vec2 p, vec4 r, float fade) { vec2 d = min(p - r.xy, r.zw - p); return smoothstep(0.0, fade, min(d.x, d.y)); }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  vec3 apronC = texture2D(uApron, cvRectUV(vFieldXZ, uApronRect)).rgb;
  vec3 scanC = texture2D(uScan, cvRectUV(vFieldXZ, uScanRect)).rgb;
  vec3 insetC = texture2D(uInset, cvRectUV(vFieldXZ, uInsetRect)).rgb;
  vec3 ground = mix(apronC, scanC, cvEdge(vFieldXZ, uScanRect, 28.0));
  ground = mix(ground, insetC, cvEdge(vFieldXZ, uInsetRect, 16.0));
  // Overcast photo → sunlit albedo (see above).
  float lum = dot(ground, vec3(0.2126, 0.7152, 0.0722));
  ground = max(vec3(0.0), vec3(lum) + (ground - vec3(lum)) * uGrade.x) * uGrade.yzw;
  ground = pow(ground, vec3(uDensity));
  // Close ground: grass grain (fine luminance) and patchy colour (yellower / deeper tufts).
  float dist = length(vViewPosition);
  float near = 1.0 - smoothstep(14.0, 70.0, dist);
  float fine = cvNoise(vFieldXZ * 23.0) * 0.55 + cvNoise(vFieldXZ * 7.0 + 3.7) * 0.45;
  float tuft = cvNoise(vFieldXZ * 1.3 + 11.0);
  ground *= 1.0 + uDetail * near * (fine - 0.5) * 2.0;
  ground = mix(ground, ground * vec3(1.12, 1.04, 0.72), near * smoothstep(0.35, 0.85, tuft) * 0.45);
  diffuseColor.rgb *= ground;
}`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizon, smoothstep(uFar.x, uFar.y, length(vFieldXZ - uFarCentre)) * uFarAmount);`,
      );
  };
  material.customProgramCacheKey = () => 'convalt-terrain';
  return { material, uniforms: uniforms as unknown as TerrainUniforms & typeof uniforms };
}

export type SkyUniforms = {
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uGround: { value: THREE.Color };
  uIvory: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunGlow: { value: THREE.Color };
  uReveal: { value: number };
};

/**
 * Sky dome around the camera. At reveal 0 it is exactly the page's ivory (unlit, not tone mapped),
 * so it can be switched on invisibly; it then blends into a soft outdoor gradient with a sun glow.
 */
export function createSky(radius: number) {
  const uniforms: SkyUniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uIvory: { value: new THREE.Color('#f5f4ee') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunGlow: { value: new THREE.Color() },
    uReveal: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uIvory;
      uniform vec3 uSunDir; uniform vec3 uSunGlow; uniform float uReveal;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, h));
        if (h < 0.0) sky = mix(uHorizon, uGround, smoothstep(0.0, 0.3, -h));
        float s = max(dot(d, uSunDir), 0.0);
        sky += uSunGlow * (pow(s, 48.0) * 0.3 + pow(s, 5.0) * 0.06) * step(0.0, h);
        gl_FragColor = vec4(mix(uIvory, sky, uReveal), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  mesh.name = 'FieldSky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, uniforms };
}

/**
 * Per-instance opacity for the short reveal of each module or support. Fading instances live in
 * their own (transparent) instanced mesh, sorted back to front; everything fully revealed is in
 * the opaque mesh. The shadow pass uses a hashed alpha test on the same opacity, so a shadow
 * fades in with its module instead of popping.
 */
export function withInstanceOpacity<T extends THREE.MeshStandardMaterial>(base: T): { material: T; depth: THREE.MeshDepthMaterial } {
  const material = base.clone() as T;
  material.transparent = true;
  material.depthWrite = true;
  const baseCompile = base.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceOpacity;')
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vInstanceOpacity;');
  };
  material.customProgramCacheKey = () => `convalt-instance-fade:${base.customProgramCacheKey?.() ?? ''}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vInstanceOpacity;\n${NOISE}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (cvHash(gl_FragCoord.xy) > vInstanceOpacity) discard;');
  };
  depth.customProgramCacheKey = () => 'convalt-instance-fade-depth';
  return { material, depth };
}
