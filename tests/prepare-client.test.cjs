'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { unzipSync, zipSync, strToU8 } = require('fflate');
const { prepareClient, patchClass } = require('../lib/prepare-client.cjs');

const project = path.resolve(__dirname, '..');
const developmentTools = spawnSync('javac', ['-version']).status === 0 && spawnSync('python3', ['--version']).status === 0;
let fixture;

function ownedFixture() {
  if (fixture) return fixture;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asobrain-owned-fixture-'));
  const source = path.join(directory, 'Client.java');
  fs.writeFileSync(source, `package fixture;
import java.awt.*;
import java.awt.image.ImageObserver;
import java.net.Socket;
public class Client extends Canvas {
  public static void main(String[] args) {}
  public Socket connect() throws Exception { return new Socket(); }
  public Image decoded(byte[] bytes) { return Toolkit.getDefaultToolkit().createImage(bytes); }
  public Image buffer() { return createImage(23, 17); }
  public boolean draw(Graphics g, Image image, ImageObserver observer, int kind) {
    switch (kind) {
      case 0: return g.drawImage(image, 1, 2, observer);
      case 1: return g.drawImage(image, 3, 4, 5, 6, observer);
      case 2: return g.drawImage(image, 1, 2, 3, 4, 5, 6, 7, 8, observer);
      default: return false;
    }
  }
  public int sparse(int key) { switch(key) {case 2:return 9;case 1337:return 4;default:return 0;} }
}`);
  const compiled = spawnSync('javac', ['--release', '8', '-d', directory, source], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const bytes = new Uint8Array(fs.readFileSync(path.join(directory, 'fixture/Client.class')));
  const entries = {
    'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0\r\nMain-Class: fixture.\r\n Client\r\n\r\n'),
    'META-INF/TEST.SF': strToU8('owned synthetic signature'),
    'META-INF/TEST.RSA': Uint8Array.of(5, 4, 3),
    'fixture/Client.class': bytes,
    'fixture/unchanged.bin': Uint8Array.of(0, 128, 255, 17),
  };
  fixture = { directory, bytes, entries, jar: zipSync(entries) };
  return fixture;
}

test('runtime surgery matches the development Python patcher on owned bytecode with branches and all image overloads', { skip: !developmentTools }, () => {
  const { bytes, directory } = ownedFixture();
  const result = patchClass(bytes, owner => ['fixture/Client', 'java/awt/Canvas'].includes(owner));
  assert.equal(result.socketConstructions, 1);
  assert.equal(result.graphicsCalls, 5);
  const python = `import importlib.util, pathlib, sys
spec=importlib.util.spec_from_file_location('builder',sys.argv[1])
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
data=pathlib.Path(sys.argv[2]).read_bytes()
data=builder.patch_socket_construction(data)
data,count=builder.patch_graphics(data,(b'fixture/Client',b'java/awt/Canvas'))
sys.stdout.buffer.write(data)
`;
  const reference = spawnSync('python3', ['-c', python, path.join(project, 'tests/reference-patcher.py'), path.join(directory, 'fixture/Client.class')]);
  assert.equal(reference.status, 0, reference.stderr.toString());
  assert.deepEqual(Buffer.from(result.bytes), reference.stdout);
});

test('first-startup preparation preserves original archive payloads and strips invalid signatures', { skip: !developmentTools }, () => {
  const { jar, entries } = ownedFixture();
  const prepared = prepareClient(jar);
  const output = unzipSync(prepared.jar);
  assert.equal(prepared.mainClass, 'fixture.Client');
  assert.equal(prepared.stats.socketConstructions, 1);
  assert.equal(prepared.stats.graphicsCalls, 5);
  assert.deepEqual(prepared.stats.patchedClasses, ['fixture/Client.class']);
  assert.deepEqual(prepared.stats.strippedSignatures, ['META-INF/TEST.SF', 'META-INF/TEST.RSA']);
  assert.deepEqual(output['fixture/unchanged.bin'], entries['fixture/unchanged.bin']);
  assert.deepEqual(output['META-INF/MANIFEST.MF'], entries['META-INF/MANIFEST.MF']);
  assert.equal(output['META-INF/TEST.SF'], undefined);
  assert.equal(output['META-INF/TEST.RSA'], undefined);
});

test('owned patched fixture passes JVM verification with only the distributable helpers', { skip: !developmentTools }, () => {
  const { jar, directory } = ownedFixture();
  const target = path.join(directory, 'prepared.jar');
  fs.writeFileSync(target, prepareClient(jar).jar);
  const result = spawnSync('java', ['-Xverify:all', '-cp', [target, path.join(project, 'dist/bridge.jar')].join(path.delimiter), 'fixture.Client'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('optional skin archives accept only image resources and never extra executable classes', { skip: !developmentTools }, () => {
  const { jar } = ownedFixture();
  const image = Uint8Array.of(99, 88, 77);
  const output = prepareClient(jar, { skinArchives: [zipSync({ 'pale/owned-test.png': image })] });
  assert.deepEqual(unzipSync(output.jar)['pale/owned-test.png'], image);
  assert.throws(() => prepareClient(jar, { skinArchives: [zipSync({ 'pale/Injected.class': image })] }), /Unexpected skin image path/);
});

test('the distributable helper JAR contains owned classes only, with no client bytecode or artwork', () => {
  const entries = unzipSync(fs.readFileSync(path.join(project, 'dist/bridge.jar')));
  assert.ok(Object.keys(entries).length > 0);
  for (const name of Object.keys(entries)) assert.match(name, /^local\/asobrain\/[^/]+\.class$/);
  assert.ok(entries['local/asobrain/Bootstrap.class']);
  assert.ok(entries['local/asobrain/BridgeSocket.class']);
  assert.ok(entries['local/asobrain/SmoothAssets.class']);
});

test.after(() => { if (fixture) fs.rmSync(fixture.directory, { recursive: true, force: true }); });
