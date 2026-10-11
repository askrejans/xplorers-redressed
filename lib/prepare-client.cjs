'use strict';

const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');

const DRAW_SIGNATURES = new Set([
  '(Ljava/awt/Image;IILjava/awt/image/ImageObserver;)Z',
  '(Ljava/awt/Image;IIIILjava/awt/image/ImageObserver;)Z',
  '(Ljava/awt/Image;IIIIIIIILjava/awt/image/ImageObserver;)Z',
]);
const COMPONENT_CLASSES = new Set([
  'java/awt/Component', 'java/awt/Container', 'java/awt/Canvas', 'java/awt/Panel',
  'java/awt/Window', 'java/awt/Frame', 'java/awt/Dialog', 'java/applet/Applet',
  'javax/swing/JComponent', 'javax/swing/JPanel', 'javax/swing/JFrame', 'javax/swing/JDialog',
]);
const TWO_BYTE = new Set([0x10, 0x12, 0xa9, 0xbc]);
const THREE_BYTE = new Set([0x11, 0x13, 0x14, 0x84, 0xbb, 0xbd, 0xc0, 0xc1, 0xc6, 0xc7]);
const FIVE_BYTE = new Set([0xb9, 0xba, 0xc8, 0xc9]);
for (let i = 0x15; i < 0x1a; i++) TWO_BYTE.add(i);
for (let i = 0x36; i < 0x3b; i++) TWO_BYTE.add(i);
for (let i = 0x99; i < 0xa9; i++) THREE_BYTE.add(i);
for (let i = 0xb2; i < 0xb9; i++) THREE_BYTE.add(i);

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function constantPool(bytes) {
  const data = view(bytes);
  if (data.getUint32(0) !== 0xcafebabe) throw new Error('Invalid Java class');
  const count = data.getUint16(8);
  const pool = [null];
  let offset = 10;
  while (pool.length < count) {
    const tag = bytes[offset++];
    if (tag === 1) {
      const length = data.getUint16(offset);
      pool.push({ tag, text: strFromU8(bytes.subarray(offset + 2, offset + 2 + length)) });
      offset += 2 + length;
    } else if ([7, 8, 16, 19, 20].includes(tag)) {
      pool.push({ tag, a: data.getUint16(offset) });
      offset += 2;
    } else if ([9, 10, 11, 12, 17, 18].includes(tag)) {
      pool.push({ tag, a: data.getUint16(offset), b: data.getUint16(offset + 2) });
      offset += 4;
    } else if (tag === 3 || tag === 4) {
      pool.push({ tag });
      offset += 4;
    } else if (tag === 5 || tag === 6) {
      pool.push({ tag }, null);
      offset += 8;
    } else if (tag === 15) {
      pool.push({ tag });
      offset += 3;
    } else {
      throw new Error(`Unsupported constant pool tag ${tag}`);
    }
  }
  return { pool, end: offset };
}

function codeBlocks(bytes, pool, offset) {
  const data = view(bytes);
  const blocks = [];
  offset += 6;
  offset += 2 + data.getUint16(offset) * 2;
  function attributes(start, collect) {
    const count = data.getUint16(start);
    start += 2;
    for (let i = 0; i < count; i++) {
      const name = data.getUint16(start), length = data.getUint32(start + 2);
      const info = start + 6;
      if (collect && pool[name].text === 'Code') blocks.push({ start: info + 8, length: data.getUint32(info + 4) });
      start = info + length;
    }
    return start;
  }
  const fields = data.getUint16(offset);
  offset += 2;
  for (let i = 0; i < fields; i++) offset = attributes(offset + 6, false);
  const methods = data.getUint16(offset);
  offset += 2;
  for (let i = 0; i < methods; i++) offset = attributes(offset + 6, true);
  return blocks;
}

