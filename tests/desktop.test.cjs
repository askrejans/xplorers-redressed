const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { SocketBridge, WebsiteSession, parseLaunch, parseModeCatalog, createImportScript, createLocalServer, SITE, isExternalAllowed } = require('../lib/desktop.cjs');

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function fixture(t, handler) {
  const server = net.createServer(handler);
  const port = await listen(server);
  const bridge = new SocketBridge({ allowedTargets: { '127.0.0.1': [port] } });
  t.after(async () => { bridge.closeAll(); await new Promise(resolve => server.close(resolve)); });
  return { bridge, port };
}

function launch(port = 1983, username = 'Alice', auth = 'session%26token') {
  return `<html><APPLET code='fixture.Xplorers' archive="fixture.jar" codebase='http://games.asobrain.com/applets/xplorers/'>
    <PARAM NAME='user' VALUE='${username}'><param name="auth" value="${auth}">
    <param name=primaryPort value=${port}><param name='secondaryPort' value='${port === 1980 ? 1982 : port}'>
    <param name="label" value="Cities &amp; Knights &#39;game&#39;">
    </APPLET></html>`;
}

const MODE_FIXTURES = [
  ['xplorersCities1', 'Rank C&K 1', 1980], ['xplorersBasic1', 'Rank Basic 1', 1983],
  ['xplorersTeam1', 'Rank 2vs2 1', 1989], ['xplorersTournament1', 'Tournament 1', 1970],
  ['xplorersTournament2', 'Tournament 2', 1971, true], ['xplorersPractice1', 'Practice 1', 1985],
  ['xplorersPractice2', 'Practice 2', 1986], ['xplorersTournament3', 'Practice 2vs2', 1972],
  ['mapeditor', 'Map Editor', 1988],
];

function catalog() {
  return '<table>' + MODE_FIXTURES.map(([id, label, _port, closed], index) => `<tr>${index === 0 ? '<td rowspan="9">Xplorers</td>' : ''}<td><a href='javascript:launch2016("${id}","/pages/play/launch/${id}.php")'>${label}</a></td><td>${closed ? 'Closed' : '5 /400'}</td><td>Fixture notes</td></tr>`).join('') +
    '<tr><td><a href=\'javascript:launch2016("toulouse","/pages/play/launch/toulouse1.php")\'>Toulouse</a></td></tr></table>';
}

function importFixture() {
  return { playHtml: catalog(), launches: Object.fromEntries(MODE_FIXTURES.filter(mode => !mode[3]).map(([id, _label, port]) => [id, launch(port)])) };
}

test('production socket allowlist rejects arbitrary hosts and ports', async () => {
  const bridge = new SocketBridge();
  await assert.rejects(bridge.open('127.0.0.1', 1983), { code: 'FORBIDDEN_TARGET' });
  await assert.rejects(bridge.open('games.asobrain.com', 80), { code: 'FORBIDDEN_TARGET' });
});

test('socket reads preserve fragmented binary data, partial reads, and EOF', async t => {
  const { bridge, port } = await fixture(t, socket => {
    socket.write(Buffer.from([0, 255]));
    setTimeout(() => socket.write(Buffer.from([3, 4, 5])), 25);
    setTimeout(() => socket.end(Buffer.from([6])), 55);
  });
  const id = await bridge.open('127.0.0.1', port);
  assert.deepEqual([...await bridge.read(id, 1, 1000)], [0]);
  assert.equal(bridge.available(id), 1);
  assert.deepEqual([...await bridge.read(id, 1, 1000)], [255]);
  assert.deepEqual([...await bridge.read(id, 20, 1000)], [3, 4, 5]);
  assert.deepEqual([...await bridge.read(id, 20, 1000)], [6]);
  assert.deepEqual([...await bridge.read(id, 20, 1000)], []);
  const addresses = bridge.addresses(id);
  assert.equal(addresses.remotePort, port);
  assert.equal(addresses.remoteAddress, '127.0.0.1');
  assert.equal(addresses.localAddress, '127.0.0.1');
});

