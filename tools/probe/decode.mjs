// Decode CSP's "Connect to smartphone" QR from a screenshot (docs/PROTOCOL.md).
import fs from 'node:fs';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
if (!qr) { console.error('no QR found'); process.exit(1); }
console.log('url:', qr.data);

const s = new URL(qr.data).searchParams.get('s');
const key = [0x74, 0xb2, 0x92, 0x5b, 0x4a, 0x21, 0xda];
const bytes = Buffer.from(s, 'hex').map((b, i) => b ^ key[i % key.length]);
const [ips, port, password, generation] = bytes.toString('utf8').split('\t');
const out = { ips: ips.split(','), port: Number(port), password, generation };
fs.writeFileSync(new URL('./conn.json', import.meta.url), JSON.stringify(out, null, 2));
console.log({ ...out, password: `<${password.length} chars>` });
