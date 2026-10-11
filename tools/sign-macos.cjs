#!/usr/bin/env node
'use strict';

// Copyright (C) 2026 Arvis Skrējāns. SPDX-License-Identifier: GPL-3.0-only
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  const [app, identity, keychain, extra] = process.argv.slice(2);
  if (!app || !identity || extra !== undefined) {
    throw new Error('Usage: node tools/sign-macos.cjs <app.app> "Developer ID Application: Company (TEAMID)" [keychain]');
  }
  if (!identity.startsWith('Developer ID Application: ')) {
    throw new Error('Direct-download signing requires a Developer ID Application identity from the local Keychain.');
  }
  if (process.platform !== 'darwin') throw new Error('macOS signing must run on macOS.');
  const appPath = path.resolve(app);
  if (!appPath.endsWith('.app')) throw new Error('The signing target must be an Electron .app bundle.');
  await fs.access(appPath);
  const { sign } = await import('@electron/osx-sign');
  await sign({
    app: appPath,
    identity,
    ...(keychain ? { keychain: path.resolve(keychain) } : {}),
    identityValidation: true,
    platform: 'darwin',
    type: 'distribution',
    version: require('../package.json').devDependencies.electron,
    optionsForFile: () => ({
      entitlements: path.join(__dirname, '../packaging/entitlements.macos.plist'),
      hardenedRuntime: true,
    }),
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
  console.log(`Signed and verified: ${appPath}`);
  console.log('Notarize and staple this app before publishing the final archive.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