test('read timeout leaves the socket usable and close unblocks a waiting read', async t => {
  let remote;
  const { bridge, port } = await fixture(t, socket => { remote = socket; });
  const id = await bridge.open('127.0.0.1', port);
  await assert.rejects(bridge.read(id, 32, 15), { code: 'SOCKET_TIMEOUT', message: 'Read timed out' });
  remote.write(Buffer.from([42]));
  assert.deepEqual([...await bridge.read(id, 32, 1000)], [42]);
  const waiting = bridge.read(id, 32);
  assert.throws(() => bridge.read(id, 1), { code: 'SOCKET_BUSY' });
  bridge.close(id);
  await assert.rejects(waiting, { code: 'SOCKET_CLOSED' });
  assert.throws(() => bridge.available(id), { code: 'SOCKET_CLOSED' });
  bridge.close(id);
});

test('large writes handle backpressure without dropping or reordering bytes', async t => {
  const payload = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  let complete;
  const received = new Promise(resolve => { complete = resolve; });
  const { bridge, port } = await fixture(t, socket => {
    const chunks = [];
    let length = 0;
    socket.pause();
    setTimeout(() => socket.resume(), 20);
    socket.on('data', bytes => {
      chunks.push(bytes);
      length += bytes.length;
      if (length === payload.length) { complete(Buffer.concat(chunks)); socket.end(); }
    });
  });
  const id = await bridge.open('127.0.0.1', port);
  await bridge.write(id, payload);
  assert.deepEqual(await received, payload);
  await assert.rejects(bridge.write(id, 'text'), { code: 'INVALID_WRITE' });
});

test('launcher parser handles original quoting and HTML entities without decoding URL parameters', () => {
  const meta = parseLaunch(launch());
  assert.equal(meta.code, 'fixture.Xplorers');
  assert.equal(meta.archive, 'fixture.jar');
  assert.equal(meta.params.primaryPort, '1983');
  assert.equal(meta.params.auth, 'session%26token');
  assert.equal(meta.params.label, "Cities & Knights 'game'");
  assert.throws(() => parseLaunch('<form name="login"></form>'), { code: 'NO_LAUNCH' });
});

test('catalog discovers grouped Xplorers rows, their player counts, and the closed tournament', () => {
  const modes = parseModeCatalog(catalog());
  assert.deepEqual(modes.map(mode => mode.id), MODE_FIXTURES.map(mode => mode[0]));
  assert.equal(modes.find(mode => mode.id === 'mapeditor').label, 'Map Editor');
  assert.equal(modes.find(mode => mode.id === 'xplorersTournament2').available, false);
  assert.equal(modes[0].players, 5);
  assert.equal(modes[0].capacity, 400);
  assert.equal(modes[1].players, 5);
  assert.doesNotThrow(() => new vm.Script(createImportScript('http://127.0.0.1:12345/session')));
});

test('login sends the original form, preserves cookies, and fetches every available launcher', async t => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const bytes of request) body += bytes;
    requests.push({ path: request.url, body, cookie: request.headers.cookie });
    response.setHeader('Content-Type', 'text/html');
    if (request.method === 'POST') {
      response.setHeader('Set-Cookie', 'PHPSESSID=fixture-session; path=/');
      response.end(new URLSearchParams(body).get('authpass') === 'wrong' ? '<input name="authpass">' : catalog());
    } else {
      if (request.headers.cookie !== 'PHPSESSID=fixture-session') { response.writeHead(401).end(); return; }
      const mode = MODE_FIXTURES.find(([id]) => request.url.endsWith(`${id}.php`));
      response.end(launch(mode[2]));
    }
  });
  const port = await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const session = new WebsiteSession({ site: `http://127.0.0.1:${port}` });
  let notification;
  session.once('session', value => { notification = value; });
  const result = await session.login('Alice', 'p&word');
  const posted = new URLSearchParams(requests[0].body);
  assert.equal(posted.get('authuser'), 'Alice');
  assert.equal(posted.get('authpass'), 'p&word');
  assert.equal(posted.get('login'), 'true');
  assert.equal(result.lobbies.xplorersBasic1.params.primaryPort, '1983');
  assert.equal(result.lobbies.xplorersCities1.params.primaryPort, '1980');
  assert.equal(result.modes.length, 9);
  assert.equal(requests.length, 9);
  assert.equal(requests.some(request => request.path.endsWith('xplorersTournament2.php')), false);
  assert.equal(notification, result);
  assert.equal(session.getSession(), result);
  assert.equal(JSON.stringify(session.getSession()).includes('p&word'), false);
  assert.equal(Object.hasOwn(session.getSession(), 'password'), false);
  assert.equal(session.redact('Alice session%26token session&token password=secret'), '[redacted] [redacted] [redacted] password=[redacted]');
  session.logout();
  assert.equal(session.getSession(), null);
  assert.equal(session.cookies.size, 0);
  await assert.rejects(session.login('Alice', 'wrong'), error => {
    assert.equal(error.code, 'LOGIN_FAILED');
    assert.equal(error.message.includes('wrong'), false);
    assert.equal(error.message.includes('session%26token'), false);
    assert.equal(error.message.includes('<input'), false);
    return true;
  });
  assert.equal(session.getSession(), null);
});

