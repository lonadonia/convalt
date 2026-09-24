import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { PanelAsset } from './panelAsset';
import type { SceneRig } from './rig';

/** The supplied solar panel, normalized (metres, centred, front face = local +Z). */
export function OriginalPanel({ asset, rig }: { asset: PanelAsset; rig: SceneRig }) {
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(asset.geometry, asset.material);
    m.name = 'SuppliedSolarPanel';
    return m;
  }, [asset]);

  useLayoutEffect(() => {
    rig.original = mesh;
    return () => {
      if (rig.original === mesh) rig.original = null;
    };
  }, [mesh, rig]);

  return <primitive object={mesh} />;
}
