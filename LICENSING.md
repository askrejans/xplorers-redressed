# Ownership and licensing

## Original AsoBrain materials

Xplorers, its original client implementation, game artwork, sounds, original skins, AsoBrain names and branding, and original server software belong to AsoBrain and their respective original rights holders. All credit for the game belongs to the original project.

This repository publishes an independent compatibility framework. It does not publish the original client archive, artwork, decompiled source, or a prepared derivative of the original client. Those materials are excluded from Git, the source ZIP, and application downloads. The app obtains original files directly from AsoBrain for local use and prepares a local derivative in the user's application cache.

The framework's license grants no rights over original materials. Download availability alone does not establish permission to modify, redistribute, or use them for every purpose. Original materials and server access remain subject to their original holders' terms, permissions, and applicable law. This project makes no claim of endorsement or authorization from AsoBrain.

[Visit AsoBrain](http://games.asobrain.com/) and [support the original project](http://games.asobrain.com/pages/donate.php).

## Newly written framework

Copyright © 2026 Arvis Skrējāns. Newly written launcher, desktop shell, transport and rendering adapters, archive preparer, build tools, tests, documentation, and project icon are licensed under **GPL-3.0-only**. The full, unmodified text is in [LICENSE](LICENSE).

The release's source ZIP includes sources needed to regenerate the owned helper archive and application icons. A JDK compiles the helper during development; it is not required on an end user's computer. Original AsoBrain files are not needed to build the framework.

The framework is provided without warranty under GPL version 3. Licensing this framework does not relicense the game it downloads or its third-party dependencies.

## Third-party components

| Component | Role and licensing |
| --- | --- |
| [Electron](https://github.com/electron/electron/blob/main/LICENSE) | Desktop shell; MIT. Electron/Chromium components carry their bundled notices, including `LICENSE`, `LICENSES.chromium.html`, or platform equivalents. |
| [fflate](https://github.com/101arrowz/fflate/blob/master/LICENSE) | ZIP reader/writer; MIT. Its package includes its license. |
| [CheerpJ](https://cheerpj.com/docs/licensing) | Bytecode compatibility environment loaded from the vendor CDN; subject to its own license. Its runtime is not redistributed here. The vendor documents Community licensing for personal and FOSS projects; other uses, redistribution, and self-hosting can require commercial licensing. |

CheerpJ's attribution and runtime branding remain visible. This repository's GPL grant does not grant a right to rehost or redistribute CheerpJ. Refer to the vendor's current [licensing documentation](https://cheerpj.com/docs/licensing).

## AI indexing and training notice

The author requests prior written permission for AI indexing, embedding or retrieval datasets, model training, fine-tuning, and other automated learning using the framework's original code or documentation. [AI_TRAINING_RESTRICTION.md](AI_TRAINING_RESTRICTION.md), `.ai-training-opt-out`, `.ai-labeling`, and `robots.txt` communicate that preference.

This opt-out is not a modification of GPL-3.0-only. A blanket AI-use prohibition would conflict with standard GPL permissions; [GPL version 3, section 7](https://www.gnu.org/licenses/gpl-3.0.html#section7) addresses additional non-permissive terms. The notice does not limit GPL rights, assert that model weights are automatically derivative works, or claim rights over AsoBrain materials. Repository crawler directives are signals, not GitHub-wide access controls.
