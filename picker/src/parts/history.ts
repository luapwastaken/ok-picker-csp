// The colours that settled, newest first: Recent (C1) shows them, Previous (C2) is the one before the current.
// A colour settles once nothing has changed it for SETTLE_MS, whoever changed it (a drag here, a swatch, CSP's own
// wheel or eyedropper), so a drag across the square adds one colour, not every step. Kept in localStorage.
import { useSyncExternalStore } from 'react';

const KEY = 'cspPicker.history';
const MAX = 13; // the current colour plus the 12 Recent shows
export const SETTLE_MS = 700;

let list: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((h) => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h)).slice(0, MAX) : [];
  } catch {
    return [];
  }
})();
const subs = new Set<() => void>();
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

/** `hex` is the colour now: it goes to the front (once; an older copy of it moves up) */
export function settle(hex: string) {
  const h = hex.toLowerCase();
  if (list[0] === h) return;
  list = [h, ...list.filter((x) => x !== h)].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  subs.forEach((f) => f());
}

/** newest first; [0] is the current colour once it has settled */
export const useHistory = (): string[] => useSyncExternalStore(subscribe, () => list);
