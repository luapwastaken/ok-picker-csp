// The 1.0 panel's pieces as parts, each in its Full and its Compact look, plus Sliders (A2). Composed from
// Design Tools' exported picker pieces, as compact.tsx was.
import { useLayoutEffect, useRef } from 'react';
import { ArrowCounterClockwise, Equals, Eyedropper, Warning } from '@phosphor-icons/react';
import { cssColor, hexToOklch, inSrgb, READOUT_TOL, toHex, toSrgbGamut, type Oklch } from 'dt:shared/color/index.ts';
import { fromHex } from 'dt:shared/color/picker.ts';
import { valueOf } from 'dt:shared/color/value.ts';
import type { PickerModel } from 'dt:shared/types.ts';
import { COPY_FORMATS } from 'dt:shared/color/format.ts';
import { HexField } from 'dt:renderer/ui/HexField.tsx';
import { IconButton } from 'dt:renderer/ui/IconButton.tsx';
import { Icon } from 'dt:renderer/ui/Icon.tsx';
import { Tooltip } from 'dt:renderer/ui/Tooltip.tsx';
import { PickerChannel, channelProps } from 'dt:renderer/ui/PickerChannel.tsx';
import { PickerPlane } from 'dt:renderer/ui/PickerPlane.tsx';
import { PickerSquare } from 'dt:renderer/ui/PickerSquare.tsx';
import { PickerWheel } from 'dt:renderer/ui/PickerWheel.tsx';
import { PickerNumbers, PickerSliders } from 'dt:renderer/ui/PickerNumbers.tsx';
import { Gamut, PickerOklch, SrgbFix } from 'dt:renderer/ui/PickerOklch.tsx';
import { HUE_HELD, PickerHold, VALUE_HELD } from 'dt:renderer/ui/PickerHold.tsx';
import { PickerStyles, toggleHueLock, toggleValueLock, useHueLock, useValueLock, usePickerModel, usePickerStyle } from 'dt:renderer/ui/PickerStyles.tsx';
import { NumberField } from 'dt:renderer/ui/NumberField.tsx';
import { CopyAs, copyColour, useCopyFormat } from 'dt:renderer/ui/CopyAs.tsx';
import { menu } from 'dt:renderer/ui/menu.ts';
import { roundTo } from 'dt:renderer/ui/scrub.ts';
import { pickFromScreen } from 'dt:renderer/ui/Picker.tsx';
import s from 'dt:renderer/ui/Picker.module.css';
import { useHistory } from './history.ts';
import { useParts } from './store.ts';
import type { PartProps } from './types.ts';

const MODEL_NAME: Record<PickerModel, string> = { hsb: 'HSB', rgb: 'RGB', hsl: 'HSL', oklch: 'OKLCH', cmyk: '≈CMYK' };
const WARN = 'Outside sRGB: shown clipped, and kept until you change it. Tap to use the sRGB colour';
const HOLD_VALUE = "Keeps this colour's value (its grey, Rec. 709) while hue and chroma move. Applies to every picker.";
const HOLD_HUE = 'Keeps the hue while you drag.';

const useSrgbOf = (p: PartProps) => () => { p.g.onBegin(); p.onChange(toSrgbGamut(p.value)); };

/** a model's channels as track rows: bare tracks with their letter (Compact), or tracks with their fields (Full) */
function ChannelRows({ p, model, bare }: { p: PartProps; model: PickerModel; bare: boolean }) {
  const hueHeld = useHueLock();
  const list = p.colour.channels(model);
  const locked = (ch: (typeof list)[number]) => (ch.carrier ? VALUE_HELD : hueHeld && ch.label === 'H' ? HUE_HELD : undefined);
  if (!bare) return <div className={s.chans}>{list.map((ch) => <PickerChannel key={ch.label} {...channelProps(ch)} locked={locked(ch)} {...p.g} />)}</div>;
  return (
    <div className="cchans">
      {list.map((ch) => (
        <div className="crow" key={ch.label}>
          <span className="lbl">{ch.label}</span>
          <PickerChannel bare {...channelProps(ch)} locked={locked(ch)} {...p.g} />
        </div>
      ))}
    </div>
  );
}

export function StylesPart() {
  return <div className={s.top}><PickerStyles /></div>;
}

