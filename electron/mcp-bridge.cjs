#!/usr/bin/env node
// stdio <-> HTTP bridge for MCP clients that only speak stdio (e.g. Claude Desktop).
//
// Claude Desktop config:
//   "carforge": { "command": "<path>/CarForge Studio.exe", "args": ["<path>/resources/mcp-bridge.cjs"],
//                 "env": { "ELECTRON_RUN_AS_NODE": "1" } }
//
// Reads newline-delimited JSON-RPC from stdin, forwards each message to the running CarForge
// app (http://127.0.0.1:<port>/mcp, discovered from ~/.carforge/runtime.json) and writes the
// replies to stdout. If the app is not running it is launched automatically.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const RUNTIME = path.join(os.homedir(), '.carforge', 'runtime.json');
const log = (...a) => process.stderr.write(`[carforge-bridge] ${a.join(' ')}\n`);

function runtime() {
  try { return JSON.parse(fs.readFileSync(RUNTIME, 'utf8')); } catch { return null; }
}
function endpoint() {
  if (process.env.CARFORGE_MCP_URL) return process.env.CARFORGE_MCP_URL;
  const r = runtime();
  return r?.url || 'http://127.0.0.1:47800/mcp';
}

let sessionId = null;

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(body);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': data.length };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers, timeout: 0 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.headers['mcp-session-id']) sessionId = res.headers['mcp-session-id'];
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function health(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.get({ hostname: u.hostname, port: u.port, path: '/health', timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

let launching = null;
async function ensureApp() {
  if (await health(endpoint())) return true;
  if (!launching) {
    launching = (async () => {
      const exe = process.env.CARFORGE_EXE || runtime()?.exe || (process.versions.electron ? process.execPath : null);
      if (!exe) { log('CarForge is not running and its executable is unknown'); return false; }
      log('starting CarForge Studio:', exe);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const args = runtime()?.appArgs || [];
      try { spawn(exe, args, { detached: true, stdio: 'ignore', env }).unref(); } catch (e) { log('launch failed', e.message); return false; }
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await health(endpoint())) return true;
      }
      return false;
    })().finally(() => { setTimeout(() => { launching = null; }, 1000); });
  }
  return launching;
}

function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

async function forward(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const isRequest = (m) => m && m.method && m.id !== undefined && m.id !== null;
  const requests = (Array.isArray(msg) ? msg : [msg]).filter(isRequest);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await post(endpoint(), line);
      if (r.status === 202 || !r.body) return;
      if (r.status >= 400 && !r.body.trim().startsWith('{') && !r.body.trim().startsWith('[')) throw new Error(`HTTP ${r.status}: ${r.body}`);
      const out = JSON.parse(r.body);
      if (Array.isArray(out)) out.forEach(write); else write(out);
      return;
    } catch (e) {
      if (attempt === 0 && (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET')) {
        if (await ensureApp()) { sessionId = null; continue; }
      }
      for (const m of requests) write({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: `CarForge Studio is not reachable (${e.message}). Start the CarForge Studio app and try again.` } });
      return;
    }
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
const inflight = new Set();
rl.on('line', (line) => {
  if (!line.trim()) return;
  // initialize must complete before anything else; afterwards run requests concurrently
  let msg = null;
  try { msg = JSON.parse(line); } catch { /* handled in forward */ }
  if (msg && msg.method === 'initialize') {
    chain = chain.then(() => forward(line));
  } else {
    const p = chain.then(() => forward(line));
    inflight.add(p); p.finally(() => inflight.delete(p));
  }
});
rl.on('close', async () => { await chain; await Promise.all([...inflight]); process.exit(0); });
log('ready, forwarding to', endpoint());
