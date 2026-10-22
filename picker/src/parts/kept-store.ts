// Small localStorage-backed stores (useSyncExternalStore, as store.ts), and the kept rows.
import { useSyncExternalStore } from 'react';
import type { Oklch } from 'dt:shared/color/index.ts';

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
export const removeKept = (id: string) => store.set({ rows: store.get().rows.filter((r) => r.id !== id) });
