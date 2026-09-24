import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EXPLODE_SPREAD, PARALLAX, POSES, STORY, steppedProgress, type KeyPose } from '../config/choreography';
import { FEATURES, FRAME, MODEL_CELL_FIELD } from '../config/intro';
import { FIELD_APPROACH, FIELD_CAMERA, FIELD_FINAL_FIT, HERO_MOUNT } from '../config/field';
import { JOURNEY, JUMP, dcOf, journeyLayout, journeyOfDc, journeyOfField, journeyOfStory, storyOf } from '../config/journey';
import { sampleDc } from '../datacenter/timeline';
import { SceneBlend } from './datacenter/sceneBlend';
import { ADAPTIVE, type QualityProfile } from '../config/quality';
import { clamp, damp, easeInOutSine, easeOutCubic, lerp } from '../lib/math';
import { markOverlayLayoutDirty, measureLayout, overlay, refreshOverlayLayout, type LayoutMetrics } from '../state/overlay';
import { story, ui, useUI, type LayerId, type Tier } from '../state/store';
import { applyJourney, setScene } from '../lib/journeyDriver';
import { debug } from '../lib/debug';
import { applyIntrinsics, applyLensShift, fitToRegion, intrinsicsOf, type Framing } from './framing';
import { sweepUniforms } from './materials';
import { solvePanelPose } from './panelPose';
import { CameraPath, anglesOf, type CameraKey, type CameraSample } from './field/cameraPath';
import type { SceneRig } from './rig';

const IDENTITY = new THREE.Quaternion();

/** Screen area for the final overview: beside the section text, or above it on portrait screens. */
function finalRegion(aspect: number, m: LayoutMetrics | null): [number, number, number, number] {
  const R = FIELD_FINAL_FIT;
  if (aspect < R.portraitAspect) return [R.left, R.top, R.right, Math.max(R.top + 0.2, (m?.fieldTop ?? 0.55) - R.gap)];
  return [Math.min(R.maxLeft, (m?.fieldRight ?? 0.42) + R.gap), R.top, R.right, R.bottom];
}

const LAYER_IDS: LayerId[] = ['protection', 'cells', 'structure'];
const DEFAULT_SIZE: [number, number, number] = [1.864, 0.935, 0.03];

type Key = { q: THREE.Quaternion; framing: Framing };

function quatFromPose(pose: KeyPose) {
  const [x, y, z] = pose.rotation;
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
}

/**
 * Keeps the object clear of the HTML text: in the side-by-side layout the region starts right of
 * the measured text column; in the stacked layout it fills the measured gap between text and controls.
 */
function constrainRegion(pose: KeyPose, which: 'hero' | 'inspect' | 'final', tier: Tier, m: LayoutMetrics | null): KeyPose['region'] {
  const [x0, y0, x1, y1] = pose.region;
  // The final pose is the centred handoff to the power-generation scene (the text has cleared).
  if (!m || which === 'final') return pose.region;
  if (tier === 'desktop') {
    const left = Math.min(x1 - 0.25, Math.max(x0, m.textRight + 0.035));
    return [left, y0, x1, y1];
  }
  // Hero: below the text block. Module states: the full gap between lede and controls.
  const ny0 = Math.max(y0, which === 'hero' ? m.heroBottom + 0.03 : m.moduleTextBottom + 0.025);
  const ny1 = which === 'hero' ? y1 : m.controlsTop - 0.05;
  return ny1 - ny0 > 0.16 ? [x0, ny0, x1, ny1] : pose.region;
}

function solveKeys(tier: Tier, aspect: number, size: [number, number, number], metrics: LayoutMetrics | null) {
  const spread = EXPLODE_SPREAD[tier];
  const make = (pose: KeyPose, which: 'hero' | 'inspect' | 'final'): Key => {
    const q = quatFromPose(pose);
    const region = constrainRegion(pose, which, tier, metrics);
    const half = new THREE.Vector3(size[0] / 2 + 0.012, size[1] / 2 + 0.012, size[2] / 2 + pose.explode * (spread + 0.004));
    return {
      q,
      framing: fitToRegion({ halfExtents: half, orientation: q, azimuthDeg: pose.azimuth, elevationDeg: pose.elevation, fov: pose.fov, aspect, region }),
    };
  };
  const p = POSES[tier];
  return { hero: make(p.hero, 'hero'), inspect: make(p.inspect, 'inspect'), final: make(p.final, 'final') };
}