test('localhost import requires the original site Origin and static assets stay within dist', async t => {
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'asobrain-desktop-test-'));
  await fs.writeFile(path.join(dist, 'index.html'), '<p>Local client</p>');
  const session = new WebsiteSession();
  const { server, origin, importUrl } = await createLocalServer({ dist, session });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dist, { recursive: true }); });
  const body = JSON.stringify(importFixture());
  assert.equal((await fetch(importUrl, { method: 'POST', body })).status, 403);
  assert.equal((await fetch(importUrl, { method: 'POST', body, headers: { Origin: 'http://evil.example' } })).status, 403);
  const preflight = await fetch(importUrl, { method: 'OPTIONS', headers: { Origin: SITE } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), SITE);
  const imported = await fetch(importUrl, { method: 'POST', body, headers: { Origin: SITE, 'Content-Type': 'application/json' } });
  assert.equal(imported.status, 200);
  assert.deepEqual(await imported.json(), { ok: true });
  assert.equal(session.getSession().username, 'Alice');
  assert.equal(session.getSession().modes.length, 9);
  assert.equal(session.getSession().modes.find(mode => mode.id === 'xplorersTournament2').available, false);
  assert.equal((await fetch(importUrl, { method: 'POST', body: '{}', headers: { Origin: SITE } })).status, 400);
  assert.equal(await (await fetch(origin)).text(), '<p>Local client</p>');
  assert.equal((await fetch(`${origin}/%2e%2e%2fmain.cjs`)).status, 403);
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = http.get(origin, { headers: { Host: 'other-host.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(reboundStatus, 403);
});

test('framework helper jar supports full, bounded, suffix, and HEAD byte ranges for CheerpJ', async t => {
  const dist = path.join(__dirname, '..', 'dist');
  const jar = await fs.readFile(path.join(dist, 'bridge.jar'));
  const { server, origin } = await createLocalServer({ dist, session: new WebsiteSession() });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `${origin}/bridge.jar`;
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(Number(full.headers.get('Content-Length')), jar.length);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), jar);
  const first = await fetch(url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('Content-Range'), `bytes 0-3/${jar.length}`);
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [0x50, 0x4b, 0x03, 0x04]);
  const suffix = await fetch(url, { headers: { Range: 'bytes=-512' } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), jar.subarray(-512));
  const open = await fetch(url, { headers: { Range: `bytes=${jar.length - 22}-` } });
  assert.equal(open.status, 206);
  assert.deepEqual(Buffer.from(await open.arrayBuffer()), jar.subarray(-22));
  const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=10-29' } });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('Content-Length'), '20');
  assert.equal(head.headers.get('Content-Range'), `bytes 10-29/${jar.length}`);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const range of [`bytes=${jar.length}-`, 'bytes=20-10', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4']) {
    const invalid = await fetch(url, { headers: { Range: range } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('Content-Range'), `bytes */${jar.length}`);
  }
});

test('external website links permit only Asobrain HTTP(S) and the CheerpJ HTTPS credit', () => {
  for (const url of ['http://games.asobrain.com/pages/profile.php?user=Alice', 'https://forums.asobrain.com/', 'https://cheerpj.com/']) assert.equal(isExternalAllowed(url), true);
  for (const url of ['https://asobrain.com.evil.test/', 'https://evil.test/asobrain.com', 'http://cheerpj.com/', 'file:///tmp/index.html', 'javascript:alert(1)', 'https://user:password@games.asobrain.com/']) assert.equal(isExternalAllowed(url), false);
});
