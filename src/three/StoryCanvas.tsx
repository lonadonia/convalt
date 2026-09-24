import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { QualityProfile } from '../config/quality';
import { story, ui, useUI } from '../state/store';
import { journeyLayout } from '../config/journey';
import { loadFieldAssets, type FieldAssets } from './field/fieldAssets';
import { loadDcAssets, type DcAssets } from './datacenter/dcAssets';
import { DataCenterWorld } from './datacenter/DataCenterWorld';
import { FieldWorld } from './field/FieldWorld';
import { debug } from '../lib/debug';
import { useDisposeOnUnmount } from '../hooks/useDisposeOnUnmount';
import { ExplodedAssembly } from './ExplodedAssembly';
import { OriginalPanel } from './OriginalPanel';
import { loadPanelAsset, type PanelAsset } from './panelAsset';
import type { SceneRig } from './rig';
import { SceneEnvironment } from './SceneEnvironment';
import { compileWhenReady } from './compile';
import { StoryController } from './StoryController';
import { GroundShadow } from './studio';
import { installPerfProbe } from './perfProbe';

const GROUND_Y = -0.66;

/** Mounts the panel and the assembly, uploads textures and compiles shaders before revealing. */
function PanelContent({ asset, rig }: { asset: PanelAsset; rig: SceneRig }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    let cancelled = false;
    const m = asset.material;
    for (const t of new Set([m.map, m.normalMap, m.roughnessMap, m.metalnessMap])) if (t) gl.initTexture(t);
    const assemblyRoot = rig.assembly?.root;
    if (assemblyRoot) assemblyRoot.visible = true;
    compileWhenReady(gl, scene, camera, () => !cancelled)
      .then(() => {
        if (assemblyRoot) assemblyRoot.visible = false;
        if (cancelled) return;
        ui.set({ status: 'ready', loadProgress: 1 });
        story.invalidate();
      });
    return () => { cancelled = true; };
  }, [asset, rig, gl, scene, camera]);

  return (
    <>
      <OriginalPanel asset={asset} rig={rig} />
      <ExplodedAssembly asset={asset} rig={rig} />
    </>
  );
}

/**
 * Power-generation scene: loads its assets once the Module scene's panel is ready and the browser is
 * idle (at once when the visitor is already past the overview), builds the scene, uploads textures
 * and compiles its programs before it can be seen. Failure leaves the page usable: the panel stays
 * in the studio and the section text still appears.
 */
function FieldLoader({ rig, quality }: { rig: SceneRig; quality: QualityProfile }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const status = useUI((s) => s.status);
  const tier = useUI((s) => s.tier);

  useEffect(() => {
    if (status !== 'ready' || !rig.asset || !rig.lights) return;
    let cancelled = false;
    let world: FieldWorld | null = null;
    let assets: FieldAssets | null = null;
    const start = () => {
      if (cancelled) return;
      ui.set({ fieldStatus: 'loading' });
      loadFieldAssets(tier, quality.anisotropy)
        .then(async (a) => {
          if (cancelled || !rig.asset || !rig.lights) { a.dispose(); return; }
          assets = a;
          world = new FieldWorld(gl, scene, rig.lights, () => rig.studioEnv, a, rig.asset.meta.size[2], tier);
          scene.add(world.root);
          rig.panelRoot.add(world.hero);
          await world.prepare(camera);
          if (cancelled) return;
          rig.field = world;
          (window as unknown as { __convaltField?: unknown }).__convaltField = world.stats;
          ui.set({ fieldStatus: 'ready' });
          story.invalidate();
        })
        .catch((err) => {
          if (cancelled) return;
          console.error('[convalt] power-generation assets failed to load', err);
          ui.set({ fieldStatus: 'error' });
          story.invalidate();
        });
    };
    const near = story.target > journeyLayout(tier).introShare;
    const ric = typeof window.requestIdleCallback === 'function';
    const handle = near ? 0 : ric ? window.requestIdleCallback(start, { timeout: 2500 }) : window.setTimeout(start, 1200);
    if (near) start();
    return () => {
      cancelled = true;
      if (!near) { if (ric) window.cancelIdleCallback(handle); else window.clearTimeout(handle); }
      if (rig.field === world) rig.field = null;
      world?.dispose();
      assets?.dispose();
      ui.set({ fieldStatus: 'idle' });
    };
  }, [status, tier, quality.anisotropy, gl, scene, camera, rig]);
  return null;
}

/**
 * Data-center scene: loads after the power-generation assets have settled (at once when the visitor
 * is already past the story), is built, compiled and given one reflection pass before it can be
 * seen — the transition never waits for it. Failure leaves the section usable: the field darkens
 * into charcoal and the copy and link appear as usual.
 */
