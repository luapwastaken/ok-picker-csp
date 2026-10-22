// Drive the panel's WebView on the tablet over Chrome DevTools (debug builds only).
//   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
//   node wv.mjs eval "<js>"     evaluate in the page, print the JSON result
//   node wv.mjs file <script.js> evaluate a file's contents (an async function body)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../picker/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const [cmd, arg] = process.argv.slice(2);
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const [page] = await browser.pages();
const body = cmd === 'file' ? fs.readFileSync(arg, 'utf8') : `return (${arg});`;
const out = await page.evaluate(`(async () => { ${body} })()`);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
await browser.disconnect();
