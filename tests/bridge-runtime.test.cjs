'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

class SocketException extends Error {}
class SocketTimeoutException extends SocketException {}
class ConnectException extends SocketException {}
const lib = { java: { net: { SocketException, SocketTimeoutException, ConnectException } } };

function runtime(overrides = {}) {
  const socket = {
    open: async () => 7,
    addresses: async () => ({ localAddress: '192.168.1.2', remoteAddress: '203.0.113.9', localPort: 41234, remotePort: 20000 }),
    read: async () => Uint8Array.of(0, 127, 128, 255),
    write: async () => {},
    close: async () => {},
    available: async () => 4,
    ...overrides,
  };
  const context = vm.createContext({ window: { desktop: { socket } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/bridge-runtime.js'), 'utf8'), context);
  return { context, natives: context.createAsobrainNatives() };
}

test('native reads preserve unsigned network bytes in Java signed arrays and honor offsets', async () => {
  let request;
  const { natives } = runtime({ read: async (...args) => { request = args; return Uint8Array.of(0, 127, 128, 255); } });
  const target = new Int8Array(8).fill(33);
  const length = await natives.Java_local_asobrain_BridgeSocket_readNative(lib, 7, target, 2, 4, 40000);
  assert.equal(length, 4);
  assert.deepEqual(Array.from(target), [33, 33, 0, 127, -128, -1, 33, 33]);
  assert.deepEqual(request, [7, 4, 40000]);
});

test('native writes transmit exactly the requested Java byte array slice', async () => {
  let written;
  const { natives } = runtime({ write: async (id, bytes) => { written = { id, bytes: Array.from(bytes) }; } });
  await natives.Java_local_asobrain_BridgeSocket_writeNative(lib, 7, Int8Array.of(11, -128, -1, 0, 127, 22), 1, 4);
  assert.deepEqual(written, { id: 7, bytes: [128, 255, 0, 127] });
});

test('graceful EOF becomes InputStream -1, while timeout and close remain distinct Java exceptions', async () => {
  const target = new Int8Array(10);
  const eof = runtime({ read: async () => new Uint8Array() }).natives;
  assert.equal(await eof.Java_local_asobrain_BridgeSocket_readNative(lib, 7, target, 0, 10, 0), -1);
  const timeout = runtime({ read: async () => { throw Object.assign(new Error('Read timed out'), { code: 'SOCKET_TIMEOUT' }); } }).natives;
  await assert.rejects(timeout.Java_local_asobrain_BridgeSocket_readNative(lib, 7, target, 0, 10, 40), SocketTimeoutException);
  const closed = runtime({ read: async () => { throw Object.assign(new Error('Socket closed'), { code: 'SOCKET_CLOSED' }); } }).natives;
  await assert.rejects(closed.Java_local_asobrain_BridgeSocket_readNative(lib, 7, target, 0, 10, 40), error =>
    error instanceof SocketException && !(error instanceof SocketTimeoutException));
});

test('opened socket metadata preserves the actual local address for the original handshake', async () => {
  const { natives } = runtime();
  assert.equal(await natives.Java_local_asobrain_BridgeSocket_openNative(lib, 'games.asobrain.com', 20000), 7);
  assert.equal(await natives.Java_local_asobrain_BridgeSocket_addressesNative(lib, 7), '203.0.113.9\n192.168.1.2\n20000\n41234');
  assert.equal(await natives.Java_local_asobrain_BridgeSocket_availableNative(lib, 7), 4);
  await natives.Java_local_asobrain_BridgeSocket_closeNative(lib, 7);
  await assert.rejects(natives.Java_local_asobrain_BridgeSocket_addressesNative(lib, 7), SocketException);
});

test('live graphics changes wake the existing controller and preserve changes between polls', async () => {
  const { context, natives } = runtime();
  assert.equal(await natives.Java_local_asobrain_Bootstrap_viewStateNative(), '0,800,600');
  const pending = natives.Java_local_asobrain_Bootstrap_viewStateNative();
  context.setAsobrainGraphics(true);
  assert.equal(await pending, '1,800,600');
  context.setAsobrainGraphics(false);
  assert.equal(await natives.Java_local_asobrain_Bootstrap_viewStateNative(), '0,800,600');
});

test('display resizes wake the same controller with current mode and coalesce queued dimensions', async () => {
  const { context, natives } = runtime();
  await natives.Java_local_asobrain_Bootstrap_viewStateNative();
  const pending = natives.Java_local_asobrain_Bootstrap_viewStateNative();
  context.setAsobrainDisplaySize(1200.8, 720.9);
  assert.equal(await pending, '0,1200,720');
  context.setAsobrainDisplaySize(1024, 640);
  context.setAsobrainGraphics(true);
  context.setAsobrainDisplaySize(900, 500);
  assert.equal(await natives.Java_local_asobrain_Bootstrap_viewStateNative(), '1,900,500');
  context.setAsobrainDisplaySize(0, 0);
  assert.equal(context.asobrainDisplaySize.width, 900);
  assert.equal(context.asobrainDisplaySize.height, 500);
});