function blendFraming(a: Framing, b: Framing, t: number, out: { dir: THREE.Vector3; distance: number; shift: THREE.Vector2; fov: number }) {
  out.dir.copy(a.direction).lerp(b.direction, t).normalize();
  out.distance = Math.exp(lerp(Math.log(a.distance), Math.log(b.distance), t));
  out.shift.copy(a.shift).lerp(b.shift, t);
  out.fov = lerp(a.fov, b.fov, t);
  return out;
}

export function StoryController({ rig, quality }: { rig: SceneRig; quality: QualityProfile }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const setDpr = useThree((s) => s.setDpr);
  const viewportDpr = useThree((s) => s.viewport.dpr);
  const tier = useUI((u) => u.tier);

  useEffect(() => {
    story.invalidate = () => invalidate();
    invalidate();
    return () => {
      overlay.sceneActive = false;
      story.invalidate = () => applyJourney(story.target);
    };
  }, [invalidate]);

  const aspect = size.width / Math.max(1, size.height);
  const [layoutKey, setLayoutKey] = useState('');
  // Re-measure the text layout whenever the canvas size, tier or fonts change.
  useEffect(() => {
    markOverlayLayoutDirty();
    const update = () => setLayoutKey(measureLayout()?.key ?? '');
    update();
    const raf = requestAnimationFrame(update);
    document.fonts?.ready.then(update).catch(() => undefined);
    invalidate();
    return () => cancelAnimationFrame(raf);
  }, [size.width, size.height, tier, invalidate]);
  const keys = useMemo(
    () => solveKeys(tier, aspect, rig.asset?.meta.size ?? DEFAULT_SIZE, overlay.metrics),
    [tier, aspect, rig.asset, layoutKey],
  );
  const fieldReady = useUI((u) => u.fieldStatus === 'ready');
  const dcReady = useUI((u) => u.dcStatus === 'ready');
  const blend = useMemo(() => new SceneBlend(), []);
  useEffect(() => () => blend.dispose(), [blend]);
  useEffect(() => { blend.prepare(gl); }, [blend, gl]);
  const scene = useThree((s) => s.scene);
  // What the render hook needs from the frame (set by the frame loop, read at render priority).
  const render = useRef({ dc: sampleDc(0) });
  // Power generation: one camera path from the Module scene's final camera (exact handoff) through
  // the approach and the outdoor keys. Without the field (loading/failed) only the approach runs.
  const fieldPath = useMemo(() => {
    const fin = keys.final.framing;
    const { az, el } = anglesOf(fin.direction);
    const list: CameraKey[] = [
      { t: 0, target: new THREE.Vector3(), az, el, dist: fin.distance, shift: fin.shift.clone() },
      { t: FIELD_APPROACH[tier].t, target: new THREE.Vector3(), az, el, dist: fin.distance * FIELD_APPROACH[tier].scale, shift: new THREE.Vector2() },
    ];
    const field = fieldReady ? rig.field : null;
    if (field) {
      const hero = new THREE.Vector3(...HERO_MOUNT);
      const keysCfg = FIELD_CAMERA[tier].keys;
      keysCfg.forEach((k, i) => {
        const last = i === keysCfg.length - 1;
        const base = k.anchor === 'hero' ? hero : field.layout.siteCentre;
        const o = last ? debug.fieldCam : null; // ?fieldcam= composition override
        const key: CameraKey = {
          t: k.t,
          target: base.clone().add(o ? new THREE.Vector3(o[3] ?? 0, 0, o[4] ?? 0) : new THREE.Vector3(...k.target)),
          az: o?.[0] ?? k.az,
          el: o?.[1] ?? k.el,
          dist: o?.[2] ?? k.dist,
          shift: new THREE.Vector2(o?.[5] ?? k.shift?.[0] ?? 0, o?.[6] ?? k.shift?.[1] ?? 0),
        };
        if (last && !o && tier === 'desktop') {
          // Final overview: the whole installation fitted into the area the text leaves free.
          const f = fitToRegion({ halfExtents: field.bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5), orientation: IDENTITY, azimuthDeg: key.az, elevationDeg: key.el, fov: fin.fov, aspect, region: finalRegion(aspect, overlay.metrics) });
          field.bounds.getCenter(key.target);
          key.dist = f.distance;
          key.shift.copy(f.shift);
        }
        list.push(key);
      });
    }
    return new CameraPath(list);
  }, [keys, tier, aspect, fieldReady, rig]);

  const state = useRef({
    last: performance.now(),
    shownStep: -1,
    stageFade: 1,
    jump: 'none' as 'none' | 'out' | 'in',
    parallax: new THREE.Vector2(),
    highlight: { protection: 0, cells: 0, structure: 0 } as Record<LayerId, number>,
    dimmed: { protection: 0, cells: 0, structure: 0 } as Record<LayerId, number>,
    readyAt: -1,
    photoPos: new THREE.Vector3(),
    tmp: new THREE.Vector3(),
    photoQ: new THREE.Quaternion(),
    normal: new THREE.Vector3(),
    dpr: viewportDpr,
    slowFrames: 0,
    prevNeeded: false,
    fastFrames: 0,
    blend: { dir: new THREE.Vector3(), distance: 5, shift: new THREE.Vector2(), fov: 26 },
    tmpBlend: { dir: new THREE.Vector3(), distance: 5, shift: new THREE.Vector2(), fov: 26 },
    q: new THREE.Quaternion(),
    qOffset: new THREE.Quaternion(),
    euler: new THREE.Euler(0, 0, 0, 'YXZ'),
    corners: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
    anchor: new THREE.Vector3(),
    anchorAlt: new THREE.Vector3(),
    cam: { position: new THREE.Vector3(), target: new THREE.Vector3(), shift: new THREE.Vector2(), distance: 1 } as CameraSample,
    activityTimer: 0,
    jumpDark: 0,
    stageVisible: true,
  });

  // Past the journey the released stage scrolls away: note when it is out of view, so the quiet
  // indicator activity stops redrawing a scene nobody can see.
  useEffect(() => {
    const stage = overlay.stage;
    if (!stage || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => {
      state.current.stageVisible = e.isIntersecting;
      if (e.isIntersecting) invalidate();
    });
    io.observe(stage);
    return () => io.disconnect();
  }, [invalidate]);

  useFrame((_, delta) => {
    const s = state.current;
    const now = performance.now();
    const frameMs = now - s.last;
    s.last = now;
    const dt = Math.min(delta, 1 / 20);
    const { motion, status, activeLayer } = ui.get();
    const ready = status === 'ready' && Boolean(rig.asset);
    let needsFrame = false;

    // ---- 1. Progress: the single source of truth ----------------------------------------------
    if (motion) {
      const diff = story.target - story.progress;
      const share = journeyLayout(tier).introShare;
      // A jump across the intro cuts through a brief stage fade (see JUMP) — no fast-forward.
      if (s.jump === 'none' && Math.abs(diff) > JUMP.threshold && Math.min(story.target, story.progress) < share) {
        s.jump = 'out';
        // Whether this cut starts or ends in the dark lower page (it then fades through charcoal).
        const L = journeyLayout(tier);
        s.jumpDark = Math.max(sampleDc(dcOf(story.progress, L)).dark, sampleDc(dcOf(story.target, L)).dark);
      }
      if (s.jump === 'out') {
        s.stageFade = Math.max(0, s.stageFade - dt / JUMP.fadeOut);
        if (s.stageFade === 0) { story.progress = story.target; s.jump = 'in'; }
        needsFrame = true;
      } else {
        const lambda = Math.min(story.progress, story.target) < share ? JOURNEY.introSmoothing : STORY.smoothing;
        story.progress = Math.abs(diff) < 0.00005 ? story.target : damp(story.progress, story.target, lambda, dt);
        if (s.jump === 'in') {
          s.stageFade = Math.min(1, s.stageFade + dt / JUMP.fadeIn);
          if (s.stageFade === 1) s.jump = 'none';
          needsFrame = true;
        } else s.stageFade = 1;
      }
      needsFrame ||= story.progress !== story.target;
      s.shownStep = -1;
    } else {
      s.jump = 'none';
      // Reduced motion: hold still compositions (opening, overview, module, closing) and
      // cross-fade between them — no camera travel, no ambient motion.
      const L = journeyLayout(tier);
      const step = story.target < L.introShare * 0.5
        ? 0
        : story.target < L.storyEnd
          ? journeyOfStory(steppedProgress(storyOf(story.target, L)), L)
          : story.target < journeyOfDc(0.05, L)
            ? journeyOfField(JOURNEY.fieldTarget, L) // the completed installation with its text
            : journeyOfDc(JOURNEY.dcTarget, L); // the settled data-center view with its copy
      if (s.shownStep < 0) { s.shownStep = step; s.stageFade = 1; }
      if (step !== s.shownStep) {
        s.stageFade = Math.max(0, s.stageFade - dt / 0.16);
        if (s.stageFade === 0) s.shownStep = step;
        needsFrame = true;
      } else if (s.stageFade < 1) {
        s.stageFade = Math.min(1, s.stageFade + dt / 0.22);
        needsFrame = true;
      }
      story.progress = s.shownStep;
    }
    // ---- 2. One driver applies the DOM for this frame and returns the derived samples ----------
    overlay.sceneActive = true;
    const frame = applyJourney(story.progress);
    const { intro, introT, sample: sm, fieldT, field: fs, dcT, dc } = frame;
    const inIntro = introT < 1;
    const inField = fieldT > 0;
    const fieldWorld = fieldReady ? rig.field : null;
    if (ready && s.readyAt < 0) s.readyAt = now;

    // Light sweep: one band across the cell face as the panel settles into the overview
    // (scroll-driven; there is no timed cinematic).
    let sweepPos = -2;
    let sweepStrength = 0;
    if (inIntro && motion && intro.sweep > 0 && intro.sweep < 1) {
      sweepPos = lerp(-0.55, 1.25, easeInOutSine(intro.sweep));
      sweepStrength = 0.17 * Math.sin(Math.PI * intro.sweep);
    }
    if (rig.asset) {
      const sw = sweepUniforms(rig.asset.material);
      if (sw) { sw.uSweep.value = sweepPos; sw.uSweepStrength.value = sweepStrength; }
    }

    // ---- 3. Camera (sole owner) ----------------------------------------------------------------
    const b = blendFraming(keys.hero.framing, keys.inspect.framing, sm.toInspect, s.blend);
    if (sm.toFinal > 0) {
      const t2 = blendFraming(keys.inspect.framing, keys.final.framing, sm.toFinal, s.tmpBlend);
      // Final blend starts from the inspect framing; hero no longer contributes at this point.
      b.dir.copy(t2.dir); b.distance = t2.distance; b.shift.copy(t2.shift); b.fov = t2.fov;
    }
    camera.fov = b.fov;
    camera.aspect = aspect;
    camera.up.set(0, 1, 0);
    if (inField) {
      // Power generation: the continuous outdoor path (starts exactly at the final framing above).
      const c = fieldPath.sample(fieldT, s.cam);
      camera.position.copy(c.position);
      camera.lookAt(c.target);
      camera.near = Math.max(0.05, Math.min(1, c.distance * 0.012));
      camera.far = 4000;
      applyLensShift(camera, c.shift);
    } else {
      camera.position.copy(b.dir).multiplyScalar(b.distance);
      camera.lookAt(0, 0, 0);
      // During the handoff the panel starts far out (the footage's long lens, see below); keep the
      // whole path inside the frustum.
      camera.near = inIntro ? 0.05 : Math.max(0.05, b.distance - 3);
      camera.far = b.distance + (inIntro ? 40 : 12);
      applyLensShift(camera, b.shift);
    }
    camera.updateMatrixWorld();

    // ---- 4. Pose: key-pose blend + restrained parallax; photo → overview during the intro -------
    const parallaxAllowed = motion && tier === 'desktop' && !inIntro ? sm.parallax : 0;
    story.parallaxWeight = parallaxAllowed;
    const px = story.pointer.x * parallaxAllowed, py = story.pointer.y * parallaxAllowed;
    s.parallax.x = damp(s.parallax.x, px, PARALLAX.lambda, dt);
    s.parallax.y = damp(s.parallax.y, py, PARALLAX.lambda, dt);
    if (Math.abs(s.parallax.x - px) < 0.0005 && Math.abs(s.parallax.y - py) < 0.0005) s.parallax.set(px, py);
    else needsFrame = true;

    s.q.copy(keys.hero.q).slerp(keys.inspect.q, sm.toInspect);
    if (sm.toFinal > 0) s.q.slerp(keys.final.q, sm.toFinal);
    s.euler.set(-s.parallax.y * PARALLAX.pitch, s.parallax.x * PARALLAX.yaw, 0, 'YXZ');
    s.qOffset.setFromEuler(s.euler);
    rig.panelRoot.quaternion.copy(s.qOffset).multiply(s.q);
    rig.panelRoot.position.set(0, 0, 0);
    if (inIntro && frame.photoPanel && intro.panelCorners && rig.asset) {
      // Handoff: the camera takes on the footage camera as framed on screen (its focal length and
      // principal point through the video layer's transform), and the real model takes the pose
      // whose projected cell field matches the filmed panel — a rigid fit to sub-pixel accuracy.
      // It then eases into the unchanged overview pose while the lens returns to the overview
      // camera; the focal length follows the depth (dolly compensation), so the panel's size on
      // screen changes smoothly instead of breathing. Without the footage (failed to load) the
      // model simply fades in at the overview pose.
      const W = size.width, H = size.height;
      const hz = rig.asset.meta.size[2] / 2;
      const hero = intrinsicsOf(camera, W, H);
      const xf = intro.layers.assembly.xf;
      const f0 = xf.s * FEATURES.assembly.endFocal;
      const p0x = xf.tx + (xf.s * FRAME.w) / 2, p0y = xf.ty + (xf.s * FRAME.h) / 2;
      applyIntrinsics(camera, f0, p0x, p0y, W, H);
      const pose = solvePanelPose(intro.panelCorners, W, H, camera, MODEL_CELL_FIELD.hx, MODEL_CELL_FIELD.hy);
      s.normal.set(0, 0, 1).applyQuaternion(pose.quaternion);
      s.photoPos.copy(pose.position).addScaledVector(s.normal, -hz);
      s.photoQ.copy(pose.quaternion);
      perf.handoffErrorPx = pose.errorPx;
      const k = intro.toOverview;
      const d0 = -s.tmp.copy(s.photoPos).applyMatrix4(camera.matrixWorldInverse).z;
      const d1 = -s.tmp.copy(rig.panelRoot.position).applyMatrix4(camera.matrixWorldInverse).z;
      rig.panelRoot.position.lerpVectors(s.photoPos, rig.panelRoot.position, k);
      s.photoQ.slerp(rig.panelRoot.quaternion, k);
      rig.panelRoot.quaternion.copy(s.photoQ);
      const g = Math.exp(lerp(Math.log(f0 / d0), Math.log(hero.focal / d1), k));
      applyIntrinsics(camera, g * lerp(d0, d1, k), lerp(p0x, hero.ppx, k), lerp(p0y, hero.ppy, k), W, H);
    }
    if (inField && fieldWorld) {
      // The same panel settles onto its mounting table (short, gentle; rigid — nothing scales).
      rig.panelRoot.quaternion.copy(keys.final.q).slerp(fieldWorld.heroRootPose.quaternion, fs.settle);
      rig.panelRoot.position.set(0, 0, 0).lerp(fieldWorld.heroRootPose.position, fs.settle);
    }
    rig.panelRoot.visible = !inIntro || intro.modelVisible;
    rig.panelRoot.updateMatrixWorld(true);

    // ---- 5. Explode + handoff ------------------------------------------------------------------
    const spread = EXPLODE_SPREAD[tier];
    const explode = sm.explode;
    if (rig.assembly && rig.original) {
      const open = explode > 0.0005;
      rig.assembly.root.visible = open;
      // After the aligned crossfade the supplied field module carries on alone.
      rig.original.visible = !open && !(inField && fieldWorld && fs.heroSwap >= 0.999);
      const selectable = sm.controls > 0.35 && explode > 0.5;
      for (const id of LAYER_IDS) {
        const hTarget = selectable && activeLayer === id ? 1 : 0;
        const dTarget = selectable && activeLayer && activeLayer !== id ? 1 : 0;
        s.highlight[id] = Math.abs(s.highlight[id] - hTarget) < 0.002 ? hTarget : damp(s.highlight[id], hTarget, motion ? 9 : 40, dt);
        s.dimmed[id] = Math.abs(s.dimmed[id] - dTarget) < 0.002 ? dTarget : damp(s.dimmed[id], dTarget, motion ? 9 : 40, dt);
        if (s.highlight[id] !== hTarget || s.dimmed[id] !== dTarget) needsFrame = true;
      }
      rig.assembly.update(explode, spread, s.dimmed, s.highlight);
    }

    // ---- 6. Ground shadow from the panel footprint --------------------------------------------
    const [sx, sy] = rig.asset?.meta.size ?? DEFAULT_SIZE;
    const hx = sx / 2, hy = sy / 2;
    s.corners[0].set(-hx, -hy, 0); s.corners[1].set(hx, -hy, 0); s.corners[2].set(hx, hy, 0); s.corners[3].set(-hx, hy, 0);
    for (const c of s.corners) c.applyMatrix4(rig.panelRoot.matrixWorld);
    const shadowStrength = (ready ? 1 : 0) * (inIntro ? intro.shadow : 1) * (1 - fs.studioOut);
    rig.shadow.update(s.corners, shadowStrength);
    rig.shadow.mesh.visible = shadowStrength > 0.001;

    // ---- 6b. Power generation: environment, reveal, hero handoff, shadows ------------------------
    if (fieldWorld) {
      const f = inField ? fs : null;
      const dirty = fieldWorld.update({
        environment: f?.environment ?? 0,
        fog: f?.fog ?? 0,
        t: fieldT,
        heroTable: f?.heroTable ?? 0,
        heroSwap: f?.heroSwap ?? 0,
        camera,
      });
      if (dirty) gl.shadowMap.needsUpdate = true;
    }

    // ---- 6c. Data centers: camera path for this viewport, quiet indicator activity -------------
    const dcWorld = dcReady ? rig.dc : null;
    if (dcWorld && dc.band > 0) {
      dcWorld.setFraming(tier, aspect, overlay.metrics);
      const activity = motion && dc.dcGain >= 1 && s.stageVisible;
      dcWorld.update(dcT, aspect, now / 1000, activity);
      if (activity && !s.activityTimer) {
        // Sparse indicator changes need only a few frames per second, not a continuous loop.
        s.activityTimer = window.setTimeout(() => { s.activityTimer = 0; invalidate(); }, 250);
      }
    }
    render.current.dc = dc;
    // Reduced-motion cross-fades and jump cuts fade the stage out and back in: when either end is
    // the dark lower page, the stage fades through charcoal, never through the ivory page. Under
    // the canvas the backdrop can be opaque at once; over the factory (which it covers) it rises
    // with the fade-out instead of cutting.
    if ((!motion || s.jump !== 'none') && overlay.dcBackdrop) {
      const darkTarget = sampleDc(dcOf(story.target, journeyLayout(tier))).dark;
      let dark = dc.dark;
      if (!motion) dark = Math.max(dark, darkTarget);
      else if (s.jump === 'out') dark = Math.max(dark, darkTarget * (inIntro ? 1 - s.stageFade : 1));
      else if (s.jump === 'in' && s.jumpDark > 0.5) dark = Math.max(dark, 1 - s.stageFade);
      overlay.dcBackdrop.style.opacity = dark.toFixed(3);
      if (dark > 0.5) setScene('dark');
    }

    // ---- 7. Stage media: canvas fade-in over the poster ---------------------------------------
    const fadeIn = ready ? clamp((now - s.readyAt) / 700) : 0;
    if (ready && fadeIn < 1) needsFrame = true;
    const modelGate = inIntro ? intro.modelOpacity : 1;
    const canvasOpacity = (motion ? easeOutCubic(fadeIn) : fadeIn > 0 ? 1 : 0) * s.stageFade * modelGate;
    if (overlay.canvasWrap) overlay.canvasWrap.style.opacity = canvasOpacity.toFixed(3);
    const visual = overlay.factory?.parentElement;
    if (visual) visual.style.opacity = s.stageFade.toFixed(3);
    // Copy follows the same cut, so a jump never pops text over the fading stage.
    if (overlay.content) overlay.content.style.opacity = s.stageFade < 1 ? s.stageFade.toFixed(3) : '';
    // Loading/fallback posters stand in for the model only once the factory has faded away.
    const posterVisible = (status === 'ready' ? 1 - fadeIn : 1) * (1 - intro.factory);
    if (overlay.posterHero) overlay.posterHero.style.opacity = (posterVisible * (1 - sm.moduleText) * (1 - fs.poster)).toFixed(3);
    if (overlay.posterModule) overlay.posterModule.style.opacity = (posterVisible * sm.moduleText).toFixed(3);
    if (overlay.posterField) overlay.posterField.style.opacity = (posterVisible * fs.poster * (1 - dc.band)).toFixed(3);
    if (overlay.posterDc) overlay.posterDc.style.opacity = (posterVisible * dc.band).toFixed(3);

    // ---- 8. HTML overlay (same frame as the canvas) --------------------------------------------

    // Leader line from the selected control to its layer (desktop only).
    const leaderLayer = activeLayer && tier === 'desktop' && rig.assembly ? activeLayer : null;
    const leaderAlpha = leaderLayer ? s.highlight[leaderLayer] * sm.controls : 0;
    if (leaderAlpha > 0.01 && overlay.layoutDirty) refreshOverlayLayout();
    const btn = leaderLayer ? overlay.layerButtonRects[leaderLayer] : undefined;
    const stageRect = overlay.stageRect;
    if (overlay.leader && overlay.leaderDot) {
      if (leaderLayer && btn && stageRect && leaderAlpha > 0.01 && rig.assembly) {
        const a = rig.assembly.anchor(leaderLayer, -1, s.anchor);
        const c = rig.assembly.anchor(leaderLayer, 1, s.anchorAlt);
        rig.panelRoot.localToWorld(a).project(camera);
        rig.panelRoot.localToWorld(c).project(camera);
        const pick = a.x <= c.x ? a : c;
        const ax = (pick.x * 0.5 + 0.5) * size.width;
        const ay = (-pick.y * 0.5 + 0.5) * size.height;
        const x0 = btn.right - stageRect.left + 14;
        const y0 = btn.top - stageRect.top + btn.height / 2;
        const xm = Math.max(x0 + 12, ax - 36);
        overlay.leader.setAttribute('d', `M${x0.toFixed(1)},${y0.toFixed(1)} L${xm.toFixed(1)},${y0.toFixed(1)} L${ax.toFixed(1)},${ay.toFixed(1)}`);
        overlay.leaderDot.setAttribute('cx', ax.toFixed(1));
        overlay.leaderDot.setAttribute('cy', ay.toFixed(1));
        overlay.leader.style.opacity = leaderAlpha.toFixed(3);
        overlay.leaderDot.style.opacity = leaderAlpha.toFixed(3);
      } else {
        overlay.leader.style.opacity = '0';
        overlay.leaderDot.style.opacity = '0';
      }
    }

    // ---- 9. Measured quality: adapt DPR while animating ---------------------------------------
    if (s.prevNeeded && frameMs < 100) {
      if (frameMs > ADAPTIVE.slowFrameMs) { s.slowFrames++; s.fastFrames = 0; }
      else if (frameMs < ADAPTIVE.fastFrameMs) { s.fastFrames++; s.slowFrames = Math.max(0, s.slowFrames - 1); }
      if (s.slowFrames > ADAPTIVE.sampleFrames && s.dpr > quality.dpr[0]) {
        s.dpr = Math.max(quality.dpr[0], s.dpr * ADAPTIVE.stepDown);
        setDpr(s.dpr);
        s.slowFrames = 0;
      } else if (s.fastFrames > ADAPTIVE.sampleFrames * 4 && s.dpr < quality.dpr[1]) {
        s.dpr = Math.min(quality.dpr[1], s.dpr * ADAPTIVE.stepUp);
        setDpr(s.dpr);
        s.fastFrames = 0;
      }
    }
    perf.record(now, frameMs, s.dpr);
    s.prevNeeded = needsFrame;

    if (needsFrame) invalidate();
  });

  // ---- Render (after the frame above): one scene, or the short dark blend between two ----------
  useFrame(() => {
    gl.info.reset();
    blend.render(gl, { scene, camera }, dcReady ? rig.dc : null, render.current.dc);
    // This frame's renderer counters (every pass: shadow, reflection, blend).
    perf.render.calls = gl.info.render.calls;
    perf.render.triangles = gl.info.render.triangles;
    perf.render.mode = blend.mode;
  }, 1);

  return null;
}

/** Frame-time log for validation (read by scripts/capture.mjs via window.__convaltPerf). */
const perfHost = window as unknown as { __convaltPerf?: Record<string, unknown> };
const perf = Object.assign((perfHost.__convaltPerf ??= {}), {
  /** Mean screen-space corner error of the photo → model handoff pose (validation). */
  handoffErrorPx: 0,
  render: { calls: 0, triangles: 0, mode: 'field' as string },
  frames: [] as Array<[number, number, number]>,
  record(t: number, ms: number, dpr: number) {
    if (this.frames.length > 20000) this.frames.length = 0;
    this.frames.push([t, ms, dpr]);
  },
});
