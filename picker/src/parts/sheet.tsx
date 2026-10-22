// ≡ → Panel parts: the current layout's parts, each switched on or off and dragged into order by its grip, with
// presets that reset which are on. It covers the panel below the title bar until Done.
import { useRef, type PointerEvent } from 'react';
import { DotsSixVertical } from '@phosphor-icons/react';
import { Toggle } from 'dt:renderer/ui/Toggle.tsx';
import type { PickerModel } from 'dt:shared/types.ts';
import { PARTS } from './index.tsx';
import { applyPreset, movePart, PRESETS, toggleSliderSet, togglePart, useParts, type LayoutId, type PartId, type Preset } from './store.ts';

const SETS: { m: PickerModel; label: string }[] = [
  { m: 'hsb', label: 'HSB' }, { m: 'rgb', label: 'RGB' }, { m: 'hsl', label: 'HSL' }, { m: 'oklch', label: 'OKLCH' }, { m: 'cmyk', label: '≈CMYK' },
];
const PRESET_NAME: Record<Preset, string> = { full: 'Full', compact: 'Compact', minimal: 'Minimal' };

export function PartsSheet({ layout, onDone }: { layout: LayoutId; onDone(): void }) {
  const st = useParts();
  const lay = st[layout];
  const list = useRef<HTMLDivElement>(null);
  const dragging = useRef<PartId | null>(null);
  const same = (p: Preset) => PRESETS[p].length === lay.on.length && PRESETS[p].every((id) => lay.on.includes(id));

  // a grip drag: the row moves to wherever the finger is over
  const down = (id: PartId) => (e: PointerEvent<HTMLElement>) => {
    dragging.current = id;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const id = dragging.current;
    if (!id || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>('[data-part]')];
    const at = rows.findIndex((r) => e.clientY < r.getBoundingClientRect().bottom);
    const to = at < 0 ? rows.length - 1 : at;
    if (lay.order[to] !== id) movePart(layout, id, to);
  };
  const up = () => { dragging.current = null; };

  return (
    <div className="sheet" role="dialog" aria-label="Panel parts">
      <div className="sheethead">
        <span>Panel parts · {layout === 'full' ? 'Full' : 'Compact'}</span>
        <button type="button" className="pair" onClick={onDone}>Done</button>
      </div>
      <div className="presets" role="group" aria-label="Start from">
        {(Object.keys(PRESETS) as Preset[]).map((p) => (
          <button key={p} type="button" className="cbtn" aria-pressed={same(p)} onClick={() => applyPreset(layout, p)}>{PRESET_NAME[p]}</button>
        ))}
      </div>
      <div className="plist" ref={list}>
        {lay.order.map((id) => {
          const on = lay.on.includes(id);
          return (
            <div key={id} className="prow" data-part={id} data-on={on || undefined}>
              <span className="pgrip" aria-label={`Move ${PARTS[id].label}`} onPointerDown={down(id)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                <DotsSixVertical size={18} weight="bold" />
              </span>
              <div className="pmain">
                <Toggle checked={on} label={PARTS[id].label} onChange={() => togglePart(layout, id)} quiet />
                {PARTS[id].hint && <span className="phint">{PARTS[id].hint}</span>}
                {id === 'sliders' && on && (
                  <div className="psets" role="group" aria-label="Slider sets">
                    {SETS.map(({ m, label }) => (
                      <button key={m} type="button" className="cbtn" aria-pressed={st.sliderSets.includes(m)} onClick={() => toggleSliderSet(m)}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
