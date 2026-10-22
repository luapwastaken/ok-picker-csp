// Headless check of the Gradient / Ramp and Kept parts: node check/gradient.mjs [outdir]
import { mkdirSync } from 'node:fs';
import { launch, serve, DSF, root } from './lib.mjs';
import path from 'node:path';
import { build } from 'esbuild';

// the pure maths, bundled on the spot (its dt: imports point at Design Tools' source)
const DT = process.env.DESIGNTOOLS_DIR ?? 'D:/stuff/!projects/Design tool/designtools/designtools';
const bundled = await build({
  entryPoints: [path.join(root, 'src/parts/gradient-math.ts')], bundle: true, write: false, format: 'esm', platform: 'node',
  nodePaths: [path.join(root, 'node_modules')],
  plugins: [{ name: 'dt', setup: (b) => b.onResolve({ filter: /^dt:/ }, (a) => ({ path: path.join(DT, 'src', a.path.slice(3)) })) }],
});
const { mixAt, bias, stepsOf, hueTurn } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const out = process.argv[2] ?? 'shots/gradient';
mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (name, cond, info = '') => { console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : info); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── maths (needs the DT imports to resolve, so it runs inside the built page instead if the import above fails)
const ALL = ['styles', 'area', 'numbers', 'sliders', 'holds', 'hex', 'recent', 'tints', 'harmonies', 'gradient', 'kept'];
const parts = (compact) => ({ [compact ? 'compact' : 'full']: { order: ALL, on: ['area', 'gradient', 'kept', 'hex'] } });

const { srv, base } = await serve();
const browser = await launch();
const errors = [];

async function open(w, h, compact) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewport({ width: w, height: h, deviceScaleFactor: DSF });
  await page.goto(`${base}/dist/index.html`, { waitUntil: 'load' });
  await page.evaluate((st) => { localStorage.clear(); localStorage.setItem('cspPicker.parts', JSON.stringify(st)); }, parts(compact));
  await page.goto(`${base}/dist/index.html?${compact ? 'compact=1&' : ''}status=connected`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.cspPicker.onCspColor({ r: 217, g: 100, b: 74, index: 0, canSet: true });
    window.cspPicker.onSubColor({ r: 59, g: 78, b: 140 });
  });
  await wait(400);
  return page;
}
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const menuPick = async (page, text) => {
  await page.evaluate((t) => [...document.querySelectorAll('[role^=menuitem]')].find((x) => x.textContent.trim().startsWith(t))?.click(), text);
  await wait(150);
};
const calls = (page, fn) => page.evaluate((f) => (window.__bridgeCalls ?? []).filter((c) => c.fn === f), fn);
const hex = (r, g, b) => '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
const endsOf = (page) => page.evaluate(() => [...document.querySelectorAll('.gend')].map((e) => getComputedStyle(e).backgroundColor));

