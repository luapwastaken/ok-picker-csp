// Small localStorage-backed stores (useSyncExternalStore, as store.ts), and the kept rows.
import { useSyncExternalStore } from 'react';
import type { Oklch } from 'dt:shared/color/index.ts';
import { writeAco } from 'dt:shared/palette/writers.ts';
import type { Swatch } from 'dt:shared/types.ts';
import { bridge } from '../bridge.ts';

export function makeStore<T>(key: string, fresh: T) {
  let state: T = fresh;
  try { state = { ...fresh, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch {}
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
      subs.forEach((f) => f());
    },
    use: () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => state),
  };
}

export type KeptRow = { id: string; name: string; kind: 'Gradient' | 'Ramp'; colours: Oklch[] };
const store = makeStore<{ rows: KeptRow[]; counts: Record<string, number> }>('cspPicker.kept', { rows: [], counts: {} });

export const useKept = () => store.use().rows;
/** numbers keep counting after a removal, so a name is never reused */
export function keep(kind: KeptRow['kind'], colours: Oklch[]) {
  const n = (store.get().counts[kind] ?? 0) + 1;
  store.set({ counts: { ...store.get().counts, [kind]: n }, rows: [...store.get().rows, { id: `${kind}${n}`, name: `${kind} ${n}`, kind, colours }] });
}
/** the kept rows (or, with none kept, [fallback] as one row) as an .aco colour set: saved on the tablet or shared */
export function exportColourSet(how: 'save' | 'share', fallback?: { name: string; colours: Oklch[] }) {
  const rows = store.get().rows.length ? store.get().rows : fallback ? [{ id: 'now', name: fallback.name, colours: fallback.colours }] : [];
  if (!rows.length) return;
  const swatches: Swatch[] = rows.flatMap((r) => r.colours.map((oklch, i): Swatch => ({ id: `${r.id}-${i}`, name: `${r.name} · ${i + 1}`, role: null, oklch, type: 'process' })));
  const bytes = writeAco(swatches);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  bridge[how]('OK Picker colours.aco', 'application/octet-stream', btoa(s));
}

export const removeKept = (id: string) => store.set({ rows: store.get().rows.filter((r) => r.id !== id) });
