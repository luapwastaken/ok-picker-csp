// The panel's side of the Android bridge (contract in picker/README.md).
//   JS -> Android: window.AndroidBridge (a @JavascriptInterface object: string / number args only)
//   Android -> JS: window.cspPicker (installed by main.tsx)
// With no window.AndroidBridge (a desktop browser) a mock logs every call to the console and to
// window.__bridgeCalls, so a test can read what the panel sent.

export type Phase = 'start' | 'move' | 'end';
export type Edge = 'left' | 'right' | 'top' | 'bottom' | 'bottomleft' | 'bottomright';
export type Display = 'popup' | 'tab';

export type AndroidBridge = {
  setColor(r: number, g: number, b: number): void;
  copy(text: string): void;
  frame(action: string): void;
  dragTitle(phase: string, x: number, y: number): void;
  resize(edge: string, phase: string, x: number, y: number): void;
  pair(): void;
  sendReport(): void;
  setDisplay(mode: string): void;
  eyedropper?(on: boolean): void;
  share?(name: string, mime: string, base64: string): void;
  save?(name: string, mime: string, base64: string): void;
  ready?(): void;
};

export type BridgeCall = { fn: string; args: unknown[] };
declare global {
  interface Window {
    AndroidBridge?: AndroidBridge;
    __bridgeCalls?: BridgeCall[];
  }
}

const native = window.AndroidBridge;
export const isMock = !native;

function mock(): AndroidBridge {
  const calls: BridgeCall[] = (window.__bridgeCalls = []);
  const rec = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args });
    if (fn !== 'setColor' && fn !== 'dragTitle' && fn !== 'resize') console.log('[mock bridge]', fn, ...args);
  };
  return Object.fromEntries(
    ['setColor', 'copy', 'frame', 'dragTitle', 'resize', 'pair', 'sendReport', 'setDisplay', 'eyedropper', 'share', 'save', 'ready'].map((k) => [k, rec(k)]),
  ) as AndroidBridge;
}

const b = native ?? mock();
// the interface object's methods are native: call them on the object, and survive a missing one on an older app
const call = (fn: keyof AndroidBridge, ...args: unknown[]) => {
  try {
    if (typeof b[fn] === 'function') (b as any)[fn](...args); // direct call: a Java-bound method is not guaranteed to take .call
  } catch (e) {
    console.warn('bridge', fn, e);
  }
};

export const bridge = {
  /** sRGB bytes, 0..255. Called continuously while dragging; native keeps the latest only. */
  setColor: (r: number, g: number, b: number) => call('setColor', r, g, b),
  copy: (text: string) => call('copy', text),
  /** 'minimize' | 'restore' | 'close' | 'look:dark' | 'look:light' | 'density:regular' | 'density:large' */
  frame: (action: string) => call('frame', action),
  /** window move by the title bar: x, y are the pointer's clientX/clientY in CSS px at the event */
  dragTitle: (phase: Phase, x: number, y: number) => call('dragTitle', phase, x, y),
  /** window resize by an edge: same coordinates */
  resize: (edge: Edge, phase: Phase, x: number, y: number) => call('resize', edge, phase, x, y),
  pair: () => call('pair'),
  sendReport: () => call('sendReport'),
  setDisplay: (mode: Display) => call('setDisplay', mode),
  /** true: hold Alt in CSP so its brush becomes the eyedropper (the user taps the canvas); false: release it */
  eyedropper: (on: boolean) => call('eyedropper', on),
  /** a file through Android's share sheet (a colour set for CSP): its bytes as base64 */
  share: (name: string, mime: string, base64: string) => call('share', name, mime, base64),
  /** the same through Android's Save dialog, so the file lands on the tablet */
  save: (name: string, mime: string, base64: string) => call('save', name, mime, base64),
  ready: () => call('ready'),
};
