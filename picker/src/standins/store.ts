// Stand-in for Design Tools' shell/core/store.ts: the picker only reads `settings` (style, model, plane, locks).
// Backed by localStorage; defaults suit CSP (a wheel, RGB numbers like CSP's Color panel).
import { useSyncExternalStore } from 'react';

export type PanelSettings = { pickerStyle: string; pickerModel: string; pickerPlane: string; valueLock: boolean; hueLock: boolean; greyscale?: boolean };
export type ShellState = { settings: PanelSettings | null };

const KEY = 'cspPicker.settings';
const DEFAULTS: PanelSettings = { pickerStyle: 'wheel', pickerModel: 'rgb', pickerPlane: 'lc', valueLock: false, hueLock: false };

function load(): PanelSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let state: ShellState = { settings: load() };
const listeners = new Set<() => void>();

export const getState = (): ShellState => state;
export function setState(patch: Partial<ShellState>): void {
  state = { ...state, ...patch };
  try {
    if (state.settings) localStorage.setItem(KEY, JSON.stringify(state.settings));
  } catch {}
  listeners.forEach((f) => f());
}
export const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
export const useShell = <T,>(select: (s: ShellState) => T): T => useSyncExternalStore(subscribe, () => select(state));
