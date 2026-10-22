// Shared by shots.mjs and verify.mjs: a static server for picker/ and a HEADLESS browser (never a visible window).
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

export function serve() {
  const ref = path.resolve(root, '../reference');
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const f = url.startsWith('/reference/') ? path.join(ref, url.slice(11)) : path.join(root, url);
    if (!existsSync(f) || !f.startsWith(root) && !f.startsWith(ref)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

const EXES = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
export const launch = () =>
  puppeteer.launch({ executablePath: EXES.find(existsSync), headless: true, args: ['--no-first-run', '--disable-gpu-vsync'] });

export const DSF = 340 / 160; // the tablet's WebView
