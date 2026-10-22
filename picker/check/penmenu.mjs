// The ≡ menu under a pen (the S Pen reports hover): hovering a row must not open its submenu, a tap must.
// A mouse still opens submenus on hover. node check/penmenu.mjs
import { launch, serve } from './lib.mjs';

const { base, close } = await serve();
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 320, height: 700 });
await page.goto(`${base}/dist/index.html?display=popup&dock=float&theme=dark`, { waitUntil: 'load' });
const cdp = await page.createCDPSession();
const at = (sel, text) => page.evaluate((s, t) => {
  const e = [...document.querySelectorAll(s)].find((x) => !t || x.textContent.trim().startsWith(t));
  const b = e.getBoundingClientRect();
  return [b.x + b.width / 2, b.y + b.height / 2];
}, sel, text);
const send = (type, [x, y], pointerType, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, pointerType, button: 'none', ...extra });
const tap = async (pt, pointerType) => {
  await send('mouseMoved', pt, pointerType);
  await send('mousePressed', pt, pointerType, { button: 'left', clickCount: 1 });
  await send('mouseReleased', pt, pointerType, { button: 'left', clickCount: 1 });
};
const submenuOpen = () => page.evaluate(() => [...document.querySelectorAll('[role^=menuitem]')].some((x) => x.textContent.trim().startsWith('Wheel')));
const settle = () => new Promise((r) => setTimeout(r, 400));

const results = {};
for (const pointerType of ['pen', 'mouse']) {
  await tap(await at('[aria-label="Palette menu"]'), pointerType);
  await settle();
  const style = await at('[role^=menuitem]', 'Style');
  for (let i = 0; i < 4; i++) await send('mouseMoved', [style[0] - 20 + i * 10, style[1]], pointerType); // hover across the row
  await settle();
  results[`${pointerType}: hover opens Style`] = await submenuOpen();
  await tap(style, pointerType);
  await settle();
  results[`${pointerType}: tap opens Style`] = await submenuOpen();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await settle();
}
console.log(results);
const ok = results['pen: hover opens Style'] === false && results['pen: tap opens Style'] === true && results['mouse: hover opens Style'] === true;
console.log(ok ? 'PASS' : 'FAIL');
await browser.close();
close?.();
process.exit(ok ? 0 : 1);
