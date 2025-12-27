const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const DEFAULT_PORT = 17305;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_MAX_BODY = 10 * 1024 * 1024;
const DEFAULT_PRINT_WAIT_MS = 90000;
const DEFAULT_QUEUE_MAX = 50;
const DEFAULT_MAX_COPIES = 10;
const DEFAULT_EDGE_PROFILE_DIR = path.join(__dirname, 'edge-profile');
const DEFAULT_MAX_JOBS_TRACKED = 200;

const CONFIG_PATH = path.join(__dirname, 'agent-config.json');

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function resolveProfileDir(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return DEFAULT_EDGE_PROFILE_DIR;
  return path.isAbsolute(value) ? value : path.resolve(__dirname, value);
}

const config = readConfig();

const HOST = (process.env.PDV_AGENT_HOST || config.host || DEFAULT_HOST).trim();
const PORT = Number(process.env.PDV_AGENT_PORT || config.port || DEFAULT_PORT);
const MAX_BODY = clampNumber(config.maxBodyBytes, 1024, 50 * 1024 * 1024, DEFAULT_MAX_BODY);
const EDGE_PATH = (process.env.PDV_AGENT_EDGE_PATH || config.edgePath || '').trim();
const PRINT_WAIT_MS = clampNumber(
  process.env.PDV_AGENT_PRINT_WAIT_MS || config.printWaitMs,
  2000,
  120000,
  DEFAULT_PRINT_WAIT_MS
);
const QUEUE_MAX = clampNumber(config.queueMax, 1, 500, DEFAULT_QUEUE_MAX);
const MAX_COPIES = clampNumber(
  process.env.PDV_AGENT_MAX_COPIES || config.maxCopies,
  1,
  50,
  DEFAULT_MAX_COPIES
);
const EDGE_PROFILE_DIR = resolveProfileDir(
  process.env.PDV_AGENT_EDGE_PROFILE_DIR || config.edgeProfileDir
);
const PRINTER_ALIASES =
  config.printerAliases && typeof config.printerAliases === 'object' ? config.printerAliases : {};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, payload) {
  setCors(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY) {
        reject(new Error('payload-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve(null);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', reject);
  });
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function sanitizeFileName(value) {
  const raw = (value || 'pdv-receipt').toString().trim() || 'pdv-receipt';
  return raw
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function createJobId() {
  return crypto.randomBytes(8).toString('hex');
}

function findEdgePath() {
  if (EDGE_PATH && fs.existsSync(EDGE_PATH)) {
    return EDGE_PATH;
  }

  const candidates = [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    const result = spawnSync('where', ['msedge'], { encoding: 'utf8' });
    if (result.status === 0) {
      const match = (result.stdout || '').split(/\r?\n/).find(Boolean);
      if (match && fs.existsSync(match.trim())) {
        return match.trim();
      }
    }
  } catch (_) {
    return '';
  }

  return '';
}

async function getDefaultPrinter() {
  const script = `
$printer = (Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1).Name
if ($printer) { Write-Output $printer }
`;
  const result = await runProcess('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'default-printer-failed');
  }
  return (result.stdout || '').trim();
}

async function setDefaultPrinter(printerName) {
  const safePrinter = printerName ? printerName.trim() : '';
  if (!safePrinter) return;
  const script = `
$printer = ${JSON.stringify(safePrinter)};
$wsh = New-Object -ComObject WScript.Network
$wsh.SetDefaultPrinter($printer)
`;
  const result = await runProcess('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'set-default-printer-failed');
  }
}

function injectAutoPrint(html) {
  const script = `
<script>
(() => {
  let didPrint = false;
  const triggerPrint = () => {
    if (didPrint) return;
    didPrint = true;
    try { window.focus(); } catch (_) {}
    try { window.print(); } catch (_) {}
  };
  const schedulePrint = (delayMs) => setTimeout(triggerPrint, delayMs);
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    schedulePrint(100);
  } else {
    document.addEventListener('DOMContentLoaded', () => schedulePrint(100), { once: true });
  }
  window.addEventListener('load', () => schedulePrint(120), { once: true });
  schedulePrint(1500);
  const safeClose = () => {
    try { window.close(); } catch (_) {}
    try { window.open('', '_self'); window.close(); } catch (_) {}
  };
  window.addEventListener('afterprint', () => setTimeout(safeClose, 200), { once: true });
  setTimeout(safeClose, 30000);
})();
</script>
`;
  if (typeof html !== 'string') return '';
  if (html.includes('</body>')) {
    return html.replace('</body>', `${script}</body>`);
  }
  return `${html}${script}`;
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, timeoutMs);

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ timedOut: false, code, signal });
    });
  });
}

