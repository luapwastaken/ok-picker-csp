// Compact mode: the active style's main control, then one strip (swatches, hex, copy). Composed from Design Tools' exported pieces.
import { useRef } from 'react';
import { Equals, Eyedropper, Warning } from '@phosphor-icons/react';
import { cssColor, inSrgb, READOUT_TOL, toSrgbGamut, type Oklch } from 'dt:shared/color/index.ts';
import { fromHex } from 'dt:shared/color/picker.ts';
import { valueOf } from 'dt:shared/color/value.ts';
import { COPY_FORMATS } from 'dt:shared/color/format.ts';
import { HexField } from 'dt:renderer/ui/HexField.tsx';
import { IconButton } from 'dt:renderer/ui/IconButton.tsx';
import { Tooltip } from 'dt:renderer/ui/Tooltip.tsx';
import { PickerChannel, channelProps } from 'dt:renderer/ui/PickerChannel.tsx';
import { PickerPlane } from 'dt:renderer/ui/PickerPlane.tsx';
import { PickerSquare } from 'dt:renderer/ui/PickerSquare.tsx';
import { PickerWheel } from 'dt:renderer/ui/PickerWheel.tsx';
import { usePickerColour } from 'dt:renderer/ui/pickerModels.ts';
import { HUE_HELD, VALUE_HELD, type Match } from 'dt:renderer/ui/PickerHold.tsx';
import { NumberField } from 'dt:renderer/ui/NumberField.tsx';
import { menu } from 'dt:renderer/ui/menu.ts';
import { roundTo } from 'dt:renderer/ui/scrub.ts';
import { pickFromScreen } from 'dt:renderer/ui/Picker.tsx';
import { toggleHueLock, toggleValueLock, useHueLock, useValueLock, usePickerModel, usePickerStyle } from 'dt:renderer/ui/PickerStyles.tsx';
import { copyColour, useCopyFormat } from 'dt:renderer/ui/CopyAs.tsx';
import { bridge } from './bridge.ts';

type Rgb = { r: number; g: number; b: number };
export const css = (c: Rgb) => '#' + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('');

/** CSP's two colour boxes: main (front) and sub (back); the ring marks the one CSP has active */
export function Boxes({ main, sub, index, transparent, state }: { main: Rgb; sub: Rgb | null; index: number; transparent: boolean; state?: string }) {
  return (
    <span className="boxes" aria-label="CSP colours" data-state={state}>
      <i className="sub" data-on={index === 1 || undefined} style={{ background: sub ? css(sub) : 'transparent' }} />
      <i className="main" data-on={index !== 1 || undefined} data-transparent={transparent || undefined} style={{ background: transparent ? undefined : css(main) }} />
    </span>
  );
}

const WARN = 'Outside sRGB: shown clipped, and kept until you change it. Tap to use the sRGB colour';
const HOLD_VALUE = "Keeps this colour's value (its grey, Rec. 709) while hue and chroma move. Applies to every picker.";
const HOLD_HUE = 'Keeps the hue while you drag.';

export type CompactProps = {
  value: Oklch;
  onChange(v: Oklch): void;
  main: Rgb;
  sub: Rgb | null;
  index: number;
  transparent: boolean;
  /** the short label under the strip, or '' when all is well */
  label: string;
  state: 'ok' | 'busy' | 'connecting' | 'bad';
  unpaired: boolean;
  match?: Match[];
};