for (const [name, w, h, compact] of [['full', 340, 900, false], ['compact', 260, 800, true]]) {
  const page = await open(w, h, compact);
  const bar = await page.$('.gbar');
  ok(`${name}: bar present`, !!bar);
  const ends0 = await endsOf(page);

  // drag along the bar
  const bb = await bar.boundingBox();
  const n0 = (await calls(page, 'setColor')).length;
  await page.mouse.move(bb.x + bb.width * 0.1, bb.y + bb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(bb.x + bb.width * (0.1 + i * 0.1), bb.y + bb.height / 2);
  await page.mouse.up();
  await wait(200);
  const n1 = (await calls(page, 'setColor')).length;
  ok(`${name}: drag sends colours`, n1 - n0 >= 5, `sent ${n1 - n0}`);
  ok(`${name}: marker shown`, !!(await page.$('.gmark')));
  await page.screenshot({ path: `${out}/${name}-gradient.png` });

  // tap a step
  const chips = await page.$$('.grows .chip');
  const chip = chips[1];
  const want = await chip.evaluate((e) => e.getAttribute('aria-label'));
  await chip.evaluate((e) => e.click());
  await wait(200);
  const last = (await calls(page, 'setColor')).pop().args;
  ok(`${name}: tap sends the step`, hex(...last) === want, `${last} vs ${want}`);
  ok(`${name}: ends stayed pinned`, JSON.stringify(await endsOf(page)) === JSON.stringify(ends0), `${ends0} -> ${await endsOf(page)}`);

  // options menu: steps 12 wraps into rows, path long, swap
  await click(page, '[aria-label="Gradient options"]');
  await wait(150);
  await menuPick(page, 'Steps');
  await menuPick(page, '12');
  ok(`${name}: 12 steps`, (await page.$$('.grows .chip')).length === 12);
  await page.screenshot({ path: `${out}/${name}-gradient-12.png` });
  await click(page, '[aria-label="Gradient options"]');
  await wait(150);
  await menuPick(page, 'Swap ends');
  const swapped = await endsOf(page);
  ok(`${name}: swap ends`, swapped[0] === ends0[1] && swapped[1] === ends0[0]);

  // keep a gradient, then a ramp
  await page.evaluate(() => [...document.querySelectorAll('.ghead .gbtn')].find((b) => b.textContent === 'Keep').click());
  await page.evaluate(() => document.querySelector('[role=radio]:last-child').click());
  await wait(200);
  ok(`${name}: ramp chips`, (await page.$$('.grows .chip')).length === 5);
  ok(`${name}: ramp value strip`, (await page.$$('.gstrip i')).length === 5);
  await page.screenshot({ path: `${out}/${name}-ramp.png` });
  await page.evaluate(() => [...document.querySelectorAll('.ghead .gbtn')].find((b) => b.textContent === 'Keep').click());
  await wait(200);
  const names = await page.evaluate(() => [...document.querySelectorAll('.kname')].map((e) => e.textContent));
  ok(`${name}: kept rows`, names.join() === 'Gradient 1,Ramp 1', names.join());
  await page.screenshot({ path: `${out}/${name}-kept.png`, fullPage: true });

  // export
  await page.evaluate(() => [...document.querySelectorAll('.kept .gwide')].find((b) => b.textContent.startsWith('Export')).click());
  await wait(200);
  const sh = (await calls(page, 'share')).pop();
  const bytes = sh ? Buffer.from(sh.args[2], 'base64') : Buffer.alloc(0);
  ok(`${name}: export header`, !!sh && sh.args[0] === 'OK Picker colours.aco' && bytes.length > 4 && bytes[0] === 0 && bytes[1] === 1, JSON.stringify(sh?.args.slice(0, 2)));
  ok(`${name}: export holds both rows`, bytes.length > 0 && bytes.readUInt16BE(2) === 17, `count ${bytes.length ? bytes.readUInt16BE(2) : '-'}`);

  // remove with a second tap
  await click(page, '.kx');
  ok(`${name}: first tap only asks`, (await page.$$('.krow')).length === 2);
  await click(page, '.kx');
  await wait(100);
  ok(`${name}: second tap removes`, (await page.$$('.krow')).length === 1);
  await page.close();
}

// maths, in the page's own module graph is overkill: the functions are pure, so test them here via esbuild-free import
try {
  const near = (x, y, e = 1e-6) => Math.abs(x - y) < e;
  const red = [0.63, 0.25, 29], blue = [0.45, 0.31, 264];
  const lab = mixAt(red, blue, 0.5, 'lab');
  ok('math: lab midpoint L is the mean', near(lab[0], 0.54, 1e-9));
  ok('math: ends are exact in sRGB', near(mixAt([0.6, 0.1, 40], [0.4, 0.1, 200], 0, 'short')[0], 0.6) && near(mixAt([0.6, 0.1, 40], [0.4, 0.1, 200], 1, 'short')[2], 200, 1e-6));
  const [h0, ts] = hueTurn([0.5, 0.1, 350], [0.5, 0.1, 10], 'short'), [, tl] = hueTurn([0.5, 0.1, 350], [0.5, 0.1, 10], 'long');
  ok('math: short hue goes through 0', h0 === 350 && ts === 20, `${ts}`);
  ok('math: long hue goes the other way', tl === -340, `${tl}`);
  ok('math: grey end takes the other hue', hueTurn([0.5, 0, 0], [0.5, 0.1, 120], 'short')[0] === 120);
  ok('math: bias m=0.5 is linear', near(bias(0.3, 0.5), 0.3));
  ok('math: bias puts the middle at m', near(bias(0.3, 0.3), 0.5) && near(bias(1, 0.3), 1) && near(bias(0, 0.3), 0));
  ok('math: steps include both ends', stepsOf(red, blue, 5, 'lab').length === 5);
} catch (e) { ok('math', false, String(e)); }

ok('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
srv.close();
console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
