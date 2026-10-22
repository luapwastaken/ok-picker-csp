// B4: the gradients and ramps kept from the Gradient part, tap to use, and export as a Photoshop colour set (.aco)
// that CSP imports into its Color Set palette.
import { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { writeAco } from 'dt:shared/palette/writers.ts';
import type { Swatch } from 'dt:shared/types.ts';
import { bridge } from '../bridge.ts';
import { Chips, PartHead } from './chips.tsx';
import { removeKept, useKept } from './kept-store.ts';
import type { PartProps } from './types.ts';
import './gradient.css';

const base64 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };

export function KeptPart(p: PartProps) {
  const rows = useKept();
  const [armed, setArmed] = useState<string | null>(null); // a first tap on ✕ asks, a second removes
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const exportAco = () => {
    const swatches: Swatch[] = rows.flatMap((r) => r.colours.map((oklch, i): Swatch => ({ id: `${r.id}-${i}`, name: `${r.name} · ${i + 1}`, role: null, oklch, type: 'process' })));
    bridge.share('OK Picker colours.aco', 'application/octet-stream', base64(writeAco(swatches)));
  };

  return (
    <div className="gr kept">
      <PartHead>Kept</PartHead>
      {!rows.length && <p className="cnote">Keep a gradient or ramp to collect it here</p>}
      {rows.map((r) => (
        <div className="krow" key={r.id}>
          <div className="khead">
            <span className="kname">{r.name}</span>
            <button type="button" className="gbtn kx" data-armed={armed === r.id || undefined} aria-label={armed === r.id ? `Remove ${r.name}: tap again` : `Remove ${r.name}`}
              onClick={() => (armed === r.id ? (removeKept(r.id), setArmed(null)) : setArmed(r.id))}>
              {armed === r.id ? 'Remove?' : <X size={14} />}
            </button>
          </div>
          <Chips chips={r.colours.map((oklch) => ({ oklch }))} current={p.value} onPick={p.set} label={r.name} />
        </div>
      ))}
      {rows.length > 0 && <button type="button" className="gbtn gwide" onClick={exportAco}>Export colour set…</button>}
    </div>
  );
}
