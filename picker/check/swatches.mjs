// Recent / Tints / Harmonies: screenshots in Full and Compact, taps reach CSP: node check/swatches.mjs <outdir>
import { mkdirSync } from 'node:fs';
import { launch, serve, DSF } from './lib.mjs';

const out = process.argv[2] ?? 'shots/swatches';
mkdirSync(out, { recursive: true });
const ALL = ['styles', 'area', 'numbers', 'sliders', 'holds', 'hex', 'recent', 'tints', 'harmonies', 'gradient', 'kept'];
const ON = ['recent', 'tints', 'harmonies'];
const HIST = ['#d9644a', '#3b4e8c', '#f2d1a8', '#7a3b2e', '#e8b04a', '#223344', '#88aa66', '#ccbbdd', '#101010', '#fafafa', '#c0392b', '#2980b9', '#27ae60'];
const CASES = [
  { name: 'full', q: '', w: 340, h: 800, parts: { full: { order: ALL, on: ON } } },
  { name: 'compact', q: 'compact=1', w: 260, h: 700, parts: { compact: { order: ALL, on: ON } } },
  { name: 'narrow-200', q: 'compact=1', w: 200, h: 700, parts: { compact: { order: ALL, on: ON } } },
  { name: 'empty-grey', q: '', w: 340, h: 800, parts: { full: { order: ALL, on: ON } }, hist: [], rgb: [128, 128, 128] },
];
const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };

const { srv, base } = await serve();
const browser = await launch();
const errors = [];
for (const c of CASES) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`${c.name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${c.name}: ${m.text()}`));
  await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: DSF });
  await page.goto(`${base}/dist/index.html`, { waitUntil: 'load' });
  await page.evaluate((c, HIST) => {
    localStorage.clear();
    localStorage.setItem('cspPicker.parts', JSON.stringify(c.parts));
    localStorage.setItem('cspPicker.history', JSON.stringify(c.hist ?? HIST));
  }, c, HIST);
  await page.goto(`${base}/dist/index.html?${c.q}&status=connected`, { waitUntil: 'load' });
  const [r, g, b] = c.rgb ?? [217, 100, 74];
  await page.evaluate((r, g, b) => window.cspPicker.onCspColor({ r, g, b, index: 0, canSet: true }), r, g, b);
  await new Promise((x) => setTimeout(x, 400));

  const rows = await page.evaluate(() => ({
    recent: document.querySelectorAll('[aria-label="Recent colours"] .chip').length,
    tints: document.querySelectorAll('[aria-label="Tints"] .chip').length,
    harm: document.querySelectorAll('.hrow').length,
    empty: document.body.textContent.includes('Colours you use show here'),
    over: document.documentElement.scrollWidth > innerWidth,
    minChip: Math.min(...[...document.querySelectorAll('.chip')].map((e) => Math.round(e.getBoundingClientRect().height))),
  }));
  const hn = (c.hist ?? HIST).length;
  expect(rows.tints === 9, `${c.name}: tints ${rows.tints}`);
  expect(rows.harm === 5, `${c.name}: harmony rows ${rows.harm}`);
  expect(rows.recent === Math.min(12, hn), `${c.name}: recent ${rows.recent}`);
  expect(rows.empty === !hn, `${c.name}: empty note`);
  expect(!rows.over, `${c.name}: horizontal overflow`);
  console.log(c.name.padEnd(12), JSON.stringify(rows));

  if (c.name === 'full') {
    const tap = async (sel, i) => {
      await page.evaluate(() => (window.__bridgeCalls.length = 0));
      const col = await page.evaluate((sel, i) => {
        const el = document.querySelectorAll(`${sel} .chip`)[i];
        const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        cx.fillStyle = getComputedStyle(el).backgroundColor; // the browser resolves oklch() for us
        cx.fillRect(0, 0, 1, 1);
        el.click();
        return [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      }, sel, i);
      await new Promise((x) => setTimeout(x, 300));
      const call = await page.evaluate(() => window.__bridgeCalls.filter((x) => x.fn === 'setColor').pop());
      const got = call?.args;
      expect(got && got.every((v, k) => Math.abs(v - col[k]) <= 1), `${sel}[${i}]: setColor ${JSON.stringify(got)} vs ${JSON.stringify(col)}`);
    };
    await tap('[aria-label="Tints"]', 6);
    await tap('[aria-label="Recent colours"]', 3);
  }
  await page.screenshot({ path: `${out}/${c.name}.png` });
  await page.close();
}
expect(!errors.length, `console errors: ${errors.join(' | ')}`);
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'PASS');
await browser.close();
srv.close();
process.exit(fails.length ? 1 : 0);
