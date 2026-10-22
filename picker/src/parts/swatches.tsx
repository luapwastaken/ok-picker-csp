// Recent (C1), Tints (C3) and Harmonies (C4): rows of tappable swatches, all drawn by the shared Chips.
import { hexToOklch, type Oklch } from 'dt:shared/color/index.ts';
import { fitChroma } from 'dt:shared/palette/space.ts';
import { harmony, type HarmonyKind } from 'dt:shared/palette/harmony.ts';
import { Chips, PartHead, type Chip } from './chips.tsx';
import { useHistory } from './history.ts';
import type { PartProps } from './types.ts';
import './swatches.css';

const GREY = 0.004; // below this chroma a colour is a grey: tints keep it grey

export function RecentPart(p: PartProps) {
  const hist = useHistory().slice(0, 12); // already distinct, newest first
  return (
    <div className="pswatch">
      {p.layout === 'full' && <PartHead>Recent</PartHead>}
      {hist.length ? (
        <Chips label="Recent colours" chips={hist.map((h) => ({ oklch: hexToOklch(h) }))} current={p.value} onPick={p.set} />
      ) : <p className="cnote">Colours you use show here</p>}
    </div>
  );
}

const LEVELS = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];

export function TintsPart(p: PartProps) {
  const [, c, h] = p.value;
  const chroma = c < GREY ? 0 : c;
  const chips: Chip[] = LEVELS.map((l) => ({ oklch: fitChroma([l, chroma, h]) }));
  return (
    <div className="pswatch">
      {p.layout === 'full' && <PartHead>Tints</PartHead>}
      <Chips label="Tints" chips={chips} current={p.value} onPick={p.set} />
    </div>
  );
}

const KINDS: [HarmonyKind, string][] = [['complementary', 'Complement'], ['analogous', 'Analogous'], ['triad', 'Triad'], ['split', 'Split'], ['tetrad', 'Tetrad']];

export function HarmoniesPart(p: PartProps) {
  const compact = p.layout === 'compact';
  return (
    <div className="pswatch">
      {!compact && <PartHead>Harmonies</PartHead>}
      <div className="hrows" data-layout={p.layout}>
        {KINDS.map(([kind, name]) => {
          const chips: Oklch[] = [p.value, ...harmony(p.value, kind)]; // harmony() leaves the base out: lead with it
          return (
            <div className="hrow" key={kind} title={name}>
              {!compact && <span className="hlbl">{name}</span>}
              <Chips label={name} chips={chips.map((oklch) => ({ oklch }))} current={p.value} onPick={p.set} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
