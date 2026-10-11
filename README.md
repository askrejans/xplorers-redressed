# Xplorers Redressed

**[♥ Support the original AsoBrain project](http://games.asobrain.com/pages/donate.php)** · [Visit AsoBrain](http://games.asobrain.com/) · [Download desktop releases](https://github.com/askrejans/xplorers-redressed/releases/latest)

All credit for Xplorers, its game rules, original client, artwork, servers, and community belongs to **AsoBrain and the original creators**. If this wrapper helps you return to the game, please support the people who made it and keep its servers running.

Xplorers Redressed is an **unofficial, reverse-engineered desktop compatibility framework** for the original multiplayer Xplorers client. Java applets belong to the 2000s; current browsers no longer run them. This project gives the same game a modern desktop frame, fullscreen support, and an optional smoother graphics path while preserving its existing account and server behavior.

It requires **no installed Java, native JVM, or browser plugin**. The original Java bytecode runs inside a WebAssembly environment supplied by CheerpJ. The game itself remains the original implementation; this is a compatibility port, rather than a new implementation of the game rules.

**The repository and release downloads contain no original AsoBrain client or artwork.** On first launch of a mode, the framework downloads the required client directly from AsoBrain, checks its recorded SHA-256 fingerprint, and prepares a local working copy. Additional original skin images download when needed. Original files remain in your local application cache.

## Download and play

Get the package for your computer from [Releases](https://github.com/askrejans/xplorers-redressed/releases/latest):

| Package | Run after extraction |
| --- | --- |
| macOS universal, Apple Silicon and Intel | `Xplorers Redressed.app` |
| Windows x64 | `Xplorers Redressed.exe` |
| Linux x64 | `Xplorers Redressed` |
| Framework source ZIP | Build using the instructions below |

Keep all accompanying files together on Windows and Linux. These are portable packages, with no installer. Linux needs a graphical desktop and Electron's required system libraries. The current release is provided as compiled, without a Developer ID/notarized macOS signature or Windows Authenticode signature.

An internet connection is required for AsoBrain and the CheerpJ runtime CDN. First launch takes longer while the original game and runtime download.

1. Open the app and sign in using your existing AsoBrain username and password.
2. Choose a room or Map Editor. Original rankings, opponents, account permissions, and server rules apply.
3. Use **Fullscreen**, **F11**, or **Control–Command–F** on macOS. **Rooms** closes the current connection and returns to the launcher.

Cookies and launch authentication values stay in memory for the application session. The app saves its graphics preference and downloaded game resources locally. AsoBrain's legacy login and game connections retain their original HTTP/TCP protocols; this wrapper does not add encryption to those server connections.

## All Xplorers modes

The launcher reads the authenticated catalog from AsoBrain, including available and closed rooms:

| Mode | Original behavior retained |
| --- | --- |
| Rank C&K 1 | Cities & Knights with human opponents |
| Rank Basic 1 | Basic ranked games with human opponents |
| Rank 2vs2 1 | Ranked team games |
| Tournament 1 | Current tournament room |
| Tournament 2 | Listed; disabled while AsoBrain marks it Closed |
| Practice 1 | Bots, humans, and user maps |
| Practice 2 | Bots, humans, and user maps |
| Practice 2vs2 | Team games with bots and humans |
| Map Editor | Original map editor and account permissions |

Game creation, settings, skins, spectating, replays, chat, reconnects, rankings, and rules remain handled by the downloaded original client and original servers. Availability can change. AsoBrain's other games are outside this release.

**Original** graphics are the default. **Enhanced** resamples original static artwork with bicubic interpolation and preserves resolution through the game's offscreen buffers. It keeps original designs and game coordinates. Animated images retain their live frames. Switch modes in the launcher or during play; the preference is remembered. Smoothing cannot recover artistic detail absent from the original pixels.

## How it works

Electron hosts a single-page launcher and an embedded CheerpJ 4.3 WebAssembly display. The main process signs in to AsoBrain, reads its applet launch parameters, and downloads the selected archive. A JavaScript class-file preparer modifies a private local copy to redirect socket construction and a small set of image operations into the framework's owned helpers. Invalidated signing metadata is removed only from the local derivative; the cached original remains untouched.

The socket helper forwards original binary traffic through Electron's native TCP bridge, limited to the original AsoBrain host and Xplorers ports. The framework does not replace the server, account database, matchmaking, or rules engine. Four observed executable archive versions are fingerprinted; an unknown or changed archive fails before execution until compatibility and its fingerprint are reviewed.

The small `dist/bridge.jar` is built exclusively from this repository's sources. It contains no AsoBrain classes or artwork. CheerpJ loads from its vendor CDN and is not included in the releases. See [technical documentation](docs/TECHNICAL.md).

## Development

Use Node.js 22 or newer, Python 3, and a JDK supporting `javac --release 8`. Java is a **development tool** for compiling and verifying the owned helper; packaged app users do not need it.

```sh
npm ci
npm run build:bridge
npm test
npm start
```

The helper build verifies its classes and runs synthetic graphics checks. Node tests cover archive preparation, sockets, mode parsing, login/session import, cache integrity, resource routing, and HTTP ranges. Tests use owned fixtures without AsoBrain archives or credentials. An optional browser dropdown regression also runs when Playwright and Chromium are available.

```sh
npm run package:mac
npm run package:win
npm run package:linux
```

Packaging uses the original project icon in `packaging/`. To regenerate it, install Pillow for development and run `npm run build:icons`. macOS universal packaging should run on macOS. Build outputs and local research are ignored by Git and excluded from packages. See [release verification](docs/RELEASE.md).

## Copyright and licensing

**Xplorers and its original code, artwork, names, and other original materials remain the copyright of AsoBrain and their original rights holders.** They have not been relicensed by this project. Public download availability is not a grant of copyright permission. Use of the original client and servers remains subject to AsoBrain's applicable terms and permissions. This framework is independent and not endorsed by AsoBrain.

Only the newly written framework, documentation, and project icon are offered under **GNU GPL version 3 only**, in [LICENSE](LICENSE). Third-party components retain their own licenses. See [LICENSING.md](LICENSING.md) and [NOTICE](NOTICE) for ownership boundaries and runtime attribution.

The repository carries an [AI indexing and training opt-out](AI_TRAINING_RESTRICTION.md) and crawler metadata following the author's other projects. These request prior permission; they do not remove GPL-3.0-only rights or add an incompatible restriction.

**[Please support AsoBrain—the original game and community.](http://games.asobrain.com/pages/donate.php)**
