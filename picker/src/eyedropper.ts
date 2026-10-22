// WebView has no EyeDropper API; Design Tools' Picker reads globalThis.EyeDropper at module load, so this is imported first.
// open() asks native to hold Alt in CSP (its brush becomes the eyedropper), then resolves with the next CSP colour that differs
// from the one at open. It only observes onCspColor (main.tsx calls observe()); the echo rule is untouched.
import { bridge } from './bridge.ts';

type Rgb = { r: number; g: number; b: number };
const TIMEOUT = 15000;
let last: Rgb | null = null;
let cur: { base: Rgb | null; resolve(v: { sRGBHex: string }): void; reject(e: unknown): void; timer: ReturnType<typeof setTimeout> } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
const hex = (c: Rgb) => '#' + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('');

function settle() {
  if (!cur) return null;
  const c = cur;
  clearTimeout(c.timer);
  cur = null;
  bridge.eyedropper(false);
  notify();
  return c;
}
const abort = () => new DOMException('The eyedropper was cancelled', 'AbortError');

export const eyedropperArmed = () => !!cur;
export const subscribeEyedropper = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

/** every non-transparent colour CSP reports */
export function observeCspColor(c: Rgb) {
  const base = cur?.base;
  last = { r: c.r, g: c.g, b: c.b };
  if (cur && (!base || base.r !== c.r || base.g !== c.g || base.b !== c.b)) settle()!.resolve({ sRGBHex: hex(c) });
}

class PolyEyeDropper {
  open(): Promise<{ sRGBHex: string }> {
    settle()?.reject(abort()); // a second open() cancels the first
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle()?.reject(abort()), TIMEOUT);
      cur = { base: last, resolve, reject, timer };
      bridge.eyedropper(true);
      notify();
    });
  }
}
// ?eyedropper=poly forces it in a desktop browser (which has its own EyeDropper), for the checks
if (!(globalThis as { EyeDropper?: unknown }).EyeDropper || /[?&]eyedropper=poly/.test(location.search)) (globalThis as { EyeDropper?: unknown }).EyeDropper = PolyEyeDropper;
