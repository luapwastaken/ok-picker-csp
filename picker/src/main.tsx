import './eyedropper.ts'; // first: Picker.tsx reads globalThis.EyeDropper when it loads
import { StrictMode, useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowsInSimple, ArrowsOutSimple, List, Minus, Palette, X } from '@phosphor-icons/react';
import { hexToOklch, rgb255, toHex, type Oklch } from 'dt:shared/color/index.ts';
import { fromRgb255 } from 'dt:shared/color/picker.ts';
import { greyMatrix } from 'dt:shared/color/value.ts';
import { COPY_FORMATS } from 'dt:shared/color/format.ts';
import { usePickerColour } from 'dt:renderer/ui/pickerModels.ts';
import { PICKER_STYLE_OPTIONS, setPickerModel, setPickerStyle, toggleValueLock, usePickerModel, usePickerStyle } from 'dt:renderer/ui/PickerStyles.tsx';
import { useCopyFormat, setCopyFormat } from 'dt:renderer/ui/CopyAs.tsx';
import { Tooltip } from 'dt:renderer/ui/Tooltip.tsx';
import { MenuHost } from 'dt:renderer/ui/Menu.tsx';
import { ToastHost } from 'dt:renderer/ui/Toast.tsx';
import { menu, type MenuItem } from 'dt:renderer/ui/menu.ts';
import s from 'dt:renderer/ui/Picker.module.css';
import { Boxes, css } from './boxes.tsx';
import { PARTS } from './parts/index.tsx';
import { PartsSheet } from './parts/sheet.tsx';
import { settle, SETTLE_MS } from './parts/history.ts';
import { shown, toggleGrey, useParts, type LayoutId } from './parts/store.ts';
import type { PartProps } from './parts/types.ts';
import { eyedropperArmed, observeCspColor, subscribeEyedropper } from './eyedropper.ts';
import { bridge, isMock, type Display, type Edge, type Phase } from './bridge.ts';
import 'dt:renderer/styles/base.css';
import './styles/csp-base.css';
import './styles/csp-dark.css';
import './styles/csp-light.css';
import './panel.css';

type Theme = 'dark' | 'light';
type Density = 'small' | 'regular' | 'large';
type Dock = 'left' | 'right' | 'float';
type Status = { state: 'connected' | 'connecting' | 'disconnected' | 'unpaired'; detail?: string };
type Csp = { index: number; transparent: boolean; canSet: boolean };
type CspColor = { r: number; g: number; b: number; index?: number; transparent?: boolean; canSet?: boolean };

