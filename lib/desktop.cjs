const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SITE = 'http://games.asobrain.com';
const GAME_PORTS = [1970, 1971, 1972, 1980, 1982, 1983, 1984, 1985, 1986, 1987, 1988, 1989];

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

class SocketBridge {
  constructor({ allowedTargets = { 'games.asobrain.com': GAME_PORTS }, connectTimeoutMs = 10000 } = {}) {
    this.allowedTargets = allowedTargets;
    this.connectTimeoutMs = connectTimeoutMs;
    this.sockets = new Map();
    this.nextId = 1;
  }

  async open(host, port) {
    host = String(host).toLowerCase();
    port = Number(port);
    if (!this.allowedTargets[host]?.includes(port)) throw fail('FORBIDDEN_TARGET', 'This game server is not allowed');
    const id = this.nextId++;
    const socket = new net.Socket();
    const state = { socket, chunks: [], length: 0, ended: false, closed: false, error: null, reader: null };
    this.sockets.set(id, state);
    socket.setNoDelay(true);
    socket.on('data', data => {
      state.chunks.push(data);
      state.length += data.length;
      this.flush(state);
    });
    socket.on('end', () => { state.ended = true; this.flush(state); });
    socket.on('error', error => {
      state.error = fail('SOCKET_ERROR', error.message);
      this.flush(state);
    });
    socket.on('close', () => { state.ended = true; this.flush(state); });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const error = fail('SOCKET_TIMEOUT', 'Connection timed out');
          socket.destroy(error);
        }, this.connectTimeoutMs);
        const finish = callback => value => {
          clearTimeout(timer);
          socket.off('connect', connected);
          socket.off('error', failed);
          callback(value);
        };
        const connected = finish(resolve);
        const failed = finish(reject);
        socket.once('connect', connected);
        socket.once('error', failed);
        socket.connect(port, host);
      });
      return id;
    } catch (error) {
      this.sockets.delete(id);
      throw error;
    }
  }

  get(id) {
    const state = this.sockets.get(Number(id));
    if (!state) throw fail('SOCKET_CLOSED', 'Socket is closed');
    return state;
  }

  flush(state) {
    const reader = state.reader;
    if (!reader) return;
    if (state.closed) return reader.finish(fail('SOCKET_CLOSED', 'Socket is closed'));
    if (state.length) {
      const bytes = Buffer.allocUnsafe(Math.min(reader.max, state.length));
      let offset = 0;
      while (offset < bytes.length) {
        const chunk = state.chunks[0];
        const count = Math.min(chunk.length, bytes.length - offset);
        chunk.copy(bytes, offset, 0, count);
        offset += count;
        if (count === chunk.length) state.chunks.shift();
        else state.chunks[0] = chunk.subarray(count);
      }
      state.length -= bytes.length;
      return reader.finish(null, new Uint8Array(bytes));
    }
    if (state.error) return reader.finish(state.error);
    if (state.ended) reader.finish(null, new Uint8Array());
  }

  read(id, max, timeoutMs = 0) {
    const state = this.get(id);
    if (!Number.isInteger(max) || max < 1 || max > 16 * 1024 * 1024) throw fail('INVALID_READ', 'Invalid read length');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0) throw fail('INVALID_READ', 'Invalid read timeout');
    if (state.reader) throw fail('SOCKET_BUSY', 'A read is already waiting on this socket');
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (error, value) => {
        clearTimeout(timer);
        state.reader = null;
        if (error) reject(error); else resolve(value);
      };
      state.reader = { max, finish };
      if (timeoutMs) timer = setTimeout(() => finish(fail('SOCKET_TIMEOUT', 'Read timed out')), timeoutMs);
      this.flush(state);
    });
  }

  async write(id, bytes) {
    const state = this.get(id);
    if (state.closed || state.ended) throw fail('SOCKET_CLOSED', 'Socket is closed');
    if (state.error) throw state.error;
    if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) throw fail('INVALID_WRITE', 'Expected bytes');
    await new Promise((resolve, reject) => {
      state.socket.write(Buffer.from(bytes), error => error ? reject(fail('SOCKET_ERROR', error.message)) : resolve());
    });
  }

  available(id) { return this.get(id).length; }

  addresses(id) {
    const { socket } = this.get(id);
    return { localAddress: socket.localAddress, remoteAddress: socket.remoteAddress, localPort: socket.localPort, remotePort: socket.remotePort };
  }

  close(id) {
    const state = this.sockets.get(Number(id));
    if (!state) return;
    state.closed = true;
    this.flush(state);
    state.socket.destroy();
    this.sockets.delete(Number(id));
  }

  closeAll() { for (const id of this.sockets.keys()) this.close(id); }
}

function decodeEntities(value) {
  const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity.startsWith('#')) {
      const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return number <= 0x10ffff ? String.fromCodePoint(number) : match;
    }
    return names[entity.toLowerCase()];
  });
}

function attributes(tag) {
  const result = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  return result;
}

