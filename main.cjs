const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SITE, SocketBridge, WebsiteSession, createImportScript, createLocalServer, isExternalAllowed } = require('./lib/desktop.cjs');
const { ClientCache } = require('./lib/client-cache.cjs');
const { prepareClient } = require('./lib/prepare-client.cjs');

const sockets = new SocketBridge();
const session = new WebsiteSession();
let window;
let local;
let cache;
let graphics = 'original';

function toggleFullscreen() {
  const fullscreen = !window.isFullScreen();
  window.setFullScreen(fullscreen);
  return fullscreen;
}

function handle(name, handler) {
  ipcMain.handle(`desktop:${name}`, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url !== `${local.origin}/`) {
      return { ok: false, error: { code: 'FORBIDDEN_FRAME', message: 'This window cannot access the game bridge' } };
    }
    try { return { ok: true, value: await handler(...args) }; }
    catch (error) { return { ok: false, error: { code: error.code || 'DESKTOP_ERROR', message: error.message } }; }
  });
}

app.whenReady().then(async () => {
  const preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
  try {
    const preferences = JSON.parse(await fs.readFile(preferencesPath, 'utf8'));
    if (['smooth', 'original'].includes(preferences.graphics)) graphics = preferences.graphics;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  cache = new ClientCache({ directory: path.join(app.getPath('userData'), 'client-cache'), prepareClient, onProgress: message => window?.webContents.send('desktop:setup-progress', message) });
  local = await createLocalServer({ dist: path.join(__dirname, 'dist'), session, cache });
  handle('login', (username, password) => session.login(username, password));
  handle('getSession', () => session.getSession());
  handle('getImportUrl', () => local.importUrl);
  handle('importInfo', () => {
    const source = createImportScript(local.importUrl);
    return { url: local.importUrl, script: source, bookmarklet: `javascript:${encodeURIComponent(source)}` };
  });
  handle('openSite', () => shell.openExternal(`${SITE}/pages/play/index.php`));
  handle('restart', () => { sockets.closeAll(); setImmediate(() => window.webContents.reload()); });
  handle('logout', () => { sockets.closeAll(); session.logout(); });
  handle('toggleFullscreen', toggleFullscreen);
  handle('isFullscreen', () => window.isFullScreen());
  handle('getGraphics', () => graphics);
  handle('setGraphics', async mode => {
    if (!['smooth', 'original'].includes(mode)) throw new Error('Unknown graphics mode');
    graphics = mode;
    await fs.mkdir(path.dirname(preferencesPath), { recursive: true });
    await fs.writeFile(preferencesPath, JSON.stringify({ graphics: mode }) + '\n', 'utf8');
    return mode;
  });
  handle('prepareMode', async id => {
    const mode = session.getSession()?.modes?.find(candidate => candidate.id === id);
    if (!mode) throw new Error('Sign in and choose an available Xplorers room');
    const prepared = await cache.prepare(mode);
    return { ...prepared, codebase: `${local.origin}${prepared.codebasePath}` };
  });
  for (const name of ['open', 'read', 'write', 'close', 'available', 'addresses']) handle(`socket:${name}`, (...args) => sockets[name](...args));
  window = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 960,
    minHeight: 700,
    title: 'Xplorers Redressed',
    icon: path.join(__dirname, 'packaging', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window.webContents && permission === 'clipboard-sanitized-write'));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalAllowed(url)) shell.openExternal(url).catch(() => console.warn('Could not open website link'));
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${local.origin}/`)) event.preventDefault(); });
  window.webContents.on('console-message', details => console.log(`[renderer] ${session.redact(details.message)}`));
  window.webContents.on('before-input-event', (event, input) => {
    const f11 = input.key === 'F11' && !input.alt && !input.control && !input.meta && !input.shift;
    const macShortcut = process.platform === 'darwin' && input.key.toLowerCase() === 'f' && input.control && input.meta && !input.alt && !input.shift;
    if (input.type === 'keyDown' && !input.isAutoRepeat && (f11 || macShortcut)) { event.preventDefault(); toggleFullscreen(); }
  });
  window.on('enter-full-screen', () => window.webContents.send('desktop:fullscreen', true));
  window.on('leave-full-screen', () => window.webContents.send('desktop:fullscreen', false));
  session.on('session', value => { if (window && !window.isDestroyed()) window.webContents.send('desktop:session', value); });
  window.on('closed', () => { sockets.closeAll(); window = null; });
  console.log(`AsoBrain local client: ${local.origin}`);
  console.log(`Safari session import: ${local.importUrl}`);
  await window.loadURL(`${local.origin}/`);
}).catch(error => { console.error(`AsoBrain could not start: ${error.message}`); app.quit(); });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { sockets.closeAll(); local?.server.close(); });
