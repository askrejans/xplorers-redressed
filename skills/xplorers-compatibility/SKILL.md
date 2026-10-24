---
name: xplorers-compatibility
description: Maintain Xplorers Redressed's Electron launcher, owned Java bridge, WebAssembly client preparation and desktop packaging using synthetic compatibility tests.
---

# Xplorers desktop compatibility

Read paths from this project root: `README.md`, `docs/TECHNICAL.md`, `docs/RELEASE.md`, `package.json` and the affected source in `main.cjs`, `lib/`, `tools/` or `tests/`. Identify which boundary is failing: authenticated mode catalog, archive download/fingerprint, local class preparation, CheerpJ display, preload bridge, native TCP forwarding or package startup.

The current framework runs the original Java bytecode through a WebAssembly runtime. Keep ownership explicit: the owned helper `dist/bridge.jar` is built from this repository, while original client archives and artwork belong in the user's application cache and download directly from their original source. Preserve the cached original; transformations operate on a local working copy. Unknown archive fingerprints must go through compatibility review before execution rather than quietly bypassing the check.

Use synthetic owned fixtures for parser, archive and networking tests. Preserve the main/preload boundary, the approved destination host/ports, Electron sandboxing, session-only authentication values and HTTP range semantics. Graphics changes must retain original game coordinates and distinguish the original display path from optional enhancement. Verify status against actual connections and catalog observations rather than fabricated availability.

Use `npm test` for the Node tests and `npm run build:bridge` when changing the owned Java helper. Packaging commands are the existing `package:mac`, `package:win` and `package:linux` scripts. Inspect their exclusion rules and verify that releases contain neither signing secrets nor original client assets. Keep notarization receipts and release verification alongside compiled-package records. Running live account/game sessions requires the task to actually call for that verification; synthetic tests do not need user credentials.
