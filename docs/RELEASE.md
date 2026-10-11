# Release builds and verification

[Support AsoBrain](http://games.asobrain.com/pages/donate.php). All game credit belongs to its original creators. Xplorers Redressed is an unofficial compatibility framework.

## Release contents

Version 0.2.0 targets macOS universal (Intel and Apple Silicon), Windows x64, and Linux x64. Portable application ZIPs contain Electron, the owned framework and icon, third-party dependency notices, and the framework's small bytecode helper. A separate source ZIP contains the corresponding framework sources and build tools. SHA256SUMS identifies the uploaded files.

No original AsoBrain archives, artwork, downloaded cache, decompiled source, research screenshots, account information, or credentials belong in a release. The game downloads directly from AsoBrain on first use. CheerpJ loads separately from its vendor CDN.

These initial builds are published as compiled, without Developer ID/notarized macOS or Authenticode Windows release signatures. SHA-256 checksums verify file contents; they are not publisher signatures. The macOS universal toolchain may retain or generate ad hoc code signatures; those are not Developer ID signatures.

## Build procedure

```sh
npm ci
npm run build:bridge
npm test
npm run package:mac
npm run package:win
npm run package:linux
```

The checked-in icons can be regenerated with `npm run build:icons`, using Python and Pillow. Runtime users do not need those development tools or installed Java. macOS universal packaging should run on macOS. Keep the full application directory together when archiving Windows and Linux packages; preserve executable permissions and symlinks for Linux and macOS.

Before uploading, inspect each app.asar. Its only JAR must be `dist/bridge.jar`, containing only `local/asobrain/*.class`. Confirm the bundle does not contain original game files, assets, research, or secrets. Confirm macOS has arm64 and x86_64 executable slices, Windows has a PE x64 executable, Linux has an ELF x64 executable, and platform icons are present.

Create source from the release tag with `git archive`. Do not archive the working directory, whose ignored local research and old prototype releases may contain original files. Publish the source and application archives together.

## Validation scope

Automated tests use owned synthetic fixtures, without upstream games or credentials. They cover socket fragmentation, EOF/timeouts/backpressure, archive fingerprint validation, bytecode preparation, helper class verification, mode discovery, login/session import, HTTP ranges, and image geometry/animation/cache behavior. The optional Playwright/Chromium regression reproduces the native dropdown focus problem and verifies the select-only capture fix preserves selection changes and ordinary game clicks. The helper build separately checks Original pixels/default, Enhanced resampling, high DPI offscreen buffers, cropped drawing, logical PixelGrabber dimensions, and live graphics state changes.

All four observed original client variants were prepared and their patched transport classes verified locally. Live macOS checks authenticated to the original ranked and practice lobbies, rendered Map Editor, and exercised Original/Enhanced and fullscreen. The older Practice 2vs2 launcher was corrected for its obfuscated API and reached its original server; that server reported it was about to restart during validation. Tournament 2 was marked Closed by AsoBrain. This is distinct from completing every mode or a full match. Live application checks use the existing AsoBrain account and original servers; no replacement protocol or test server can establish real server compatibility.

Platform packaging checks establish executable format and bundle contents. Live Windows and Linux gameplay has not been tested on this macOS development computer. Availability and behavior also depend on AsoBrain and CheerpJ continuing to serve compatible files. Unknown or changed executable archives require a reviewed fingerprint update before the app will run them.
