// Bundles Design Tools' real Picker.tsx (read-only, from DESIGNTOOLS_DIR) with stand-ins for its Electron-bound modules.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DT = process.env.DESIGNTOOLS_DIR ?? path.resolve(here, '../../Design-tools');
const SRC = path.join(DT, 'src');
const norm = (p) => p.replace(/\\/g, '/');
const standin = (f) => path.join(here, 'src/standins', f);

// DT file (path suffix, relative to its src/) -> our stand-in
const STANDINS = {
  'renderer/shell/core/store.ts': standin('store.ts'),
  'renderer/shell/core/settings.ts': standin('settings.ts'),
  'renderer/shell/core/ipc.ts': standin('ipc.ts'),
  'renderer/ui/Tooltip.tsx': standin('Tooltip.tsx'),
};
// bare packages always come from this folder's node_modules (the same versions DT pins)
const PKGS = /^(react|react-dom|culori|@phosphor-icons\/react)(\/.*)?$/;

const plugin = {
  name: 'designtools',
  setup(b) {
    b.onResolve({ filter: /^dt:/ }, (a) => {
      const rel = a.path.slice(3);
      return { path: STANDINS[rel] ?? path.join(SRC, rel) };
    });
    b.onResolve({ filter: /.*/ }, async (a) => {
      if (a.pluginData === 'skip') return;
      if (PKGS.test(a.path)) return b.resolve(a.path, { resolveDir: here, kind: a.kind, pluginData: 'skip' });
      if (a.path.startsWith('.') && norm(a.resolveDir).startsWith(norm(SRC))) {
        const r = await b.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, pluginData: 'skip' });
        const rel = norm(r.path).slice(norm(SRC).length + 1);
        if (STANDINS[rel]) return { path: STANDINS[rel] };
        return r;
      }
    });
    // CopyAs keeps its format in a module variable: expose its setter so the ≡ menu can set it. Source text only; the repo is untouched.
    b.onLoad({ filter: /CopyAs\.tsx$/ }, (a) => ({
      contents: readFileSync(a.path, 'utf8') + '\nexport { remember as setCopyFormat };\n',
      loader: 'tsx',
      resolveDir: path.dirname(a.path),
    }));
  },
};

const git = (...a) => execFileSync('git', ['-C', DT, ...a], { encoding: 'utf8' }).trim();
const info = { designTools: { branch: git('rev-parse', '--abbrev-ref', 'HEAD'), commit: git('rev-parse', 'HEAD') }, built: new Date().toISOString() };

const out = path.join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'assets'), { recursive: true });

await build({
  entryPoints: { app: path.join(here, 'src/main.tsx') },
  outdir: path.join(out, 'assets'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome100', // an Android System WebView from the last few years
  jsx: 'automatic',
  loader: { '.css': 'css', '.woff2': 'dataurl', '.svg': 'dataurl' },
  define: { 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
  banner: { js: `/* OK Picker panel. Design Tools ${info.designTools.branch}@${info.designTools.commit} */` },
  plugins: [plugin],
  logLevel: 'info',
});
// A touch screen keeps :hover on whatever was tapped last, so every button stayed highlighted after a tap. Hover
// styles (Design Tools' modules and ours) apply only where there is a real pointer: each :hover rule moves under
// (hover: hover). The bundle is flat after esbuild (nesting lowered), so a brace walk is enough.
function hoverOnly(css) {
  const close = (s, open) => { for (let d = 0, j = open; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) return j; } return s.length - 1; };
  const split = (sel) => { const r = []; let d = 0, from = 0; for (let j = 0; j < sel.length; j++) { const c = sel[j]; if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; else if (c === ',' && !d) { r.push(sel.slice(from, j)); from = j + 1; } } return [...r, sel.slice(from)]; };
  let out = '';
  for (let i = 0; i < css.length; ) {
    const brace = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    if (css[i] === '@' && semi !== -1 && (brace === -1 || semi < brace)) { out += css.slice(i, semi + 1); i = semi + 1; continue; }
    if (brace === -1) { out += css.slice(i); break; }
    const end = close(css, brace);
    const head = css.slice(i, brace), body = css.slice(brace + 1, end);
    if (head.startsWith('@')) out += head + '{' + (/^@(media|supports|layer|container)/.test(head) ? hoverOnly(body) : body) + '}';
    else {
      const sels = split(head), hover = sels.filter((s) => s.includes(':hover')), rest = sels.filter((s) => !s.includes(':hover'));
      if (rest.length) out += rest.join(',') + '{' + body + '}';
      if (hover.length) out += '@media (hover:hover){' + hover.join(',') + '{' + body + '}}';
    }
    i = end + 1;
  }
  return out;
}
const cssFile = path.join(out, 'assets', 'app.css');
writeFileSync(cssFile, hoverOnly(readFileSync(cssFile, 'utf8')));

cpSync(path.join(here, 'index.html'), path.join(out, 'index.html'));
writeFileSync(path.join(out, 'build-info.json'), JSON.stringify(info, null, 2));
console.log('built', info.designTools.branch, info.designTools.commit.slice(0, 7));
