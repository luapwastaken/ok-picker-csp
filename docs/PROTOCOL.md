# Companion Mode protocol, as used by OK Picker

Clip Studio Paint's Companion Mode ("Connect to smartphone") is an undocumented TCP protocol. Almost everything here comes from [clipremote](https://github.com/chocolatkey/clipremote) (Go, MIT) by chocolatkey, read at commit `582daf2`, which was reverse-engineered from `libClipStudioPaint.so` and checked against a live CSP host. The rest was measured with a probe (`tools/probe`) against CSP PRO 5.1.4 (Google Play build) on a Galaxy Tab S8, Android 16. Implementation: `android/cspremote/src/main/kotlin/com/luap/cspremote/` (`Protocol.kt`, `CspClient.kt`).

Only the subset OK Picker needs is covered.

## Pairing QR

CSP shows a QR code containing a URL:

```
https://companion.clip-studio.com/rc/<lang>?s=<hex>
```

To decode: hex-decode `s`, XOR it with the repeating key `74 B2 92 5B 4A 21 DA`, and split on tab characters.

| field | meaning |
| --- | --- |
| 1 | `ips`: comma-separated IPv4 addresses of the host |
| 2 | `port`: TCP port (CSP 5.1.4: 32035) |
| 3 | `password`: one-time password for the first login |
| 4 | `generation`: string sent back at login (seen: `G#1:2022.12`) |

## Frame format

Every message, both directions, is one frame over TCP:

```
<type> $tcp_remote_command_protocol_version=1.0 <1E> $command=<name> <1E> $serial=<n> <1E> $detail=<json> <1E> <00>
```

- `<type>` is one byte; there is no space between it and the text. Fields are separated by `0x1E`; the frame ends with a NUL byte.
- A binary tail can follow the JSON after a `0x0B` byte. OK Picker ignores it.

| type | meaning |
| --- | --- |
| `0x01` | command (a request, or a command CSP starts) |
| `0x06` | success reply |
| `0x15` | error reply |

Replies carry the command name and serial of the request. Each command that CSP starts must be answered with a `0x06` frame carrying the same command and serial and an empty detail. The client does this inside its request loop, whenever it reads a type `0x01` frame while waiting for its own reply.

The serial is a counter the client increments per request, starting at 0 for each connection.

## Authentication

The first command on a connection is `Authenticate`. Its detail is a JSON array of three strings, where `hex(xor(x))` means: XOR the UTF-8 bytes of `x` with the repeating key `B6 D5 92 C4 A7 83 E1`, then lowercase hex.

| login | detail |
| --- | --- |
| first pairing | `[generation, hex(xor(qrPassword)), hex(xor(newPassword))]` |
| reconnect | `[generation, hex(xor(reconnectMarker)), hex(xor(savedPassword))]` |

- `newPassword` is chosen by the client (OK Picker: 6 random bytes, base64 without padding). It replaces the QR password: CSP accepts the QR password once, and the client must store `newPassword` for later logins. The password rotates only on a first pairing; a reconnect login does not change it.
- The reconnect marker is the literal string `{{(([[reconnection request marker]]))}}\r\n`.
- **Success is read from `AuthErrorReason` in the reply detail, not from the type byte.** `""` or `"Unknown"` means success. `VersionMismatch`, `PasswordMismatch` and `ServerUnready` are failures. `ServerUnready` is worth retrying; the other two are not.
- The reply carries `RemoteCommandSpecVersionOfServer` (seen: `G#1:2022.12`) and, in CSP 5.1.4, `IsQuickAccessAvailable: true`.

## Keep-alive

`TellHeartbeat` with an empty detail, about once a second.

## Commands used

### SetCurrentColor

Sets the active (main or sub) colour.

```json
{"IsColorTransparent":false,"RGBColorR":18,"RGBColorG":52,"RGBColorB":86}
```

