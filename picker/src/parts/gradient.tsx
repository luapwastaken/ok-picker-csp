// B1-B3: a gradient between two pinned ends (drag the bar to mix live, tap a step), or a light-to-shadow ramp from a
// pinned base. The ends and the base are snapshots on purpose: picking a step changes CSP's main colour, and a
// gradient that followed it would shift under the finger.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { hexToOklch, toHex, type Oklch } from 'dt:shared/color/index.ts';
import { greyOf, valueOf } from 'dt:shared/color/value.ts';
import { generateRamp, MATERIALS, newRamp } from 'dt:shared/palette/ramp.ts';
import type { MaterialId, RampSpec } from 'dt:shared/types.ts';
import { menu, type MenuItem } from 'dt:renderer/ui/menu.ts';
import { Chips } from './chips.tsx';
import { MID_MAX, MID_MIN, mixAt, stepsOf, type Path } from './gradient-math.ts';
import { exportColourSet, keep, makeStore } from './kept-store.ts';
import { partsState, togglePart } from './store.ts';
import type { PartProps, Rgb } from './types.ts';
import './gradient.css';

type Mode = 'gradient' | 'ramp';
type Saved = { mode: Mode; a: Oklch | null; b: Oklch | null; steps: number; path: Path; mid: number; base: Oklch | null; material: MaterialId; push: number; rsteps: number };
const store = makeStore<Saved>('cspPicker.gradient', { mode: 'gradient', a: null, b: null, steps: 5, path: 'lab', mid: 0.5, base: null, material: 'cloth', push: 0, rsteps: 5 });

