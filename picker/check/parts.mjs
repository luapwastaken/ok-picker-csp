// Screenshots of the parts layouts (mock bridge), and the console errors: node check/parts.mjs [outdir]
// Each case: a localStorage state, a query string and a viewport, like the tablet's window at its DPR.
import { mkdirSync } from 'node:fs';
import { launch, serve, DSF } from './lib.mjs';

const out = process.argv[2] ?? 'shots/parts';
mkdirSync(out, { recursive: true });
const ALL = ['styles', 'area', 'numbers', 'sliders', 'holds', 'hex', 'recent', 'tints', 'harmonies', 'gradient', 'kept'];
const lay = (on) => ({ order: ALL, on });
const CASES = [
  { name: 'full-default', q: '', w: 340, h: 640 },
  { name: 'full-tall', q: '', w: 340, h: 900 },
  { name: 'full-wheel-tall', q: '', w: 340, h: 900, style: 'wheel' },
  { name: 'compact-default', q: 'compact=1', w: 260, h: 520 },
  { name: 'sheet-full', q: 'sheet=1', w: 340, h: 640, parts: { full: lay(['styles', 'area', 'sliders', 'holds', 'hex']), sliderSets: ['oklch', 'rgb'] } },
  { name: 'sliders-two-sets', q: '', w: 340, h: 760, parts: { full: lay(['area', 'sliders', 'holds', 'hex']), sliderSets: ['oklch', 'rgb'] } },
  { name: 'compact-sliders', q: 'compact=1', w: 260, h: 600, parts: { compact: lay(['area', 'sliders', 'holds', 'hex']), sliderSets: ['oklch'] } },
  { name: 'grey', q: '', w: 340, h: 640, parts: { grey: true } },
  { name: 'small', q: 'density=small', w: 260, h: 600 },
  { name: 'narrow-200', q: '', w: 200, h: 600 },
  { name: 'full-everything', q: '', w: 340, h: 1500, parts: { full: lay(ALL), sliderSets: ['oklch'] } },
  { name: 'compact-everything', q: 'compact=1', w: 260, h: 1500, parts: { compact: lay(ALL), sliderSets: ['oklch'] } },
];

const { srv, base } = await serve();
const browser = await launch();
const errors = [];
for (const c of CASES) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`${c.name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${c.name}: ${m.text()}`));
  await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: DSF });
  await page.goto(`${base}/dist/index.html`, { waitUntil: 'load' });
  await page.evaluate((c) => {
    localStorage.clear();
    if (c.parts) localStorage.setItem('cspPicker.parts', JSON.stringify(c.parts));
    localStorage.setItem('cspPicker.history', JSON.stringify(['#d9644a', '#3b4e8c', '#f2d1a8', '#7a3b2e', '#e8b04a']));
  }, c);
  await page.goto(`${base}/dist/index.html?${c.q}&status=connected`, { waitUntil: 'load' });
  await page.evaluate((style) => {
    window.cspPicker.onCspColor({ r: 217, g: 100, b: 74, index: 0, canSet: true });
    window.cspPicker.onSubColor({ r: 59, g: 78, b: 140 });
    window.cspPicker.onCspColor({ r: 217, g: 100, b: 74, index: 0, canSet: true });
    if (style) document.querySelector(`[role=radio][aria-label="${style[0].toUpperCase() + style.slice(1)}"], button[title="${style}"]`)?.click();
  }, c.style);
  if (c.style) { // through the menu, as a user would
    await page.click('[aria-label="Palette menu"]');
    await page.evaluate(() => [...document.querySelectorAll('[role^=menuitem]')].find((x) => x.textContent.trim().startsWith('Style'))?.click());
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate((st) => [...document.querySelectorAll('[role^=menuitem]')].find((x) => x.textContent.trim().toLowerCase().startsWith(st))?.click(), c.style);
  }
  await new Promise((r) => setTimeout(r, 400));
  const fit = await page.evaluate(() => (window.__bridgeCalls ?? []).filter((x) => x.fn === 'frame' && String(x.args[0]).startsWith('fit:')).map((x) => x.args[0]).pop());
  await page.screenshot({ path: `${out}/${c.name}.png` });
  console.log(c.name.padEnd(18), fit ?? '');
  await page.close();
}
console.log('errors', errors);
await browser.close();
srv.close();
process.exit(errors.length ? 1 : 0);
