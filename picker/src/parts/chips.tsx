// A row of colour swatches to tap, shared by Recent, Tints, Harmonies, the gradient and Kept. The one equal to the
// current colour is ringed (a ring all round: never a bar on one edge). A row too narrow for MIN-wide swatches splits
// into even rows (12 become 6 + 6), so every swatch stays big enough for a finger.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cssColor, toHex, type Oklch } from 'dt:shared/color/index.ts';
import './chips.css';

export type Chip = { oklch: Oklch; label?: string };
const MIN = 28;
const GAP = 3;

export function Chips({ chips, current, onPick, label, after }: { chips: Chip[]; current?: Oklch; onPick(c: Oklch): void; label: string; after?: ReactNode }) {
  const now = current ? toHex(current).toLowerCase() : '';
  const box = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(chips.length);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const n = chips.length;
    const fit = () => {
      const rows = Math.max(1, Math.ceil((n * (MIN + GAP) - GAP) / Math.max(1, el.clientWidth)));
      setCols(Math.ceil(n / rows));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [chips.length]);
  return (
    <div className="chips" ref={box} role="group" aria-label={label} style={{ ['--n' as string]: cols }}>
      {chips.map((c, i) => {
        const hex = toHex(c.oklch).toLowerCase();
        return (
          <button key={i} type="button" className="chip" data-on={hex === now || undefined} aria-label={c.label ?? hex} title={c.label ?? hex} style={{ background: cssColor(c.oklch) }} onClick={() => onPick(c.oklch)} />
        );
      })}
      {after}
    </div>
  );
}

/** a part's small heading, with room for a control on the right */
export function PartHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="phead">
      <span className="plabel">{children}</span>
      {right}
    </div>
  );
}
