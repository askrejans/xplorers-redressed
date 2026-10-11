'use strict';

// CheerpJ calls these asynchronous native methods from the original game bytecode.
globalThis.createAsobrainNatives = function createAsobrainNatives() {
  const socket = window.desktop.socket;
  const addresses = new Map();
  let smooth = globalThis.asobrainSmooth === true;
  let width = globalThis.asobrainDisplaySize?.width || 800;
  let height = globalThis.asobrainDisplaySize?.height || 600;
  let delivered;
  let viewWaiter;

  function viewState() {
    return [smooth ? 1 : 0, width, height].join(',');
  }

  globalThis.setAsobrainGraphics = function setAsobrainGraphics(enabled) {
    smooth = Boolean(enabled);
    globalThis.asobrainSmooth = smooth;
    notifyView();
  };

  function notifyView() {
    const state = viewState();
    if (viewWaiter && delivered !== state) {
      delivered = state;
      const resolve = viewWaiter;
      viewWaiter = undefined;
      resolve(state);
    }
  }

  globalThis.setAsobrainDisplaySize = function setAsobrainDisplaySize(nextWidth, nextHeight) {
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth < 1 || nextHeight < 1) return;
    width = Math.floor(nextWidth);
    height = Math.floor(nextHeight);
    globalThis.asobrainDisplaySize = { width, height };
    notifyView();
  };

  async function javaError(lib, error) {
    const type = error.code === 'SOCKET_TIMEOUT'
      ? await lib.java.net.SocketTimeoutException
      : error.code === 'ECONNREFUSED' ? await lib.java.net.ConnectException
        : await lib.java.net.SocketException;
    throw await new type(error.message || String(error));
  }

  return {
    async Java_local_asobrain_Bootstrap_viewStateNative() {
      const state = viewState();
      if (delivered !== state) {
        delivered = state;
        return state;
      }
      return new Promise(resolve => { viewWaiter = resolve; });
    },
    async Java_local_asobrain_BridgeSocket_openNative(lib, host, port) {
      try {
        const id = await socket.open(String(host), port);
        try {
          addresses.set(id, await socket.addresses(id));
        } catch (error) {
          await socket.close(id);
          throw error;
        }
        return id;
      } catch (error) {
        return javaError(lib, error);
      }
    },
    async Java_local_asobrain_BridgeSocket_addressesNative(lib, id) {
      const value = addresses.get(id);
      if (!value) return javaError(lib, { message: 'Socket closed' });
      return [value.remoteAddress, value.localAddress, value.remotePort, value.localPort].join('\n');
    },
    async Java_local_asobrain_BridgeSocket_readNative(lib, id, bytes, offset, length, timeout) {
      try {
        const data = await socket.read(id, length, timeout);
        for (let i = 0; i < data.length; i++) bytes[offset + i] = data[i] > 127 ? data[i] - 256 : data[i];
        return data.length || -1;
      } catch (error) {
        return javaError(lib, error);
      }
    },
    async Java_local_asobrain_BridgeSocket_writeNative(lib, id, bytes, offset, length) {
      try {
        const data = new Uint8Array(length);
        for (let i = 0; i < length; i++) data[i] = bytes[offset + i];
        await socket.write(id, data);
      } catch (error) {
        return javaError(lib, error);
      }
    },
    async Java_local_asobrain_BridgeSocket_availableNative(lib, id) {
      try {
        return await socket.available(id);
      } catch (error) {
        return javaError(lib, error);
      }
    },
    async Java_local_asobrain_BridgeSocket_closeNative(lib, id) {
      addresses.delete(id);
      try {
        await socket.close(id);
      } catch (error) {
        return javaError(lib, error);
      }
    },
  };
};
