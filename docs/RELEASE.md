# Release builds and verification

[Support AsoBrain](http://games.asobrain.com/pages/donate.php). All game credit belongs to its original creators. Xplorers Redressed is an unofficial compatibility framework.

## Release contents

Version 0.2.2 targets macOS universal (Intel and Apple Silicon), Windows x64, and Linux x64. Portable application ZIPs contain Electron, the owned framework and icon, third-party dependency notices, and the framework's small bytecode helper. A separate source ZIP contains the corresponding framework sources and build tools. SHA256SUMS identifies the uploaded files.

No original AsoBrain archives, artwork, downloaded cache, decompiled source, research screenshots, account information, or credentials belong in a release. The game downloads directly from AsoBrain on first use. CheerpJ loads separately from its vendor CDN.

The macOS release is signed with CrowFoundry’s Developer ID Application identity, uses hardened runtime and the JIT entitlement needed by Electron, and is notarized with a stapled Apple ticket. Windows is published without Authenticode signing; normal Windows publisher/reputation warnings may appear. No paid Windows signing service is used. SHA-256 checksums identify the uploaded files.

Linux includes a portable ZIP, a Debian/Ubuntu `.deb`, and a Fedora-compatible `.rpm`. Both installers place the Electron sandbox helper in a root-owned installation with mode 4755. Installing needs administrator permission; launching and playing do not. CI installs each package and starts the app as a regular user. RPM startup is checked on the Ubuntu CI runner with its existing Electron libraries; native Fedora gameplay still needs wider testing. The portable ZIP requires unprivileged user namespaces or an administrator-configured sandbox helper. No `--no-sandbox` fallback is included.

## Build procedure

```sh
npm ci
npm run build:bridge
npm test
npm run package:mac
npm run package:win
npm run package:linux
# On Linux, with dpkg-deb and rpmbuild available:
python3 tools/build-linux-packages.py
```

The checked-in icons can be regenerated with `npm run build:icons`, using Python and Pillow. Runtime users do not need those development tools or installed Java. macOS universal packaging should run on macOS. Keep the full application directory together when archiving Windows and Linux packages; preserve executable permissions and symlinks for Linux and macOS.

Before uploading, inspect each app.asar. Its only JAR must be `dist/bridge.jar`, containing only `local/asobrain/*.class`. Confirm the bundle does not contain original game files, assets, research, or secrets. Confirm macOS has arm64 and x86_64 executable slices, Windows has a PE x64 executable, Linux has an ELF x64 executable, and platform icons are present.

For macOS, sign after the final package build, then submit a temporary ZIP with `xcrun notarytool submit`. Authentication and private signing material stay outside the repository. Require status `Accepted`, staple the app with `xcrun stapler staple`, verify `codesign --verify --deep --strict`, `xcrun stapler validate`, and `spctl --assess --type execute`, then create the final ZIP. The temporary submission ZIP does not contain the later stapled ticket, so it must not replace the final release ZIP. The owned signing helper accepts an optional dedicated keychain:

```sh
node tools/sign-macos.cjs "releases/Xplorers Redressed-darwin-universal/Xplorers Redressed.app" "Developer ID Application: Company (TEAMID)" /private/path/release.keychain-db
```

Create source from the release tag with `git archive`. Do not archive the working directory, whose ignored local research and old prototype releases may contain original files. Publish the source and application archives together.

## Validation scope

Automated tests use owned synthetic fixtures, without upstream games or credentials. They cover socket fragmentation, EOF/timeouts/backpressure, archive fingerprint validation, bytecode preparation, helper class verification, mode discovery, login/session import, HTTP ranges, and image geometry/animation/cache behavior. The scaled-graphics regression first reproduces the legacy Rectangle cast exception, then verifies prepared bytecode preserves clip bounds, rendered pixels, general Shape calls, and null clips. An optional owned CheerpJ board-paint fixture checks that the complete buffered map, player, and resource panels appear in both graphics modes. The optional Playwright/Chromium dropdown regression reproduces the native dropdown focus problem and verifies the select-only capture fix preserves selection changes and ordinary game clicks. The helper build separately checks Original pixels/default, Enhanced resampling, high DPI offscreen buffers, cropped drawing, logical PixelGrabber dimensions, and live graphics state changes.

All four observed original client variants were prepared and their patched transport classes verified locally. Live macOS checks authenticated to the original ranked and practice lobbies, rendered Map Editor, and exercised Original/Enhanced and fullscreen. The older Practice 2vs2 launcher was corrected for its obfuscated API and reached its original server; that server reported it was about to restart during validation. Tournament 2 was marked Closed by AsoBrain. This is distinct from completing every mode or a full match. Live application checks use the existing AsoBrain account and original servers; no replacement protocol or test server can establish real server compatibility.

Native CI builds and starts the real packaged launcher on macOS, Windows, and Linux. Startup validation loads the single-page UI, exercises the preload IPC bridge, checks the default Original graphics and unauthenticated state, and exits with a report. Linux also validates the installed DEB and RPM payloads. These checks establish startup and packaging behavior; they do not establish full-match gameplay on Windows or Linux. Availability and behavior also depend on AsoBrain and CheerpJ continuing to serve compatible files. Unknown or changed executable archives require a reviewed fingerprint update before the app will run them.
