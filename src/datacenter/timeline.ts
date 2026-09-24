import { DC_BAND, DC_RANGES } from '../config/datacenter';
import { clamp, remap, smoothstep } from '../lib/math';

/**
 * Everything the data-center section shows, as a pure function of its progress (0–1). Used by the
 * renderer (scene blend, camera) and the journey driver (copy, dark treatment), so both always
 * agree; reversing the scroll reproduces every state exactly.
 */
export type DcSample = {
  t: number;
  /** Power-generation copy still shown (1 → 0 as this section begins). */
  fieldText: number;
  /** Transition band progress: 0 before it, 1 after it. */
  band: number;
  /** Brightness of the field (1 → 0) and of the server close-up (0 → 1) inside the band. */
  fieldGain: number;
  dcGain: number;
  /** Scene-specific dark treatment of the page, header and chapter bar (0 → 1). */
  dark: number;
  /** Data-center copy and its legibility gradient. */
  text: number;
};

const range = (t: number, r: readonly [number, number]) => remap(t, r[0], r[1]);

export function sampleDc(t: number): DcSample {
  const u = range(t, DC_RANGES.band);
  return {
    t,
    fieldText: 1 - smoothstep(range(t, DC_RANGES.fieldTextOut)),
    band: u,
    fieldGain: 1 - smoothstep(clamp(u / DC_BAND.fieldOut)),
    dcGain: Math.pow(smoothstep(clamp((u - DC_BAND.dcIn) / (1 - DC_BAND.dcIn))), DC_BAND.dcRise),
    dark: smoothstep(range(t, DC_RANGES.nav)),
    text: smoothstep(range(t, DC_RANGES.text)),
  };
}
