// Headless checks over CDP (touch emulation, no real input): dragging calls setColor, onCspColor updates the picker, the echo rule holds,
// CSP-busy holds nothing back (native holds it) and moves nothing at first; the frame calls the bridge.
import assert from 'node:assert/strict';
import { DSF, launch, serve } from './lib.mjs';

const { srv, base } = await serve();
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 320, height: 640, deviceScaleFactor: DSF, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.text().startsWith('EV')) console.log(m.text()); else if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}/dist/index.html?display=popup&dock=float`, { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('cspPicker.settings', JSON.stringify({ pickerStyle: 'oklch', pickerModel: 'rgb' })));
await page.reload({ waitUntil: 'load' });

const calls = (fn) => page.evaluate((fn) => window.__bridgeCalls.filter((c) => c.fn === fn).map((c) => c.args), fn);
const clear = () => page.evaluate(() => (window.__bridgeCalls.length = 0));
const fields = () => page.$$eval('input', (els) => els.map((e) => e.value));
const csp = (c) => page.evaluate((c) => window.cspPicker.onCspColor(c), c);
const settle = () => new Promise((r) => setTimeout(r, 150));
const ok = (m) => console.log('ok  ', m);

// 1. onCspColor updates the picker
await csp({ r: 18, g: 52, b: 86, index: 0, transparent: false, canSet: true });
await settle();
assert.ok((await fields()).some((v) => v.toLowerCase().includes('123456')), 'hex field shows #123456: ' + (await fields()));
ok('onCspColor(18,52,86) shows #123456');
assert.equal((await calls('setColor')).length, 0);
ok('an incoming colour sends nothing back');

// 2. touch-drag in the picker calls setColor, continuously, latest values
await page.evaluate(() => document.querySelector('[aria-label="Palette menu"]').blur());
const box = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-picker] [tabindex="0"], [data-picker] [role="slider"]')].find((e) => e.getBoundingClientRect().height > 100) ?? document.querySelector('[data-picker] canvas');
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
assert.ok(box.w > 100, 'found a drag area');
const ts = page.touchscreen;
await ts.touchStart(box.x + box.w * 0.2, box.y + box.h * 0.5);
for (let i = 1; i <= 8; i++) await ts.touchMove(box.x + box.w * (0.2 + i * 0.08), box.y + box.h * (0.5 - i * 0.03));
await ts.touchEnd();
await settle();
const sent = await calls('setColor');
assert.ok(sent.length >= 3, 'setColor called while dragging: ' + sent.length);
assert.ok(sent.every((a) => a.length === 3 && a.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)), 'integer bytes');
ok(`dragging called setColor ${sent.length} times, last ${sent.at(-1)}`);

// 3. echo rule: CSP reports back exactly what we sent -> the picker's own OKLCH stays (read the OKLCH fields, which show decimals)
const before = await fields();
const last = sent.at(-1);
await csp({ r: last[0], g: last[1], b: last[2], index: 0, transparent: false, canSet: true });
await settle();
assert.deepEqual(await fields(), before, 'echo leaves every field untouched');
ok('echo of the last sent RGB leaves the OKLCH untouched');
// the jitter: polled every 30 ms mid-drag, CSP reports colours sent a moment ago, not only the newest
for (const older of [sent[1], sent.at(-3), sent[0]]) {
  await csp({ r: older[0], g: older[1], b: older[2], index: 0, transparent: false, canSet: true });
  await settle();
  assert.deepEqual(await fields(), before, 'an older echo (' + older + ') must not move the picker back');
}
ok('echoes of earlier sends from the same drag leave the picker where it is');
// ...and a different colour from CSP does move it
await csp({ r: 200, g: 30, b: 30, index: 0, transparent: false, canSet: true });
await settle();
assert.notDeepEqual(await fields(), before);
ok('a different CSP colour moves the picker');
// after that, the old echo colour from CSP is a real change again (lastSent was cleared)
await csp({ r: last[0], g: last[1], b: last[2], index: 0, transparent: false, canSet: true });
await settle();
assert.ok((await fields()).some((v) => v.toLowerCase().includes(last.map((n) => n.toString(16).padStart(2, '0')).join(''))), 'hex = ' + last);
ok('the same RGB arriving later (not an echo) is applied');

// 4. CSP busy (every stroke, or a dialog): sends go on (native holds them), nothing on screen moves at first
await clear();
await csp({ r: 10, g: 20, b: 30, index: 0, transparent: false, canSet: true });
await settle();
const steady = await fields();
await csp({ r: 10, g: 20, b: 30, index: 0, transparent: false, canSet: false });
await settle();
assert.deepEqual(await fields(), steady, 'the same colour with only the busy flag flipped changes nothing');
assert.ok(!(await page.$eval('.st', (e) => e.textContent.includes('busy'))), 'a stroke-length busy is not shown');
await ts.touchStart(box.x + box.w * 0.3, box.y + box.h * 0.4);
await ts.touchMove(box.x + box.w * 0.5, box.y + box.h * 0.5);
await ts.touchEnd();
await settle();
assert.ok((await calls('setColor')).length > 0, 'sent while busy, for native to hold');
assert.ok(await page.$eval('.st', (e) => e.textContent.includes('Sent when CSP is free')), 'a colour picked while busy says it waits');
assert.equal(await page.$eval('.body', (e) => getComputedStyle(e).opacity), '1', 'nothing dims');
await csp({ r: 10, g: 20, b: 30, index: 0, transparent: false, canSet: true });
await settle();
assert.ok(!(await page.$eval('.st', (e) => e.textContent.includes('Sent when'))), 'CSP free: the note goes');
ok('canSet=false: nothing changes or dims; a colour picked meanwhile is sent and says it waits until CSP is free');

// 5. sub colour, status, theme
await page.evaluate(() => { window.cspPicker.onSubColor({ r: 255, g: 0, b: 0 }); window.cspPicker.onStatus({ state: 'unpaired' }); window.cspPicker.onTheme('light'); });
await settle();
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
assert.ok(await page.$eval('.st', (e) => e.textContent.includes('Not paired')));
ok('onTheme / onStatus / onSubColor applied');
await page.click('.pair');
assert.equal((await calls('pair')).length, 1);
ok('Pair… button calls pair()');

// 6. frame: menu, close, minimize, title drag, resize
await page.evaluate(() => window.cspPicker.onStatus({ state: 'connected' }));
await clear();
await page.click('[aria-label="Close"]');
await page.click('[aria-label="Minimize"]');
assert.deepEqual((await calls('frame')).map((a) => a[0]), ['close', 'minimize']);
await page.click('[aria-label="Restore"]');
await new Promise((r) => setTimeout(r, 500));
const t = await page.$eval('.title', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + 10]; });
await ts.touchStart(t[0], t[1]); await ts.touchMove(t[0] + 40, t[1] + 30); await ts.touchEnd();
const drag = await calls('dragTitle');
assert.deepEqual(drag.map((a) => a[0]), ['start', 'move', 'end']);
const g = await page.$eval('.grip[data-edge="right"]', (e) => { const r = e.getBoundingClientRect(); return [r.x + 10, r.y + 100]; });
await ts.touchStart(g[0], g[1]); await ts.touchMove(g[0] - 30, g[1]); await ts.touchEnd(); await settle();
assert.deepEqual((await calls('resize')).map((a) => a[0] + ':' + a[1]), ['right:start', 'right:move', 'right:end']);
ok('frame: close/minimize/restore, dragTitle phases, resize phases');

// 7. menu rows exist and act (Display > Tab -> setDisplay('tab'))
await clear();
await page.click('[aria-label="Palette menu"]');
await settle();
const labels = await page.$$eval('[role^="menu"]', (els) => els.map((e) => e.textContent));
assert.ok(['Style', 'Model', 'Copy as', 'Display', 'Look', 'Pair with CSP', 'Send report'].every((l) => labels.join('|').includes(l)), labels.join('|'));
await page.evaluate(() => [...document.querySelectorAll('[role^="menuitem"]')].find((e) => e.textContent.startsWith('Send report')).click());
await settle();
assert.equal((await calls('sendReport')).length, 1);
ok('≡ menu has all entries; Send report calls sendReport()');

// copy goes to the bridge
await clear();
await page.click('[aria-label^="Copy"]');
await settle();
const copied = await calls('copy');
assert.equal(copied.length, 1);
ok('Copy -> bridge.copy(' + JSON.stringify(copied[0][0]) + ')');

// 8. compact mode
await page.setViewport({ width: 200, height: 640, deviceScaleFactor: DSF, hasTouch: true, isMobile: true });
await page.evaluate(() => localStorage.setItem('cspPicker.settings', JSON.stringify({ pickerStyle: 'wheel', pickerModel: 'rgb' })));
await page.goto(`${base}/dist/index.html?display=popup&dock=float&eyedropper=poly`, { waitUntil: 'load' });
await clear();
await page.click('[aria-label="Compact panel"]');
await settle();
assert.deepEqual((await calls('frame')).map((a) => a[0]).filter((a) => !a.startsWith('fit:')), ['compact:on']);
assert.ok(await page.$('.crow1') && await page.$('.status'), 'compact: the hex row is a part, the status strip stays');
await page.click('[aria-label="Full panel"]');
await settle();
assert.deepEqual((await calls('frame')).map((a) => a[0]).filter((a) => !a.startsWith('fit:')), ['compact:on', 'compact:off']);
await page.click('[aria-label="Compact panel"]');
await settle();
ok('compact toggle calls frame(compact:on/off)');
await csp({ r: 18, g: 52, b: 86, index: 0, transparent: false, canSet: true });
await settle();
assert.ok((await fields()).some((v) => v.toLowerCase() === '#123456'), 'hex field shows the colour');
await clear();
const ring = await page.$eval('[aria-label="Hue"]', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width / 2]; });
await ts.touchStart(ring[0] + ring[2] * 0.9, ring[1]);
for (let i = 1; i <= 6; i++) await ts.touchMove(ring[0] + ring[2] * 0.9 * Math.cos(i * 0.3), ring[1] + ring[2] * 0.9 * Math.sin(i * 0.3));
await ts.touchEnd();
await settle();
assert.ok((await calls('setColor')).length >= 2, 'dragging the compact wheel calls setColor');
ok('compact wheel drag calls setColor');
await csp({ r: 200, g: 30, b: 30, index: 0, transparent: false, canSet: true });
await settle();
assert.ok((await fields()).some((v) => v.toLowerCase() === '#c81e1e'));
ok('onCspColor updates the compact hex');
await clear();
const hexIn = await page.$('.chex input');
await hexIn.click({ clickCount: 3 });
await page.keyboard.type('#00ff88');
await page.keyboard.press('Enter');
await settle();
assert.ok((await fields()).some((v) => v.toLowerCase() === '#00ff88'), 'typed hex accepted');
assert.ok((await calls('setColor')).some((a) => a.join() === '0,255,136'));
ok('hex field accepts typing and sends it');
await clear();
await page.click('.crow1 [aria-label^="Copy"]');
await settle();
assert.equal((await calls('copy')).length, 1);
ok('compact Copy -> bridge.copy(' + JSON.stringify((await calls('copy'))[0][0]) + ')');
// 9. compact keeps the Picker's features: holds, Value, Match, sRGB fix, eyedropper, Model
await page.evaluate(() => localStorage.removeItem('cspPicker.settings'));
const pressed = (l) => page.$eval(`[aria-label="${l}"]`, (e) => e.getAttribute('aria-pressed'));
assert.equal(await pressed('Hold value'), 'false');
await page.click('[aria-label="Hold value"]'); await page.click('[aria-label="Hold hue"]');
assert.equal(await pressed('Hold value'), 'true'); assert.equal(await pressed('Hold hue'), 'true');
await page.click('[aria-label="Hold value"]'); await page.click('[aria-label="Hold hue"]');
assert.equal(await pressed('Hold value'), 'false');
ok('Hold value / Hold hue toggle (aria-pressed)');
await csp({ r: 18, g: 52, b: 86, index: 0, transparent: false, canSet: true });
await settle(); await clear();
const vin = await page.$('.cvalue input');
await vin.click({ clickCount: 3 }); await page.keyboard.type('70'); await page.keyboard.press('Enter');
await settle();
assert.ok((await calls('setColor')).length >= 1, 'typing a Value sets the colour');
ok('Value field typing sets the colour');
await page.evaluate(() => window.cspPicker.onSubColor({ r: 255, g: 232, b: 170 }));
await settle(); await clear();
await page.click('[aria-label="Match value"]'); await settle();
await page.evaluate(() => [...document.querySelectorAll('[role^="menuitem"]')].find((e) => e.textContent.includes('Sub colour')).click());
await settle();
assert.ok((await calls('setColor')).length >= 1, 'Match sets the colour');
ok('Match (sub colour) sets the value');
await page.click('[aria-label="Palette menu"]'); await settle();
assert.ok((await page.$$eval('[role^="menu"]', (els) => els.map((e) => e.textContent).join('|'))).includes('Model'));
await page.keyboard.press('Escape'); await settle();
ok('Model is in the ≡ menu in compact');
// out of sRGB: the warning icon applies the fix
await page.evaluate(() => document.activeElement?.blur());
await page.mouse.click(5, 300); await settle();
const hexIn2 = await page.$('.chex input');
await new Promise((r) => setTimeout(r, 4500)); // the Copy toast covers the strip until it goes
await hexIn2.click({ clickCount: 3 }); await page.keyboard.type('oklch(70% 0.35 150)');
await page.keyboard.press('Enter');
await settle();
assert.ok(await page.$('.cwarn'), 'warning shows outside sRGB: ' + (await fields()));
await page.click('.cwarn'); await settle();
assert.ok(!(await page.$('.cwarn')), 'the fix brings the colour into sRGB');
ok('tapping the warning applies Use sRGB');
// eyedropper polyfill flow
await csp({ r: 18, g: 52, b: 86, index: 0, transparent: false, canSet: true });
await settle(); await clear();
await page.click('[aria-label="Eyedropper"]'); await settle();
assert.deepEqual(await calls('eyedropper'), [[true]]);
assert.ok((await page.$eval('.status .st', (e) => e.textContent)).includes('Tap the canvas to pick'));
await csp({ r: 18, g: 52, b: 86, index: 0, transparent: false, canSet: true }); await settle();
assert.equal((await calls('eyedropper')).length, 1, 'the same colour does not settle it');
await csp({ r: 1, g: 2, b: 3, index: 0, transparent: false, canSet: true }); await settle();
assert.deepEqual(await calls('eyedropper'), [[true], [false]]);
assert.ok((await fields()).some((v) => v.toLowerCase() === '#010203'));
assert.ok(!(await page.$eval('.status .st', (e) => e.textContent)).includes('Tap the canvas'));
ok('eyedropper: armed label, same colour ignored, next colour picked, released');
await clear();
await page.click('[aria-label="Eyedropper"]'); await settle();
await page.evaluate(() => { new EyeDropper().open().catch(() => {}); });
await settle();
assert.deepEqual((await calls('eyedropper')).map((a) => a[0]), [true, false, true]);
ok('a second open() cancels the first');

assert.deepEqual(errors, [], 'no page errors (compact): ' + errors.join('; '));

assert.deepEqual(errors, [], 'no page errors: ' + errors.join('; '));
ok('no console errors');
await browser.close();
srv.close();
