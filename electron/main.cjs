// CarForge Studio – Electron main process.
// Creates the window, hosts the MCP server (Streamable HTTP on 127.0.0.1) and forwards tool
// calls to the renderer, where the 3D scene lives.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { McpHttpServer } = require('./mcp-server.cjs');

const isDev = !app.isPackaged;
const PORT = Number(process.env.CARFORGE_MCP_PORT || 47800);
const RUNTIME_DIR = path.join(os.homedir(), '.carforge');
const RUNTIME_FILE = path.join(RUNTIME_DIR, 'runtime.json');

if (process.env.CARFORGE_NO_SANDBOX || (process.getuid && process.getuid() === 0)) app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (process.env.CARFORGE_HEADLESS_GL) { app.commandLine.appendSwitch('use-gl', 'angle'); app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }

let win = null;
let mcp = null;
let toolList = null;
const toolListWaiters = [];
const pending = new Map();
let callSeq = 0;

// single instance: a second launch (e.g. by the MCP bridge) just focuses the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

function bridgePath() {
  return isDev ? path.join(__dirname, 'mcp-bridge.cjs') : path.join(process.resourcesPath, 'mcp-bridge.cjs');
}

function documentsDir(kind = 'exports') {
  const d = path.join(app.getPath('documents'), 'CarForge', kind);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeRuntime(url) {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify({ url, pid: process.pid, exe: process.execPath, appArgs: isDev ? [path.join(__dirname, '..')] : [], bridge: bridgePath(), started: new Date().toISOString() }, null, 2));
  } catch (e) { console.error('runtime file', e); }
}

function claudeDesktopConfigPath() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function claudeSnippet() {
  const entry = { command: process.execPath, args: isDev ? [bridgePath()] : [bridgePath()], env: { ELECTRON_RUN_AS_NODE: '1' } };
  return { mcpServers: { carforge: entry } };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 680,
    backgroundColor: '#121317',
    title: 'CarForge Studio',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.once('ready-to-show', () => { win.show(); if (process.env.CARFORGE_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' }); });
  win.on('closed', () => { win = null; toolList = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('render-process-gone', (_e, d) => console.error('renderer gone', d));
  win.webContents.on('console-message', (_e, level, message) => { if (process.env.CARFORGE_LOG_RENDERER) console.log('[renderer]', message); });
  const menu = Menu.buildFromTemplate([
    { label: 'App', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'quit' }] },
  ]);
  Menu.setApplicationMenu(menu);
}

function sendStatus(st) { win?.webContents.send('mcp:status', st); }

async function listTools() {
  if (toolList) return toolList;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('CarForge window is still loading')), 30000);
    toolListWaiters.push((l) => { clearTimeout(t); resolve(l); });
  });
}

function callTool(name, args) {
  if (!win) return Promise.resolve({ content: [{ type: 'text', text: 'CarForge window is not open' }], isError: true });
  const id = ++callSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ content: [{ type: 'text', text: `Tool "${name}" timed out` }], isError: true }); }, 300000);
    pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    win.webContents.send('mcp:call', { id, name, args });
  });
}

// ---------------------------------------------------------------- IPC
ipcMain.on('mcp:tools', (_e, tools) => { toolList = tools; while (toolListWaiters.length) toolListWaiters.shift()(tools); });
ipcMain.on('mcp:result', (_e, { id, result }) => { const r = pending.get(id); if (r) { pending.delete(id); r(result); } });
ipcMain.handle('mcp:status', () => mcp?.status || { listening: false });
ipcMain.handle('claude:config', () => ({ snippet: claudeSnippet(), path: claudeDesktopConfigPath(), bridge: bridgePath(), url: mcp?.status.url }));
ipcMain.handle('claude:install', () => {
  const p = claudeDesktopConfigPath();
  let cfg = {};
  if (fs.existsSync(p)) {
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); } catch { throw new Error(`Could not parse ${p}; fix it or add the snippet manually`); }
    fs.copyFileSync(p, `${p}.bak`);
  } else fs.mkdirSync(path.dirname(p), { recursive: true });
  cfg.mcpServers = { ...(cfg.mcpServers || {}), ...claudeSnippet().mcpServers };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return { path: p };
});

const toBuffer = (data, encoding) => {
  if (typeof data === 'string') return Buffer.from(data, encoding === 'base64' ? 'base64' : 'utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('unsupported data');
};
const resolveUserPath = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.resolve(p));

ipcMain.handle('file:save', async (_e, { defaultPath, filters, data }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(documentsDir(defaultPath?.endsWith('.carforge') ? 'projects' : 'exports'), defaultPath || 'untitled'), filters });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, toBuffer(data));
  return r.filePath;
});
ipcMain.handle('file:open', async (_e, { filters }) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters, defaultPath: documentsDir('projects') });
  if (r.canceled || !r.filePaths[0]) return null;
  const buf = fs.readFileSync(r.filePaths[0]);
  return { path: r.filePaths[0], name: path.basename(r.filePaths[0]), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});
ipcMain.handle('file:write', async (_e, { path: p, data, encoding }) => {
  const full = resolveUserPath(p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, toBuffer(data, encoding));
  return full;
});
ipcMain.handle('file:read', async (_e, p) => {
  const buf = fs.readFileSync(resolveUserPath(p));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});
ipcMain.handle('file:export', async (_e, { path: p, fileName, data, kind }) => {
  const full = p ? resolveUserPath(p) : path.join(documentsDir(kind || 'exports'), fileName);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, toBuffer(data));
  return full;
});

// ---------------------------------------------------------------- lifecycle
app.whenReady().then(async () => {
  if (!gotLock) return;
  createWindow();
  mcp = new McpHttpServer({ listTools, callTool, onStatus: sendStatus, version: app.getVersion() });
  try {
    const url = await mcp.start(PORT);
    writeRuntime(url);
    console.log(`CarForge MCP server listening on ${url}`);
  } catch (e) {
    console.error('MCP server failed to start:', e.message);
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  mcp?.stop();
  try { const r = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8')); if (r.pid === process.pid) fs.unlinkSync(RUNTIME_FILE); } catch { /* ignore */ }
  app.quit();
});
