#!/usr/bin/env node
'use strict';

// Optional integration check: JDK, Playwright/Chromium, pngjs and the public CheerpJ CDN are required.
// NODE_PATH can point at existing packages; no game archives or accounts are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { zipSync, strToU8 } = require('fflate');
const { prepareClient } = require('../lib/prepare-client.cjs');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const project = path.resolve(__dirname, '..');

async function verify() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorers-awt-paint-'));
  let browser, server;
  try {
    const compiled = spawnSync('javac', ['--release', '8', '-cp', path.join(project, 'dist/bridge.jar'),
      '-d', temporary, path.join(project, 'tests/fixtures/OwnedPaintFixture.java')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    const entries = { 'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0\r\nMain-Class: fixture.OwnedPaintFixture\r\n\r\n') };
    for (const filename of fs.readdirSync(path.join(temporary, 'fixture'))) {
      if (filename.endsWith('.class')) entries[`fixture/${filename}`] = fs.readFileSync(path.join(temporary, 'fixture', filename));
    }
    const original = zipSync(entries);
    const prepared = prepareClient(original).jar;
    const jars = { '/original.jar': original, '/prepared.jar': prepared, '/bridge.jar': fs.readFileSync(path.join(project, 'dist/bridge.jar')) };
    server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      const bytes = jars[url.pathname];
      if (bytes) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Number(range[2]) : bytes.length - 1;
        if (start > end || end >= bytes.length) { response.writeHead(416); response.end(); return; }
        response.writeHead(range ? 206 : 200, {
          'Content-Type': 'application/java-archive', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
          ...(range && { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }),
        });
        response.end(bytes.subarray(start, end + 1));
        return;
      }
      if (url.pathname !== '/') { response.writeHead(404); response.end(); return; }
      const jar = url.searchParams.get('prepared') === '1' ? 'prepared' : 'original';
      const mode = url.searchParams.get('mode') === 'enhanced' ? 'enhanced' : 'original';
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<div id="display"></div><script src="https://cjrtnc.leaningtech.com/4.3/loader.js"></script><script>
        (async()=>{await cheerpjInit({version:8,status:'none'});cheerpjCreateDisplay(640,400,document.getElementById('display'));
        await cheerpjRunMain('fixture.OwnedPaintFixture','/app/bridge.jar:/app/${jar}.jar','${mode}');})()
        .catch(error=>console.error('AWT runtime failed',error));</script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    for (const scenario of [
      { prepared: false, mode: 'original' },
      { prepared: true, mode: 'original' },
      { prepared: true, mode: 'enhanced' },
    ]) {
      const page = await browser.newPage();
      try {
        const logs = [];
        let finish;
        const finished = new Promise(resolve => { finish = resolve; });
        page.on('console', message => {
          logs.push(message.text());
          if (message.text().includes('AWT fixture finished')) finish();
        });
        page.on('pageerror', error => logs.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/?prepared=${Number(scenario.prepared)}&mode=${scenario.mode}`);
        let timeout;
        try {
          await Promise.race([finished, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Error(`AWT fixture timed out: ${logs.join('\n')}`)), 90000);
          })]);
        } finally { clearTimeout(timeout); }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        // Check displayed pixels; the runtime owns the canvas and its readback implementation.
        const { data } = PNG.sync.read(await page.screenshot());
        const pixels = { map: 0, players: 0, resources: 0 };
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] !== 255) continue;
          if (data[i] === 0 && data[i + 1] === 255 && data[i + 2] === 0) pixels.map++;
          if (data[i] === 255 && data[i + 1] === 200 && data[i + 2] === 0) pixels.players++;
          if (data[i] === 0 && data[i + 1] === 255 && data[i + 2] === 255) pixels.resources++;
        }
        const failedCast = logs.some(line => line.includes('ClassCastException'));
        if (scenario.prepared) {
          assert.equal(failedCast, false, logs.join('\n'));
          for (const [panel, count] of Object.entries(pixels)) assert.ok(count > 1000, `${scenario.mode}: ${panel} did not reach the screen (${count} pixels)\n${logs.join('\n')}`);
        } else {
          assert.equal(failedCast, true, 'The original owned fixture must reproduce the legacy clip cast failure');
          assert.deepEqual(pixels, { map: 0, players: 0, resources: 0 }, 'A failed child paint must leave the board blank');
        }
        console.log(`${scenario.prepared ? 'Prepared' : 'Before fix'} ${scenario.mode}: ${JSON.stringify(pixels)}; legacy cast failure=${failedCast}`);
      } finally { await page.close(); }
    }
    console.log('Verified the real CheerpJ board repaint in Original and Enhanced modes with owned fixtures only.');
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
