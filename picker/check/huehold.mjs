// Hold hue in RGB, headless: the Design Tools smoke's sequence (a drag across the area, then the R bar) with the
// colours printed at each step, so a hue that moves can be traced. node check/huehold.mjs
import { launch, serve } from './lib.mjs';

const { base, close } = await serve();
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 320, height: 700 });
await page.goto(`${base}/dist/index.html?display=popup&dock=float&theme=dark`, { waitUntil: 'load' });
await page.evaluate((both) => localStorage.setItem('cspPicker.settings', JSON.stringify({ pickerStyle: 'square', pickerModel: 'rgb', hueLock: true, valueLock: both })), process.argv[2] === 'both');
await page.reload({ waitUntil: 'load' });
// node check/huehold.mjs [both] [r,g,b] [rFrom,rTo]: the start colour and the R drag (fractions of the track)
const start = (process.argv[3] ?? '205,199,255').split(',').map(Number);
const rDrag = process.argv[4]?.split(',').map(Number);
await page.evaluate(([r, g, b]) => window.cspPicker.onCspColor({ r, g, b, index: 0, canSet: true }), start);
await new Promise((r) => setTimeout(r, 300));

const state = () => page.evaluate(() => {
  const hex = [...document.querySelectorAll('input')].find((i) => i.value.startsWith('#'))?.value ?? '';
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mx = Math.max(...c), d = mx - Math.min(...c);
  const k = !d ? null : mx === c[0] ? ((c[1] - c[2]) / d + 6) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  return { hex, rgb: c, hue: k === null ? null : +(k * 60).toFixed(2) };
});
const box = (sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, sel);
async function drag(b, [fx0, fy0], [fx1, fy1]) {
  await page.mouse.move(b.x + b.w * fx0, b.y + b.h * fy0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.w * (fx0 + ((fx1 - fx0) * i) / 6), b.y + b.h * (fy0 + ((fy1 - fy0) * i) / 6));
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 100));
}

console.log('start      ', await state());
await drag(await box('[data-area="rgb"]'), [0.2, 0.8], [0.9, 0.3]);
console.log('after area ', await state());
await drag(await box('[data-track="R"]'), [rDrag?.[0] ?? (process.argv[2] === 'both' ? 0.8 : 0.3), 0.5], [rDrag?.[1] ?? (process.argv[2] === 'both' ? 0.55 : 0.8), 0.5]);
console.log('after R    ', await state());
await browser.close();
close?.();
process.exit(0); // the static server keeps the process alive otherwise