function DataCenterLoader({ rig, quality }: { rig: SceneRig; quality: QualityProfile }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const status = useUI((s) => s.status);
  const fieldSettled = useUI((s) => s.fieldStatus === 'ready' || s.fieldStatus === 'error');
  const tier = useUI((s) => s.tier);
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    if (wanted || status !== 'ready' || !rig.asset) return;
    const near = story.target > journeyLayout(tier).storyEnd;
    if (!fieldSettled && !near) return;
    if (near) { setWanted(true); return; }
    const ric = typeof window.requestIdleCallback === 'function';
    const go = () => setWanted(true);
    const handle = ric ? window.requestIdleCallback(go, { timeout: 3000 }) : window.setTimeout(go, 1500);
    return () => { if (ric) window.cancelIdleCallback(handle); else window.clearTimeout(handle); };
  }, [wanted, status, fieldSettled, tier, rig]);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    let world: DataCenterWorld | null = null;
    let assets: DcAssets | null = null;
    ui.set({ dcStatus: 'loading' });
    loadDcAssets(quality.anisotropy)
      .then(async (a) => {
        if (cancelled) { a.dispose(); return; }
        assets = a;
        world = new DataCenterWorld(gl, a);
        const aspect = size.width / Math.max(1, size.height);
        world.setFraming(ui.get().tier, aspect, null);
        world.update(0.06, aspect, 0, false);
        await world.prepare();
        world.renderReflection();
        if (cancelled) return;
        rig.dc = world;
        (window as unknown as { __convaltDc?: unknown }).__convaltDc = world.stats;
        ui.set({ dcStatus: 'ready' });
        story.invalidate();
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[convalt] data-center model failed to load', err);
        ui.set({ dcStatus: 'error' });
        story.invalidate();
      });
    return () => {
      cancelled = true;
      if (rig.dc === world) rig.dc = null;
      world?.dispose();
      assets?.dispose();
      ui.set({ dcStatus: 'idle' });
    };
    // The model does not depend on the tier or viewport (only its camera path does).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, gl, rig, quality.anisotropy]);
  return null;
}

/** WebGL context loss: keep the page usable (posters) and recover when the browser restores it. */
function ContextGuard() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      ui.set({ status: 'context-lost' });
    };
    const restored = () => {
      ui.set({ status: 'ready' });
      invalidate();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    if (debug.loseContext) {
      const ext = gl.getContext().getExtension('WEBGL_lose_context');
      const t1 = window.setTimeout(() => ext?.loseContext(), debug.loseContext);
      const t2 = window.setTimeout(() => ext?.restoreContext(), debug.loseContext + 2500);
      return () => { window.clearTimeout(t1); window.clearTimeout(t2); canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored); };
    }
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [gl, invalidate]);
  return null;
}

export default function StoryCanvas({ quality }: { quality: QualityProfile }) {
  const rig = useMemo<SceneRig>(() => ({
    panelRoot: Object.assign(new THREE.Group(), { name: 'PanelRoot' }),
    original: null,
    assembly: null,
    asset: null,
    shadow: new GroundShadow(GROUND_Y),
    lights: null,
    studioEnv: null,
    field: null,
    dc: null,
  }), []);
  const [asset, setAsset] = useState<PanelAsset | null>(null);

  useEffect(() => {
    let disposed = false;
    let loaded: PanelAsset | null = null;
    ui.set({ status: 'loading', loadProgress: 0 });
    const url = debug.failModel ? '/models/does-not-exist.glb' : quality.modelUrl;
    loadPanelAsset(url, quality.anisotropy, (f) => ui.set({ loadProgress: f }))
      .then((a) => {
        if (disposed) { a.dispose(); return; }
        loaded = a;
        rig.asset = a;
        setAsset(a);
      })
      .catch((err) => {
        if (disposed) return;
        console.error('[convalt] model failed to load', err);
        ui.set({ status: 'error' });
        story.invalidate();
      });
    return () => {
      disposed = true;
      rig.asset = null;
      loaded?.dispose();
    };
  }, [quality.modelUrl, quality.anisotropy, rig]);

  useDisposeOnUnmount(rig.shadow.dispose);

  return (
    <Canvas
      className="story-canvas"
      frameloop="demand"
      // One sun shadow map, rendered only when the installation changes (see FieldWorld.update).
      // Passed through the prop: R3F sets gl.shadowMap.enabled from it on every configure.
      shadows={{ type: THREE.PCFShadowMap, autoUpdate: false }}
      dpr={quality.dpr[1]}
      flat={false}
      gl={{ antialias: quality.antialias, alpha: true, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: debug.capture }}
      camera={{ fov: 26, near: 0.1, far: 40, position: [0, 0, 6], manual: true }}
      onCreated={({ gl, scene, camera }) => {
        // Shader-log checks force synchronous compile queries; keep them for development only.
        gl.debug.checkShaderErrors = import.meta.env.DEV;
        if (debug.perf) installPerfProbe(gl);
        if (debug.inspect) (window as unknown as { __three?: unknown }).__three = { gl, scene, camera };
        // Counters cover a whole frame (every pass), reset by the scene controller.
        gl.info.autoReset = false;
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.setClearColor(0x000000, 0);
      }}
      aria-hidden="true"
      tabIndex={-1}
    >
      <ContextGuard />
      <SceneEnvironment rig={rig} />
      <primitive object={rig.panelRoot}>
        {asset && <PanelContent asset={asset} rig={rig} />}
      </primitive>
      <FieldLoader rig={rig} quality={quality} />
      <DataCenterLoader rig={rig} quality={quality} />
      <StoryController rig={rig} quality={quality} />
    </Canvas>
  );
}
