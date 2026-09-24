import type * as THREE from 'three';
import type { Assembly } from './assembly';
import type { DataCenterWorld } from './datacenter/DataCenterWorld';
import type { FieldLights, FieldWorld } from './field/FieldWorld';
import type { PanelAsset } from './panelAsset';
import type { GroundShadow } from './studio';

/** Scene objects the controller animates. Created once per canvas; filled as assets arrive. */
export type SceneRig = {
  /** Pose root: the original panel, the explanatory assembly and the field hero are children. */
  panelRoot: THREE.Group;
  original: THREE.Mesh | null;
  assembly: Assembly | null;
  asset: PanelAsset | null;
  shadow: GroundShadow;
  /** Studio and outdoor lights (outdoor ones start at zero intensity). */
  lights: FieldLights | null;
  /** The studio reflection map (restored whenever the field scene is not visible). */
  studioEnv: THREE.Texture | null;
  /** Power-generation scene, once its assets are loaded and compiled. */
  field: FieldWorld | null;
  /** Data-center scene (its own scene and camera), once loaded and compiled. */
  dc: DataCenterWorld | null;
};
