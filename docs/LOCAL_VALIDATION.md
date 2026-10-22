# Local validation and packaging

Builds and tests run on developer machines. Hosted GitHub workflows, artifact uploads and automatic release publishing have been removed. Use Node.js 22+, Python 3 and JDK 17 (the bridge targets Java 8).

```sh
npm ci
npm run build:bridge
npm test
```

Package on the target OS with `npm run package:mac`, `npm run package:win` or `npm run package:linux`, then run `node tools/smoke-package.cjs` against that native package. Linux package verification additionally uses `python3 tools/build-linux-packages.py` and an actual Debian/RPM install under a normal desktop user. Verify that the installed `chrome-sandbox` is owned by root with mode 4755; retain Electron sandboxing.

Follow [the release checklist](RELEASE.md) for signing, notarization, smoke checks and archive preparation. Release uploads remain an explicit owner action after checks on the exact revision; no workflow automatically creates or replaces downloads. Keep original client archives/artwork, runtime caches and signing credentials out of packages and source control.