function parseLaunch(html) {
  const applet = String(html).match(/<applet\b([^>]*)>([\s\S]*?)<\/applet\s*>/i);
  if (!applet) throw fail('NO_LAUNCH', 'The website did not return a game launcher. Log in again.');
  const attrs = attributes(applet[1]);
  const params = {};
  for (const match of applet[2].matchAll(/<param\b([^>]*)>/gi)) {
    const attr = attributes(match[1]);
    if (attr.name && attr.value !== undefined) params[attr.name] = attr.value;
  }
  if (!attrs.code || !attrs.archive || !params.user || !params.auth) throw fail('NO_LAUNCH', 'The website returned an incomplete game launcher');
  return { code: attrs.code, codebase: attrs.codebase || `${SITE}/applets/`, archive: attrs.archive, params };
}

function textContent(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseModeCatalog(html) {
  const modes = [];
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    for (const anchor of row[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
      const href = attributes(anchor[1]).href || '';
      const launch = /launch2016\s*\(\s*(['"])(.*?)\1\s*,\s*(['"])(\/pages\/play\/launch\/(?:xplorers\w+|mapeditor)\.php)\3\s*\)/i.exec(href);
      if (!launch) continue;
      const id = path.basename(launch[4], '.php');
      if (modes.some(mode => mode.id === id)) continue;
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(cell => textContent(cell[1]));
      const count = cells.map(cell => /^(\d+)\s*\/\s*(\d+)$/.exec(cell)).find(Boolean);
      modes.push({
        id,
        label: textContent(anchor[2]) || cells[0] || launch[2],
        description: cells.at(-1) || '',
        launchName: launch[2],
        launchPath: launch[4],
        available: !/\bclosed\b/i.test(textContent(row[1])),
        players: count ? Number(count[1]) : null,
        capacity: count ? Number(count[2]) : null,
      });
    }
  }
  if (!modes.length) throw fail('NO_CATALOG', 'The website did not return the Xplorers room list. Log in again.');
  return modes;
}

function completeSession(modes, username) {
  const lobbies = {};
  for (const mode of modes) {
    if (mode.available) {
      const params = Object.fromEntries(Object.entries(mode.params).map(([key, value]) => [key.toLowerCase(), value]));
      if (!GAME_PORTS.includes(Number(params.primaryport))) throw fail('NO_LAUNCH', 'The website returned an unsupported Xplorers game port');
      for (const name of ['primaryport', 'secondaryport']) {
        if (params[name] !== undefined && !GAME_PORTS.includes(Number(params[name]))) throw fail('NO_LAUNCH', 'The website returned an unsupported Xplorers game port');
      }
      lobbies[mode.id] = mode;
    }
  }
  if (!username) {
    const user = modes.find(mode => mode.available)?.params.user || '';
    try { username = decodeURIComponent(user.replace(/\+/g, ' ')); } catch { username = user; }
  }
  return { authenticated: true, username, modes, lobbies };
}

function createImportScript(importUrl) {
  async function transfer(endpoint) {
    try {
      const playHtml = await (await fetch('/pages/play/index.php?javaVersion=1.8.0', { credentials: 'include' })).text();
      const page = new DOMParser().parseFromString(playHtml, 'text/html');
      const paths = new Map();
      for (const row of page.querySelectorAll('tr')) {
        if (/\bClosed\b/i.test(row.textContent)) continue;
        for (const link of row.querySelectorAll('a[href]')) {
          const match = link.getAttribute('href').match(/\/pages\/play\/launch\/(?:xplorers\w+|mapeditor)\.php/i);
          if (match) paths.set(match[0].split('/').pop().replace(/\.php$/, ''), match[0]);
        }
      }
      const launches = {};
      for (const [id, launchPath] of paths) launches[id] = await (await fetch(launchPath, { credentials: 'include' })).text();
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playHtml, launches }) });
      if (!response.ok) throw Error();
      alert('Session imported. Return to the local Xplorers client.');
    } catch { alert('Import failed. Keep the local client open and log in to AsoBrain first.'); }
  }
  return `(${transfer.toString()})(${JSON.stringify(importUrl)})`;
}

class WebsiteSession extends EventEmitter {
  constructor({ site = SITE } = {}) {
    super();
    this.site = site;
    this.cookies = new Map();
    this.session = null;
  }

