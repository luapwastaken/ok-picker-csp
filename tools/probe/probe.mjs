// CSP Companion Mode probe, run from the PC one step at a time.
// Wire format from clipremote 582daf2 (pkg/packets, client.go).
//   node probe.mjs authframe <out.bin>   Authenticate frame for the tablet-shell (same-device) test
//   node probe.mjs parse <reply.bin>     decode frames CSP sent back
//   node probe.mjs login                 log in, read colour state, listen 5 s (changes nothing)
//   node probe.mjs colours               set 5 known colours, read each back, restore the original
//   node probe.mjs watch [sec]           print every push + polled colour change (you pick colours in CSP)
//   node probe.mjs rate                  60 colours/s for 5 s, then restore
// --host H overrides the QR address (e.g. 127.0.0.1 through adb forward).
import net from 'node:net';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const CONN = new URL('./conn.json', import.meta.url);
const conn = JSON.parse(fs.readFileSync(CONN));
const save = () => fs.writeFileSync(CONN, JSON.stringify(conn, null, 2));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const host = opt('--host') ?? conn.ips[0];
const [step, arg] = args;

const SEP = Buffer.from('\x1e$');
const AUTH_KEY = [0xb6, 0xd5, 0x92, 0xc4, 0xa7, 0x83, 0xe1];
const MARKER = '{{(([[reconnection request marker]]))}}\r\n';
const FAIL = ['VersionMismatch', 'PasswordMismatch', 'ServerUnready'];
const authHex = (s) => Buffer.from(s).map((b, i) => b ^ AUTH_KEY[i % 7]).toString('hex');
const now = () => performance.now();

function frame(type, command, serial, detail) {
  const body = detail === undefined ? '' : JSON.stringify(detail);
  return Buffer.concat([
    Buffer.from([type]),
    Buffer.from(`$tcp_remote_command_protocol_version=1.0\x1e$command=${command}\x1e$serial=${serial}\x1e$detail=${body}\x1e`),
    Buffer.from([0]),
  ]);
}

function parse(f) {
  const parts = [];
  let at = 2;
  for (let i = 0; i < 3; i++) {
    const j = f.indexOf(SEP, at);
    parts.push(f.subarray(at, j).toString());
    at = j + 2;
  }
  let detail = f.subarray(at + 'detail='.length, f.length - 2);
  const tail = detail.indexOf(0x0b);
  if (tail >= 0) detail = detail.subarray(0, tail);
  const raw = detail.toString();
  let json;
  try { json = raw ? JSON.parse(raw) : undefined; } catch { json = raw; }
  return { type: f[0], command: parts[1].slice(8), serial: Number(parts[2].slice(7)), raw, detail: json, tail: tail >= 0 };
}

function* frames(buf) {
  let k;
  while ((k = buf.indexOf(0)) !== -1) {
    yield buf.subarray(0, k + 1);
    buf = buf.subarray(k + 1);
  }
}

// Authenticate detail: fresh login with the QR password, or reconnect with the rotated one.
function authDetail() {
  if (conn.next) return { detail: [conn.generation, authHex(MARKER), authHex(conn.next)], next: undefined };
  const next = randomBytes(6).toString('base64').replace(/=+$/, '');
  return { detail: [conn.generation, authHex(conn.password), authHex(next)], next };
}

function authOk(p) {
  const reason = p.detail?.AuthErrorReason ?? '';
  return { ok: !FAIL.includes(reason) && !(p.raw === '' && p.type === 0x15), reason, spec: p.detail?.RemoteCommandSpecVersionOfServer };
}

function open() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(conn.port, host);
    const pending = new Map();
    const pushes = [];
    let serial = 0, buf = Buffer.alloc(0), beat;
    sock.setNoDelay(true);
    sock.once('error', reject);
    sock.on('close', () => clearInterval(beat));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      let used = 0;
      for (const f of frames(buf)) {
        used += f.length;
        const p = parse(f);
        if (p.type === 0x01) {
          sock.write(frame(0x06, p.command, p.serial)); // CSP waits for an ACK on every command it starts
          pushes.forEach((fn) => fn(p));
        } else {
          pending.get(p.serial)?.(p);
          pending.delete(p.serial);
        }
      }
      buf = buf.subarray(used);
    });
    const c = {
      send(command, detail) {
        const s = serial++;
        return new Promise((ok, fail) => {
          pending.set(s, ok);
          sock.write(frame(0x01, command, s, detail));
          setTimeout(() => pending.delete(s) && fail(new Error(`${command}: no reply in 5 s`)), 5000);
        });
      },
      onPush: (fn) => pushes.push(fn),
      startHeartbeat: () => { beat = setInterval(() => c.send('TellHeartbeat').catch(() => {}), 1000); },
      close: () => new Promise((r) => { clearInterval(beat); sock.end(r); }),
    };
    sock.once('connect', () => resolve(c));
  });
}

async function login() {
  const t = now();
  const c = await open();
  console.log(`tcp connect to ${host}:${conn.port}: ok (${(now() - t).toFixed(0)} ms)`);
  const { detail, next } = authDetail();
  const r = await c.send('Authenticate', detail);
  const a = authOk(r);
  console.log(`login (${next ? 'QR password' : 'reconnect'}): ${a.ok ? 'ok' : 'FAILED'}  reason=${JSON.stringify(a.reason)} spec=${a.spec} type=0x${r.type.toString(16)}`);
  console.log('  auth reply:', r.raw);
  if (!a.ok) { await c.close(); process.exit(1); }
  if (next) { conn.next = next; save(); }
  c.startHeartbeat();
  return c;
}

