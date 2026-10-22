// Screenshots of dist/index.html (mock bridge) over the reference CSP screenshot, headless, at the tablet's 2.125 DPR.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DSF, launch, root, serve } from './lib.mjs';

const out = path.join(root, 'shots');
mkdirSync(out, { recursive: true });
const { srv, base } = await serve();
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1205, height: 753, deviceScaleFactor: DSF });

// win: where the WebView window sits in CSP's screen (CSS px)
const SHOTS = [
  { name: 'tab-docked', q: 'display=tab&dock=left', win: [42, 78, 300, 675], flat: true },
  { name: 'popup', q: 'display=popup&dock=left', win: [62, 120, 300, 610] },
  { name: 'floating', q: 'display=popup&dock=float', win: [520, 110, 320, 610] },
  { name: 'floating-minimized', q: 'display=popup&dock=float&minimized=1', win: [520, 110, 320, 32 + 2] },
];

async function shoot(name, q, win, flat, theme, after) {
  await page.goto(`${base}/check/stage.html`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((light) => document.body.classList.toggle('light', light), theme === 'light');
  await page.evaluate((win, flat, src) => {
    const f = document.getElementById('win');
    f.className = flat ? 'flat' : '';
    Object.assign(f.style, { left: win[0] + 'px', top: win[1] + 'px', width: win[2] + 'px', height: win[3] + 'px' });
    f.src = src;
    return new Promise((ok) => (f.onload = ok));
  }, win, flat, `/dist/index.html?${q}&theme=${theme}`);
  const frame = page.frames().find((f) => f.url().includes('dist/index.html'));
  await frame.evaluate(() => window.cspPicker.onCspColor({ r: 18, g: 52, b: 86, index: 0, canSet: true }) || window.cspPicker.onSubColor({ r: 255, g: 232, b: 170 }));
  await new Promise((r) => setTimeout(r, 400));
  if (after) await after(frame);
  await page.screenshot({ path: path.join(out, `${name}-${theme}.png`) });
  console.log('shot', `${name}-${theme}.png`);
}

for (const theme of ['dark', 'light']) {
  for (const s of SHOTS) await shoot(s.name, s.q, s.win, s.flat, theme);
  // the ≡ menu open, then its Look submenu (tapped through CDP touch in the iframe's own page, never the real pointer)
  await shoot('menu-open', 'display=popup&dock=float', [520, 110, 320, 610], false, theme, async (f) => {
    await f.evaluate(() => document.querySelector('[aria-label="Palette menu"]').click());
    await new Promise((r) => setTimeout(r, 300));
  });
  // other picker styles in the popup
  for (const style of ['square', 'sliders', 'oklch']) {
    await shoot(`style-${style}`, 'display=popup&dock=float', [520, 110, 320, 600], false, theme, async (f) => {
      await f.evaluate((st) => { localStorage.setItem('cspPicker.settings', JSON.stringify({ pickerStyle: st, pickerModel: 'rgb' })); }, style);
      await f.evaluate(() => location.reload());
      await new Promise((r) => setTimeout(r, 800));
      const g = page.frames().find((x) => x.url().includes('dist/index.html'));
      await g.evaluate(() => window.cspPicker.onCspColor({ r: 18, g: 52, b: 86, index: 0, canSet: true }));
      await new Promise((r) => setTimeout(r, 300));
    });
  }
  // restore the default style for the next theme's runs
}

// ── compact mode: 200 CSS px wide, as tall as each style naturally is ──
const W = 200;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function natural(style, extra = '') {
  const p = await browser.newPage();
  await p.setViewport({ width: W, height: 900, deviceScaleFactor: DSF });
  await p.goto(`${base}/dist/index.html?compact=1&display=popup&dock=float&theme=dark${extra}`, { waitUntil: 'load' });
  await p.evaluate((st) => localStorage.setItem('cspPicker.settings', JSON.stringify({ pickerStyle: st, pickerModel: 'hsb' })), style);
  await p.reload({ waitUntil: 'load' });
  await p.evaluate(() => window.cspPicker.onCspColor({ r: 18, g: 52, b: 86, index: 0, canSet: true }));
  await settle(300);
  const h = await p.evaluate(() => {
    const t = (q) => document.querySelector(q);
    const body = t('.cbody'), cs = getComputedStyle(body);
    return Math.ceil(t('.title').offsetHeight + t('.cin').offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + t('.cstrip').offsetHeight);
  });
  await p.close();
  return h;
}
const heights = {};
for (const st of ['wheel', 'square', 'oklch', 'sliders']) heights[st] = await natural(st);
console.log('natural compact heights at 200px (connected):', JSON.stringify(heights));
console.log('status row adds', (await natural('wheel', '&status=unpaired')) - heights.wheel, 'px');
async function compactShot(name, style, theme, status, busy, more = {}) {
  const H = heights[style] + (status || busy || more.arm ? 32 : 0);
  await shoot(name, `display=popup&dock=float&compact=1&eyedropper=poly${status ? '&status=' + status : ''}`, [520, 110, W, H], false, theme, async (f) => {
    await f.evaluate((st, extra) => localStorage.setItem('cspPicker.settings', JSON.stringify({ pickerStyle: st, pickerModel: 'hsb', ...extra })), style, more.settings ?? {});
    await f.evaluate(() => location.reload());
    await settle(800);
    const g = page.frames().find((x) => x.url().includes('dist/index.html'));
    await g.evaluate((busy) => { window.cspPicker.onCspColor({ r: 18, g: 52, b: 86, index: 0, canSet: !busy }); window.cspPicker.onSubColor({ r: 255, g: 232, b: 170 }); }, busy);
    await settle(300);
    if (more.arm) { await g.evaluate(() => document.querySelector('[aria-label="Eyedropper"]').click()); await settle(300); }
  });
}
for (const st of ['wheel', 'square', 'oklch', 'sliders']) await compactShot('compact-' + st, st, 'dark');
await compactShot('compact-wheel', 'wheel', 'light');
await compactShot('compact-busy', 'wheel', 'dark', null, true);
await compactShot('compact-unpaired', 'wheel', 'dark', 'unpaired');
await compactShot('compact-holdvalue', 'wheel', 'dark', null, false, { settings: { valueLock: true } });
await compactShot('compact-eyedropper', 'wheel', 'dark', null, false, { arm: true });
await browser.close();
srv.close();
