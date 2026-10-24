# Xplorers Redressed

This is the independent desktop compatibility framework in the historically named `asobrain-web` folder. Read `README.md`, `docs/TECHNICAL.md`, `docs/RELEASE.md` and [the compatibility skill](skills/xplorers-compatibility/SKILL.md) for changes to the launcher, Java bridge, archive preparation, networking or packaging.

The owned Electron/JavaScript framework and Java bridge are separate from the original AsoBrain client and artwork. Original archives download at first use and are fingerprint-checked; keep original assets and account/server behavior out of the repository and release bundles. `research/` is retained local research, not a disposable build directory. Preserve Electron sandboxing and the approved host/port boundary.

`npm test` runs the synthetic Node suites. `npm run build:bridge` builds the owned Java helper; packaging commands and their current prerequisites are in `package.json` and README. Cleanup removed generated desktop bundles and dependency downloads, while retaining source archives, notarization receipts and logs. Reinstall dependencies with the lockfile before rebuilding.
