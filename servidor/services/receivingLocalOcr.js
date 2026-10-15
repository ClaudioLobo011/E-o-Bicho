const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const runtime = path.resolve(__dirname, '../.receiving-ocr-local');
const python = path.join(runtime, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const script = path.resolve(__dirname, '../scripts/receiving-ocr.py');
const available = () => fs.existsSync(python) && fs.existsSync(script) && fs.existsSync(path.join(runtime, 'ready.json'));

async function recognizePhoto(buffer, { timeoutMs = 120000 } = {}) {
  if (!available()) throw new Error('Local OCR runtime unavailable');
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'eobicho-receiving-'));
  const input = path.join(temporary, 'input-image');
  try {
    await fsp.writeFile(input, buffer);
    return await new Promise((resolve, reject) => {
      const child = spawn(python, [script, input], {
        cwd: runtime, windowsHide: true, shell: false,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', OMP_NUM_THREADS: '2' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', failed = false;
      const fail = error => { if (failed) return; failed = true; child.kill(); reject(error); };
      const timer = setTimeout(() => fail(Object.assign(new Error('A leitura demorou demais. Tente uma foto mais nítida ou prepare as linhas pela conversa.'), { status: 422 })), timeoutMs);
      child.stdout.on('data', chunk => {
        stdout += chunk.toString('utf8');
        if (Buffer.byteLength(stdout) > 2 * 1024 * 1024) fail(new Error('Local OCR output exceeded limit'));
      });
      child.stderr.resume();
      child.on('error', error => { clearTimeout(timer); fail(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (failed) return;
        if (code !== 0) return reject(new Error(`Local OCR failed (${code})`));
        try {
          const data = JSON.parse(stdout);
          if (typeof data.rawText !== 'string' || data.rawText.length > 120000) throw new Error('Invalid local OCR output');
          resolve(data);
        } catch (error) { reject(error); }
      });
    });
  } finally {
    const cleanup = path.resolve(temporary), temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!cleanup.startsWith(temporaryRoot) || !path.basename(cleanup).startsWith('eobicho-receiving-')) throw new Error('Unexpected OCR temporary directory');
    await fsp.rm(cleanup, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

module.exports = { available, recognizePhoto, runtime, python, script };