/** how long a sent colour still counts as ours when CSP reports it back */
const ECHO_MS = 1500;
const q = new URLSearchParams(location.search);
const stored = (k: string) => { try { return localStorage.getItem('cspPicker.' + k); } catch { return null; } };
const keep = (k: string, v: string) => { try { localStorage.setItem('cspPicker.' + k, v); } catch {} };
const pick = <T extends string>(v: string | null, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

const STATUS_TEXT: Record<Status['state'], string> = { connected: 'Connected to CSP', connecting: 'Connecting…', disconnected: 'Disconnected from CSP', unpaired: 'Not paired with CSP' };
const isText = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input, textarea, [contenteditable="true"]');

function App() {
  const [value, setValue] = useState<Oklch>(() => hexToOklch('#000000'));
  const [csp, setCsp] = useState<Csp>({ index: 0, transparent: false, canSet: true });
  const [main, setMain] = useState({ r: 0, g: 0, b: 0 });
  const [sub, setSub] = useState<{ r: number; g: number; b: number } | null>(null);
  const [status, setStatus] = useState<Status>({ state: (q.get('status') as Status['state']) ?? 'connected' });
  const [theme, setTheme] = useState<Theme>(pick(q.get('theme') ?? stored('theme'), ['dark', 'light'], 'dark'));
  const [density, setDensity] = useState<Density>(pick(q.get('density') ?? stored('density'), ['small', 'regular', 'large'], 'regular'));
  const [display, setDisplay] = useState<Display>(pick(q.get('display') ?? stored('display'), ['popup', 'tab'], 'popup'));
  const [dock, setDock] = useState<Dock>(pick(q.get('dock'), ['left', 'right', 'float'], 'left'));
  const [compact, setCompact] = useState(() => (q.get('compact') ?? stored('compact')) === '1');
  const [minimized, setMinimized] = useState(q.get('minimized') === '1');
  const [sheet, setSheet] = useState(q.get('sheet') === '1');
  const parts = useParts();
  const layout: LayoutId = compact ? 'compact' : 'full';

  const lastSent = useRef<[number, number, number] | null>(null);
  const live = useRef({ value, csp });
  live.current = { value, csp };
  const canSet = useRef(true);
  /** a colour has come from CSP or from a hand here: before that, the black placeholder is nobody's colour */
  const known = useRef(false);

  // theme, density and display go on the root: the token files key off them
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.dataset.density = density; }, [density]);

  // the last colour CSP reported, so a repeat (its busy flag flips at every stroke) changes nothing on screen
  const lastIn = useRef('');
  // Echo rule, widened: while the panel is dragged, CSP is polled every 30 ms and can report any colour sent in the
  // last moments, not only the newest. Each one counts as ours, or the picker jumps back a step (the jittery line).
  const recent = useRef(new Map<string, number>());
  const [waiting, setWaiting] = useState(false);
  const send = useCallback((v: Oklch) => {
    // sent even while CSP is busy: native holds the latest colour until CSP frees up (docs/PROTOCOL.md)
    if (!canSet.current) setWaiting(true);
    const rgb = rgb255(v);
    const l = lastSent.current;
    if (l && l[0] === rgb[0] && l[1] === rgb[1] && l[2] === rgb[2]) return;
    lastSent.current = rgb;
    lastIn.current = '';
    recent.current.set(rgb.join(','), performance.now());
    bridge.setColor(rgb[0], rgb[1], rgb[2]);
  }, []);

  const onChange = useCallback((v: Oklch) => { known.current = true; setValue(v); send(v); }, [send]);
  const colour = usePickerColour(value, onChange);

  // Recent and Previous: the colour settles once nothing has changed it for a moment, whoever changed it
  useEffect(() => {
    if (!known.current) return;
    const hex = toHex(value);
    const t = setTimeout(() => settle(hex), SETTLE_MS);
    return () => clearTimeout(t);
  }, [value]);

  // Android -> JS
  useEffect(() => {
    window.cspPicker = {
      onCspColor(c: CspColor) {
        const next: Csp = { index: c.index ?? 0, transparent: !!c.transparent, canSet: c.canSet !== false };
        const prev = live.current.csp;
        // canSet flips at every stroke and nothing on screen shows it, so it stays out of state: a stroke re-renders nothing
        const wasFree = canSet.current;
        canSet.current = next.canSet;
        if (next.canSet && !wasFree) setWaiting(false); // CSP is free: native has sent the held colour
        if (prev.index !== next.index || prev.transparent !== next.transparent) {
          setCsp(next);
          live.current.csp = next;
        }
        if (next.transparent) return;
        observeCspColor(c);
        const key = `${c.r},${c.g},${c.b}`;
        if (key === lastIn.current) return; // same colour again: nothing to redraw
        lastIn.current = key;
        const now = performance.now();
        for (const [k, t] of recent.current) if (now - t > ECHO_MS) recent.current.delete(k);
        if (recent.current.has(key)) { // an echo of something we sent: keep our own OKLCH
          const l = lastSent.current;
          if (l && key === l.join(',')) setMain({ r: c.r, g: c.g, b: c.b }); // the swatch shows only the newest
          return;
        }
        setMain({ r: c.r, g: c.g, b: c.b });
        lastSent.current = null; // a colour from CSP itself: the next send is never a repeat of an older one
        recent.current.clear();
        known.current = true;
        setValue((old) => fromRgb255([c.r, c.g, c.b], old[2]));
      },
      // sent with every state change (each stroke flips CSP's busy flag): the same sub colour must not re-render
      onSubColor: (c) => setSub((old) => (old && old.r === c.r && old.g === c.g && old.b === c.b ? old : { r: c.r, g: c.g, b: c.b })),
      onStatus: (st) => setStatus(st),
      onTheme: (t) => setTheme(t === 'light' ? 'light' : 'dark'),
      // optional extras the native side may call: where the panel sits and whether it is rolled up
      onLayout: (l) => {
        if (l.dock) setDock(l.dock);
        if (l.display) setDisplay(l.display);
        if (typeof l.minimized === 'boolean') setMinimized(l.minimized);
      },
    };
    bridge.ready();
  }, []);
  // the window switches size on this: once at startup (after ready) and on every change
  useEffect(() => { bridge.frame(compact ? 'compact:on' : 'compact:off'); }, [compact]);
  // Compact: the window's height follows its contents (or the Panel parts sheet while it is open)
  useEffect(() => {
    if (!compact || minimized) return;
    let sent = 0;
    const fit = () => {
      const t = (sel: string) => document.querySelector(sel) as HTMLElement | null;
      const title = t('.title'), body = t('.body'), list = t('.parts'), foot = t('.status'), sh = t('.sheet');
      if (!title || !body || !list || !foot) return;
      const cs = getComputedStyle(body);
      const content = list.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + foot.offsetHeight;
      const h = Math.ceil(title.offsetHeight + Math.max(content, sh ? sh.scrollHeight : 0));
      if (h !== sent) { sent = h; bridge.frame(`fit:${h}`); }
    };
    const ro = new ResizeObserver(fit);
    for (const sel of ['.parts', '.status', '.sheet']) { const e = document.querySelector(sel); if (e) ro.observe(e); }
    fit();
    return () => ro.disconnect();
  }, [compact, minimized, sheet, parts]);

  const chooseLook = (t: Theme) => { setTheme(t); keep('theme', t); bridge.frame('look:' + t); };
  const chooseDensity = (d: Density) => { setDensity(d); keep('density', d); bridge.frame('density:' + d); };
  const chooseDisplay = (d: Display) => { setDisplay(d); keep('display', d); bridge.setDisplay(d); };
  const chooseCompact = (c: boolean) => { setCompact(c); keep('compact', c ? '1' : '0'); };
  const setMin = (m: boolean) => { setMinimized(m); bridge.frame(m ? 'minimize' : 'restore'); };
  const openSheet = () => { if (minimized) setMin(false); setSheet(true); };

  const style = usePickerStyle();
  const model = usePickerModel();
  const copyAs = useCopyFormat();
  const openMenu = (e: PointerEvent<HTMLButtonElement>) => {
    const items: MenuItem[] = [
      { label: 'Style', submenu: PICKER_STYLE_OPTIONS.map((o) => ({ label: o.label, checked: o.value === style, onSelect: () => setPickerStyle(o.value) })) },
      { label: 'Model', submenu: (['hsb', 'rgb', 'hsl', 'cmyk', 'oklch'] as const).map((m) => ({ label: m === 'hsb' ? 'HSB' : m === 'hsl' ? 'HSL' : m === 'cmyk' ? '≈CMYK' : m === 'oklch' ? 'OKLCH' : 'RGB', checked: m === model, onSelect: () => setPickerModel(m) })) },
      { label: 'Copy as', submenu: COPY_FORMATS.map((f) => ({ label: f.label, checked: f.id === copyAs, onSelect: () => setCopyFormat(f.id) })) },
      'separator',
      { label: 'Panel parts…', onSelect: openSheet },
      { label: 'Display', submenu: [{ label: 'Pop-up', checked: display === 'popup', onSelect: () => chooseDisplay('popup') }, { label: 'Keep open', checked: display === 'tab', onSelect: () => chooseDisplay('tab') }, 'separator', { label: 'Compact', checked: compact, onSelect: () => chooseCompact(!compact) }] },
      {
        label: 'Look',
        submenu: [
          { header: 'Colour theme' },
          { label: 'Dark', checked: theme === 'dark', onSelect: () => chooseLook('dark') },
          { label: 'Light', checked: theme === 'light', onSelect: () => chooseLook('light') },
          { header: 'Size' },
          { label: 'Small', checked: density === 'small', onSelect: () => chooseDensity('small') },
          { label: 'Regular', checked: density === 'regular', onSelect: () => chooseDensity('regular') },
          { label: 'Large', checked: density === 'large', onSelect: () => chooseDensity('large') },
        ],
      },
      'separator',
      { label: 'Pair with CSP…', onSelect: () => bridge.pair() },
      { label: 'Send report', onSelect: () => bridge.sendReport() },
    ];
    menu.open(e.currentTarget.getBoundingClientRect(), items, { owner: e.currentTarget, width: 220 });
  };

  // drag the window by the title bar; the native side moves it
  const drag = useRef(false);
  const titleDown = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    bridge.dragTitle('start', e.clientX, e.clientY);
  };
  const titleMove = (e: PointerEvent<HTMLElement>) => drag.current && bridge.dragTitle('move', e.clientX, e.clientY);
  const titleUp = (e: PointerEvent<HTMLElement>) => { if (drag.current) { drag.current = false; bridge.dragTitle('end', e.clientX, e.clientY); } };

  // a docked panel resizes from the canvas side and the bottom (it re-anchors to the square); a floating one from
  // every side, the top too. Compact's height follows its contents, so it only gets the width.
  const all: Edge[] = dock === 'left' ? ['right', 'bottom', 'bottomright'] : dock === 'right' ? ['left', 'bottom', 'bottomleft'] : ['top', 'left', 'right', 'bottom', 'bottomleft', 'bottomright'];
  const edges = compact ? all.filter((e) => e !== 'top' && e !== 'bottom') : all;
  const armed = useSyncExternalStore(subscribeEyedropper, eyedropperArmed);
  // CSP is busy for every stroke (however long) and under dialogs, and the two look the same. Busy shows only when it
  // matters: a colour picked here is waiting for CSP. It never dims or resizes anything.
  const busy = waiting && status.state === 'connected';
  const statusText = armed ? 'Tap the canvas to pick' : busy ? 'Sent when CSP is free' : status.detail && status.state !== 'connected' ? `${STATUS_TEXT[status.state]}: ${status.detail}` : STATUS_TEXT[status.state];
  const boxState = busy ? 'busy' : status.state === 'connecting' ? 'connecting' : status.state === 'connected' ? 'ok' : 'bad';
  const matchList = sub ? [{ name: 'Sub colour', oklch: hexToOklch(css(sub)) }] : undefined;

  const props: PartProps = {
    value, colour, onChange, main, sub, layout, match: matchList,
    set: (v) => { colour.begin(); onChange(v); },
    g: { onBegin: () => colour.begin() },
  };
  // V toggles Hold value from a hardware keyboard, as in Design Tools' picker
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.code !== 'KeyV' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented || isText(e.target)) return;
    e.preventDefault();
    toggleValueLock();
  };

  return (
    <div className="frame" data-display={display} data-dock={dock} data-min={minimized || undefined} data-compact={compact || undefined}>
      <header className="title" onPointerDown={titleDown} onPointerMove={titleMove} onPointerUp={titleUp} onPointerCancel={titleUp}>
        <button type="button" className="tb" aria-label="Palette menu" onClick={(e) => (e.preventDefault(), openMenu(e as never))}><List size={18} /></button>
        <div className="tab"><Palette size={18} weight="fill" /><span>OK Picker</span></div>
        <span className="grow" />
        <Tooltip content="Grey check: the panel in grey, to judge values">
          <button type="button" className="tb tg" aria-label="Grey check" aria-pressed={parts.grey} onClick={toggleGrey}>G</button>
        </Tooltip>
        <Tooltip content={compact ? 'Full panel' : 'Compact panel'}>
          <button type="button" className="tb" aria-label={compact ? 'Full panel' : 'Compact panel'} onClick={() => chooseCompact(!compact)}>
            {compact ? <ArrowsOutSimple size={18} /> : <ArrowsInSimple size={18} />}
          </button>
        </Tooltip>
        <button type="button" className="tb" aria-label={minimized ? 'Restore' : 'Minimize'} onClick={() => setMin(!minimized)}><Minus size={18} /></button>
        <button type="button" className="tb" aria-label="Close" onClick={() => bridge.frame('close')}><X size={18} /></button>
      </header>
      {!minimized && (
        <>
          <main className="body" data-grey={parts.grey || undefined}>
            <div className={`${s.picker} parts`} data-picker={style} onKeyDown={onKeyDown}>
              {shown(parts[layout]).map((id) => {
                const { Part } = PARTS[id];
                return <Part key={id} {...props} />;
              })}
            </div>
          </main>
          <footer className="status">
            <Boxes main={main} sub={sub} index={csp.index} transparent={csp.transparent} state={boxState} />
            <span className="st" data-state={status.state} data-busy={busy || undefined}>{csp.transparent ? 'Transparent colour' : statusText}</span>
            {status.state === 'unpaired' && <button type="button" className="pair" onClick={() => bridge.pair()}>Pair…</button>}
          </footer>
          {sheet && <PartsSheet layout={layout} onDone={() => setSheet(false)} />}
        </>
      )}
      {edges.map((e) => (
        <Grip key={e} edge={e} />
      ))}
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
        <filter id="okp-grey" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={greyMatrix()} /></filter>
      </svg>
      <MenuHost />
      <ToastHost />
    </div>
  );
}

/** a resize edge: pointer capture, phases to the native side */
function Grip({ edge }: { edge: Edge }) {
  const on = useRef(false);
  const go = (phase: Phase) => (e: PointerEvent<HTMLElement>) => {
    if (phase === 'start') { on.current = true; e.currentTarget.setPointerCapture(e.pointerId); }
    else if (!on.current) return;
    if (phase === 'end') on.current = false;
    bridge.resize(edge, phase, e.clientX, e.clientY);
  };
  return <div className="grip" data-edge={edge} onPointerDown={go('start')} onPointerMove={go('move')} onPointerUp={go('end')} onPointerCancel={go('end')} />;
}

declare global {
  interface Window {
    cspPicker: {
      onCspColor(c: CspColor): void;
      onSubColor(c: { r: number; g: number; b: number }): void;
      onStatus(s: Status): void;
      onTheme(t: 'dark' | 'light'): void;
      onLayout(l: { dock?: Dock; display?: Display; minimized?: boolean }): void;
    };
  }
}

// no browser menu on a long press: it is the tooltip's gesture
addEventListener('contextmenu', (e) => e.preventDefault());
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
if (isMock) console.log('[mock bridge] no AndroidBridge: calls are logged to window.__bridgeCalls');