function instructions(bytes, start, length) {
  const data = view(bytes), end = start + length, result = [];
  for (let cursor = start; cursor < end;) {
    const opcode = bytes[cursor];
    result.push({ offset: cursor, opcode });
    let size = 1;
    if (TWO_BYTE.has(opcode)) size = 2;
    else if (THREE_BYTE.has(opcode)) size = 3;
    else if (FIVE_BYTE.has(opcode)) size = 5;
    else if (opcode === 0xc5) size = 4;
    else if (opcode === 0xc4) size = bytes[cursor + 1] === 0x84 ? 6 : 4;
    else if (opcode === 0xaa || opcode === 0xab) {
      let aligned = cursor + 1;
      aligned += (4 - ((aligned - start) % 4)) % 4;
      size = opcode === 0xaa
        ? aligned - cursor + 12 + 4 * (data.getInt32(aligned + 8) - data.getInt32(aligned + 4) + 1)
        : aligned - cursor + 8 + 8 * data.getUint32(aligned + 4);
    }
    cursor += size;
    if (cursor > end) throw new Error('Invalid Java instruction length');
  }
  return result;
}

function patchClass(original, isComponent = owner => COMPONENT_CLASSES.has(owner)) {
  const { pool, end } = constantPool(original), originalView = view(original);
  const calls = codeBlocks(original, pool, end).flatMap(block => instructions(original, block.start, block.length));
  const newSockets = calls.filter(call => call.opcode === 0xbb && pool[pool[originalView.getUint16(call.offset + 1)].a].text === 'java/net/Socket');
  const additions = [], modified = original.slice(), modifiedView = view(modified);
  let nextIndex = pool.length;
  function add(tag, payload) {
    const index = nextIndex++;
    additions.push(Uint8Array.of(tag), payload);
    return index;
  }
  function words(...values) {
    const bytes = new Uint8Array(values.length * 2), data = view(bytes);
    values.forEach((value, i) => data.setUint16(i * 2, value));
    return bytes;
  }
  function utf8(text) {
    const bytes = strToU8(text);
    return add(1, concat([words(bytes.length), bytes]));
  }
  function helper(name) { return add(7, words(utf8(name))); }
  const bridgeClass = newSockets.length ? helper('local/asobrain/BridgeSocket') : null;
  let graphicsClass, socketConstructions = 0, constructors = 0, graphicsCalls = 0;
  const references = new Map();
  for (let index = 1; index < pool.length; index++) {
    const item = pool[index];
    if (!item || item.tag !== 10) continue;
    const owner = pool[pool[item.a].a].text, names = pool[item.b];
    const name = pool[names.a].text, descriptor = pool[names.b].text;
    if (bridgeClass && owner === 'java/net/Socket' && name === '<init>') {
      if (!['()V', '(Ljava/lang/String;I)V'].includes(descriptor)) throw new Error(`Unsupported client socket constructor: ${descriptor}`);
      references.set(index, { index: add(10, words(bridgeClass, item.b)), kind: 'socket' });
      continue;
    }
    let firstArgument;
    if (owner === 'java/awt/Toolkit' && name === 'createImage' && descriptor === '([B)Ljava/awt/Image;') firstArgument = 'Ljava/awt/Toolkit;';
    else if (['java/awt/Graphics', 'java/awt/Graphics2D'].includes(owner) && name === 'drawImage' && DRAW_SIGNATURES.has(descriptor)) firstArgument = 'Ljava/awt/Graphics;';
    else if (name === 'createImage' && descriptor === '(II)Ljava/awt/Image;' && isComponent(owner)) firstArgument = 'Ljava/awt/Component;';
    if (firstArgument) {
      if (!graphicsClass) graphicsClass = helper('local/asobrain/SmoothAssets');
      const nameIndex = utf8(name), descriptorIndex = utf8('(' + firstArgument + descriptor.slice(1));
      const nameAndType = add(12, words(nameIndex, descriptorIndex));
      references.set(index, { index: add(10, words(graphicsClass, nameAndType)), kind: 'graphics' });
    }
  }
  for (const call of calls) {
    if (call.opcode === 0xbb && newSockets.some(site => site.offset === call.offset)) {
      modifiedView.setUint16(call.offset + 1, bridgeClass);
      socketConstructions++;
    } else if (call.opcode === 0xb7 || call.opcode === 0xb6) {
      const replacement = references.get(originalView.getUint16(call.offset + 1));
      if (replacement?.kind === 'socket' && call.opcode === 0xb7) {
        modifiedView.setUint16(call.offset + 1, replacement.index);
        constructors++;
      } else if (replacement?.kind === 'graphics' && call.opcode === 0xb6) {
        modified[call.offset] = 0xb8;
        modifiedView.setUint16(call.offset + 1, replacement.index);
        graphicsCalls++;
      }
    }
  }
  if (constructors !== socketConstructions) throw new Error('Unmatched client socket construction');
  const bytes = socketConstructions || graphicsCalls
    ? concat([original.subarray(0, 8), words(nextIndex), original.subarray(10, end), ...additions, modified.subarray(end)])
    : original;
  return { bytes, socketConstructions, graphicsCalls };
}

