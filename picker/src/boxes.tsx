import type { Rgb } from './parts/types.ts';

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
