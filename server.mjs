// PhoneDrop server: receives files / text from your iPhone and pastes them
// into whatever field has focus on this Mac.
//
// Zero dependencies. Listens on 127.0.0.1 only; expose it to your phone with
// `tailscale serve` (see README.md). Every API call needs the PIN.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const MAX_UPLOAD = 4 * 1024 * 1024 * 1024; // 4 GB per file

// ---------- config (PIN is created on first run) ----------
function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  let changed = false;
  if (!cfg.pin) {
    cfg.pin = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
    changed = true;
  }
  if (!cfg.port) {
    cfg.port = 8787;
    changed = true;
  }
  if (!cfg.dropDir) {
    cfg.dropDir = path.join(os.homedir(), 'PhoneDrop');
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  }
  return cfg;
}
const cfg = loadConfig();
fs.mkdirSync(cfg.dropDir, { recursive: true });

// ---------- auth ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const pinHash = sha(cfg.pin);
let failures = 0;
let lockedUntil = 0;

function checkPin(req) {
  const now = Date.now();
  if (now < lockedUntil) return 'locked';
  const given = req.headers['x-pin'] ?? '';
  if (crypto.timingSafeEqual(sha(given), pinHash)) {
    failures = 0;
    return 'ok';
  }
  failures += 1;
  if (failures >= 5) {
    // 5 wrong tries -> lock everyone out, doubling each time (max 1 hour)
    const mins = Math.min(60, 2 ** (failures - 5));
    lockedUntil = now + mins * 60_000;
  }
  return 'bad';
}

// Only answer requests addressed to localhost or your tailnet name (blocks DNS rebinding).
function hostAllowed(req) {
  const host = String(req.headers.host ?? '').split(':')[0].toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.ts.net') ||
    (cfg.allowedHosts ?? []).includes(host)
  );
}

// ---------- paste into the focused field ----------
function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(Object.assign(new Error(err.trim() || `exit ${code}`), { stderr: err }))
    );
    if (input !== undefined) p.stdin.end(input);
  });
}

let pasteQueue = Promise.resolve();
function pasteText(text) {
  // serialize pastes so clipboard save/restore never overlaps
  const job = pasteQueue.then(async () => {
    const previous = await run('pbpaste', []).catch(() => '');
    await run('pbcopy', [], text);
    try {
      await run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    } finally {
      setTimeout(() => run('pbcopy', [], previous).catch(() => {}), 500);
    }
    await new Promise((r) => setTimeout(r, 550));
  });
  pasteQueue = job.catch(() => {});
  return job;
}

// Asks macOS whether this process may send keystrokes, using a bare Shift tap
// (key code 56), which has no visible effect. Cached for a minute.
let pasteCheck = { at: 0, ok: true };
async function canPaste() {
  if (Date.now() - pasteCheck.at < 60_000) return pasteCheck.ok;
  const ok = await run('osascript', ['-e', 'tell application "System Events" to key code 56']).then(
    () => true,
    () => false
  );
  pasteCheck = { at: Date.now(), ok };
  return ok;
}

function pressEnter() {
  return run('osascript', ['-e', 'tell application "System Events" to key code 36']);
}

function explainKeystrokeError(e) {
  const msg = String(e?.stderr ?? e?.message ?? e);
  if (/not allowed|1002|assistive/i.test(msg)) {
    return (
      'Mac blocked the paste. Open System Settings > Privacy & Security > Accessibility ' +
      'and turn on the app that runs this server (Terminal or the Claude app), then try again.'
    );
  }
  return msg;
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeName(raw) {
  let name = path.basename(raw || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  if (!name) name = 'file';
  if (name.length > 80) {
    const ext = path.extname(name).slice(0, 10);
    name = name.slice(0, 70) + ext;
  }
  return name;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Not found');
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req)) return send(res, 421, 'Unknown host');
    const url = new URL(req.url, 'http://localhost');

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url.pathname);
    }

    const auth = checkPin(req);
    if (auth === 'locked') return send(res, 429, { error: 'Too many wrong PINs. Wait a few minutes.' });
    if (auth !== 'ok') return send(res, 401, { error: 'Wrong PIN' });

    if (req.method === 'GET' && url.pathname === '/api/ping') {
      return send(res, 200, {
        ok: true,
        host: os.hostname().replace(/\.local$/, ''),
        canPaste: await canPaste(),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const len = Number(req.headers['content-length'] ?? 0);
      if (len > MAX_UPLOAD) return send(res, 413, { error: 'File too large' });
      const original = decodeURIComponent(String(req.headers['x-filename'] ?? 'file'));
      const name = `${stamp()}-${safeName(original)}`;
      const dest = path.join(cfg.dropDir, name);
      try {
        await pipeline(req, fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 }));
      } catch (e) {
        fs.rm(dest, { force: true }, () => {});
        throw e;
      }
      console.log(`saved ${dest} (${fs.statSync(dest).size} bytes)`);
      return send(res, 200, { ok: true, path: dest, name });
    }

    if (req.method === 'POST' && url.pathname === '/api/text') {
      const { text } = JSON.parse((await readBody(req)) || '{}');
      if (typeof text !== 'string' || !text) return send(res, 400, { error: 'No text' });
      try {
        await pasteText(text);
      } catch (e) {
        return send(res, 500, { error: explainKeystrokeError(e) });
      }
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/enter') {
      try {
        await pressEnter();
      } catch (e) {
        return send(res, 500, { error: explainKeystrokeError(e) });
      }
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('request failed:', e?.message ?? e);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
    else res.end();
  }
});

server.requestTimeout = 0; // big uploads on slow links
server.listen(cfg.port, '127.0.0.1', () => {
  console.log('');
  console.log('  PhoneDrop is running');
  console.log(`  Local:   http://localhost:${cfg.port}`);
  console.log(`  PIN:     ${cfg.pin}   (type this once on your phone)`);
  console.log(`  Files:   ${cfg.dropDir}`);
  console.log('');
  console.log(`  Phone link: run   tailscale serve --bg ${cfg.port}   (see README.md)`);
  console.log('');
});