export function Compact(p: CompactProps) {
  const { value } = p;
  const style = usePickerStyle();
  const model = usePickerModel();
  const hueHeld = useHueLock();
  const valueHeld = useValueLock();
  const matchBtn = useRef<HTMLButtonElement>(null);
  const colour = usePickerColour(value, p.onChange);
  const format = useCopyFormat();
  const g = { onBegin: colour.begin };
  const useSrgb = () => { colour.begin(); p.onChange(toSrgbGamut(value)); };
  const setValue = (t: number) => { colour.begin(); colour.setValue(t); };
  const openMatch = () => {
    const el = matchBtn.current!;
    menu.open(el.getBoundingClientRect(), [
      { header: 'Match the value of' },
      ...p.match!.map((m) => ({ label: m.name, swatch: cssColor(m.oklch), hint: (valueOf(m.oklch) * 100).toFixed(1), onSelect: () => setValue(valueOf(m.oklch)) })),
    ], { owner: el, width: 260 });
  };
  const dropper = async () => {
    const got = await pickFromScreen();
    if (!got) return;
    colour.begin();
    p.onChange(fromHex(got, value[2]));
  };
  const barRows = (list: ReturnType<typeof colour.channels>) =>
    list.map((ch) => (
      <div className="crow" key={ch.label}>
        <span className="lbl">{ch.label}</span>
        <PickerChannel bare {...channelProps(ch)} locked={ch.carrier ? VALUE_HELD : hueHeld && ch.label === 'H' ? HUE_HELD : undefined} {...g} />
      </div>
    ));
  return (
    <>
      <main className="body cbody">
        <div className="cmain" data-style={style}>
          <div className="cin" data-picker={style}>
            {style === 'square' && <PickerSquare area={colour.area(model)} {...g} />}
            {style === 'wheel' && <PickerWheel area={colour.area(model, true)} {...g} />}
            {style === 'sliders' && <div className="cchans">{barRows(colour.channels(model))}</div>}
            {style === 'oklch' && (
              <>
                <PickerPlane value={value} target={colour.target} chroma={colour.chroma} onSlide={colour.slide} {...g} onChange={colour.retarget} />
                <div className="cchans">{barRows(colour.channels('oklch'))}</div>
              </>
            )}
            <div className="chold" role="group" aria-label="Hold">
              <div className="chold1">
                <Tooltip content={HOLD_VALUE}><button type="button" className="cbtn" aria-label="Hold value" aria-pressed={valueHeld} onClick={toggleValueLock}>V</button></Tooltip>
                <Tooltip content={HOLD_HUE}><button type="button" className="cbtn" aria-label="Hold hue" aria-pressed={hueHeld} onClick={toggleHueLock}>H</button></Tooltip>
                {p.match && p.match.length > 0 && (
                  <Tooltip content="Set this colour's value to the sub colour's">
                    <button ref={matchBtn} type="button" className="cbtn" aria-label="Match value" onClick={openMatch}><Equals size={18} /></button>
                  </Tooltip>
                )}
                <Tooltip content="Eyedropper: tap a colour on the canvas">
                  <button type="button" className="cbtn" aria-label="Eyedropper" onClick={() => void dropper()}><Eyedropper size={18} /></button>
                </Tooltip>
              </div>
              <Tooltip content="Rec. 709 luma: the grey a greyscale view shows. L and C change while this is held.">
                <span className="cvalue">
                  <NumberField label="Value" value={roundTo((colour.target ?? valueOf(value)) * 100, 1)} min={0} max={100} step={0.5} precision={1} onBegin={colour.begin} onChange={(x) => colour.setValue(x / 100)} />
                </span>
              </Tooltip>
              {valueHeld && colour.target === null && <span className="cnote">Nothing to hold at black or white</span>}
            </div>
          </div>
        </div>
      </main>
      <footer className="cstrip" data-state={p.state}>
        <div className="crow1">
          <Boxes main={p.main} sub={p.sub} index={p.index} transparent={p.transparent} state={p.state} />
          <div className="chex">
            <HexField value={value} steered onBegin={colour.begin} onChange={p.onChange} />
            {!inSrgb(value, READOUT_TOL) && (
              <Tooltip content={WARN}>
                <button type="button" className="cwarn" aria-label={WARN} onClick={useSrgb}><Warning size={18} weight="fill" /></button>
              </Tooltip>
            )}
          </div>
          <IconButton icon="content_copy" size="sm" label={`Copy ${COPY_FORMATS.find((f) => f.id === format)!.label}`} onClick={() => void copyColour(value)} />
        </div>
        {(p.label || p.unpaired) && (
          <div className="cstate" data-state={p.state}>
            <span>{p.label}</span>
            {p.unpaired && <button type="button" className="pair" onClick={() => bridge.pair()}>Pair…</button>}
          </div>
        )}
      </footer>
    </>
  );
}
