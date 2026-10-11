const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const manifest = require('../package.json');

test('release package filters exclude credentials and original archives while retaining the owned helper', async () => {
  const filterModule = path.join(path.dirname(require.resolve('@electron/packager')), 'copy-filter.js');
  const { populateIgnoredPaths, userPathFilter } = await import(pathToFileURL(filterModule).href);
  const root = path.join(__dirname, '..');
  for (const target of ['mac', 'win', 'linux']) {
    const ignore = /--ignore="([^"]+)"/.exec(manifest.scripts[`package:${target}`])[1];
    const options = { dir: root, out: path.join(root, 'releases'), prune: false, ignore };
    const filter = userPathFilter({ ...options, ...populateIgnoredPaths(options) });
    for (const name of ['.git/config', '.env', '.env.local', 'credentials/private.key', 'private.pem', 'signing.p12', 'signing.pfx', 'signing.jks', 'signing.keystore', 'dist/assets/original/card.gif', 'dist/xplorers-browser.jar', 'original-client.jar', 'research/original.jar', 'releases/archive.zip']) {
      assert.equal(await filter(path.join(root, name)), false, `${target}: ${name}`);
    }
    for (const name of ['main.cjs', 'preload.cjs', 'lib/client-cache.cjs', 'dist/index.html', 'dist/bridge.jar', 'dist/bridge-runtime.js', 'packaging/icon.png', 'LICENSE']) {
      assert.equal(await filter(path.join(root, name)), true, `${target}: ${name}`);
    }
  }
});