// CSP reports channels on a 32-bit scale: byte x 0x01010101.
const rgbOf = (d) => d && [d.CurrentColorRed, d.CurrentColorGreen, d.CurrentColorBlue].map((v) => Math.round(v / 0x01010101));
const readRGB = async (c) => (await c.send('SyncSubViewUIState')).detail;
const setRGB = (c, [r, g, b]) => c.send('SetCurrentColor', { IsColorTransparent: false, RGBColorR: r, RGBColorG: g, RGBColorB: b });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const steps = {
  authframe() {
    const { detail, next } = authDetail();
    fs.writeFileSync(arg, frame(0x01, 'Authenticate', 0, detail));
    conn.pendingNext = next; // promoted to conn.next by `parse` once CSP accepts the login
    save();
    console.log(`wrote ${arg} (${next ? 'QR password' : 'reconnect'})`);
  },

  parse() {
    const buf = fs.readFileSync(arg);
    if (!buf.length) return console.log('no bytes came back');
    for (const f of frames(buf)) {
      const p = parse(f);
      const extra = p.command === 'Authenticate' ? `  -> ${authOk(p).ok ? 'LOGIN OK' : 'login failed'}` : '';
      console.log(`0x${p.type.toString(16)} ${p.command} #${p.serial}: ${p.raw.slice(0, 300)}${extra}`);
      if (p.command === 'Authenticate' && authOk(p).ok && conn.pendingNext) conn.next = conn.pendingNext;
    }
    delete conn.pendingNext;
    save();
  },

  async login() {
    const c = await login();
    c.onPush((p) => console.log(`  push ${p.command}: ${p.raw.slice(0, 200)}`));
    console.log('SyncSubViewUIState:', JSON.stringify((await c.send('SyncSubViewUIState')).detail));
    console.log('SyncColorCircleUIState:', JSON.stringify((await c.send('SyncColorCircleUIState')).detail));
    await wait(5000);
    await c.close();
  },

  async colours() {
    const c = await login();
    const orig = rgbOf(await readRGB(c));
    console.log('original colour:', orig);
    const tests = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [18, 52, 86], [255, 255, 255]];
    for (const rgb of tests) {
      const t = now();
      const r = await setRGB(c, rgb);
      const back = rgbOf(await readRGB(c));
      const circle = (await c.send('SyncColorCircleUIState')).detail;
      const same = back.every((v, i) => v === rgb[i]);
      console.log(`set ${rgb} -> 0x${r.type.toString(16)} read back ${back} ${same ? 'EXACT' : 'DIFFERS'} (${(now() - t).toFixed(0)} ms)`);
      console.log('   circle:', JSON.stringify(circle));
      await wait(1500); // time to eyeball CSP's HEX field
    }
    await setRGB(c, orig);
    console.log('restored:', rgbOf(await readRGB(c)));
    await c.close();
  },

  async watch() {
    const c = await login();
    const secs = Number(arg ?? 60);
    let last = '';
    c.onPush((p) => console.log(`${(now() / 1000).toFixed(1)}s push ${p.command}: ${p.raw.slice(0, 200)}`));
    // Does telling CSP which tab we show turn its pushes on? (the official app sends this on tab change)
    for (const cmd of ['GetServerSelectedTabKind', 'SetServerSelectedTabKind', 'GetServerSelectedTabKind']) {
      const r = await c.send(cmd).catch((e) => ({ type: 0, raw: e.message }));
      console.log(`${cmd} -> 0x${r.type.toString(16)} ${r.raw}`);
    }
    const end = now() + secs * 1000;
    const pct = (v) => Math.round((v / 0xffffffff) * 1000) / 10;
    const hls = (h, l, s) => `H${Math.round((h / 0xffffffff) * 360)} L${pct(l)} S${pct(s)}`;
    console.log(`watching for ${secs} s: pick colours in CSP now`);
    while (now() < end) {
      const k = (await c.send('SyncColorCircleUIState')).detail;
      const rgb = `rgb ${rgbOf(await readRGB(c))} | index ${k.CurrentColorIndex} main ${hls(k.HLSColorMainH, k.HLSColorMainL, k.HLSColorMainS)} sub ${hls(k.HLSColorSubH, k.HLSColorSubL, k.HLSColorSubS)} transparent ${k.IsCurrentColorTransparent}`;
      if (rgb !== last) console.log(`${(now() / 1000).toFixed(1)}s poll ${rgb}`);
      last = rgb;
      await wait(250);
    }
    await c.close();
  },

  async set() { // node probe.mjs set r,g,b  (no restore; for screenshots)
    const c = await login();
    await setRGB(c, arg.split(',').map(Number));
    console.log('now:', rgbOf(await readRGB(c)));
    await c.close();
  },

  async rate() {
    const c = await login();
    const orig = rgbOf(await readRGB(c));
    const lat = [];
    let errors = 0;
    for (let i = 0; i < 300; i++) {
      const t = now();
      const r = await setRGB(c, [i % 256, (i * 7) % 256, 128]);
      if (r.type !== 0x06) errors++;
      lat.push(now() - t);
      await wait(Math.max(0, 1000 / 60 - (now() - t)));
    }
    const back = rgbOf(await readRGB(c));
    lat.sort((a, b) => a - b);
    console.log(`300 sets: median ${lat[150].toFixed(1)} ms, p95 ${lat[285].toFixed(1)} ms, max ${lat[299].toFixed(1)} ms, errors ${errors}; last read back ${back} (want ${[299 % 256, (299 * 7) % 256, 128]})`);
    await setRGB(c, orig);
    console.log('restored:', rgbOf(await readRGB(c)));
    await c.close();
  },
};

if (!steps[step]) { console.log('steps:', Object.keys(steps).join(', ')); process.exit(1); }
await steps[step]();
