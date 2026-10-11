'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

async function smokePackage() {
  const root = path.resolve(__dirname, '..');
  const platform = process.platform;
  const directory = path.join(root, 'releases', `Xplorers Redressed-${platform}-${platform === 'darwin' ? 'universal' : 'x64'}`);
  const defaultBinary = platform === 'darwin'
    ? path.join(directory, 'Xplorers Redressed.app', 'Contents', 'MacOS', 'Xplorers Redressed')
    : path.join(directory, `Xplorers Redressed${platform === 'win32' ? '.exe' : ''}`);
  const binary = path.resolve(process.argv[2] || defaultBinary);
  await fs.access(binary);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'xplorers-packaged-smoke-'));
  const userData = path.join(temporary, 'profile');
  const reportPath = path.join(temporary, 'result.json');
  await fs.mkdir(userData);
  let output = '';
  let child;
  function terminate() {
    if (!child?.pid) return;
    if (platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 2000 });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  try {
    const result = await new Promise((resolve, reject) => {
      child = spawn(binary, ['--smoke-test', `--smoke-user-data=${userData}`, `--smoke-report=${reportPath}`],
        { cwd: root, detached: platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const timeout = setTimeout(() => {
        terminate();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        reject(new Error('Packaged startup did not finish within 30 seconds'));
      }, 30000);
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
    });
    let report;
    try { report = JSON.parse(await fs.readFile(reportPath, 'utf8')); }
    catch { throw new Error(`Packaged startup produced no valid smoke report (exit ${result.code}, signal ${result.signal || 'none'})`); }
    if (result.code !== 0 || !report.ok || !report.packaged || report.platform !== platform) {
      throw new Error(`Packaged startup failed: ${report.error || JSON.stringify({ result, report })}`);
    }
    console.log(`Packaged startup passed: ${JSON.stringify(report)}`);
  } catch (error) {
    if (output) console.error(output.trim());
    throw error;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      terminate();
      await new Promise(resolve => {
        const cleanupTimeout = setTimeout(resolve, 1500);
        child.once('close', () => { clearTimeout(cleanupTimeout); resolve(); });
      });
    }
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

smokePackage().catch(error => { console.error(error.message); process.exitCode = 1; });
