// Minimal, dependency-free MCP server over Streamable HTTP (JSON responses).
// Spec: https://modelcontextprotocol.io  – supports protocol revisions 2024-11-05 … 2025-11-25,
// and answers the stateless 2026-07-28 style (no initialize, server/discover) as well.
const http = require('http');
const crypto = require('crypto');

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2026-07-28'];
const LATEST = '2025-11-25';

const INSTRUCTIONS = `CarForge Studio is a 3D modelling app specialised in cars, running on the user's computer.
Start with get_scene and (once) get_modeling_guide. Create cars with create_car (presets: sedan, sports_coupe, supercar, hatchback, suv, pickup, wagon, muscle, van)
and refine them with update_car – there are ~100 parameters (describe_car_parameters). Always check your work visually with capture_view (several views at once).
Units are metres/degrees, +Y up, cars face +X. Everything is undoable (undo tool). Export with export_model (GLB recommended).`;

class McpHttpServer {
  /**
   * @param {object} opts
   * @param {() => Promise<Array>} opts.listTools
   * @param {(name: string, args: object) => Promise<object>} opts.callTool
   * @param {(status: object) => void} opts.onStatus
   */
  constructor({ listTools, callTool, onStatus, name = 'carforge-studio', title = 'CarForge Studio', version = '1.0.0' }) {
    this.listTools = listTools;
    this.callTool = callTool;
    this.onStatus = onStatus || (() => {});
    this.info = { name, title, version };
    this.server = null;
    this.port = null;
    this.status = { listening: false, url: null, clientConnected: false, clientName: null, lastSeen: 0, calls: 0, error: null };
    this.sessions = new Map();
    this._timer = setInterval(() => this._checkIdle(), 5000);
  }

  _checkIdle() {
    const connected = Date.now() - this.status.lastSeen < 120000 && this.status.lastSeen > 0;
    if (connected !== this.status.clientConnected) { this.status.clientConnected = connected; this.onStatus({ ...this.status }); }
  }

  async start(port = 47800, host = '127.0.0.1', tries = 10) {
    for (let i = 0; i < tries; i++) {
      const p = port + i;
      try {
        await new Promise((resolve, reject) => {
          const srv = http.createServer((req, res) => this._handle(req, res).catch((e) => {
            try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); } catch { /* ignore */ }
          }));
          srv.keepAliveTimeout = 65000;
          srv.requestTimeout = 0;
          srv.once('error', reject);
          srv.listen(p, host, () => { this.server = srv; resolve(); });
        });
        this.port = p;
        this.status = { ...this.status, listening: true, url: `http://${host}:${p}/mcp`, error: null };
        this.onStatus({ ...this.status });
        return this.status.url;
      } catch (e) {
        if (e.code !== 'EADDRINUSE') { this.status.error = e.message; this.onStatus({ ...this.status }); throw e; }
      }
    }
    this.status.error = `ports ${port}-${port + tries - 1} are busy`;
    this.onStatus({ ...this.status });
    throw new Error(this.status.error);
  }

  stop() { clearInterval(this._timer); this.server?.close(); }

  _originAllowed(origin) {
    if (!origin || origin === 'null') return true;
    try {
      const u = new URL(origin);
      return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'file:';
    } catch { return false; }
  }

  async _readBody(req, limit = 64 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new Error('request too large');
      chunks.push(c);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async _handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!this._originAllowed(req.headers.origin)) { res.writeHead(403); return res.end('forbidden origin'); }
    if (url.pathname === '/health' || url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, ...this.info, mcp: this.status.url }));
    }
    if (url.pathname !== '/mcp') { res.writeHead(404); return res.end('not found'); }
    if (req.method === 'GET') { res.writeHead(405, { Allow: 'POST, DELETE' }); return res.end(); }
    if (req.method === 'DELETE') {
      const sid = req.headers['mcp-session-id'];
      if (sid) this.sessions.delete(sid);
      res.writeHead(200); return res.end();
    }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST, DELETE' }); return res.end(); }

    let msg;
    try { msg = JSON.parse(await this._readBody(req)); } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${e.message}` } }));
    }
    this.status.lastSeen = Date.now();
    if (!this.status.clientConnected) { this.status.clientConnected = true; this.onStatus({ ...this.status }); }

    const batch = Array.isArray(msg);
    const list = batch ? msg : [msg];
    const headers = { 'Content-Type': 'application/json' };
    const replies = [];
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      if (m.method && m.id !== undefined && m.id !== null) {
        const r = await this._request(m, req, headers);
        replies.push(r);
      } else if (m.method) {
        this._notification(m);
      }
      // responses from the client (no method) are ignored – we never send requests
    }
    if (!replies.length) { res.writeHead(202); return res.end(); }
    const body = JSON.stringify(batch ? replies : replies[0]);
    headers['Content-Length'] = Buffer.byteLength(body);
    res.writeHead(200, headers);
    res.end(body);
  }

  _notification(m) {
    if (m.method === 'notifications/initialized') return;
    // notifications/cancelled etc. are accepted silently
  }

  async _request(m, req, headers) {
    const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    const err = (code, message, data) => ({ jsonrpc: '2.0', id: m.id, error: { code, message, ...(data ? { data } : {}) } });
    const p = m.params || {};
    try {
      switch (m.method) {
        case 'initialize': {
          const requested = p.protocolVersion;
          const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : LATEST;
          const sid = crypto.randomUUID();
          this.sessions.set(sid, { client: p.clientInfo, created: Date.now() });
          headers['Mcp-Session-Id'] = sid;
          this.status.clientName = p.clientInfo?.name || null;
          this.onStatus({ ...this.status });
          return ok({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: this.info, instructions: INSTRUCTIONS });
        }
        case 'server/discover':
          return ok({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: { listChanged: false } }, serverInfo: this.info, instructions: INSTRUCTIONS });
        case 'ping':
          return ok({});
        case 'tools/list': {
          const tools = await this.listTools();
          return ok({ tools });
        }
        case 'tools/call': {
          if (!p.name) return err(-32602, 'Missing tool name');
          const meta = p._meta?.clientInfo?.name || p._meta?.['io.modelcontextprotocol/clientInfo']?.name;
          if (meta && meta !== this.status.clientName) { this.status.clientName = meta; this.onStatus({ ...this.status }); }
          this.status.calls++;
          const result = await this.callTool(p.name, p.arguments || {});
          return ok(result);
        }
        case 'resources/list': return ok({ resources: [] });
        case 'resources/templates/list': return ok({ resourceTemplates: [] });
        case 'prompts/list': return ok({ prompts: [] });
        case 'logging/setLevel': return ok({});
        default: return err(-32601, `Method not found: ${m.method}`);
      }
    } catch (e) {
      return err(-32603, e.message || String(e));
    }
    // eslint-disable-next-line no-unreachable
    void req;
  }
}

module.exports = { McpHttpServer, SUPPORTED_VERSIONS };
