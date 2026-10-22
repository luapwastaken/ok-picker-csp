# OK Picker panel (stage 1)

The picker panel for the Android overlay: Design Tools' real `Picker.tsx`, bundled, in a CSP-style frame.
`npm run build` makes `dist/` (index.html, assets/app.js, assets/app.css, build-info.json). The Android app copies `dist/` into `assets/` as-is.

- `npm install` once, then `npm run build`. `DESIGNTOOLS_DIR` (default: a sibling checkout, `../../Design-tools` relative to this folder) is read-only; branch and commit go into `dist/build-info.json` and the first line of `app.js`.
- `npm run verify` and `npm run shots`: headless Chrome over CDP (no real input). Shots land in `shots/`.
- Stand-ins (`src/standins/`, aliased by `build.mjs`): `store.ts` + `settings.ts` (localStorage), `ipc.ts` (clipboard -> `bridge.copy`), `Tooltip.tsx` (long-press). DT's own `Menu.tsx`/`Toast.tsx` draw the menus and toasts, themed by the CSP tokens. `CopyAs.tsx` gets one export appended at build time (`setCopyFormat`) so the menu can set the format.
- Looks: `src/styles/csp-dark.css` (sampled), `csp-light.css` (guessed), `csp-base.css` (type and touch sizes). Theme = `data-theme` on `<html>`; density = `data-density`.

## WebView settings the page expects
JavaScript and DOM storage on (localStorage keeps style, model, copy format, look, display). Page background is opaque, so no transparent window is needed. Long-press must not start text selection or the context menu (the page already blocks `contextmenu`).

## Bridge

### JS -> Android: `window.AndroidBridge` (`@JavascriptInterface`, string/number args only)
| method | meaning |
| --- | --- |
| `setColor(r, g, b)` | sRGB bytes 0..255 (ints). Called continuously while dragging (not repeated for an identical colour). Native keeps the latest, and holds it while CSP is busy (`canSet` false, e.g. mid-stroke) until CSP frees up. |
| `copy(text)` | text for the clipboard (Copy / Copy as) |
| `frame(action)` | `minimize`, `restore`, `close`, plus informational `look:dark`, `look:light`, `density:regular`, `density:large` (the panel applies these itself; native may ignore them) |
| `dragTitle(phase, x, y)` | window move. `phase` is `start`/`move`/`end`; x, y are the pointer's `clientX/clientY` in CSS px at the event. Native: screen point = current window origin + client * density; move the window by the change since `start`. |
| `resize(edge, phase, x, y)` | same coordinates. `edge`: `left`, `right`, `bottom`, `bottomleft`, `bottomright`. Which edges show depends on `dock` (below): the edge nearest the canvas, and the bottom. |
| `pair()` | the Pair with CSP... menu row and the Pair button |
| `sendReport()` | the Send report row |
| `setDisplay(mode)` | `popup` or `tab`, from the menu |
| `frame('compact:on')` / `frame('compact:off')` | compact mode (title bar, main control, hold row, strip) switched on or off; sent on every change and once at startup after `ready()`. Designed for 200 CSS px wide (min 180). |
| `frame('fit:<css px>')` | compact only: the natural content height in CSS px; native sizes the window to it (re-sent when it changes) |
| `eyedropper(on)` | `true`: hold Alt in CSP so its brush becomes the eyedropper and the user taps the canvas; `false`: release it. The page's `EyeDropper` polyfill (`src/eyedropper.ts`, WebView has none) calls it: it resolves with the next `onCspColor` whose RGB differs from the one at open, and gives up (calls `eyedropper(false)`) after 15 s or when opened again. Mock records the calls; `?eyedropper=poly` forces the polyfill in desktop Chrome. |
| `ready()` | optional, called once `window.cspPicker` is installed. The page checks a method exists before calling it. |

Minimize: the panel hides its body and calls `frame('minimize')` (restore: `frame('restore')`); native should resize the window to the title bar height (`--titlebar-h` = 32 CSS px) and back. Minimize shows only in pop-up/float display, as in CSP.

### Android -> JS: `window.cspPicker`
- `onCspColor({r, g, b, index, transparent, canSet})`: `index` 0 main, 1 sub, -1 transparent. `canSet:false` (every stroke, and dialogs) changes nothing on screen at first; after 1.5 s the full panel says "CSP is busy" and the swatch ring greys. Busy never changes the layout. A repeated identical colour is ignored. `transparent:true` shows "Transparent colour" and leaves the picker alone.
- `onSubColor({r, g, b})`: the sub colour (swatch in the status strip, and the picker's Match menu).
- `onStatus({state, detail})`: `connected` | `connecting` | `disconnected` | `unpaired` (shows a Pair button). Shown in the status strip.
- `onTheme('dark'|'light')`: also chosen from the menu; the last one wins.
- Optional extras: `onLayout({dock: 'left'|'right'|'float', display: 'popup'|'tab', minimized: boolean})`. `dock` picks the resize edges (left dock: right edge + bottom; right dock: left edge + bottom; float: all). Default `dock=left`, `display` from localStorage (default `popup`).

### Echo rule
If an incoming CSP RGB equals the last RGB the panel sent, the picker keeps its own OKLCH. Any other incoming colour clears that memory, so the same RGB arriving later is applied.

### Mock (no `AndroidBridge`)
Calls go to `window.__bridgeCalls` (`[{fn, args}]`). Inject with `window.cspPicker.onCspColor({...})` in the console. URL params for tests: `?theme=dark|light&display=popup|tab&dock=left|right|float&density=regular|large&minimized=1&status=connected|unpaired|...`.

## Touch sizes
Measured in the reference (2.125x): CSP's rows, toolbar buttons and tool icons are 34-40 CSS px (palette title strip is about 22). The panel uses: rows/menu rows 40, buttons 40 (32 small), icon buttons 38/34/28, title bar and its buttons 32, status strip 32. Density Large adds about 15%. Resize grips are 20 px wide (bottom 14, corners 24) with 26 px of body padding beside them, because Chrome's touch adjustment snaps a touch within a few px of the edge to the picker area next to it.
