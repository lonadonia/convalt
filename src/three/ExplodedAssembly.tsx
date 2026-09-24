import { useLayoutEffect, useMemo } from 'react';
import { useDisposeOnUnmount } from '../hooks/useDisposeOnUnmount';
import { buildAssembly } from './assembly';
import type { PanelAsset } from './panelAsset';
import type { SceneRig } from './rig';

/** Explanatory assembly (hidden until the layers start to separate). */
export function ExplodedAssembly({ asset, rig }: { asset: PanelAsset; rig: SceneRig }) {
  const assembly = useMemo(() => buildAssembly(asset), [asset]);

  useLayoutEffect(() => {
    assembly.root.visible = false;
    rig.assembly = assembly;
    return () => {
      if (rig.assembly === assembly) rig.assembly = null;
    };
  }, [assembly, rig]);
  useDisposeOnUnmount(assembly.dispose);

  return <primitive object={assembly.root} />;
}
