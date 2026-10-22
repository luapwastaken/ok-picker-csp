// The gradient's maths, pure: a colour at a position along two ends, by path, with a bias, always inside sRGB.
import { fitChroma, fromOklab, toOklab, wrapHue } from 'dt:shared/palette/space.ts';
import type { Oklch } from 'dt:shared/color/index.ts';

export type Path = 'lab' | 'short' | 'long';
export const MID_MIN = 0.15, MID_MAX = 0.85;

/** below this chroma a hue is invisible, so the other end's hue steers (as gradient.ts in Design Tools) */
const GREY = 1e-3;

/** t bent so that t = m lands on the middle of the mix; m = 0.5 is linear */
export const bias = (t: number, m: number): number => {
  const k = Math.log(0.5) / Math.log(Math.min(MID_MAX, Math.max(MID_MIN, m)));
  return Math.min(1, Math.max(0, t)) ** k;
};

/** the hues to mix between, and the turn from one to the other, the short or the long way round */
export function hueTurn(a: Oklch, b: Oklch, path: 'short' | 'long'): [number, number] {
  const ha = a[1] < GREY ? b[2] : a[2];
  const hb = b[1] < GREY ? ha : b[2];
  const short = ((((hb - ha) % 360) + 540) % 360) - 180;
  return [ha, path === 'short' ? short : short >= 0 ? short - 360 : short + 360];
}

/** the colour `t` (0..1) of the way from a to b, `m` the midpoint bias, fitted into sRGB (L and h kept) */
export function mixAt(a: Oklch, b: Oklch, t: number, path: Path, m = 0.5): Oklch {
  const u = bias(t, m);
  const mix = (x: number, y: number) => x + (y - x) * u;
  if (path === 'lab') {
    const [pa, pb] = [toOklab(a), toOklab(b)];
    return fitChroma(fromOklab([mix(pa[0], pb[0]), mix(pa[1], pb[1]), mix(pa[2], pb[2])], a[1] >= b[1] ? a[2] : b[2]));
  }
  const [h0, turn] = hueTurn(a, b, path);
  return fitChroma([mix(a[0], b[0]), mix(a[1], b[1]), wrapHue(h0 + turn * u)]);
}

/** n steps including both ends */
export const stepsOf = (a: Oklch, b: Oklch, n: number, path: Path, m = 0.5): Oklch[] =>
  Array.from({ length: n }, (_, i) => mixAt(a, b, n === 1 ? 0 : i / (n - 1), path, m));
