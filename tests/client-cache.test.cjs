const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ClientCache, downloadBytes, sourceUrl } = require('../lib/client-cache.cjs');
const { WebsiteSession, createLocalServer } = require('../lib/desktop.cjs');

test('upstream client downloads are bounded and reject redirects outside the original source', async t => {
  const server = http.createServer((request, response) => {
    if (request.url.endsWith('redirect.jar')) response.writeHead(302, { Location: 'http://outside.example/applets/xplorers/client.jar' }).end();
    else if (request.url.endsWith('large.jar')) response.end(Buffer.alloc(1025));
    else response.end('fixture');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.throws(() => sourceUrl('http://outside.example/applets/xplorers/client.jar', origin), /Unexpected/);
  assert.throws(() => sourceUrl(`${origin}/pages/play/index.php`, origin), /Unexpected/);
  assert.throws(() => sourceUrl(`${origin}/applets/xplorers/client.jar?auth=secret`, origin), /Unexpected/);
  await assert.rejects(downloadBytes(`${origin}/applets/xplorers/redirect.jar`, { origin }), /Unexpected/);
  await assert.rejects(downloadBytes(`${origin}/applets/xplorers/large.jar`, { origin, maxBytes: 1024 }), /too large/);
});

test('original archive cache is reused between modes, never stores login metadata, and serves ranges', async t => {
  const fixtureJar = Buffer.from('PK\x03\x04owned orchestration fixture');
  const image = Buffer.from('owned image fixture');
  const requested = [];
  const upstream = http.createServer((request, response) => {
    requested.push(request.url);
    response.end(request.url.endsWith('.gif') ? image : fixtureJar);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xplorers-cache-test-'));
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'xplorers-static-test-'));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  let preparations = 0;
  const prepareClient = bytes => { preparations++; return { jar: bytes, mainClass: 'fixture.Client' }; };
  const trustedArchives = { 'client.jar': createHash('sha256').update(fixtureJar).digest('hex') };
  const cache = new ClientCache({ directory, origin, prepareClient, trustedArchives });
  const mode = { id: 'basic', available: true, codebase: `${origin}/applets/xplorers/`, archive: 'client.jar', params: { user: 'PRIVATE_USER', auth: 'PRIVATE_AUTH' } };
  const first = await cache.prepare(mode);
  const second = await cache.prepare({ ...mode, id: 'cities' });
  assert.equal(preparations, 1);
  assert.deepEqual(requested, ['/applets/xplorers/client.jar']);
  assert.equal(first.classpath, '/app/bridge.jar:/app/client/basic/client.jar');
  assert.equal(second.mainClass, 'fixture.Client');
  const client = await cache.resolve('/client/basic/client.jar');
  assert.deepEqual(await fs.readFile(client.filename), fixtureJar);
  assert.equal((await fs.readFile(client.filename)).includes('PRIVATE_AUTH'), false);
  const resource = await cache.resolve('/client/cities/pale/card.gif');
  assert.deepEqual(resource.bytes, image);
  assert.equal(await cache.resolve('/client/cities/../preferences.json'), null);
  const newCache = new ClientCache({ directory, origin, prepareClient, trustedArchives });
  await newCache.prepare(mode);
  assert.equal(requested.filter(url => url.endsWith('client.jar')).length, 1);
  const local = await createLocalServer({ dist, session: new WebsiteSession(), cache });
  t.after(async () => {
    await new Promise(resolve => local.server.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    await fs.rm(directory, { recursive: true });
    await fs.rm(dist, { recursive: true });
  });
  const response = await fetch(`${local.origin}/client/basic/client.jar`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(response.status, 206);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(await (await fetch(`${local.origin}/client/cities/pale/card.gif`)).text(), image.toString());
});

test('mismatched source and cached executable archives never reach preparation or serving', async t => {
  const expected = Buffer.from('PK\x03\x04expected owned fixture');
  const malicious = Buffer.from('PK\x03\x04different executable payload');
  const server = http.createServer((_request, response) => response.end(malicious));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xplorers-integrity-test-'));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const mode = { id: 'basic', available: true, codebase: `${origin}/applets/xplorers/`, archive: 'fixture.jar' };
  const trustedArchives = { 'fixture.jar': createHash('sha256').update(expected).digest('hex') };
  let preparations = 0;
  const cache = new ClientCache({ directory, origin, trustedArchives, prepareClient: () => { preparations++; } });
  await assert.rejects(cache.prepare(mode), /SHA-256 integrity check/);
  assert.equal(preparations, 0);
  assert.equal(await cache.resolve('/client/basic/client.jar'), null);
  await assert.rejects(fs.readdir(path.join(directory, 'downloads')), { code: 'ENOENT' });
  const url = `${mode.codebase}fixture.jar`;
  const cachedPath = path.join(directory, 'downloads', createHash('sha256').update(url).digest('hex'));
  await fs.mkdir(path.dirname(cachedPath), { recursive: true });
  await fs.writeFile(cachedPath, malicious);
  await assert.rejects(cache.prepare(mode), /SHA-256 integrity check/);
  assert.equal(preparations, 0);
  assert.equal(await cache.resolve('/client/basic/client.jar'), null);
  await assert.rejects(cache.prepare({ ...mode, archive: 'unknown-next-version.jar' }), /Unsupported original client version/);
});