  request(urlPath, body, redirects = 0) {
    if (redirects > 4) return Promise.reject(fail('WEBSITE_ERROR', 'Too many website redirects'));
    const url = new URL(urlPath, this.site);
    if (url.origin !== this.site) return Promise.reject(fail('WEBSITE_ERROR', 'Unexpected website redirect'));
    return new Promise((resolve, reject) => {
      const headers = { 'User-Agent': 'AsoBrain-Local-Client', Cookie: [...this.cookies.values()].join('; ') };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      const request = http.request(url, { method: body === undefined ? 'GET' : 'POST', headers }, response => {
        for (const cookie of response.headers['set-cookie'] || []) {
          const pair = cookie.split(';', 1)[0];
          this.cookies.set(pair.split('=', 1)[0], pair);
        }
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          this.request(new URL(response.headers.location, url).href, undefined, redirects + 1).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(fail('WEBSITE_ERROR', `Website request failed (${response.statusCode})`));
          return;
        }
        const chunks = [];
        let length = 0;
        response.on('data', chunk => {
          length += chunk.length;
          if (length > 2 * 1024 * 1024) response.destroy(fail('WEBSITE_ERROR', 'Website response is too large'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      request.setTimeout(15000, () => request.destroy(fail('WEBSITE_ERROR', 'Website request timed out')));
      request.on('error', reject);
      request.end(body);
    });
  }

  async login(username, password) {
    if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) throw fail('LOGIN_FAILED', 'Enter your username and password');
    this.cookies.clear();
    const body = new URLSearchParams({ login: 'true', authuser: username, authpass: password, lobby: '' }).toString();
    const html = await this.request('/pages/play/index.php?javaVersion=1.8.0', body);
    if (/name\s*=\s*['"]?authpass\b/i.test(html)) throw fail('LOGIN_FAILED', 'The website did not accept the login. Check your username and password.');
    const modes = parseModeCatalog(html);
    for (const mode of modes) if (mode.available) Object.assign(mode, parseLaunch(await this.request(mode.launchPath)));
    this.session = completeSession(modes, username);
    this.emit('session', this.session);
    return this.session;
  }

  import(data) {
    const modes = parseModeCatalog(data?.playHtml || '');
    for (const mode of modes) {
      if (!mode.available) continue;
      const launcher = data?.launches?.[mode.id];
      if (typeof launcher !== 'string') throw fail('NO_LAUNCH', `Missing ${mode.label} launcher`);
      Object.assign(mode, parseLaunch(launcher));
    }
    this.session = completeSession(modes);
    this.emit('session', this.session);
    return this.session;
  }

  getSession() { return this.session; }

  logout() { this.cookies.clear(); this.session = null; this.emit('session', null); }

  redact(message) {
    let result = String(message);
    const secrets = [this.session?.username, ...this.cookies.values()];
    for (const lobby of Object.values(this.session?.lobbies || {})) {
      for (const [key, value] of Object.entries(lobby.params)) {
        if (/user|auth|password|token/i.test(key)) {
          secrets.push(String(value));
          try { secrets.push(decodeURIComponent(String(value).replace(/\+/g, ' '))); } catch {}
        }
      }
    }
    for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[redacted]');
    return result.replace(/\b(auth|password|token|cookie)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]');
  }
}

async function createLocalServer({ dist, session, cache }) {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jar': 'application/java-archive', '.wasm': 'application/wasm', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
  let origin;
  const server = http.createServer(async (request, response) => {
    if (request.headers.host !== new URL(origin).host) { response.writeHead(403).end(); return; }
    const pathname = new URL(request.url, origin).pathname;
    if (pathname === '/session') {
      if (request.headers.origin !== SITE) { response.writeHead(403).end(); return; }
      const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin', 'Cache-Control': 'no-store' };
      if (request.method === 'OPTIONS') { response.writeHead(204, cors).end(); return; }
      if (request.method !== 'POST') { response.writeHead(405, cors).end(); return; }
      let body = '';
      try {
        for await (const chunk of request) {
          body += chunk.toString();
          if (body.length > 1024 * 1024) throw fail('INVALID_IMPORT', 'Session import is too large');
        }
        session.import(JSON.parse(body));
        response.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
      } catch {
        response.writeHead(400, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'Invalid session import' }));
      }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    try {
      let data;
      let extension;
      if (pathname.startsWith('/client/')) {
        const resource = await cache?.resolve(pathname);
        if (!resource) { response.writeHead(404).end(); return; }
        data = resource.bytes || await fs.readFile(resource.filename);
        extension = resource.extension || path.extname(resource.filename);
      } else {
        const filename = path.resolve(dist, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
        if (!filename.startsWith(path.resolve(dist) + path.sep)) { response.writeHead(403).end(); return; }
        data = await fs.readFile(filename);
        extension = path.extname(filename);
      }
      const headers = { 'Content-Type': mime[extension] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        let start = 0;
        let end = data.length - 1;
        if (match?.[1]) { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
        else if (match?.[2]) start = Math.max(0, data.length - Number(match[2]));
        if (!match || !(match[1] || match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= data.length) {
          response.writeHead(416, { ...headers, 'Content-Range': `bytes */${data.length}`, 'Content-Length': 0 }).end();
          return;
        }
        const slice = data.subarray(start, end + 1);
        response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': slice.length });
        response.end(request.method === 'HEAD' ? undefined : slice);
      } else {
        response.writeHead(200, { ...headers, 'Content-Length': data.length });
        response.end(request.method === 'HEAD' ? undefined : data);
      }
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, importUrl: `${origin}/session` };
}

function isExternalAllowed(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return false;
    return url.hostname === 'asobrain.com' || url.hostname.endsWith('.asobrain.com') || (url.protocol === 'https:' && url.hostname === 'cheerpj.com');
  } catch { return false; }
}

module.exports = { SITE, GAME_PORTS, SocketBridge, WebsiteSession, parseLaunch, parseModeCatalog, createImportScript, createLocalServer, isExternalAllowed };
