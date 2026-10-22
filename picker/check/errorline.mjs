// A long pairing error shows in full in the status strip: node check/errorline.mjs <png>
import { launch, serve, DSF } from './lib.mjs';
const { srv, base } = await serve();
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 300, height: 700, deviceScaleFactor: DSF });
await page.goto(`${base}/dist/index.html?status=unpaired`, { waitUntil: 'load' });
await page.evaluate(() => window.cspPicker.onStatus({ state: 'unpaired', detail: 'Pairing failed: no QR code in 8 pictures of the screen. Open Connect to smartphone in CSP so its QR shows, then tap Pair.' }));
await new Promise((r) => setTimeout(r, 300));
const st = await page.$eval('.status .st', (e) => ({ text: e.textContent, clipped: e.scrollWidth > e.clientWidth + 1, h: e.getBoundingClientRect().height }));
console.log(st);
await page.screenshot({ path: process.argv[2] ?? 'errorline.png' });
await browser.close(); srv.close();
process.exit(st.clipped ? 1 : 0);
