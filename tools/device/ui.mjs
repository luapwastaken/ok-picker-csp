// Device UI checks for the panel: real touches through adb, positions from the page over DevTools.
//   node ui.mjs <step>   steps below; screenshots land in $SHOTS (default ./shots)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(new URL('../../picker/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const ADB = `"${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe" -s ${process.env.TABLET ?? (() => { throw new Error('set TABLET=<ip:port> (adb devices)'); })()}`;
const SHOTS = process.env.SHOTS ?? 'shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sh = (c) => execSync(`${ADB} shell "${c}"`, { env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DPR = 2.125;

// Our two overlay windows' frames, [panel, icon] by size.
export function frames() {
  const blocks = sh('dumpsys window windows').split(/Window #\d+ /).filter((b) => /^Window\{[0-9a-f]+ u0 com\.luap\.okpicker\}/.test(b));
  const f = blocks.map((b) => { const m = b.match(/ frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); const v = b.match(/mViewVisibility=(0x[0-9a-f]+)/); return { x: +m[1], y: +m[2], w: m[3] - m[1], h: m[4] - m[2], visible: v?.[1] === '0x0' }; })
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const icon = f.find((x) => x.w === x.h && x.w < 120) ?? f[1];
  return { panel: f.find((x) => x !== icon), icon };
}
export const shot = (name) => fs.writeFileSync(`${SHOTS}/${name}.png`, execSync(`${ADB} exec-out screencap -p`, { maxBuffer: 64 << 20 }));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const [page] = await browser.pages();
// A page element's centre in screen pixels.
async function at(selector, dx = 0.5, dy = 0.5) {
  const r = await page.evaluate((s) => { const e = typeof s === 'string' ? document.querySelector(s) : null; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, selector);
  if (!r) throw new Error(`no ${selector}`);
  const { panel } = frames();
  // never aim a touch at a closed panel: it would land on CSP underneath (it once changed the brush size)
  if (!panel.visible) throw new Error('the panel is not visible; refusing to touch');
  return [Math.round(panel.x + (r.x + r.w * dx) * DPR), Math.round(panel.y + (r.y + r.h * dy) * DPR)];
}
const tap = async (sel) => { const [x, y] = await at(sel); sh(`input tap ${x} ${y}`); await sleep(500); };
const menuItem = async (label) => {
  const r = await page.evaluate((l) => { const e = [...document.querySelectorAll('[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], button, li')].find((x) => x.textContent.trim().startsWith(l) && x.getBoundingClientRect().height > 0); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, label);
  if (!r) throw new Error(`no menu item ${label}`);
  const { panel } = frames();
  sh(`input tap ${Math.round(panel.x + r.x * DPR)} ${Math.round(panel.y + r.y * DPR)}`);
  await sleep(500);
};

const steps = {
  async frames() { console.log(frames()); },
  async compact() {
    await tap('[aria-label="Compact panel"]'); await sleep(700);
    const out = { on: frames().panel }; shot('compact-on');
    for (const st of ['Wheel', 'Sliders', 'OKLCH', 'Square']) {
      await tap('[aria-label="Palette menu"]'); await menuItem('Style'); await menuItem(st); await sleep(700);
      out[st] = frames().panel; shot('compact-' + st.toLowerCase());
    }
    console.log(out);
  },
  // Drag the panel by its title: let go right beside the square and it stays exactly there (it used to jump to the
  // square); let go with the finger on the square, which lights up, and it docks to it again.
  async anchor() {
    const floating = () => /floating" value="true/.test(sh('run-as com.luap.okpicker cat shared_prefs/ui.xml'));
    let { panel, icon } = frames();
    let [x, y] = await at('.title', 0.35, 0.5);
    const gx = x - panel.x, gy = y - panel.y;
    const px = icon.x - 30 - panel.w >= 0 ? icon.x - 30 - panel.w : icon.x + icon.w + 30; // 30 px off the square
    sh(`input swipe ${x} ${y} ${px + gx} ${icon.y + gy} 900`); await sleep(800);
    const near = { want: { x: px, y: icon.y }, got: frames().panel, floating: floating() };
    near.ok = Math.abs(near.got.x - px) <= 3 && Math.abs(near.got.y - icon.y) <= 3 && near.floating;
    // onto the square, held there for a look at the lit square, then let go
    ({ icon } = frames());
    [x, y] = await at('.title', 0.35, 0.5);
    const [ix, iy] = [icon.x + icon.w / 2, icon.y + icon.h / 2];
    sh(`input motionevent DOWN ${x} ${y}`);
    for (let i = 1; i <= 12; i++) { sh(`input motionevent MOVE ${Math.round(x + (ix - x) * i / 12)} ${Math.round(y + (iy - y) * i / 12)}`); await sleep(30); }
    await sleep(300); shot('dock-lit');
    sh(`input motionevent UP ${ix} ${iy}`); await sleep(800);
    ({ panel, icon } = frames());
    const docked = { panel, icon, floating: floating() };
    docked.ok = !docked.floating && (Math.abs(panel.x + panel.w - icon.x) < 20 || Math.abs(icon.x + icon.w - panel.x) < 20);
    console.log({ near, docked });
  },
  // Pop-up: a tap outside (CSP's dark surround, right of the paper) hides it; the square toggles it.
  async popup() {
    const vis = () => frames().panel.visible;
    const display = await page.evaluate(() => document.querySelector('.frame')?.dataset.display);
    const { icon } = frames();
    const log = { display, start: vis() };
    sh('input tap 2470 1300'); await sleep(600); log.afterOutside = vis();
    sh(`input tap ${icon.x + 40} ${icon.y + 40}`); await sleep(600); log.afterIconTap = vis();
    sh(`input tap ${icon.x + 40} ${icon.y + 40}`); await sleep(600); log.afterIconTap2 = vis();
    sh(`input tap ${icon.x + 40} ${icon.y + 40}`); await sleep(600); log.afterIconTap3 = vis();
    console.log(log);
  },
  async keepopen() {
    await tap('[aria-label="Palette menu"]'); await menuItem('Display'); await menuItem('Keep open'); await sleep(400);
    sh('input tap 2470 1300'); await sleep(600);
    const w = sh('dumpsys window windows').split(/Window #/).filter((x) => /u0 com\.luap\.okpicker\}/.test(x)).map((x) => x.match(/mViewVisibility=(0x\d+)/)?.[1]);
    console.log({ display: await page.evaluate(() => document.querySelector('.frame')?.dataset.display), visibilities: w });
  },
  async close() {
    await tap('[aria-label="Close"]'); await sleep(600);
    const f = frames();
    sh('cmd statusbar expand-notifications'); await sleep(1200); shot('notification');
    console.log({ panelVisible: f.panel.visible, iconVisible: f.icon.visible });
  },
  async report() {
    await tap('[aria-label="Palette menu"]'); await menuItem('Send report'); await sleep(1500); shot('report-share');
    console.log(sh('dumpsys window | grep mCurrentFocus').trim());
    sh('input keyevent KEYCODE_BACK'); await sleep(800);
    console.log(sh('dumpsys window | grep mCurrentFocus').trim());
  },
  // The panel's eyedropper: arm it, tap the paper (left of the panel), CSP's own eyedropper picks.
  async eyedropper() {
    const before = await page.evaluate(() => document.querySelector('input')?.value);
    await tap('[aria-label="Eyedropper"]'); await sleep(500);
    const armed = await page.evaluate(() => document.querySelector('.frame')?.innerText.includes('Tap the canvas'));
    shot('eyedropper-armed');
    sh('input tap 1500 1000'); await sleep(1200);
    console.log({ before, armed, after: await page.evaluate(() => document.querySelector('input')?.value), stillArmed: await page.evaluate(() => document.querySelector('.frame')?.innerText.includes('Tap the canvas')) });
  },
  // Hold value: V on, drag across the square, the Value field must not move.
  async holdvalue() {
    await tap('[aria-label="Hold value"], button[title="Hold value"]');
    const pressed = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'V')?.getAttribute('aria-pressed'));
    const v0 = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).join(' | '));
    const [x, y] = await at('.cin', 0.3, 0.2); sh(`input swipe ${x} ${y} ${x + 200} ${y + 120} 600`); await sleep(800);
    const v1 = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).join(' | '));
    shot('holdvalue');
    await tap('[aria-label="Hold value"], button[title="Hold value"]');
    console.log({ pressed, before: v0, after: v1 });
  },
  async pair() {
    await menuItem('Pair'); await sleep(1500); shot('pair-consent');
    console.log(sh('dumpsys window | grep mCurrentFocus').trim());
  },
  // Hold value on, swipe across the main control, sample the Value field every frame: any change is jitter.
  async jitter() {
    const pressed = () => page.evaluate(() => document.querySelector('[aria-label="Hold value"]')?.getAttribute('aria-pressed'));
    const wasOn = (await pressed()) === 'true';
    if (!wasOn) await tap('[aria-label="Hold value"]');
    await page.evaluate(() => {
      window.__vals = []; window.__lines = []; window.__off = [];
      const field = () => [...document.querySelectorAll('input')].find((i) => !i.value.startsWith('#'));
      // the held-value contour (a straight line in RGB) and the marker's distance from it, in CSS px
      const line = () => document.querySelector('.cin svg[viewBox="0 0 100 100"] path')?.getAttribute('d') ?? 'none';
      const off = () => {
        const sq = document.querySelector('.cin svg[viewBox="0 0 100 100"]');
        const ring = [...document.querySelectorAll('.cin svg')].find((s) => Math.round(s.getBoundingClientRect().width) === 20);
        if (!sq || !ring) return null;
        const b = sq.getBoundingClientRect(), r = ring.getBoundingClientRect();
        const d = sq.querySelector('path').getAttribute('d').match(/[-\d.]+/g).map(Number);
        const mx = ((r.x + r.width / 2 - b.x) / b.width) * 100, my = ((r.y + r.height / 2 - b.y) / b.height) * 100;
        return +((((my - (d[1] + ((d[3] - d[1]) * (mx - d[0])) / (d[2] - d[0]))) / 100) * b.height).toFixed(2));
      };
      const tick = () => { window.__vals.push(field()?.value); window.__lines.push(line()); window.__off.push(off()); if (window.__vals.length < 400) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const [x, y] = await at('.cin', 0.2, 0.15);
    sh(`input swipe ${x} ${y} ${x + 250} ${y + 180} 1500`); await sleep(1500);
    const { vals, lines, offs, model } = await page.evaluate(() => ({ vals: window.__vals, lines: window.__lines, offs: window.__off, model: JSON.parse(localStorage.getItem('cspPicker.settings') ?? '{}') }));
    if (!wasOn) await tap('[aria-label="Hold value"]');
    const flips = (a) => a.reduce((n, v, i) => n + (i && v !== a[i - 1] ? 1 : 0), 0);
    const o = offs.filter((v) => v !== null);
    console.log({ frames: vals.length, model, values: [...new Set(vals)], valueFlips: flips(vals), lineShapes: new Set(lines).size, lineFlips: flips(lines),
      markerOffLinePx: { min: Math.min(...o), max: Math.max(...o), flips: flips(o) }, holdRestored: (await pressed()) === String(wasOn) });
  },
  // Hold hue on, real touch drags on the hue control: the hex must not change. Model/style from argv[3] (default hsb).
  async holdhue() {
    const model = process.argv[3] ?? 'hsb';
    const lock = process.argv[4] !== 'off';
    const prev = await page.evaluate((m, lk) => { const s = JSON.parse(localStorage.getItem('cspPicker.settings') ?? '{}'); localStorage.setItem('cspPicker.settings', JSON.stringify({ ...s, pickerModel: m, hueLock: lk, valueLock: false })); return s; }, model, lock);
    await page.reload(); await sleep(1500); await page.evaluate(() => AndroidBridge.ready()); await sleep(500);
    const hex = () => page.evaluate(() => [...document.querySelectorAll('input')].find((i) => i.value.startsWith('#'))?.value);
    const pressed = await page.evaluate(() => document.querySelector('[aria-label="Hold hue"]')?.getAttribute('aria-pressed'));
    const before = await hex();
    // the bar under the square (the hue bar in HSB/HSL, red in RGB), then the square itself
    // the bar under the area: the first wide, 20-30 px tall box in the main control (classes are hashed)
    const bar = await page.evaluate(() => {
      const e = [...document.querySelectorAll('.cin *')].find((x) => { const b = x.getBoundingClientRect(); return b.width > 100 && b.height >= 20 && b.height <= 30; });
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const { panel } = frames();
    if (!panel.visible) throw new Error('the panel is not visible; refusing to touch');
    const bx = Math.round(panel.x + (bar.x + bar.w * 0.2) * DPR), by = Math.round(panel.y + (bar.y + bar.h / 2) * DPR);
    sh(`input swipe ${bx} ${by} ${bx + 180} ${by} 500`); await sleep(700);
    const afterBar = await hex();
    const [sx, sy] = await at('.cin', 0.3, 0.2);
    sh(`input swipe ${sx} ${sy} ${sx + 150} ${sy + 100} 500`); await sleep(700);
    const afterSquare = await hex();
    const hue = (h) => { const n = parseInt(h.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return null; const k = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return Math.round(k * 60); };
    await page.evaluate((s) => localStorage.setItem('cspPicker.settings', JSON.stringify(s)), prev);
    await page.reload(); await sleep(1500); await page.evaluate(() => AndroidBridge.ready());
    console.log({ model, holdHuePressed: pressed, sliders: bar, before, afterBar, afterSquare, hues: [before, afterBar, afterSquare].map(hue) });
  },
  // Hold hue on in the other styles: drag each style's hue control (the wheel's ring, the H track) with real touch.
  async holdhuestyles() {
    const prev = await page.evaluate(() => JSON.parse(localStorage.getItem('cspPicker.settings') ?? '{}'));
    const hex = () => page.evaluate(() => [...document.querySelectorAll('input')].find((i) => i.value.startsWith('#'))?.value);
    const out = {};
    for (const [style, model] of [['wheel', 'hsb'], ['sliders', 'hsb'], ['oklch', 'hsb']]) {
      for (const lock of [false, true]) {
        await page.evaluate((s) => localStorage.setItem('cspPicker.settings', JSON.stringify(s)), { ...prev, pickerStyle: style, pickerModel: model, hueLock: lock, valueLock: false });
        await page.reload(); await sleep(1500); await page.evaluate(() => AndroidBridge.ready()); await sleep(500);
        const { panel } = frames();
        if (!panel.visible) throw new Error('the panel is not visible; refusing to touch');
        // the hue control: the wheel's outer ring, or the track labelled H
        const g = await page.evaluate((st) => {
          const box = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
          if (st === 'wheel') { const e = [...document.querySelectorAll('.cin *')].find((x) => { const b = x.getBoundingClientRect(); return b.width > 140 && Math.abs(b.width - b.height) < 4; }); return { kind: 'ring', ...box(e) }; }
          const lbl = [...document.querySelectorAll('.cin .lbl, .cin span, .cin label')].find((x) => x.textContent.trim() === 'H');
          const row = lbl?.closest('.crow') ?? lbl?.parentElement;
          const track = row && [...row.querySelectorAll('*')].find((x) => { const b = x.getBoundingClientRect(); return b.width > 80 && b.height >= 10 && b.height <= 30; });
          return track ? { kind: 'H track', ...box(track) } : null;
        }, style);
        if (!g) { out[`${style} lock ${lock}`] = 'no hue control found'; continue; }
        const P = (u, v) => [Math.round(panel.x + (g.x + g.w * u) * DPR), Math.round(panel.y + (g.y + g.h * v) * DPR)];
        const before = await hex();
        const [a, b] = g.kind === 'ring' ? [P(0.04, 0.5), P(0.5, 0.04)] : [P(0.15, 0.5), P(0.75, 0.5)];
        sh(`input swipe ${a.join(' ')} ${b.join(' ')} 500`); await sleep(700);
        out[`${style} H ${lock ? 'on ' : 'off'}`] = `${g.kind}: ${before} -> ${await hex()}`;
      }
    }
    await page.evaluate((s) => localStorage.setItem('cspPicker.settings', JSON.stringify(s)), prev);
    await page.reload(); await sleep(1500); await page.evaluate(() => AndroidBridge.ready());
    console.log(out);
  },
  async popupmode() {
    await tap('[aria-label="Palette menu"]'); await menuItem('Display'); await menuItem('Pop-up'); await sleep(400);
    console.log(await page.evaluate(() => document.querySelector('.frame')?.dataset.display));
  },
  async full() { await tap('[aria-label="Full panel"]'); await sleep(700); console.log(frames().panel); },
  async minimize() {
    const before = frames().panel;
    await tap('[aria-label="Minimize"]'); await sleep(400);
    const min = frames().panel; shot('minimized');
    await tap('[aria-label="Restore"]'); await sleep(400);
    console.log({ before, min, after: frames().panel });
  },
  async resize() {
    const before = frames().panel;
    const grips = await page.evaluate(() => [...document.querySelectorAll('.grip')].map((g) => ({ cls: g.className, ...JSON.parse(JSON.stringify(g.getBoundingClientRect())) })));
    const [x, y] = await at('.grip.bottomright, .grip[data-edge="bottomright"], .grip:last-of-type');
    sh(`input swipe ${x} ${y} ${x + 120} ${y - 200} 700`); await sleep(500);
    const after = frames().panel; shot('resized');
    console.log({ grips: grips.map((g) => g.cls), before, after });
  },
  async menu() {
    await tap('[aria-label="Palette menu"]'); shot('menu');
    await menuItem('Style'); shot('menu-style');
    await menuItem('Wheel'); await sleep(300); shot('style-wheel');
    console.log(await page.evaluate(() => document.querySelector('[data-picker]')?.dataset.picker));
  },
  async light() {
    await tap('[aria-label="Palette menu"]'); await menuItem('Look'); await menuItem('Light'); await sleep(300); shot('look-light');
    await tap('[aria-label="Palette menu"]'); await menuItem('Look'); await menuItem('Dark'); await sleep(300);
    console.log(await page.evaluate(() => document.documentElement.dataset.theme));
  },
};
await steps[process.argv[2]]();
await browser.disconnect();
