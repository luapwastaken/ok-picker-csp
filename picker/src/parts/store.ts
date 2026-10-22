// What the panel shows: two layouts (Full and Compact), each a list of parts in order with some switched on, plus the
// slider sets and the grey check. Kept in the WebView's localStorage.
import { useSyncExternalStore } from 'react';
import type { PickerModel } from 'dt:shared/types.ts';

export const PART_IDS = ['styles', 'area', 'numbers', 'sliders', 'holds', 'hex', 'recent', 'tints', 'harmonies', 'gradient', 'kept'] as const;
export type PartId = (typeof PART_IDS)[number];
export type LayoutId = 'full' | 'compact';
export type Layout = { order: PartId[]; on: PartId[] };
export type Preset = 'full' | 'compact' | 'minimal';

/** the presets equal 1.0's two panels, so nothing changes for someone who never opens Panel parts */
export const PRESETS: Record<Preset, PartId[]> = {
  full: ['styles', 'area', 'numbers', 'holds', 'hex'],
  compact: ['area', 'holds', 'hex'],
  minimal: ['area'],
};

type State = { full: Layout; compact: Layout; sliderSets: PickerModel[]; grey: boolean };
const KEY = 'cspPicker.parts';
const MODELS: PickerModel[] = ['hsb', 'rgb', 'hsl', 'oklch', 'cmyk'];

const fresh = (p: Preset): Layout => ({ order: [...PART_IDS], on: [...PRESETS[p]] });
const valid = (ids: unknown): PartId[] => (Array.isArray(ids) ? ids.filter((x): x is PartId => (PART_IDS as readonly string[]).includes(x)) : []);
function layout(saved: Partial<Layout> | undefined, p: Preset): Layout {
  if (!saved) return fresh(p);
  const order = [...new Set(valid(saved.order))];
  for (const id of PART_IDS) if (!order.includes(id)) order.push(id); // a part added in a later version goes last
  return { order, on: valid(saved.on) };
}
function load(): State {
  let s: Partial<State> = {};
  try { s = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch {}
  const sets = Array.isArray(s.sliderSets) ? s.sliderSets.filter((m) => MODELS.includes(m)) : [];
  return { full: layout(s.full, 'full'), compact: layout(s.compact, 'compact'), sliderSets: sets.length ? sets : ['oklch'], grey: s.grey === true };
}

let state = load();
const subs = new Set<() => void>();
function set(next: State) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const useParts = (): State => useSyncExternalStore(subscribe, () => state);
export const partsState = () => state;

export const togglePart = (l: LayoutId, id: PartId) => {
  const on = state[l].on.includes(id) ? state[l].on.filter((x) => x !== id) : [...state[l].on, id];
  set({ ...state, [l]: { ...state[l], on } });
};
export const movePart = (l: LayoutId, id: PartId, to: number) => {
  const order = state[l].order.filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
  set({ ...state, [l]: { ...state[l], order } });
};
export const applyPreset = (l: LayoutId, p: Preset) => set({ ...state, [l]: { order: state[l].order, on: [...PRESETS[p]] } });
export const toggleSliderSet = (m: PickerModel) => {
  const has = state.sliderSets.includes(m);
  if (has && state.sliderSets.length === 1) return; // the part needs one set; switch the part off instead
  set({ ...state, sliderSets: has ? state.sliderSets.filter((x) => x !== m) : MODELS.filter((x) => x === m || state.sliderSets.includes(x)) });
};
export const toggleGrey = () => set({ ...state, grey: !state.grey });
/** the parts a layout shows, in order */
export const shown = (l: Layout): PartId[] => l.order.filter((id) => l.on.includes(id));