RGB are bytes 0..255. The request must **not** carry `ColorSpaceKind` or `ColorIndex`: their absence is how CSP tells an RGB request apart. The colour shown in CSP's own Color panel matched what was sent exactly (`#123456` read back as 18, 52, 86).

### SyncSubViewUIState

Request with an empty detail. Reply fields used:

| field | encoding |
| --- | --- |
| `CurrentColorRed`, `CurrentColorGreen`, `CurrentColorBlue` | 32-bit scale: byte x `0x01010101` (not 0..255) |
| `IsCurrentColorTransparent` | boolean; when true the RGB reads 255, 255, 255 |
| `CanExecuteSetterCommand` | boolean, see below |

It always reports the active colour.

### SyncColorCircleUIState

Request with an empty detail. Reply fields used:

| field | encoding |
| --- | --- |
| `ColorSelectionModel` | `"HSV"` or HLS (anything else) |
| `HLSColorMainH/L/S`, `HLSColorSubH/L/S` | each 0..`0xFFFFFFFF`: H maps to 0..360 degrees, L and S to 0..100% |
| `HSVColorMainH/S/V`, `HSVColorSubH/S/V` | same scale, used when the model is HSV |
| `CurrentColorIndex` | 0 main, 1 sub, -1 transparent |
| `IsCurrentColorTransparent`, `CanExecuteSetterCommand` | booleans |
| `IsManipulating` | boolean |

### DoModeChange (eyedropper)

Simulates a modifier key. With a brush selected, CSP's default turns Alt into its eyedropper, so holding Alt lets the user tap the canvas to pick a colour; the next colour read is the pick.

```json
{"FlagShift":false,"FlagControl":false,"FlagAlt":true,"ProxyKeyboardEventKind":"KeyDown"}
```

Send the same body with `"KeyUp"` to release.

## CanExecuteSetterCommand

Present in both Sync replies. It is false while CSP is mid-stroke and while CSP shows a modal dialog (for example the restore notice after a force-stop). Setters are refused then, so OK Picker holds the latest colour and sends it once the flag is true again.

## Connection behaviour

- **One client at a time.** CSP stops listening while a client is connected, so only one companion app can be connected.
- CSP's server starts when Connect to smartphone opens and stops if the dialog closes with nobody paired. After the first login the dialog closes itself and the server stays up. It survived a force-stop of CSP: the port came back on relaunch, and the rotated password still logged in with no QR.
- CSP listens on `0.0.0.0`, so a client on the same tablet can connect to `127.0.0.1`. OK Picker tries loopback first, then each address from the QR, because a QR address can be stale after a Wi-Fi change.
- Tapping CSP's own phone icon while connected disconnects the client and voids the saved password (`PasswordMismatch` on the next login): pair again from a fresh QR.

## Polling

clipremote lists the two Sync commands as pushes from the host, but **CSP 5.1.4 pushed nothing**. The wheel, Color Set, history, main/sub swap and eyedropper all became visible only by polling, which caught every change at a 250 ms interval. `SetServerSelectedTabKind` with an empty body did not turn pushes on, and `GetServerSelectedTabKind` stays `Invalid`.

So the client polls `SyncSubViewUIState` and `SyncColorCircleUIState` in turn. OK Picker's intervals: 30 ms for 1.5 s after the colour last changed (a drag on CSP's wheel gives about 32 updates a second), then an idle interval of 100 ms with the panel open, 500 ms with only the square showing, and 2 s while CSP is not in front.

Measured round trips from a PC, at 60 colour sets a second for 5 s: median 12 ms, p95 20 ms, max 46 ms, no errors.

## Echo rule

A colour sent with `SetCurrentColor` comes back in the next poll. If the RGB read back equals one sent a moment ago, a client should keep its own representation (for example OKLCH) rather than re-deriving it from RGB, or the picker will jump. OK Picker's panel does this for every colour sent in the last 1.5 s.
