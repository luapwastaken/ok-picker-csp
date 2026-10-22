// Drawing and CSP input against the panel, each scenario screen-recorded and checked for any change on the panel:
// pixels (diff.py over the recording), DOM mutations and opacity in the page, and the native window frames.
//   node sweep.mjs [scenario...]     default: all. Recordings land in $SHOTS (default ./sweep).
// Strokes go on the canvas right of the panel; run it only on an empty test canvas, and undo afterwards (see `undo`).
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const require = createRequire(new URL('../../picker/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const EXE = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const TABLET = process.env.TABLET ?? (() => { throw new Error('set TABLET=<ip:port> (adb devices)'); })();
const OUT = process.env.SHOTS ?? 'sweep';
fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const sh = (c) => execSync(`"${EXE}" -s ${TABLET} shell "${c}"`, { env, maxBuffer: 64 << 20 }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function frames() {
  const blocks = sh('dumpsys window windows').split(/Window #\d+ /).filter((b) => /^Window\{[0-9a-f]+ u0 com\.luap\.okpicker\}/.test(b));
  const f = blocks.map((b) => { const m = b.match(/ frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); const v = b.match(/mViewVisibility=(0x[0-9a-f]+)/); return { x: +m[1], y: +m[2], w: m[3] - m[1], h: m[4] - m[2], visible: v?.[1] === '0x0' }; })
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const icon = f.find((x) => x.w === x.h && x.w < 120) ?? f[1];
  return { panel: f.find((x) => x !== icon), icon };
}

// A stylus path through points, as one stroke (DOWN, MOVEs, UP) in one shell call; `gap` seconds between points.
const stroke = (pts, gap = 0) => {
  const [first, ...rest] = pts;
  const moves = rest.map(([x, y]) => `input stylus motionevent MOVE ${x} ${y}${gap ? `; sleep ${gap}` : ''}`).join('; ');
  const [lx, ly] = pts.at(-1);
  sh(`input stylus motionevent DOWN ${first[0]} ${first[1]}; ${moves}; input stylus motionevent UP ${lx} ${ly}`);
};
const wave = (x0, y0, x1, y1, n, amp) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n;
  return [Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t + Math.sin(t * Math.PI * 4) * amp)];
});

// The screen as it is now (auto-rotate may be on), and where CSP's paper and spare UI are with the view at Fit.
// Strokes are written in 0..1 of the paper box, so the same scenario runs in either orientation.
function layout() {
  const [w, h] = sh('dumpsys window displays').match(/cur=(\d+)x(\d+)/).slice(1).map(Number);
  const land = w > h;
  return land
    ? { land, size: '1280x800', paper: [1080, 290, 2370, 1570], list: [260, 1450, 1200], surround: [2470, 1300] }
    : { land, size: '800x1280', paper: [920, 1080, 1580, 1740], list: [260, 1450, 1200], surround: [1250, 2300] };
}
let L = layout();
const P = (u, v) => [Math.round(L.paper[0] + (L.paper[2] - L.paper[0]) * u), Math.round(L.paper[1] + (L.paper[3] - L.paper[1]) * v)];
const swipe = (a, b, ms, tool = 'stylus') => sh(`input ${tool} swipe ${P(...a).join(' ')} ${P(...b).join(' ')} ${ms}`);

const SCENARIOS = {
  short: { secs: 4, strokes: 1, run: () => swipe([0.3, 0.2], [0.45, 0.25], 120) },
  long: { secs: 12, strokes: 1, run: () => stroke(wave(...P(0.15, 0.3), ...P(0.85, 0.75), 60, 60), 0.08) },
  dots: { secs: 8, strokes: 12, run: () => { for (let i = 0; i < 12; i++) sh(`input stylus tap ${P(0.15 + i * 0.06, 0.9 - (i % 3) * 0.03).join(' ')}`); } },
  scribble: { secs: 8, strokes: 8, run: () => { for (let i = 0; i < 8; i++) swipe([0.15 + i * 0.09, 0.05], [0.22 + i * 0.09, 0.18], 90); } },
  // a finger on the canvas pans the view in CSP (no stroke); View > Fit puts it back afterwards
  pan: { secs: 5, strokes: 0, run: () => swipe([0.6, 0.5], [0.45, 0.42], 600, '') },
  // CSP's own UI, nothing that changes a setting: scroll the sub tool list, tap the dark surround beside the paper
  cspui: { secs: 6, strokes: 0, run: () => { const [x, y0, y1] = L.list; sh(`input swipe ${x} ${y0} ${x} ${y1} 400`); sh(`input swipe ${x} ${y1} ${x} ${y0} 400`); sh(`input tap ${L.surround.join(' ')}`); } },
  // pick in the panel, then draw at once: the stroke should carry the new colour, the panel should not twitch after
  pickdraw: { secs: 6, strokes: 1, expectChange: true, run: async () => { const [x, y] = await at('.cin', 0.7, 0.3); sh(`input tap ${x} ${y}`); swipe([0.3, 0.55], [0.6, 0.6], 300); } },
  // pick in the panel while a stroke is under way: held, sent when the stroke ends ("Sent when CSP is free")
  pickduring: { secs: 9, strokes: 1, expectChange: true, run: async () => {
    const [x, y] = await at('.cin', 0.3, 0.6);
    const s = spawn(EXE, ['-s', TABLET, 'shell', `input stylus swipe ${P(0.2, 0.68).join(' ')} ${P(0.85, 0.8).join(' ')} 4000`], { env });
    await sleep(1500);
    sh(`input tap ${x} ${y}`);
    await new Promise((r) => s.on('exit', r));
  } },
};

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const [page] = await browser.pages();
// a page element's point in screen pixels (dx, dy: where in its box)
async function at(selector, dx = 0.5, dy = 0.5) {
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, selector);
  const { panel } = frames();
  // never aim a touch at a closed panel: it would land on CSP underneath
  if (!panel.visible) throw new Error('the panel is not visible; refusing to touch');
  return [Math.round(panel.x + (r.x + r.w * dx) * 2.125), Math.round(panel.y + (r.y + r.h * dy) * 2.125)];
}