/** the active style's main control: the square or wheel, the sliders, or the OKLCH plane */
export function AreaPart(p: PartProps) {
  const style = usePickerStyle();
  const model = usePickerModel();
  const { colour, g, value } = p;
  const box = useRef<HTMLDivElement>(null);
  // Full: the wheel fills whichever of the area's width and height is smaller (CSS can't: the area's height comes from
  // the flex layout, which container units read as 0)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || style !== 'wheel') return;
    const ro = new ResizeObserver(() => el.style.setProperty('--pwheel', `${Math.max(150, Math.min(el.clientWidth, el.clientHeight))}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [style, p.layout]);
  if (p.layout === 'compact') {
    return (
      <div className="cmain" data-style={style}>
        <div className="cin">
          {style === 'square' && <PickerSquare area={colour.area(model)} {...g} />}
          {style === 'wheel' && <PickerWheel area={colour.area(model, true)} {...g} />}
          {style === 'sliders' && <ChannelRows p={p} model={model} bare />}
          {style === 'oklch' && (
            <>
              <PickerPlane value={value} target={colour.target} chroma={colour.chroma} onSlide={colour.slide} {...g} onChange={colour.retarget} />
              <ChannelRows p={p} model="oklch" bare />
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="parea" data-style={style} ref={box}>
      {style === 'square' && <PickerSquare area={colour.area(model)} {...g} />}
      {style === 'wheel' && <PickerWheel area={colour.area(model, true)} {...g} />}
      {style === 'sliders' && <PickerSliders model={model} channels={colour.channels(model)} {...g} />}
      {style === 'oklch' && <PickerOklch value={value} channels={colour.channels('oklch')} target={colour.target} chroma={colour.chroma} onSlide={colour.slide} onMax={colour.max} {...g} onChange={colour.retarget} />}
      {style === 'oklch' && <Gamut value={value} target={colour.target} onUse={useSrgbOf(p)} />}
      {style === 'sliders' && model === 'cmyk' && <p className={s.note}>≈ Estimate from sRGB, no ICC profile</p>}
    </div>
  );
}

/** the model menu and its fields, under Square and Wheel */
export function NumbersPart(p: PartProps) {
  const style = usePickerStyle();
  const model = usePickerModel();
  if (style !== 'square' && style !== 'wheel') return null;
  return (
    <>
      <PickerNumbers model={model} channels={p.colour.channels(model)} {...p.g} />
      {model === 'cmyk' && <p className={s.note}>≈ Estimate from sRGB, no ICC profile. Four inks have no flat plane, so the area stays saturation by brightness</p>}
    </>
  );
}

/** A2: one or more slider sets, whatever the style, chosen in Panel parts */
export function SlidersPart(p: PartProps) {
  const { sliderSets } = useParts();
  return (
    <div className="psliders">
      {sliderSets.map((m) => (
        <section key={m} className="pset" aria-label={`${MODEL_NAME[m]} sliders`}>
          {sliderSets.length > 1 && <span className="plabel">{MODEL_NAME[m]}</span>}
          <ChannelRows p={p} model={m} bare={p.layout === 'compact'} />
        </section>
      ))}
    </div>
  );
}

/** Hold value, Value, Hold hue, Match: Design Tools' row in Full, buttons in Compact */
export function HoldsPart(p: PartProps) {
  const hueHeld = useHueLock();
  const valueHeld = useValueLock();
  const matchBtn = useRef<HTMLButtonElement>(null);
  const { colour, value } = p;
  if (p.layout !== 'compact') return <PickerHold value={value} colour={colour} match={p.match} {...p.g} />;
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
    if (got) p.set(fromHex(got, value[2]));
  };
  return (
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
  );
}

/** C2: the colour before the last change; a tap goes back, a second tap swaps again */
function Previous({ p }: { p: PartProps }) {
  const now = toHex(p.value).toLowerCase();
  const prev = useHistory().find((h) => h !== now);
  if (!prev) return null;
  return (
    <Tooltip content="Previous colour: tap to go back">
      <button type="button" className="prev" aria-label={`Previous colour ${prev}`} style={{ background: prev }} onClick={() => p.set(hexToOklch(prev))}>
        <ArrowCounterClockwise size={12} weight="bold" />
      </button>
    </Tooltip>
  );
}

/** the hex field with the previous colour, the eyedropper (Full) and copy */
export function HexPart(p: PartProps) {
  const format = useCopyFormat();
  const style = usePickerStyle();
  const { value } = p;
  const outside = !inSrgb(value, READOUT_TOL);
  const useSrgb = useSrgbOf(p);
  if (p.layout === 'compact') {
    return (
      <div className="crow1">
        <Previous p={p} />
        <div className="chex">
          <HexField value={value} steered onBegin={p.g.onBegin} onChange={p.onChange} />
          {outside && (
            <Tooltip content={WARN}>
              <button type="button" className="cwarn" aria-label={WARN} onClick={useSrgb}><Warning size={18} weight="fill" /></button>
            </Tooltip>
          )}
        </div>
        <IconButton icon="content_copy" size="sm" label={`Copy ${COPY_FORMATS.find((f) => f.id === format)!.label}`} onClick={() => void copyColour(value)} />
      </div>
    );
  }
  const pick = async () => {
    const got = await pickFromScreen();
    if (got && got !== toHex(value)) p.set(fromHex(got, value[2]));
  };
  return (
    <>
      <div className={`${s.hexRow} phex`}>
        <Previous p={p} />
        <HexField value={value} steered className={s.hex} onBegin={p.g.onBegin} onChange={p.onChange} />
        <IconButton icon="colorize" label="Eyedropper" onClick={() => void pick()} />
        <span className="copywide"><CopyAs value={value} /></span>
        <span className="copynarrow"><IconButton icon="content_copy" label={`Copy ${COPY_FORMATS.find((f) => f.id === format)!.label}`} onClick={() => void copyColour(value)} /></span>
      </div>
      {style !== 'oklch' && outside && (
        <>
          <p className={s.outside}><Icon name="warning" size={14} />Outside sRGB: shown clipped, and kept until you change it</p>
          <SrgbFix value={value} onUse={useSrgb} />
        </>
      )}
    </>
  );
}

