const { contextBridge, ipcRenderer } = require('electron');

async function invoke(method, ...args) {
  const result = await ipcRenderer.invoke(`desktop:${method}`, ...args);
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.value;
}

contextBridge.exposeInMainWorld('desktop', {
  login: (username, password) => invoke('login', username, password),
  getSession: () => invoke('getSession'),
  getImportUrl: () => invoke('getImportUrl'),
  importInfo: () => invoke('importInfo'),
  restart: () => invoke('restart'),
  logout: () => invoke('logout'),
  openSite: () => invoke('openSite'),
  toggleFullscreen: () => invoke('toggleFullscreen'),
  isFullscreen: () => invoke('isFullscreen'),
  getGraphics: () => invoke('getGraphics'),
  setGraphics: mode => invoke('setGraphics', mode),
  prepareMode: id => invoke('prepareMode', id),
  onSetupProgress: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('desktop:setup-progress', listener);
    return () => ipcRenderer.removeListener('desktop:setup-progress', listener);
  },
  onFullscreen: callback => {
    const listener = (_event, fullscreen) => callback(fullscreen);
    ipcRenderer.on('desktop:fullscreen', listener);
    return () => ipcRenderer.removeListener('desktop:fullscreen', listener);
  },
  onSession: callback => {
    const listener = (_event, session) => callback(session);
    ipcRenderer.on('desktop:session', listener);
    return () => ipcRenderer.removeListener('desktop:session', listener);
  },
  socket: {
    open: (host, port) => invoke('socket:open', host, port),
    read: async (id, max, timeoutMs) => new Uint8Array(await invoke('socket:read', id, max, timeoutMs)),
    write: (id, bytes) => invoke('socket:write', id, new Uint8Array(bytes)),
    close: id => invoke('socket:close', id),
    available: id => invoke('socket:available', id),
    addresses: id => invoke('socket:addresses', id),
  },
});
