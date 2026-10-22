# OK Picker for Clip Studio Paint

A floating colour picker for Clip Studio Paint (CSP) on Android tablets.

OK Picker sits on top of CSP as a small square. Tap the square and a colour panel opens (square, wheel, sliders or OKLCH, with hold-value and hold-hue locks). Whatever you pick changes CSP's brush colour live, and a colour you pick in CSP's own panels shows up in the picker. It uses CSP's own Companion Mode ("Connect to smartphone"), so nothing is installed inside CSP.

The panel is the colour picker from [Design Tools](https://github.com/luapwastaken/Design-tools).

## Install

1. On the tablet, open the [latest release](https://github.com/luapwastaken/ok-picker-csp/releases/latest) and download the `OK-Picker-…apk` file.
2. Open the file. Android will ask you to allow installs from this source (the browser or Files app you opened it from). Allow it and tap Install.

Requirements:

- Android 13 or newer.
- Clip Studio Paint for Android, with Companion Mode ("Connect to smartphone").
- Only tested on a Samsung Galaxy Tab S8 (One UI 8) with CSP 5.1.4 from Google Play.

## First run

Open OK Picker. The setup screen lists a few things Android needs. Each step shows "To do" or "Done" and has a button.

1. **Display over other apps**: lets the picker sit on top of CSP. If the switch is greyed out, tap "Open App info", then the three-dot menu, then Allow restricted settings (Samsung does this for apps installed outside the Play Store).
2. **Notifications**: the notification shows the picker's status and has Hide and Quit.
3. **Battery**: stops Android from putting the picker to sleep while you paint. On Samsung, also add OK Picker to Settings, Battery, Background usage limits, Never sleeping apps.
4. **Show only over Clip Studio** (Usage access, optional): lets the picker see which app is in front, so it hides over other apps and comes back when CSP is open. Find OK Picker in the list and turn it on. Without it, the picker floats over every app until you hide it.

Then tap **Start**. Only the first step is required.

## Pair with Clip Studio

1. In CSP, open **Connect to smartphone** (File menu or the ≡ menu) so its QR code is on screen.
2. Tap the picker's square, then **Pair…** (or ≡ menu, Pair with CSP…).
3. Accept Android's screen-capture prompt. The picker reads one frame of the screen to get the QR code, then connects. Nothing is recorded or kept.

After the first pairing it reconnects by itself, including after CSP is restarted.

Only one companion app can be connected to CSP at a time. If you tap the phone icon in CSP while the picker is connected, that ends the connection and voids the pairing: pair again. The same goes for using the official Companion app.

## Using it

The square:

- Shows the current colour. Tap it to open or close the panel.
- Drag it anywhere. Let go near a screen edge and it docks to that edge.

The panel:

- Drag the title bar to move it anywhere. Drop it with your finger on the square (which lights up) to dock it beside the square again.
- Minimize (the dash) rolls it up to the title bar. The close button hides everything; bring it back with Show in the notification.
- Drag the resize grips on its edges to change its size. A floating panel also resizes from the top edge. In the full panel the colour area grows into the height you give it.
- The compact button in the title bar (or ≡, Display, Compact) switches between the full and the compact panel. Each one remembers its own parts and size.
- **G** in the title bar shows the panel in grey, to judge values.
- The ≡ menu holds:
  - **Style**: Square, Wheel, Sliders or OKLCH.
  - **Model**: HSB, RGB, HSL, CMYK (approximate) or OKLCH.
  - **Copy as**: the format used by the copy button.
  - **Panel parts…**: which parts the panel shows and in what order (below).
  - **Display**: Pop-up (hides when you tap outside it), Keep open, or Compact.
  - **Look**: Dark or Light, and Small, Regular or Large controls.
  - **Pair with CSP…** and **Send report**.
- **Hold value** (V) keeps lightness fixed while you change other things. **Hold hue** (H) keeps the hue fixed.
- The eyedropper button uses CSP's own eyedropper: tap it, then tap the canvas.
- The hex field shows the colour, and the copy button copies it. The small swatch left of it is the previous colour: tap it to go back, tap again to swap.
- The swatch at the bottom shows CSP's main and sub colours. The picker follows whichever is active in CSP.
- **Send report** shares a log (with passwords removed) through the share sheet, for bug reports.

### Panel parts

≡, Panel parts… lists the parts. Tick a part to show it, and drag its handle to move it. Full, Compact and Minimal reset the list to a starting point. Done closes the list.

- **Style switch**, **Colour area**, **Number fields**, **Hold value and hue**, **Hex, eyedropper, copy**: the panel as it was in 1.0.
- **Sliders**: slider rows under the colour area, for one or more of HSB, RGB, HSL, OKLCH and CMYK.
- **Recent colours**: the last 12 colours, from the panel and from CSP. Tap one to use it.
- **Tints**: nine lighter and darker versions of the current colour.
- **Harmonies**: complementary, analogous, triad, split and tetrad colours.
- **Gradient and ramp**: see below.
- **Kept colours**: gradients and ramps you kept, and Export colour set.

### Gradient and ramp

- **Gradient**: a smooth OKLab blend between two colours. The ends start as CSP's main and sub colour; tap an end to set it from the current, main or sub colour. Drag along the bar to mix live, or tap a step. ⋯ has the number of steps, the path (straight through OKLab, or round the hue wheel the short or long way), swap ends and the midpoint. Drag the ◆ under the bar to push the blend toward one end.
- **Ramp**: from one colour, a highlight-to-shadow ramp that warms toward the light and cools into the shadow, with even value steps.
- **Keep** saves the steps to Kept colours (it switches that part on if it's off). **Save colour set…** (in Kept colours, or ⋯ in the gradient) saves an `.aco` file to the tablet, Downloads by default; then in CSP's Color Set palette use Import color set. **Share…** sends the file to another app instead.

Colours you change in CSP's own colour panel, Color Set, history or eyedropper update the picker. The picker starts by itself when the tablet starts. With Usage access on, it shows only while CSP is in front.

## Uninstall

Settings, Apps, OK Picker, Uninstall. You can also long-press the app icon and choose Uninstall.

The notification has two buttons: **Hide** (or Show) and **Quit**, which stops the picker until you open the app again.

## Troubleshooting

- **Not connecting, or "Disconnected from CSP"**: open Connect to smartphone in CSP and pair again. Check that no other companion app is connected.
- **"Sent when CSP is free"**: CSP is mid-stroke or showing a dialog, and it refuses colour changes then. The colour is sent as soon as CSP is free.
- **Nothing shows over CSP**: check the Display over other apps step, and that OK Picker was not stopped from its notification. With Usage access on, it appears only while CSP is in front.
- **After a CSP update it stops working**: the protocol is undocumented and may change. Use Send report and open an issue with the report attached.

## Building from source

Panel (Node):

```sh
cd picker
npm install
DESIGNTOOLS_DIR=<path to a Design-tools checkout> npm run build
```

This writes `picker/dist`, which is committed so the Android app builds without Design Tools. `DESIGNTOOLS_DIR` defaults to a sibling checkout (`../Design-tools` next to this repo). The build records Design Tools' branch and commit in `dist/build-info.json`.

Android app (JDK 21, Android SDK with one platform and build-tools):

```sh
cd android
./gradlew assembleDebug
```

Release signing: `./gradlew assembleRelease` signs with the key named in a properties file outside the repo (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`), whose path is the Gradle property `okpicker.signing` (for example in `~/.gradle/gradle.properties`). Without it the release APK is unsigned.

`./gradlew assembleQa` builds a release-signed, debuggable APK (installs over the release build, keeps its data) for device testing with WebView DevTools; it needs the same signing setup as release.

Tests:

- `cd android && ./gradlew :cspremote:test` runs the protocol library against a fake CSP host.
- `cd picker && npm run verify` drives the panel in headless Chrome with a mock bridge.

Tools:

- `tools/probe`: protocol probe for a running CSP (Node, `npm install` first). It needs a `conn.json` with the QR contents.
- `tools/device`: adb and WebView DevTools checks on a real tablet. Set `TABLET=<ip:port>` (see `adb devices`).

The bridge between the panel and the app is described in [`picker/README.md`](picker/README.md).

## How it works

CSP's Companion Mode lets a phone app control some of CSP over TCP (CSP listens on port 32035). OK Picker is such a client, running on the same tablet: it reads the address and password from CSP's QR code, logs in, and keeps the connection alive. CSP does not push colour changes, so the app polls CSP's colour state (faster while the colour is moving) and sends `SetCurrentColor` when you pick in the panel.

The app is a foreground service that owns two overlay windows (the square and a WebView with the panel). The protocol library, `android/cspremote`, is plain Kotlin with no Android imports. See [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for the protocol as used here.

## Credits

- [clipremote](https://github.com/chocolatkey/clipremote) (MIT) by chocolatkey, whose reverse-engineering of the Companion Mode protocol this project builds on.
- [Design Tools](https://github.com/luapwastaken/Design-tools) for the colour picker.

## Disclaimer

This is an unofficial project. It is not affiliated with or endorsed by CELSYS. Clip Studio Paint is a trademark of CELSYS, Inc. The Companion Mode protocol is undocumented and may change with any CSP update.

## License

MIT, see [LICENSE](LICENSE).
