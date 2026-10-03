// End-to-end test: launches the Electron app, talks MCP to it over HTTP and through the stdio bridge.
// Usage: node scripts/test-mcp.cjs   (on Linux CI wrap with xvfb-run)
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const PORT = Number(process.env.CARFORGE_MCP_PORT || 47850);
const URL_ = `http://127.0.0.1:${PORT}/mcp`;
const outDir = path.join(root, 'test-output');
fs.mkdirSync(outDir, { recursive: true });

function post(body, sid) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': data.length, ...(sid ? { 'Mcp-Session-Id': sid } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null }));
    });
    req.on('error', reject); req.end(data);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function health() { try { const r = await new Promise((res, rej) => http.get(`http://127.0.0.1:${PORT}/health`, (x) => { x.resume(); res(x.statusCode); }).on('error', rej)); return r === 200; } catch { return false; } }

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

(async () => {
  const env = { ...process.env, CARFORGE_MCP_PORT: String(PORT), CARFORGE_NO_SANDBOX: '1', CARFORGE_HEADLESS_GL: process.env.CARFORGE_HEADLESS_GL ?? '1', CARFORGE_LOG_RENDERER: process.env.CARFORGE_LOG_RENDERER || '' };
  const appExe = process.env.CARFORGE_APP_EXE; // test a packaged build instead of the source tree
  const app = appExe ? spawn(appExe, ['--no-sandbox'], { env, stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(electron, [root, '--no-sandbox'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`));
  app.stderr.on('data', (d) => { const s = String(d); if (!/dbus|GPU|gpu|viz|Fontconfig|libva|ALSA|sandbox/i.test(s)) process.stdout.write(`[app:err] ${s}`); });
  try {
    for (let i = 0; i < 120 && !(await health()); i++) await wait(500);
    check(await health(), 'health endpoint up');

    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'carforge-test', version: '1' } } });
    check(init.body?.result?.protocolVersion === '2025-06-18', `initialize negotiated ${init.body?.result?.protocolVersion}`);
    const sid = init.headers['mcp-session-id'];
    check(!!sid, 'session id issued');
    const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
    check(note.status === 202, 'notification → 202');

    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid);
    const names = (list.body?.result?.tools || []).map((t) => t.name);
    check(names.length > 30, `tools/list returned ${names.length} tools`);

    const call = async (id, name, args) => (await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, sid)).body?.result;
    let r = await call(3, 'create_car', { preset: 'sports_coupe', params: { paintColor: '#0d3fa6' } });
    check(r && !r.isError && /car1/.test(r.content[0].text), 'create_car');
    r = await call(4, 'update_car', { id: 'car1', params: { rimStyle: 'mesh', spoiler: 'wing', camber: -2 } });
    check(r && !r.isError, 'update_car');
    r = await call(5, 'capture_view', { views: ['three_quarter_front', 'rear_left'], width: 800, height: 500 });
    const imgs = (r?.content || []).filter((c) => c.type === 'image');
    check(imgs.length === 2, `capture_view returned ${imgs.length} images`);
    imgs.forEach((im, i) => fs.writeFileSync(path.join(outDir, `mcp-view-${i}.${im.mimeType.includes('png') ? 'png' : 'jpg'}`), Buffer.from(im.data, 'base64')));
    r = await call(6, 'export_model', { format: 'glb', path: path.join(outDir, 'mcp-export.glb') });
    check(r && !r.isError && fs.existsSync(path.join(outDir, 'mcp-export.glb')), `export_model → ${r?.content?.[0]?.text?.slice(0, 120)}`);
    r = await call(7, 'nope', {});
    check(r?.isError, 'unknown tool reports isError');
    const discover = await post({ jsonrpc: '2.0', id: 8, method: 'server/discover' });
    check(Array.isArray(discover.body?.result?.supportedVersions), 'server/discover (stateless 2026 style)');

    // stdio bridge
    const bridgeScript = appExe ? path.join(path.dirname(appExe), 'resources', 'mcp-bridge.cjs') : path.join(root, 'electron', 'mcp-bridge.cjs');
    const bridge = spawn(appExe || electron, [bridgeScript], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CARFORGE_MCP_URL: URL_ }, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = [];
    let buf = '';
    bridge.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bridge-test', version: '1' } } }) + '\n');
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_scene', arguments: {} } }) + '\n');
    for (let i = 0; i < 60 && lines.length < 2; i++) await wait(250);
    bridge.stdin.end();
    check(lines.find((l) => l.id === 1)?.result?.serverInfo?.name === 'carforge-studio', 'stdio bridge initialize');
    check(/car1/.test(lines.find((l) => l.id === 2)?.result?.content?.[0]?.text || ''), 'stdio bridge tools/call get_scene');
  } catch (e) {
    console.error(e); failures++;
  } finally {
    app.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll MCP checks passed');
  process.exit(failures ? 1 : 0);
})();