const fromRgb = ({ r, g, b }: Rgb): Oklch => hexToOklch('#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join(''));
const WHITE: Oklch = [1, 0, 0];
const PATHS: [Path, string][] = [['lab', 'OKLab (straight)'], ['short', 'OKLCH, hue short way'], ['long', 'OKLCH, hue long way']];
const PUSHES = [['Grounded', 0], ['Expressive', 1], ['Extreme', 2]] as const;
const rampOf = (s: Saved, base: Oklch): Oklch[] => generateRamp({ ...newRamp(base, 'ramp'), material: s.material, push: s.push, steps: s.rsteps } as RampSpec).map((x) => x.oklch);

/** chips per row: ~30px each fit; more steps than that wrap to even rows */
function useCols(n: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(300);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const rows = Math.ceil(n / Math.max(1, Math.floor(w / 30)));
  return { ref, cols: Math.ceil(n / rows) };
}

function ChipRows({ chips, cols, p, label, strip }: { chips: Oklch[]; cols: number; p: PartProps; label: string; strip?: boolean }) {
  const rows: Oklch[][] = [];
  for (let i = 0; i < chips.length; i += cols) rows.push(chips.slice(i, i + cols));
  return (
    <div className="grows" style={{ ['--cols' as string]: cols }}>
      {rows.map((r, i) => (
        <div key={i}>
          <Chips chips={r.map((oklch) => ({ oklch }))} current={p.value} onPick={p.set} label={`${label} ${i + 1}`} />
          {strip && (
            <div className="gstrip" aria-hidden="true">
              {r.map((c, j) => <i key={j} style={{ background: toHex(greyOf(valueOf(c))) }} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const openMenu = (el: HTMLElement, items: MenuItem[], width = 220) => menu.open(el.getBoundingClientRect(), items, { owner: el, width });

/** an end or a base is re-taken from the current, main or sub colour */
const sourceItems = (p: PartProps, take: (c: Oklch) => void): MenuItem[] => [
  { label: 'Use current colour', onSelect: () => take(p.value) },
  { label: 'Use main colour', onSelect: () => take(fromRgb(p.main)) },
  { label: 'Use sub colour', disabled: !p.sub, onSelect: () => p.sub && take(fromRgb(p.sub)) },
];

/** the pointer's place along an element, 0..1 */
const along = (e: PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
/** pointer handlers that follow a drag along an element (captured, so it keeps going off the edge) */
const dragAlong = (move: (t: number) => void, begin?: () => void) => ({
  onPointerDown: (e: PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); begin?.(); move(along(e)); },
  onPointerMove: (e: PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(along(e)); },
});

function GradientBody({ p, s }: { p: PartProps; s: Saved }) {
  const a = s.a ?? fromRgb(p.main), b = s.b ?? (p.sub ? fromRgb(p.sub) : WHITE);
  const [pos, setPos] = useState<number | null>(null);
  const colours = stepsOf(a, b, s.steps, s.path, s.mid);
  const { ref, cols } = useCols(s.steps);

  const css = `linear-gradient(to right, ${Array.from({ length: 32 }, (_, i) => toHex(mixAt(a, b, i / 31, s.path, s.mid))).join(', ')})`;
  const mixTo = (t: number) => { setPos(t); p.onChange(mixAt(a, b, t, s.path, s.mid)); };
  const key = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowLeft' ? -0.05 : 0;
    if (!d) return;
    e.preventDefault();
    p.g.onBegin();
    mixTo(Math.min(1, Math.max(0, (pos ?? 0.5) + d)));
  };
  // the marker only shows while the colour is still the one it points at
  const here = pos !== null && toHex(mixAt(a, b, pos, s.path, s.mid)) === toHex(p.value);

  const end = (which: 'a' | 'b', c: Oklch) => (
    <button type="button" className="gend" aria-label={`End ${which.toUpperCase()}: change`} title={`End ${which.toUpperCase()}`} style={{ background: toHex(c) }}
      onClick={(e) => openMenu(e.currentTarget, [{ header: `End ${which.toUpperCase()}` }, ...sourceItems(p, (x) => store.set({ a, b, [which]: x }))])} />
  );

  return (
    <div ref={ref}>
      <div className="gbarrow">
        {end('a', a)}
        <div className="gcol">
          <div className="gbar" role="slider" tabIndex={0} aria-label="Mix" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((pos ?? 0) * 100)}
            style={{ background: css }} {...dragAlong(mixTo, p.g.onBegin)} onKeyDown={key}>
            {here && <i className="gmark" style={{ left: `${pos! * 100}%`, background: toHex(p.value) }} />}
          </div>
          <div className="gmid" title="Midpoint: drag to bias the mix, double-tap to reset" {...dragAlong((t) => store.set({ a, b, mid: Math.min(MID_MAX, Math.max(MID_MIN, t)) }))} onDoubleClick={() => store.set({ mid: 0.5 })}>
            <span style={{ left: `${s.mid * 100}%` }}>◆</span>
          </div>
        </div>
        {end('b', b)}
      </div>
      <ChipRows chips={colours} cols={cols} p={p} label="Gradient steps" />
    </div>
  );
}

function RampBody({ p, s }: { p: PartProps; s: Saved }) {
  const base = s.base ?? p.value;
  const colours = rampOf(s, base);
  const { ref, cols } = useCols(colours.length);
  const mat = MATERIALS.find((m) => m.id === s.material)!;
  const pick = (name: string, value: string, items: MenuItem[]) => (
    <button type="button" className="gbtn gsel" onClick={(e) => openMenu(e.currentTarget, items, 180)}><small>{name}</small>{value}</button>
  );
  return (
    <div ref={ref}>
      <div className="gsels">
        {pick('Material', mat.label, MATERIALS.map((m) => ({ label: m.label, checked: m.id === s.material, onSelect: () => store.set({ base, material: m.id }) })))}
        {pick('Push', PUSHES.find(([, v]) => v === s.push)?.[0] ?? 'Custom', PUSHES.map(([l, v]) => ({ label: l, checked: v === s.push, onSelect: () => store.set({ base, push: v }) })))}
        {pick('Steps', String(s.rsteps), [3, 5, 7, 9].map((n) => ({ label: String(n), checked: n === s.rsteps, onSelect: () => store.set({ base, rsteps: n }) })))}
        <button type="button" className="gbtn gsel" aria-label="Base colour" onClick={(e) => openMenu(e.currentTarget, [{ header: 'Base colour' }, ...sourceItems(p, (c) => store.set({ base: c }))])}>
          <small>Base</small><i className="gdot" style={{ background: toHex(base) }} />
        </button>
      </div>
      <ChipRows chips={colours} cols={cols} p={p} label="Ramp steps" strip />
    </div>
  );
}

export function GradientPart(p: PartProps) {
  const s = store.use();
  // pin the snapshots on first use. Main is black until CSP reports; the sub colour arriving means it has
  useEffect(() => {
    const cur = store.get();
    if (!p.sub || (cur.a && cur.b && cur.base)) return;
    store.set({ a: cur.a ?? fromRgb(p.main), b: cur.b ?? fromRgb(p.sub), base: cur.base ?? p.value });
  }, [p.main, p.sub]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = s.a ?? fromRgb(p.main), b = s.b ?? (p.sub ? fromRgb(p.sub) : WHITE);
  const steps = () => (s.mode === 'gradient' ? stepsOf(a, b, s.steps, s.path, s.mid) : rampOf(s, s.base ?? p.value));
  const name = s.mode === 'gradient' ? ('Gradient' as const) : ('Ramp' as const);
  // what is kept must show: Keep switches on Kept colours when it is off
  const keepRow = () => {
    keep(name, steps());
    if (!partsState()[p.layout].on.includes('kept')) togglePart(p.layout, 'kept');
  };
  // saving: the kept rows, or these steps when nothing is kept yet
  const exportItems: MenuItem[] = [
    { label: 'Save colour set…', onSelect: () => exportColourSet('save', { name, colours: steps() }) },
    { label: 'Share colour set…', onSelect: () => exportColourSet('share', { name, colours: steps() }) },
  ];
  const more = (e: MouseEvent<HTMLButtonElement>) =>
    openMenu(e.currentTarget, s.mode === 'gradient' ? [
      { label: 'Steps', submenu: [3, 5, 7, 9, 12].map((n) => ({ label: String(n), checked: n === s.steps, onSelect: () => store.set({ steps: n }) })) },
      { label: 'Path', submenu: PATHS.map(([v, l]) => ({ label: l, checked: v === s.path, onSelect: () => store.set({ path: v }) })) },
      'separator',
      { label: 'Swap ends', onSelect: () => store.set({ a: b, b: a }) },
      { label: 'Reset midpoint', onSelect: () => store.set({ mid: 0.5 }) },
      'separator',
      ...exportItems,
    ] : exportItems);

  return (
    <div className="gr">
      <div className="ghead">
        <div className="gswitch" role="radiogroup" aria-label="Gradient or ramp">
          {(['gradient', 'ramp'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={s.mode === m} onClick={() => store.set({ mode: m })}>{m === 'gradient' ? 'Gradient' : 'Ramp'}</button>
          ))}
        </div>
        <button type="button" className="gbtn gicon" aria-label="Gradient options" title={s.mode === 'gradient' ? 'Steps, path, swap, midpoint, save' : 'Save colour set'} onClick={more}><DotsThree size={18} weight="bold" /></button>
        <button type="button" className="gbtn" onClick={keepRow}>Keep</button>
      </div>
      {s.mode === 'gradient' ? <GradientBody p={p} s={s} /> : <RampBody p={p} s={s} />}
    </div>
  );
}
