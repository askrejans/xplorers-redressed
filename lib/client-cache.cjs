const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const SITE = 'http://games.asobrain.com';
const MAX_DOWNLOAD = 32 * 1024 * 1024;
const CORE_HASHES = Object.freeze({
  'xplorers2.41.2f.jar': 'ec6bc271da02cc2a3e993ac79603503f6bc18605eccac9dae71ef5169ddc5936',
  'mapeditor2.38f.jar': '7d68c51d3ffa05e059934853c4fd8b54385750d24e4012bc61bbb21044e9ae5f',
  'xplorers2.40.6f.jar': 'e145ad1700acbef2bf0ab207f96e2b81e9a16520ac18c02564cf5d2d3111ef05',
  'xplorers2.40.5f.jar': '9ae2382c599bf151c9715dfc397426898ffcacd9c676f80be107152f20351653',
});

function verifyArchive(bytes, expectedHash) {
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('The original client failed its SHA-256 integrity check. It was not prepared or executed.');
}

function sourceUrl(value, origin = SITE) {
  const url = new URL(value);
  if (url.origin !== origin || !url.pathname.startsWith('/applets/xplorers/') || url.username || url.password || url.search || url.hash) {
    throw new Error('Unexpected original client download location');
  }
  return url;
}

function downloadBytes(value, { origin = SITE, maxBytes = MAX_DOWNLOAD, redirects = 0 } = {}) {
  const url = sourceUrl(value, origin);
  if (redirects > 4) return Promise.reject(new Error('Too many original client download redirects'));
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { 'User-Agent': 'Xplorers-Web-Framework' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        try { downloadBytes(new URL(response.headers.location, url).href, { origin, maxBytes, redirects: redirects + 1 }).then(resolve, reject); }
        catch (error) { reject(error); }
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Original client download failed (${response.statusCode})`)); return; }
      if (Number(response.headers['content-length']) > maxBytes) { response.destroy(); reject(new Error('Original client download is too large')); return; }
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > maxBytes) response.destroy(new Error('Original client download is too large'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(30000, () => request.destroy(new Error('Original client download timed out')));
    request.on('error', reject);
  });
}

class ClientCache {
  constructor({ directory, prepareClient, origin = SITE, onProgress = () => {}, trustedArchives = CORE_HASHES }) {
    this.directory = directory;
    this.prepareClient = prepareClient;
    this.origin = origin;
    this.onProgress = onProgress;
    this.prepared = new Map();
    this.modes = new Map();
    this.downloads = new Map();
    this.trustedArchives = trustedArchives;
  }

  async download(value, expectedHash) {
    const url = sourceUrl(value, this.origin).href;
    if (!this.downloads.has(url)) this.downloads.set(url, (async () => {
      const hash = createHash('sha256').update(url).digest('hex');
      const filename = path.join(this.directory, 'downloads', hash);
      try {
        const bytes = await fs.readFile(filename);
        if (bytes.length > MAX_DOWNLOAD) throw new Error('Cached original client is too large');
        if (expectedHash) verifyArchive(bytes, expectedHash);
        return bytes;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.onProgress('Downloading the original game from AsoBrain…');
      const bytes = await downloadBytes(url, { origin: this.origin });
      if (expectedHash) verifyArchive(bytes, expectedHash);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(`${filename}.tmp`, bytes);
      await fs.rename(`${filename}.tmp`, filename);
      return bytes;
    })().catch(error => { this.downloads.delete(url); throw error; }));
    const bytes = await this.downloads.get(url);
    if (expectedHash) verifyArchive(bytes, expectedHash);
    return bytes;
  }

  async prepare(mode) {
    if (!mode?.available || !/^[\w-]+$/.test(mode.id)) throw new Error('This room is not available');
    const codebase = sourceUrl(mode.codebase.endsWith('/') ? mode.codebase : `${mode.codebase}/`, this.origin);
    const archives = String(mode.archive).split(',').map(name => name.trim()).filter(Boolean);
    if (!archives.length || archives.some(name => !/^[\w.-]+\.jar$/i.test(name))) throw new Error('Unexpected original client archive name');
    const expectedHash = this.trustedArchives[archives[0]];
    if (!expectedHash) throw new Error(`Unsupported original client version: ${archives[0]}. This framework needs an updated verified archive fingerprint.`);
    const url = sourceUrl(new URL(archives[0], codebase).href, this.origin).href;
    if (!this.prepared.has(url)) this.prepared.set(url, (async () => {
      const original = await this.download(url, expectedHash);
      if (original[0] !== 0x50 || original[1] !== 0x4b) throw new Error('AsoBrain did not return a Java archive');
      const skinArchives = [];
      for (const name of archives.slice(1)) skinArchives.push(await this.download(new URL(name, codebase).href));
      this.onProgress('Preparing the browser client and smooth graphics…');
      const result = await this.prepareClient(original, { skinArchives });
      const hash = createHash('sha256').update(url).digest('hex');
      const directory = path.join(this.directory, 'prepared', hash);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'client.jar.tmp'), result.jar);
      await fs.rename(path.join(directory, 'client.jar.tmp'), path.join(directory, 'client.jar'));
      return { directory, mainClass: result.mainClass };
    })().catch(error => { this.prepared.delete(url); throw error; }));
    const prepared = await this.prepared.get(url);
    this.modes.set(mode.id, { ...prepared, codebase: codebase.href });
    this.onProgress('Original client ready. Connecting to the game server…');
    return { classpath: `/app/bridge.jar:/app/client/${mode.id}/client.jar`, codebasePath: `/client/${mode.id}/`, mainClass: prepared.mainClass };
  }

  async resolve(pathname) {
    const match = /^\/client\/([\w-]+)\/(.+)$/.exec(pathname);
    const mode = match && this.modes.get(match[1]);
    if (!mode) return null;
    const relative = decodeURIComponent(match[2]);
    if (relative === 'client.jar') return { filename: path.join(mode.directory, 'client.jar') };
    if (!/^[\w./-]+$/.test(relative) || relative.split('/').includes('..')) return null;
    if (!/\.(?:gif|png|jpe?g|wav|au|aiff?|mp3|ogg)$/i.test(relative)) return null;
    const url = sourceUrl(new URL(relative, mode.codebase).href, this.origin);
    if (!url.href.startsWith(mode.codebase)) return null;
    return { bytes: await this.download(url.href), extension: path.extname(relative) };
  }
}

module.exports = { CORE_HASHES, ClientCache, downloadBytes, sourceUrl };
