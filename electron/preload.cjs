// Exposes a small, safe API to the renderer (window.carforge).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('carforge', {
  isDesktop: true,
  // MCP plumbing
  onToolCall: (cb) => ipcRenderer.on('mcp:call', (_e, msg) => cb(msg)),
  sendToolResult: (msg) => ipcRenderer.send('mcp:result', msg),
  setToolList: (tools) => ipcRenderer.send('mcp:tools', tools),
  onMcpStatus: (cb) => ipcRenderer.on('mcp:status', (_e, st) => cb(st)),
  getMcpStatus: () => ipcRenderer.invoke('mcp:status'),
  getClaudeConfig: () => ipcRenderer.invoke('claude:config'),
  installClaudeDesktop: () => ipcRenderer.invoke('claude:install'),
  // files
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  writeFile: (path, data, encoding) => ipcRenderer.invoke('file:write', { path, data, encoding }),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  exportFile: (opts) => ipcRenderer.invoke('file:export', opts),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, a) => cb(a)),
});