async function scenario(name) {
  const s = SCENARIOS[name];
  L = layout();
  await page.evaluate(() => {
    window.__mo?.disconnect();
    window.__mut = []; window.__look = new Set(); window.__run = true;
    window.__mo = new MutationObserver((list) => { for (const m of list) window.__mut.push(m.type + ':' + (m.attributeName ?? '') + ':' + (m.target.className?.toString?.() ?? m.target.nodeName).slice(0, 30)); });
    window.__mo.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    const tick = () => {
      const f = document.querySelector('.frame'), b = document.querySelector('.body');
      const st = (document.querySelector('.cstrip .cstate, .status .st')?.textContent ?? '').trim();
      window.__look.add(`${innerWidth}x${innerHeight} frame ${getComputedStyle(f).opacity} body ${b ? getComputedStyle(b).opacity : '-'} ring ${document.querySelector('.boxes')?.dataset.state ?? '-'} "${st}"`);
      if (window.__run) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const before = frames();
  const rec = spawn(EXE, ['-s', TABLET, 'shell', `screenrecord --size ${L.size} --bit-rate 6000000 --time-limit ${s.secs} /sdcard/okp-${name}.mp4`], { env });
  await sleep(900); // the recorder needs a moment before the first frame
  await s.run();
  await new Promise((r) => rec.on('exit', r));
  const after = frames();
  const page_ = await page.evaluate(() => { window.__run = false; window.__mo.disconnect(); return { mutations: window.__mut.length, kinds: [...new Set(window.__mut)].slice(0, 8), looks: [...window.__look] }; });
  execSync(`"${EXE}" -s ${TABLET} pull /sdcard/okp-${name}.mp4 "${OUT}/${name}.mp4"`, { env, stdio: 'ignore' });
  sh(`rm /sdcard/okp-${name}.mp4`);
  const p = before.panel; // the video is half the screen's size
  const pixels = before.panel.visible
    ? JSON.parse(execSync(`python "${fileURLToPath(new URL('diff.py', import.meta.url))}" "${OUT}/${name}.mp4" ${p.x >> 1} ${p.y >> 1} ${p.w >> 1} ${p.h >> 1}`).toString())
    : 'panel hidden';
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // the page's own record of what it showed: the state row's text (compact) or status (full), per frame
  return { name, landscape: L.land, strokes: s.strokes, expectChange: !!s.expectChange, panelPixels: pixels, page: page_, windows: same(before, after) ? 'unchanged' : { before, after } };
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
for (const n of names) console.log(JSON.stringify(await scenario(n), null, 1));
await browser.disconnect();
