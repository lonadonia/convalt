import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createStudioEnvironment } from './studio';
import type { SceneRig } from './rig';

/**
 * Studio reflections (PMREM, generated once and again after a context restore), lights and the
 * ground shadow. The outdoor sun (shadow-casting) and sky light exist from the start at zero
 * intensity, and the scene carries a zero-density haze, so the power-generation scene can fade them
 * in without recompiling any material mid-scroll.
 */
export function SceneEnvironment({ rig }: { rig: SceneRig }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    let env = createStudioEnvironment(gl);
    scene.environment = env;
    scene.environmentIntensity = 1;
    rig.studioEnv = env;
    invalidate();
    const canvas = gl.domElement;
    const onRestored = () => {
      env.dispose();
      env = createStudioEnvironment(gl);
      scene.environment = env;
      rig.studioEnv = env;
      invalidate();
    };
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextrestored', onRestored);
      scene.environment = null;
      rig.studioEnv = null;
      env.dispose();
    };
  }, [gl, scene, invalidate, rig]);

  useEffect(() => {
    // Soft key from upper left/front: crisp frame highlights; reflections come from the studio map.
    const studioKey = new THREE.DirectionalLight('#fffaf2', 1.15);
    studioKey.position.set(-3.2, 4.2, 3.4);
    const studioFill = new THREE.HemisphereLight('#f4f3ee', '#6f7a78', 0.35);
    const sun = new THREE.DirectionalLight('#fff3e2', 0);
    sun.castShadow = true;
    const sky = new THREE.HemisphereLight('#dfe8ef', '#6d7a58', 0);
    scene.add(studioKey, studioFill, sun, sun.target, sky);
    scene.fog = new THREE.FogExp2(0xf5f4ee, 0);
    rig.lights = { studioKey, studioFill, sun, sky };
    return () => {
      scene.remove(studioKey, studioFill, sun, sun.target, sky);
      sun.shadow.dispose();
      scene.fog = null;
      rig.lights = null;
    };
  }, [scene, rig]);

  useEffect(() => {
    scene.add(rig.shadow.mesh);
    return () => {
      scene.remove(rig.shadow.mesh);
    };
  }, [scene, rig]);

  return null;
}
