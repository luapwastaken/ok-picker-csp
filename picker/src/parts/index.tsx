// Every part the panel can show, in the order Panel parts lists them by default (store.ts PART_IDS).
import type { ComponentType } from 'react';
import { AreaPart, HexPart, HoldsPart, NumbersPart, SlidersPart, StylesPart } from './core.tsx';
import { HarmoniesPart, RecentPart, TintsPart } from './swatches.tsx';
import { GradientPart } from './gradient.tsx';
import { KeptPart } from './kept.tsx';
import type { PartId } from './store.ts';
import type { PartProps } from './types.ts';

export type PartDef = { label: string; hint?: string; Part: ComponentType<PartProps> };

export const PARTS: Record<PartId, PartDef> = {
  styles: { label: 'Style switch', Part: StylesPart },
  area: { label: 'Colour area', hint: 'Square, wheel, sliders or OKLCH plane', Part: AreaPart },
  numbers: { label: 'Number fields', hint: 'Under the square and the wheel', Part: NumbersPart },
  sliders: { label: 'Sliders', Part: SlidersPart },
  holds: { label: 'Hold value and hue', Part: HoldsPart },
  hex: { label: 'Hex, eyedropper, copy', Part: HexPart },
  recent: { label: 'Recent colours', Part: RecentPart },
  tints: { label: 'Tints', Part: TintsPart },
  harmonies: { label: 'Harmonies', Part: HarmoniesPart },
  gradient: { label: 'Gradient and ramp', Part: GradientPart },
  kept: { label: 'Kept colours', hint: 'Gradients and ramps you kept, and export', Part: KeptPart },
};
