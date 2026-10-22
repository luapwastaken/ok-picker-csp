// Device check: ⋯ → Save colour set… opens Android's Save dialog; Back cancels it (no file is written).
//   TABLET=<ip:port> node savecheck.mjs [shots dir]     (qa build, DevTools forwarded on 9333)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(new URL('../../picker/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
if (!process.env.TABLET) throw new Error('set TABLET=<ip:port> (adb devices)');
const ADB = `"${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe" -s ${process.env.TABLET}`;
const SHOTS = process.argv[2] ?? 'shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sh = (c) => execSync(`${ADB} shell "${c}"`, { env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const focus = () => sh('dumpsys window | grep mCurrentFocus').trim();
const panel = () => {
  const b = sh('dumpsys window windows').split(/Window #\d+ /).filter((x) => /^Window\{[0-9a-f]+ u0 com\.luap\.okpicker\}/.test(x))
    .map((x) => { const m = x.match(/ frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); return { x: +m[1], y: +m[2], w: m[3] - m[1], h: m[4] - m[2], visible: /mViewVisibility=0x0/.test(x) }; })
    .sort((a, c) => c.w * c.h - a.w * a.h)[0];
  return b;
};
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const [page] = await browser.pages();
async function tapIn(find) {
  const r = await page.evaluate(find);
  if (!r) throw new Error('not found');
  const p = panel();
  if (!p.visible) throw new Error('panel not visible; refusing to touch');
  sh(`input tap ${Math.round(p.x + r.x * 2.125)} ${Math.round(p.y + r.y * 2.125)}`);
  await sleep(600);
}
const centre = (el) => { el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
let ok = false;
try {
  await tapIn(`(${centre})(document.querySelector('[aria-label="Gradient options"]'))`);
  await tapIn(`(() => { const e = [...document.querySelectorAll('[role^=menuitem]')].find((x) => x.textContent.trim().startsWith('Save colour set')); return e && (${centre})(e); })()`);
  await sleep(1800);
  const f = focus();
  fs.writeFileSync(`${SHOTS}/save-dialog.png`, execSync(`${ADB} exec-out screencap -p`, { maxBuffer: 64 << 20 }));
  ok = /documentsui|DocumentsActivity|files/i.test(f);
  console.log(ok ? 'ok  ' : 'FAIL', 'Save dialog opens:', f);
} finally {
  if (!/clipstudiopaint/.test(focus())) { sh('input keyevent KEYCODE_BACK'); await sleep(1500); }
  console.log('after Back:', focus());
  await browser.disconnect();
  process.exit(ok ? 0 : 1);
}