function ensureEdgeProfileDir() {
  if (!EDGE_PROFILE_DIR) return;
  try {
    fs.mkdirSync(EDGE_PROFILE_DIR, { recursive: true });
  } catch (_) {
    /* ignore */
  }
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (_) {
    /* ignore */
  }
}

async function printHtmlWithEdge(htmlPath, printerName, copies) {
  const edgePath = findEdgePath();
  if (!edgePath) {
    throw new Error('edge-not-found');
  }

  const printers = await listPrinters();
  if (printerName && !printers.includes(printerName)) {
    throw new Error('printer-not-found');
  }

  const safeCopies = clampNumber(copies, 1, MAX_COPIES, 1);
  const waitMs = PRINT_WAIT_MS;
  const fileUrl = pathToFileURL(htmlPath).href;
  ensureEdgeProfileDir();
  const userDataDir = EDGE_PROFILE_DIR;
  const args = [
    '--kiosk-printing',
    '--disable-print-preview',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    `--user-data-dir=${userDataDir}`,
    `--app=${fileUrl}`,
    '--window-position=-32000,-32000',
    '--window-size=800,600',
  ];

  const defaultPrinter = await getDefaultPrinter().catch(() => '');
  if (printerName) {
    await setDefaultPrinter(printerName);
  }

  try {
    for (let i = 0; i < safeCopies; i += 1) {
      const child = spawn(edgePath, args, { windowsHide: true, stdio: 'ignore' });
      const result = await waitForExit(child, waitMs);
      if (result.timedOut) {
        try {
          child.kill();
        } catch (_) {
          /* ignore */
        }
        killProcessTree(child.pid);
        throw new Error('print-timeout');
      }
      if (result.code) {
        throw new Error(`edge-exit-${result.code}`);
      }
    }
  } finally {
    if (printerName && defaultPrinter) {
      try {
        await setDefaultPrinter(defaultPrinter);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

async function listPrinters() {
  const script = `
$printers = Get-CimInstance -ClassName Win32_Printer | Select-Object -ExpandProperty Name
$printers | ConvertTo-Json
`;
  const result = await runProcess('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'printer-list-failed');
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch (error) {
    return [];
  }
}

const jobQueue = [];
let processingQueue = false;
let activeJob = null;
const jobStatus = new Map();
const jobStatusOrder = [];

function registerJob(job) {
  const entry = {
    id: job.id,
    jobName: job.jobName,
    printerName: job.printerName || '',
    copies: job.copies,
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    error: null,
  };
  jobStatus.set(job.id, entry);
  jobStatusOrder.push(job.id);
  while (jobStatusOrder.length > DEFAULT_MAX_JOBS_TRACKED) {
    const oldestId = jobStatusOrder.shift();
    if (oldestId) jobStatus.delete(oldestId);
  }
  return entry;
}

function updateJobStatus(jobId, updates) {
  const entry = jobStatus.get(jobId);
  if (!entry) return;
  Object.assign(entry, updates);
}

function createJobFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('invalid-payload');
  }

  const html = typeof payload.html === 'string' ? payload.html.trim() : '';
  if (!html) {
    throw new Error('missing-html');
  }

  const rawPrinterName = typeof payload.printerName === 'string' ? payload.printerName.trim() : '';
  const aliased =
    rawPrinterName && Object.prototype.hasOwnProperty.call(PRINTER_ALIASES, rawPrinterName)
      ? String(PRINTER_ALIASES[rawPrinterName] || '').trim()
      : '';
  const printerName = aliased || rawPrinterName;
  const copies = clampNumber(payload.copies, 1, MAX_COPIES, 1);
  const jobName = typeof payload.jobName === 'string' ? payload.jobName.trim() : 'pdv-receipt';
  const safeJobName = sanitizeFileName(jobName);

  return {
    id: createJobId(),
    html,
    printerName,
    copies,
    jobName: safeJobName,
    createdAt: Date.now(),
  };
}

function enqueueJob(job) {
  if (jobQueue.length >= QUEUE_MAX) {
    throw new Error('queue-full');
  }
  registerJob(job);
  jobQueue.push(job);
  void processQueue();
  return job.id;
}

async function executePrintJob(job) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-agent-'));
  const htmlPath = path.join(tempDir, `${job.jobName}-${job.id}.html`);
  try {
    const htmlWithPrint = injectAutoPrint(job.html);
    fs.writeFileSync(htmlPath, htmlWithPrint, 'utf8');
    await printHtmlWithEdge(htmlPath, job.printerName, job.copies);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (jobQueue.length > 0) {
    const job = jobQueue.shift();
    if (!job) break;
    activeJob = job;
    const startedAt = Date.now();
    updateJobStatus(job.id, { status: 'printing', startedAt });
    const printerLabel = job.printerName || 'default';
    // eslint-disable-next-line no-console
    console.log(
      `[print] started id=${job.id} name=${job.jobName} printer="${printerLabel}" copies=${job.copies}`
    );
    try {
      await executePrintJob(job);
      const elapsed = Date.now() - startedAt;
      updateJobStatus(job.id, { status: 'done', finishedAt: Date.now() });
      // eslint-disable-next-line no-console
      console.log(`[print] done id=${job.id} name=${job.jobName} (${elapsed}ms)`);
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      const message = error && error.message ? error.message : String(error);
      updateJobStatus(job.id, { status: 'error', finishedAt: Date.now(), error: message });
      if (message === 'print-timeout') {
        // eslint-disable-next-line no-console
        console.error(`[print] timeout id=${job.id} name=${job.jobName} (${elapsed}ms)`);
      } else {
        // eslint-disable-next-line no-console
        console.error(`[print] error id=${job.id} name=${job.jobName} (${elapsed}ms): ${message}`);
      }
      if (error && error.stack) {
        // eslint-disable-next-line no-console
        console.error(error.stack);
      }
    } finally {
      activeJob = null;
    }
  }
  processingQueue = false;
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, version: '1.1.0' });
    return;
  }

  if (req.method === 'GET' && req.url === '/printers') {
    try {
      const printers = await listPrinters();
      sendJson(res, 200, { ok: true, printers });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || 'printer-list-failed' });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/queue') {
    sendJson(res, 200, {
      ok: true,
      queued: jobQueue.length,
      active: activeJob
        ? {
            id: activeJob.id,
            jobName: activeJob.jobName,
            printerName: activeJob.printerName || '',
            copies: activeJob.copies,
            status: 'printing',
          }
        : null,
    });
    return;
  }

  if (req.method === 'GET' && req.url && req.url.startsWith('/jobs/')) {
    const pathOnly = req.url.split('?')[0];
    const jobId = decodeURIComponent(pathOnly.slice('/jobs/'.length));
    if (!jobId) {
      sendJson(res, 400, { ok: false, error: 'invalid-job-id' });
      return;
    }
    const entry = jobStatus.get(jobId);
    if (!entry) {
      sendJson(res, 404, { ok: false, error: 'job-not-found' });
      return;
    }
    sendJson(res, 200, { ok: true, job: entry });
    return;
  }

  if (req.method === 'POST' && req.url === '/print') {
    try {
      const payload = await readJsonBody(req);
      const job = createJobFromPayload(payload);
      const jobId = enqueueJob(job);
      sendJson(res, 200, { ok: true, queued: true, jobId });
    } catch (error) {
      const message = error.message || 'print-failed';
      const statusCode = message === 'queue-full' ? 429 : 400;
      sendJson(res, statusCode, { ok: false, error: message });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not-found' });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`PDV local agent running at http://${HOST}:${PORT}`);
});
