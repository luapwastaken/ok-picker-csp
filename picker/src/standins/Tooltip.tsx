// Stand-in for ui/Tooltip.tsx: touch has no hover, so a tooltip is a long press (450 ms, finger still);
// a mouse (desktop test) still gets hover. Same props as the original, same trigger wrapping.
import { cloneElement, useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

const HOLD = 450;
const MOVE = 10; // px of drift that cancels the hold

export function Tooltip({ content, shortcut, children, disabled }: {
  content?: string; shortcut?: string; children: ReactElement<any>; disabled?: boolean; overflowOnly?: boolean; clamped?: boolean; side?: string;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const p = children.props;
  const hide = () => { clearTimeout(timer.current); setTip(null); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(hide, 2500); // a touch tip goes by itself
    addEventListener('pointerdown', hide, true);
    return () => { clearTimeout(t); removeEventListener('pointerdown', hide, true); };
  }, [tip]);

  const arm = (e: PointerEvent<Element>, delay: number) => {
    const el = e.currentTarget;
    start.current = { x: e.clientX, y: e.clientY };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const text = content ?? el.textContent ?? '';
      if (disabled || !text || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      setTip({ x: r.left + r.width / 2, y: r.bottom + 6, text: shortcut ? `${text} (${shortcut})` : text });
    }, delay);
  };
  const trigger = cloneElement(children, {
    onPointerDown(e: PointerEvent<Element>) { p.onPointerDown?.(e); if (e.pointerType !== 'mouse') arm(e, HOLD); },
    onPointerEnter(e: PointerEvent<Element>) { p.onPointerEnter?.(e); if (e.pointerType === 'mouse') arm(e, 600); },
    onPointerMove(e: PointerEvent<Element>) { p.onPointerMove?.(e); if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > MOVE && !tip) clearTimeout(timer.current); },
    onPointerUp(e: PointerEvent<Element>) { p.onPointerUp?.(e); if (e.pointerType !== 'mouse') clearTimeout(timer.current); },
    onPointerCancel(e: PointerEvent<Element>) { p.onPointerCancel?.(e); hide(); },
    onPointerLeave(e: PointerEvent<Element>) { p.onPointerLeave?.(e); if (e.pointerType === 'mouse') hide(); },
  });
  return (
    <>
      {trigger}
      {tip && createPortal(<div className="tip" style={{ left: Math.min(Math.max(tip.x, 70), innerWidth - 70), top: tip.y }}>{tip.text}</div>, document.body)}
    </>
  );
}
