// The parts framework (1.1): Panel parts (switch, reorder, presets, slider sets), G, Small, grips, Previous.
// node check/framework.mjs — headless, mock bridge.
import assert from 'node:assert/strict';
import { launch, serve, DSF } from './lib.mjs';

const { srv, base } = await serve();
const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewport({ width: 340, height: 760, deviceScaleFactor: DSF });
const ok = (m) => console.log('ok  ', m);
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const open = async (q = '') => {
  await page.goto(`${base}/dist/index.html?status=connected&${q}`, { waitUntil: 'load' });
  await page.evaluate(() => window.cspPicker.onCspColor({ r: 217, g: 100, b: 74, index: 0, canSet: true }));
  await settle();
};
const calls = (fn) => page.evaluate((f) => (window.__bridgeCalls ?? []).filter((c) => c.fn === f).map((c) => c.args), fn);
const clear = () => page.evaluate(() => { window.__bridgeCalls.length = 0; });
const has = (sel) => page.$(sel).then(Boolean);
const menuItem = async (label) => {
  await page.evaluate((l) => [...document.querySelectorAll('[role^=menuitem]')].find((x) => x.textContent.trim().startsWith(l))?.click(), label);
  await settle(150);
};
const sheetToggle = (label) => page.evaluate((l) => [...document.querySelectorAll('.sheet [role=checkbox]')].find((b) => b.textContent.trim() === l).click(), label);

await page.goto(`${base}/dist/index.html`, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await open();

// 1. the defaults equal 1.0's Full panel
assert.ok(await has('.parea') && await has('div[data-n]') && await has('.phex'), 'Full: area, numbers, hex');
assert.ok(!(await has('.psliders')), 'no sliders part by default');
ok('Full layout defaults: style switch, area, numbers, holds, hex');

// 2. Panel parts: switch parts, slider sets, presets
await page.click('[aria-label="Palette menu"]'); await settle(150);
await menuItem('Panel parts');
assert.ok(await has('.sheet'), 'the sheet opens');
await sheetToggle('Number fields'); await sheetToggle('Sliders'); await settle();
assert.ok(!(await has('div[data-n]')) && await has('.psliders'), 'numbers off, sliders on');
await page.evaluate(() => [...document.querySelectorAll('.psets .cbtn')].find((b) => b.textContent === 'RGB').click()); await settle();
assert.equal(await page.$$eval('.pset', (l) => l.length), 2, 'two slider sets');
await page.evaluate(() => [...document.querySelectorAll('.presets .cbtn')].find((b) => b.textContent === 'Full').click()); await settle();
assert.ok(await has('div[data-n]') && !(await has('.psliders')), 'Full preset restores 1.0');
assert.equal(await page.$eval('.presets .cbtn[aria-pressed="true"]', (b) => b.textContent), 'Full');
ok('Panel parts: switching parts, two slider sets, the Full preset');

// 3. reorder: drag Hex's grip to the top of the list
const grip = await page.$eval('.prow[data-part="hex"] .pgrip', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
const top = await page.$eval('.prow[data-part="styles"]', (e) => e.getBoundingClientRect().top + 4);
await page.mouse.move(grip[0], grip[1]); await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(grip[0], grip[1] + ((top - grip[1]) * i) / 8);
await page.mouse.up(); await settle();
assert.equal(await page.$eval('.prow', (e) => e.dataset.part), 'hex', 'hex is first in the list');
await page.evaluate(() => [...document.querySelectorAll('.sheethead button')].find((b) => b.textContent === 'Done').click()); await settle();
assert.ok(!(await has('.sheet')));
assert.ok(await page.$eval('.parts', (p) => p.firstElementChild.classList.contains('phex') || !!p.firstElementChild.querySelector('input')), 'the panel shows hex first');
ok('reorder by dragging a grip; Done closes the sheet');

// 4. G greys the body, and stays on after a reload
await page.click('[aria-label="Grey check"]'); await settle();
assert.ok(await has('.body[data-grey]'));
await open();
assert.ok(await has('.body[data-grey]'), 'kept after reload');
await page.click('[aria-label="Grey check"]'); await settle();
assert.ok(!(await has('.body[data-grey]')));
ok('G: grey check on, kept, off');

// 5. Look → Small
await page.click('[aria-label="Palette menu"]'); await settle(150);
await menuItem('Look'); await menuItem('Small');
assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'small');
ok('Look → Small sets the small density');

// 6. grips: floating gets the top edge, docked doesn't, compact has no vertical edges
const edges = () => page.$$eval('.grip', (l) => l.map((g) => g.dataset.edge).sort().join(','));
await open('dock=float');
assert.ok((await edges()).includes('top'), 'float has a top grip');
await open('dock=left');
assert.ok(!(await edges()).includes('top'), 'docked has no top grip');
await open('dock=float&compact=1');
assert.ok(!/(^|,)(top|bottom)(,|$)/.test(await edges()), 'compact: width only');
ok('grips: top when floating, none when docked, width only in compact');

// 7. Previous: the colour before the last settled change; a tap goes back
await page.evaluate(() => localStorage.clear());
await open();
await settle(900); // #d9644a settles
await page.evaluate(() => window.cspPicker.onCspColor({ r: 59, g: 78, b: 140, index: 0, canSet: true }));
await settle(900);
const prev = await page.$eval('.prev', (b) => b.getAttribute('aria-label'));
assert.match(prev, /#d9644a/i);
await clear();
await page.click('.prev'); await settle();
assert.deepEqual((await calls('setColor')).pop(), [217, 100, 74]);
ok('Previous: shows the colour before, a tap sends it');

// 8. Compact: the sheet makes the window taller while it is open
await open('compact=1');
await settle(300);
const fit = async () => (await calls('frame')).map((a) => a[0]).filter((a) => a.startsWith('fit:')).map((a) => +a.slice(4)).pop();
const before = await fit();
await page.click('[aria-label="Palette menu"]'); await settle(150);
await menuItem('Panel parts'); await settle(300);
const during = await fit();
assert.ok(during > before, `fit grows with the sheet (${before} -> ${during})`);
ok(`compact: the window grows for the sheet (${before} -> ${during} px)`);

// 9. Keep shows Kept colours when it is off, and ⋯ saves the steps when nothing is kept
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('cspPicker.parts', JSON.stringify({ full: { order: ['area', 'gradient', 'kept', 'hex', 'styles', 'numbers', 'sliders', 'holds', 'recent', 'tints', 'harmonies'], on: ['area', 'gradient', 'hex'] } })); });
await open();
await page.evaluate(() => window.cspPicker.onSubColor({ r: 59, g: 78, b: 140 })); await settle();
await clear();
await page.click('[aria-label="Gradient options"]'); await settle(150);
await menuItem('Save colour set');
const saved = (await calls('save')).pop();
assert.ok(saved && Buffer.from(saved[2], 'base64').readUInt16BE(2) >= 3, 'nothing kept: ⋯ saves the steps');
assert.ok(!(await has('.kept')), 'Kept is off');
await page.evaluate(() => [...document.querySelectorAll('.ghead button')].find((b) => b.textContent === 'Keep').click()); await settle();
assert.ok(await has('.kept') && (await page.$$('.krow')).length === 1, 'Keep switched Kept colours on');
ok('Keep shows Kept colours; ⋯ Save colour set works with nothing kept');

assert.deepEqual(errors, [], errors.join('; '));
ok('no console errors');
console.log('PASS');
await browser.close();
srv.close();
process.exit(0);
