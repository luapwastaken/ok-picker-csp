import type { Oklch } from 'dt:shared/color/index.ts';
import type { usePickerColour } from 'dt:renderer/ui/pickerModels.ts';
import type { Match } from 'dt:renderer/ui/PickerHold.tsx';
import type { LayoutId } from './store.ts';

export type Rgb = { r: number; g: number; b: number };

/** What every part gets. A part only draws; the panel owns the colour and sends it to CSP. */
export type PartProps = {
  /** the picker's colour */
  value: Oklch;
  /** Design Tools' picker model over `value`: areas, channels and the holds (Hold value, Hold hue) */
  colour: ReturnType<typeof usePickerColour>;
  /** a step of a drag or a typed number: shown and sent to CSP at once */
  onChange(v: Oklch): void;
  /** a colour set outright (a swatch tapped): re-captures the holds' targets, then changes */
  set(v: Oklch): void;
  /** gesture hooks for Design Tools controls (`{...g}`): onBegin captures the holds */
  g: { onBegin(): void };
  /** CSP's main and sub colours as it last reported them (sub is null until it has) */
  main: Rgb;
  sub: Rgb | null;
  match?: Match[];
  layout: LayoutId;
};
