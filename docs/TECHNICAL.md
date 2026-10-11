# Technical architecture

Xplorers Redressed is a desktop compatibility framework around the original AsoBrain Xplorers clients. AsoBrain supplies the game, rules, artwork, authentication and servers. The framework supplies an Electron window, a modern WebAssembly runtime, a TCP adapter and optional rendering changes. See the [README](../README.md) for usage and [LICENSING.md](../LICENSING.md) for component licensing and attribution. Support the original project through [AsoBrain’s donation page](http://games.asobrain.com/pages/donate.php).

## Download and execution

The application discovers rooms and launcher parameters from the authenticated original website. On first use of a client variant, `lib/client-cache.cjs` downloads its original archive from AsoBrain and checks the pinned SHA-256 fingerprint in `CORE_HASHES`. Four observed variants are supported: `xplorers2.41.2f.jar`, `xplorers2.40.6f.jar`, `xplorers2.40.5f.jar` and `mapeditor2.38f.jar`. A different main archive version requires an updated verified fingerprint.

Original downloads and prepared copies live under Electron’s `userData/client-cache`; they are not part of the repository or release bundle. Additional skin archives accept image resources only. Loose artwork and audio can be fetched from the original codebase when requested. These media downloads do not have the main archives’ individual hash pins.

`lib/prepare-client.cjs` uses `fflate` to modify bytecode operands in memory and produce a locally cached client archive. Original game and packet implementations remain in that archive. Signing metadata invalidated by the modifications is removed from the prepared copy; the cached original is retained separately.

The local HTTP server exposes the owned frontend and cached client to Electron. `dist/index.html` loads CheerpJ **4.3** from its vendor CDN and selects its **Java 8** runtime. CheerpJ executes the original Java bytecode through JavaScript/WebAssembly. This is a compatibility port, not a JavaScript rewrite of Xplorers. End users need no installed Java, native JVM process or browser plugin. Network access remains necessary for AsoBrain and the runtime CDN.

## Owned adapters

The distributable `dist/bridge.jar` contains only the framework’s `local.asobrain` classes, without original game classes or artwork:

- `Bootstrap` reflects the verified launcher class, calls its existing `launchWebStart` method and resizes its frame through the AWT event queue. One asynchronous controller receives display size and graphics mode changes.
- `BridgeSocket` replaces observed `new java.net.Socket` calls and their matching constructors. Its streams call the narrow Electron socket API through `tools/bridge/bridge-runtime.js`.
- `SmoothAssets` handles supported AWT image decoding, drawing and offscreen image creation. Bytecode hooks preserve instruction lengths and the original logical coordinates.

`lib/desktop.cjs`, `main.cjs` and `preload.cjs` implement the website/session integration, local serving and TCP IPC. The original client still performs its own handshake, serialization, game actions and reconnect logic. The adapter forwards the byte stream rather than implementing a replacement game protocol. The same original account and authenticated launcher values are used; server-side permissions and availability still apply.

## Observed mode catalog

The UI reads current availability from AsoBrain. The observed catalog contains eight available modes and one closed room:

| Mode | Primary port | Client variant |
| --- | ---: | --- |
| Rank C&K 1 | 1980 | `xplorers2.41.2f.jar` |
| Rank Basic 1 | 1983 | `xplorers2.41.2f.jar` |
| Rank 2vs2 1 | 1989 | `xplorers2.40.6f.jar` |
| Tournament 1 | 1970 | `xplorers2.41.2f.jar` |
| Tournament 2 — closed | — | Launcher is not fetched while closed |
| Practice 1 | 1985 | `xplorers2.41.2f.jar` |
| Practice 2 | 1986 | `xplorers2.41.2f.jar` |
| Practice 2vs2 | 1972 | `xplorers2.40.5f.jar` |
| Map Editor | 1988 | `mapeditor2.38f.jar` |

Backup ports come from the original launcher parameters. Map Editor uses `MapEditorLauncher`; the game variants use `Xplorers`. The pinned older practice team archive uses a verified obfuscated launcher method and frame field, selected only for its exact superclass.

## Rendering and validation

**Original is the default.** Enhanced mode resamples eligible static source images at 4× using bicubic interpolation. Offscreen drawing uses 2× backing images while reporting original logical dimensions, allowing high DPI detail to survive buffered composition. Larger backing images increase memory use. Resampling cannot recover detail absent from the source artwork.

The preparer replaces `Graphics.getClip()` with `getClipBounds()` only when the next instruction casts the result to `Rectangle`. Scaled offscreen graphics can return a `Rectangle2D` shape; the original card panels’ cast would throw before the completed board buffer reaches the screen. General shape clips retain their original behavior.

A capture handler keeps native Choice dropdown clicks from reaching CheerpJ’s enclosing AWT click listener, which would otherwise move focus to a hidden text input and close the popup. It does not cancel the browser default or selection change events.

Animated GIFs retain their original animated image instead of becoming cached first-frame snapshots. Live mode changes repaint windows and refresh the verified card, ocean and island caches, including narrow aliases for the obfuscated older practice client.

Development commands are:

```sh
npm install
npm run build:bridge
npm test
npm start
```

Only rebuilding the owned helper requires Python 3 and a JDK supporting `javac --release 8`. `tools/build-bridge.py` compiles and verifies helpers, runs `tools/VerifySmoothAssets.java` against synthetic images, then packages owned classes only. Tests cover stream boundaries, resize signals, archive preservation, bytecode parity and JVM verification. An optional real CheerpJ rendering regression, `node tools/verify-awt-paint.cjs`, requires a JDK, an existing Playwright/Chromium and pngjs installation, and internet access. It uses owned fixtures to reproduce the blank board before preparation and verify map, player, and resource panels appear in Original and Enhanced modes after preparation. It needs no game archives or accounts. All four observed originals have passed preparation and transport bytecode verification. Live smoke testing has authenticated and loaded an original lobby; this does not establish that every mode or complete match has been played. Desktop targets are macOS universal, Windows x64 and Linux x64.

Original downloaded clients and media remain AsoBrain/original-creator material. They are not bundled here or relicensed under the framework’s GPL license; see [LICENSING.md](../LICENSING.md).
