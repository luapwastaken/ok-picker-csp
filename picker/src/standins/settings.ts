// Stand-in for shell/core/settings.ts: setPicker with no main process to save through.
import { getState, setState } from './store.ts';

export type PickerPrefs = Record<string, unknown>;
export async function setPicker(patch: PickerPrefs): Promise<void> {
  const cur = getState().settings;
  if (cur) setState({ settings: { ...cur, ...patch } as typeof cur });
}
