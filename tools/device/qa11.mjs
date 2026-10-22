// Device QA for 1.1 (qa build: debuggable). Real touches through adb, state read over WebView DevTools.
//   TABLET=<ip:port> node qa11.mjs [shots dir]      (adb forward tcp:9333 localabstract:webview_devtools_remote_<pid> first)
// Only the panel is touched. Every pick is checked against CSP itself: the status strip's main box changes only when
// CSP reports the colour back. The panel's parts, layout and size are put back as they were at the end.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(new URL('../../picker/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
if (!process.env.TABLET) throw new Error('set TABLET=<ip:port> (adb devices)');
const ADB = `"${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe" -s ${process.env.TABLET}`;
const SHOTS = process.argv[2] ?? 'shots/qa11';
fs.mkdirSync(SHOTS, { recursive: true });
const sh = (c) => execSync(`${ADB} shell "${c}"`, { env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DPR = 2.125;
const shot = (name) => fs.writeFileSync(`${SHOTS}/${name}.png`, execSync(`${ADB} exec-out screencap -p`, { maxBuffer: 64 << 20 }));
function frames() {
  const blocks = sh('dumpsys window windows').split(/Window #\d+ /).filter((b) => /^Window\{[0-9a-f]+ u0 com\.luap\.okpicker\}/.test(b));
  const f = blocks.map((b) => { const m = b.match(/ frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); const v = b.match(/mViewVisibility=(0x[0-9a-f]+)/); return { x: +m[1], y: +m[2], w: m[3] - m[1], h: m[4] - m[2], visible: v?.[1] === '0x0' }; })
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const icon = f.find((x) => x.w === x.h && x.w < 120) ?? f[1];
  return { panel: f.find((x) => x !== icon), icon };
}
const focus = () => sh('dumpsys window | grep mCurrentFocus').trim();

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const [page] = await browser.pages();
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(ok ? 'ok  ' : 'FAIL', name, detail); };

/** an element's centre on screen; scrolled into view first; refuses when the panel is not on screen */
async function at(sel, dx = 0.5, dy = 0.5) {
  const r = await ev((s) => {
    const e = typeof s === 'string' ? document.querySelector(s) : null;
    if (!e) return null;
    e.scrollIntoView({ block: 'center', inline: 'nearest' });
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel);
  if (!r) throw new Error(`no ${sel}`);
  await sleep(150);
  const { panel } = frames();
  if (!panel.visible) throw new Error('the panel is not visible; refusing to touch');
  const x = Math.round(panel.x + (r.x + r.w * dx) * DPR), y = Math.round(panel.y + (r.y + r.h * dy) * DPR);
  if (x < panel.x || x > panel.x + panel.w || y < panel.y || y > panel.y + panel.h) throw new Error(`${sel} is outside the panel`);
  return [x, y];
}
const tap = async (sel, wait = 500) => { const [x, y] = await at(sel); sh(`input tap ${x} ${y}`); await sleep(wait); };
/** tap the n-th match of a selector (marks it first so at() can find it) */
const tapNth = async (sel, n, wait = 700) => {
  await ev((s, i) => { document.querySelectorAll('[data-qa]').forEach((e) => e.removeAttribute('data-qa')); document.querySelectorAll(s)[i]?.setAttribute('data-qa', '1'); }, sel, n);
  await tap('[data-qa="1"]', wait);
};
const tapText = async (sel, text, wait = 500) => {
  await ev((s, t) => { document.querySelectorAll('[data-qa]').forEach((e) => e.removeAttribute('data-qa')); [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t))?.setAttribute('data-qa', '1'); }, sel, text);
  await tap('[data-qa="1"]', wait);
};
const menuItem = (label) => tapText('[role^=menuitem]', label, 450);
/** CSP's main colour as the panel last heard it from CSP */
// both as sRGB bytes: the swatches are painted with oklch(), the box with rgb()
const RGB = `(col) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = col; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(','); }`;
const cspMain = () => ev(`(${RGB})(getComputedStyle(document.querySelector('.status .boxes .main')).backgroundColor)`);
const bg = (sel, n) => ev(`(${RGB})(getComputedStyle(document.querySelectorAll(${JSON.stringify(sel)})[${n}]).backgroundColor)`);
/** equal within a byte per channel (CSS paints oklch() and CSP rounds) */
const near = (a, b) => !!a && !!b && a.split(',').every((v, i) => Math.abs(v - b.split(',')[i]) <= 1);

// --- keep the user's setup to put back at the end
const saved = await ev(() => ({ parts: localStorage.getItem('cspPicker.parts'), compact: localStorage.getItem('cspPicker.compact'), density: localStorage.getItem('cspPicker.density') }));
const before = frames();
check('panel on screen and connected', before.panel.visible && (await ev(() => document.querySelector('.status .st').textContent)).includes('Connected'));

try {
  // 1. Panel parts: open, switch the new parts on, Done
  await tap('[aria-label="Palette menu"]');
  await menuItem('Panel parts');
  check('Panel parts opens', await ev(() => !!document.querySelector('.sheet')));
  shot('01-sheet');
  for (const label of ['Sliders', 'Recent colours', 'Tints', 'Harmonies', 'Gradient and ramp', 'Kept colours']) await tapText('.sheet [role=checkbox]', label, 350);
  const on = await ev(() => [...document.querySelectorAll('.sheet [role=checkbox][aria-checked=true]')].map((b) => b.textContent.trim()));
  check('six parts switched on by touch', on.length === 11, on.join(', '));
  await tapText('.sheethead button', 'Done', 600);
  check('Done closes the sheet', await ev(() => !document.querySelector('.sheet')));
  shot('02-all-parts');

  // 2. gradient: drag along the bar, CSP follows
  await tapText('.gswitch button', 'Gradient', 900); // the part remembers its mode
  const g0 = await ev(() => [...document.querySelectorAll('.gend')].map((e) => getComputedStyle(e.querySelector('.gdot') ?? e).backgroundColor));
  const [bx, by] = await at('.gbar', 0.1);
  const [ex] = await at('.gbar', 0.7);
  sh(`input swipe ${bx} ${by} ${ex} ${by} 700`); await sleep(1200);
  const hexNow = await ev(() => document.querySelector('.phex input, .crow1 input')?.value);
  const main1 = await cspMain();
  check('gradient drag: CSP took the mixed colour', !!hexNow, `panel ${hexNow}, CSP ${main1}`);
  // 3. tap a step: CSP gets exactly that step
  const stepSel = '[aria-label^="Gradient steps"] .chip';
  const want = await bg(stepSel, 1);
  await tapNth(stepSel, 1, 1200);
  check('gradient step tap: CSP has that step', near(await cspMain(), want), `${want} vs ${await cspMain()}`);
  const g1 = await ev(() => [...document.querySelectorAll('.gend')].map((e) => getComputedStyle(e.querySelector('.gdot') ?? e).backgroundColor));
  check('gradient ends stay put after picking', JSON.stringify(g0) === JSON.stringify(g1), JSON.stringify(g1));
  shot('03-gradient');

  // 4. Keep, then Ramp mode: tap a ramp step, Keep
  await tapText('button', 'Keep', 700);
  await tapText('.gswitch button', 'Ramp', 900);
  shot('04-ramp');
  const rampSel = '[aria-label^="Ramp steps"] .chip';
  const rampWant = await bg(rampSel, 1);
  await tapNth(rampSel, 1, 1200);
  check('ramp step tap: CSP has that step', near(await cspMain(), rampWant), rampWant);
  await tapText('button', 'Keep', 700);
  const keptRows = await ev(() => document.querySelectorAll('.krow').length);
  check('Kept has the gradient and the ramp', keptRows >= 2, `${keptRows} rows`);

  // 5. Export: the share sheet opens with the colour set, then Back
  await tapText('button', 'Export', 2000);
  const f = focus();
  check('Export opens the share sheet', /chooser|Chooser|Resolver|sharesheet|ShareSheet|intentresolver/i.test(f), f);
  shot('05-share');
  sh('input keyevent KEYCODE_BACK'); await sleep(1500);
  check('Back returns to CSP', /clipstudiopaint/.test(focus()), focus());

  // 6. Recent, Tints, Harmonies, Previous: each tap reaches CSP
  for (const [name, sel, n] of [['recent', '[aria-label="Recent colours"] .chip', 2], ['tints', '[aria-label="Tints"] .chip', 6], ['harmonies', '.hrow .chip', 1]]) {
    const count = await ev((s) => document.querySelectorAll(s).length, sel);
    if (count <= n) { check(`${name}: swatches`, false, `${count} found`); continue; }
    const w = await bg(sel, n);
    await tapNth(sel, n, 1200);
    check(`${name} tap: CSP has that colour`, near(await cspMain(), w), w);
  }
  await sleep(900); // let the last pick settle so Previous has something
  const prevWant = await bg('.prev', 0);
  await tap('.prev', 1200);
  check('previous colour tap: CSP has it', near(await cspMain(), prevWant), prevWant);
  shot('06-swatches');

  // 7. performance with everything on: page work per CSP colour report
  const ms = await ev(async () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) { window.cspPicker.onCspColor({ r: 40 + i * 9, g: 120, b: 200 - i * 5, index: 0, canSet: true }); await new Promise((r) => requestAnimationFrame(() => r())); }
    return (performance.now() - t0) / 20;
  });
  check('a CSP colour report with every part on renders within a frame', ms < 33, `${ms.toFixed(1)} ms each (incl. a frame wait)`);

  // 8. G and Small
  await tap('[aria-label="Grey check"]', 600);
  check('G greys the panel', await ev(() => !!document.querySelector('.body[data-grey]')));
  shot('07-grey');
  await tap('[aria-label="Grey check"]', 400);
  await tap('[aria-label="Palette menu"]'); await menuItem('Look'); await menuItem('Small');
  check('Look → Small', await ev(() => document.documentElement.dataset.density === 'small'));
  shot('08-small');
  await tap('[aria-label="Palette menu"]'); await menuItem('Look'); await menuItem('Regular');

  // 9. Compact: the window fits its parts; the sheet makes it taller while open
  await tap('[aria-label="Compact panel"]', 1200);
  const c0 = frames().panel;
  shot('09-compact');
  await tap('[aria-label="Palette menu"]'); await menuItem('Panel parts'); await sleep(800);
  const c1 = frames().panel;
  check('compact: the window grows for the sheet', c1.h > c0.h, `${c0.h} -> ${c1.h}`);
  await tapText('.sheethead button', 'Done', 800);
  await tap('[aria-label="Full panel"]', 1200);

  // 10. a floating panel resizes from its top edge (the bottom stays put)
  const p0 = frames();
  const [tx, ty] = await at('.title', 0.4, 0.5);
  sh(`input swipe ${tx} ${ty} ${tx - 260} ${ty + 120} 600`); await sleep(900); // away from the square: floats
  const p1 = frames().panel;
  const [gx, gy] = await at('.grip[data-edge="top"]', 0.5, 0.5);
  sh(`input swipe ${gx} ${gy} ${gx} ${gy - 90} 600`); await sleep(900);
  const p2 = frames().panel;
  check('top grip: taller, bottom unchanged', p2.h > p1.h + 40 && Math.abs((p2.y + p2.h) - (p1.y + p1.h)) <= 4, `${JSON.stringify(p1)} -> ${JSON.stringify(p2)}`);
  shot('10-floating-top');
  // back onto the square: docks again
  const [hx, hy] = await at('.title', 0.4, 0.5);
  const { icon } = frames();
  sh(`input motionevent DOWN ${hx} ${hy}`);
  for (let i = 1; i <= 10; i++) { sh(`input motionevent MOVE ${Math.round(hx + (icon.x + icon.w / 2 - hx) * i / 10)} ${Math.round(hy + (icon.y + icon.h / 2 - hy) * i / 10)}`); await sleep(25); }
  sh(`input motionevent UP ${Math.round(icon.x + icon.w / 2)} ${Math.round(icon.y + icon.h / 2)}`); await sleep(900);
  check('dropped on the square: docked again', !/floating" value="true/.test(sh('run-as com.luap.okpicker cat shared_prefs/ui.xml')));
} catch (e) {
  check('run', false, e.message);
} finally {
  // put the user's parts, layout and size back
  await ev((s) => {
    for (const [k, v] of Object.entries(s)) v === null ? localStorage.removeItem('cspPicker.' + k) : localStorage.setItem('cspPicker.' + k, v);
    location.reload();
  }, saved).catch(() => {});
  await sleep(2500);
  const fails = results.filter((r) => !r.ok);
  console.log(fails.length ? `FAIL (${fails.length} of ${results.length})` : `PASS (${results.length})`);
  await browser.disconnect();
  process.exit(fails.length ? 1 : 0);
}