function concat(parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function prepareClient(originalJarBytes, { skinArchives = [], mainClass } = {}) {
  const entries = unzipSync(new Uint8Array(originalJarBytes));
  const parents = new Map();
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.endsWith('.class')) continue;
    const { pool, end } = constantPool(bytes), data = view(bytes);
    const parent = data.getUint16(end + 4);
    parents.set(path.slice(0, -6), parent ? pool[pool[parent].a].text : null);
  }
  function isComponent(owner) {
    const seen = new Set();
    while (owner && !seen.has(owner)) {
      if (COMPONENT_CLASSES.has(owner)) return true;
      seen.add(owner);
      owner = parents.get(owner);
    }
    return false;
  }
  const stats = { socketConstructions: 0, graphicsCalls: 0, patchedClasses: [], strippedSignatures: [] };
  for (const [path, bytes] of Object.entries(entries)) {
    if (/^META-INF\/[^/]+\.(SF|RSA|DSA|EC)$/i.test(path)) {
      delete entries[path];
      stats.strippedSignatures.push(path);
    } else if (path.endsWith('.class')) {
      const patched = patchClass(bytes, isComponent);
      if (patched.bytes !== bytes) {
        entries[path] = patched.bytes;
        stats.patchedClasses.push(path);
        stats.socketConstructions += patched.socketConstructions;
        stats.graphicsCalls += patched.graphicsCalls;
      }
    }
  }
  for (const archive of skinArchives) {
    for (const [path, bytes] of Object.entries(unzipSync(new Uint8Array(archive)))) {
      if (!/^(pale|sara)\/[^/]+\.(png|gif|jpg|jpeg)$/i.test(path)) throw new Error(`Unexpected skin image path: ${path}`);
      entries[path] = bytes;
    }
  }
  const manifest = entries['META-INF/MANIFEST.MF'] ? strFromU8(entries['META-INF/MANIFEST.MF']).replace(/\r?\n /g, '') : '';
  mainClass ||= /^Main-Class:\s*(\S+)/mi.exec(manifest)?.[1];
  if (!mainClass && entries['com/asobrain/games/xplorers/mapeditor/MapEditorLauncher.class']) mainClass = 'com.asobrain.games.xplorers.mapeditor.MapEditorLauncher';
  if (!mainClass && entries['com/asobrain/games/xplorers/client/Xplorers.class']) mainClass = 'com.asobrain.games.xplorers.client.Xplorers';
  if (!mainClass || !entries[mainClass.replace(/\./g, '/') + '.class']) throw new Error('Original client launcher class was not found');
  return { jar: zipSync(entries, { level: 6 }), mainClass, stats };
}

module.exports = { prepareClient, patchClass };
