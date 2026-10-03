// Application bootstrap: wires editor, viewport, panels, menus, shortcuts, drag & drop and the MCP bridge.
import * as THREE from 'three';
import { Editor } from './editor.js';
import { Viewport } from './viewport.js';
import { Library } from './ui/library.js';
import { Outliner } from './ui/outliner.js';
import { Properties } from './ui/properties.js';
import { h, toast, modal } from './ui/dom.js';
import { ENVIRONMENTS } from './environment.js';
import { createTools, runTool } from './mcp/tools.js';
import { exportScene, importModel, installModelLoader, saveDialog, openDialog, bridge, IMPORT_FORMATS } from './io.js';

class App {
  constructor() {
    this.editor = new Editor();
    installModelLoader(this.editor);
    this.viewport = new Viewport(document.getElementById('viewport'), this.editor);
    this.toast = toast;
    this.library = new Library(this);
    this.outliner = new Outliner(this);
    this.properties = new Properties(this);
    this.tools = createTools(this);
    this.projectPath = null;
    this.aiLog = [];
    this._initToolbar();
    this._initMenus();
    this._initKeyboard();
    this._initDrop();
    this._initStatus();
    this._initMCP();
    this.viewport.frame(null, 'perspective');
    window.carforgeApp = this; // for debugging / tests
  }

  // ---------------------------------------------------------------- toolbar
  _initToolbar() {
    const env = document.getElementById('envSelect');
    for (const [k, v] of Object.entries(ENVIRONMENTS)) env.append(h('option', { value: k }, v.label));
    env.addEventListener('change', () => { this.viewport.env.apply({ preset: env.value }); this.properties.render(); });
    this.syncEnvSelect();
    document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    const snap = document.getElementById('snapBtn');
    snap.addEventListener('click', () => { snap.classList.toggle('on'); this.viewport.setSnap(snap.classList.contains('on')); });
    document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      this.action(b.dataset.action);
    }));
    document.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => this.handleDrop({ type: 'car', preset: b.dataset.quick }, null)));
  }

  syncEnvSelect() { document.getElementById('envSelect').value = this.viewport.env.settings.preset; }

  setMode(mode) {
    this.viewport.setMode(mode);
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  }

  _initMenus() {
    document.querySelectorAll('.menu > button').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = b.parentElement;
      const open = m.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open'));
      if (!open) m.classList.add('open');
    }));
    document.querySelectorAll('.menu').forEach((m) => m.addEventListener('mouseenter', () => {
      if (document.querySelector('.menu.open') && !m.classList.contains('open')) { document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open')); m.classList.add('open'); }
    }));
    window.addEventListener('click', () => document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open')));
    bridge?.onMenu?.((action) => this.action(action));
  }

  async action(a) {
    const ed = this.editor, sel = ed.selection;
    try {
      if (a.startsWith('view:')) return this.viewport.frame(ed.selected || null, a.slice(5));
      if (a.startsWith('export:')) return this.exportAs(a.slice(7));
      if (a.startsWith('bool:')) {
        if (sel.length !== 2) return toast('Select exactly two objects (shift-click): the first is kept, the second is the tool', 'err');
        return ed.booleanOp(sel[0], sel[1], a.slice(5));
      }
      switch (a) {
        case 'new': if (!ed.objects.size || confirm('Clear the scene? (you can undo)')) { ed.clear(); this.projectPath = null; } break;
        case 'open': return this.openProject();
        case 'save': return this.saveProject(false);
        case 'saveAs': return this.saveProject(true);
        case 'import': return this.importFile();
        case 'screenshot': return this.screenshot();
        case 'undo': ed.undo(); break;
        case 'redo': ed.redo(); break;
        case 'duplicate': for (const id of sel) ed.duplicate(id, { offset: [0, 0, ed.objects.get(id).userData.cf.kind === 'car' ? 2.4 : 0.4] }); break;
        case 'delete': if (sel.length) ed.remove(sel); break;
        case 'group': if (sel.length) ed.addGroup(sel); break;
        case 'ground': for (const id of sel) ed.dropToGround(id); break;
        case 'toMesh': for (const id of sel) ed.convertToMesh(id); break;
        case 'mirror': for (const id of sel) ed.mirror(id, 'z'); break;
        case 'frame': this.viewport.frame(sel.length ? sel.map((i) => ed.objects.get(i)) : null); break;
        case 'toggleGrid': this.viewport.grid.visible = !this.viewport.grid.visible; break;
        case 'connectAI': return this.showConnectDialog();
        case 'aiLog': return this.showAiLog();
        case 'help': return this.showHelp();
        default: console.warn('unknown action', a);
      }
    } catch (e) { console.error(e); toast(e.message, 'err'); }
  }

  // ---------------------------------------------------------------- keyboard
  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      const map = {
        'ctrl+z': 'undo', 'ctrl+y': 'redo', 'ctrl+shift+z': 'redo', 'ctrl+d': 'duplicate', 'ctrl+g': 'group', 'ctrl+s': 'save', 'ctrl+o': 'open', 'ctrl+n': 'new',
        delete: 'delete', backspace: 'delete', f: 'frame', f12: 'screenshot', 0: 'view:perspective', 1: 'view:front', 3: 'view:side', 7: 'view:top', 9: 'view:rear',
      };
      const combo = `${ctrl ? 'ctrl+' : ''}${e.shiftKey && ctrl ? 'shift+' : ''}${k}`;
      if (map[combo]) { e.preventDefault(); return this.action(map[combo]); }
      if (!ctrl) {
        if (k === 'q') this.setMode('select');
        if (k === 'w') this.setMode('translate');
        if (k === 'e') this.setMode('rotate');
        if (k === 'r') this.setMode('scale');
        if (k === 's') document.getElementById('snapBtn').click();
        if (k === 'h') for (const id of this.editor.selection) this.editor.setVisible(id, false);
        if (k === 'escape') this.editor.select([]);
      }
    });
  }

  // ---------------------------------------------------------------- drag & drop
  _initDrop() {
    const wrap = document.getElementById('viewportWrap');
    let depth = 0;
    wrap.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; wrap.classList.add('dragging'); });
    wrap.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; wrap.classList.remove('dragging'); } });
    wrap.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    wrap.addEventListener('drop', async (e) => {
      e.preventDefault(); depth = 0; wrap.classList.remove('dragging');
      const raw = e.dataTransfer.getData('application/x-carforge');
      if (raw) return this.handleDrop(JSON.parse(raw), this.viewport.dropPoint(e.clientX, e.clientY));
      // files from the OS
      for (const f of e.dataTransfer.files) {
        const ext = f.name.split('.').pop().toLowerCase();
        if (ext === 'carforge' || ext === 'json') { this.loadProjectData(JSON.parse(await f.text())); continue; }
        if (!IMPORT_FORMATS.includes(ext)) { toast(`Can't import .${ext}`, 'err'); continue; }
        const drop = this.viewport.dropPoint(e.clientX, e.clientY);
        await importModel(this.editor, await f.arrayBuffer(), f.name, { position: drop.point.toArray() });
        toast(`Imported ${f.name}`, 'ok');
      }
    });
    this.editor.on('change', () => document.getElementById('emptyHint').classList.toggle('hidden', this.editor.objects.size > 0));
  }

  /** Adds a library item; drop = {point, object, mesh} or null (click). */
  handleDrop(d, drop) {
    const ed = this.editor;
    const at = drop?.point ? [drop.point.x, 0, drop.point.z] : this._freeSpot(d.type === 'car' ? 2.6 : 1);
    try {
      switch (d.type) {
        case 'car': {
          const o = ed.addCar(d.preset, { position: at });
          if (ed.objects.size === 1) this.viewport.frame(o, 'hero');
          toast(`Added ${o.name} — tweak it on the right`, 'ok');
          break;
        }
        case 'primitive': {
          const o = ed.addPrimitive(d.shape, {}, { position: drop?.object ? drop.point.toArray() : [at[0], 0.5, at[2]] });
          if (!drop?.object) ed.dropToGround(ed.idOf(o), { commit: false });
          break;
        }
        case 'part': {
          const o = ed.addPart(d.partType, {}, { position: drop?.point ? drop.point.toArray() : at });
          if (d.partType === 'wheel' && !drop?.object) { o.position.y = 0.34; o.updateMatrixWorld(); }
          break;
        }
        case 'light': ed.addLight(d.lightType, d.lightType === 'area' ? { intensity: 30 } : {}, { position: [at[0], 3, at[2]] }); break;
        case 'rig': this.addStudioRig(); break;
        case 'paint':
        case 'material': {
          const target = drop?.object || ed.selected;
          if (!target) return toast('Drop paint onto an object (or select one first)', 'err');
          const id = ed.idOf(target);
          if (target.userData.cf.kind === 'car') {
            const part = drop?.mesh?.name || 'body';
            if (d.type === 'paint') ed.setParams(id, /rim|wheel/.test(part) ? { rimFinish: d.finish === 'chrome' ? 'chrome' : 'body', paintColor: target.userData.cf.params.paintColor } : /caliper/.test(part) ? { caliperColor: d.color } : { paintColor: d.color, paintFinish: d.finish });
            else ed.setMaterial(id, { preset: d.preset }, { part });
          } else if (d.type === 'paint') {
            const pr = { metallic: 'car_paint_metallic', gloss: 'car_paint_gloss', pearl: 'car_paint_pearl', matte: 'car_paint_matte', candy: 'candy', chrome: 'chrome', satin: 'car_paint_matte' }[d.finish];
            ed.setMaterial(id, { preset: pr, color: d.color });
          } else ed.setMaterial(id, { preset: d.preset });
          ed.select([id]);
          break;
        }
        default: break;
      }
    } catch (e) { console.error(e); toast(e.message, 'err'); }
  }

  _freeSpot(clear) {
    const box = this.viewport.sceneBox();
    if (box.isEmpty()) return [0, 0, 0];
    return [0, 0, box.max.z + clear];
  }

  addStudioRig() {
    const ed = this.editor;
    const ids = [
      ed.addLight('area', { intensity: 40, width: 4, height: 1.5, color: '#ffffff' }, { name: 'Key softbox', position: [3, 4, 3], rotation: [-35, 45, 0], commit: false, select: false }),
      ed.addLight('area', { intensity: 18, width: 3, height: 1.2, color: '#dfe8ff' }, { name: 'Fill softbox', position: [-4, 3, 2], rotation: [-30, -60, 0], commit: false, select: false }),
      ed.addLight('area', { intensity: 30, width: 5, height: 0.6, color: '#ffffff' }, { name: 'Rim strip', position: [-2, 3.5, -4], rotation: [-40, -150, 0], commit: false, select: false }),
    ].map((o) => ed.idOf(o));
    ed.addGroup(ids, { name: 'Studio rig' });
  }

  // ---------------------------------------------------------------- files
  projectData() {
    const cam = this.viewport.camera, t = this.viewport.controls.target;
    return this.editor.serialize({ environment: this.viewport.env.settings, camera: { position: cam.position.toArray(), target: t.toArray() } });
  }

  loadProjectData(data) {
    this.editor.load(data);
    if (data.environment) { this.viewport.env.apply(data.environment); this.syncEnvSelect(); }
    if (data.camera) { this.viewport.camera.position.fromArray(data.camera.position); this.viewport.controls.target.fromArray(data.camera.target); }
    toast('Project opened', 'ok');
  }

  async saveProject(as) {
    const json = JSON.stringify(this.projectData());
    if (bridge && this.projectPath && !as) { await bridge.writeFile(this.projectPath, json); this.editor.dirty = false; return toast('Saved', 'ok'); }
    const p = await saveDialog(json, 'my-car.carforge', 'application/json', [{ name: 'CarForge project', extensions: ['carforge'] }]);
    if (p) { this.projectPath = bridge ? p : null; this.editor.dirty = false; toast('Saved', 'ok'); }
  }

  async openProject() {
    const f = await openDialog([{ name: 'CarForge project', extensions: ['carforge', 'json'] }], '.carforge,.json');
    if (!f) return;
    this.loadProjectData(JSON.parse(new TextDecoder().decode(f.data)));
    this.projectPath = bridge ? f.path : null;
  }

  async importFile() {
    const f = await openDialog([{ name: '3D models', extensions: IMPORT_FORMATS }], IMPORT_FORMATS.map((x) => '.' + x).join(','));
    if (!f) return;
    await importModel(this.editor, f.data, f.name || f.path.split(/[\\/]/).pop());
    toast('Imported', 'ok');
  }

  async exportAs(format) {
    toast(`Exporting ${format.toUpperCase()}…`);
    const ids = this.editor.selection.length ? null : null;
    const res = await exportScene(this.editor, format, { ids });
    const p = await saveDialog(res.data, `carforge-model.${format}`, res.mime, [{ name: format.toUpperCase(), extensions: [format] }]);
    if (p) toast(`Exported ${p}`, 'ok');
  }

  async screenshot() {
    for (const m of this.editor.cars.values()) await m.whenReady(8000);
    const url = this.viewport.capture({ width: 2560, height: 1440 });
    const bin = atob(url.split(',')[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const p = await saveDialog(arr.buffer, 'carforge-render.png', 'image/png', [{ name: 'PNG image', extensions: ['png'] }]);
    if (p) toast('Render saved', 'ok');
  }

  // ---------------------------------------------------------------- status bar
  _initStatus() {
    const stats = document.getElementById('stats');
    const upd = () => { const s = this.editor.stats(); stats.textContent = `${s.objects} objects · ${s.triangles.toLocaleString()} tris`; };
    this.editor.on('change', upd); this.editor.on('update', upd); upd();
    this.editor.on('history', (d) => { document.getElementById('statusMsg').textContent = d.label; });
  }

  // ---------------------------------------------------------------- MCP / AI link
  _initMCP() {
    const pill = document.getElementById('aiStatus');
    if (!bridge) {
      pill.querySelector('.label').textContent = 'AI link (desktop only)';
      document.getElementById('mcpInfo').textContent = 'Browser preview – MCP server runs in the desktop app';
      return;
    }
    bridge.onToolCall(async ({ id, name, args }) => {
      pill.classList.add('busy');
      const t0 = performance.now();
      this._aiFeed(name, args);
      const result = await runTool(this.tools, name, args);
      const ms = Math.round(performance.now() - t0);
      this.aiLog.unshift({ time: new Date().toLocaleTimeString(), name, args, ms, error: result.isError ? result.content[0].text : null });
      if (this.aiLog.length > 200) this.aiLog.pop();
      if (result.isError) this._aiFeed(name, null, result.content[0].text);
      pill.classList.remove('busy');
      bridge.sendToolResult({ id, result });
    });
    bridge.setToolList(this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
    bridge.onMcpStatus((st) => this._mcpStatus(st));
    bridge.getMcpStatus().then((st) => this._mcpStatus(st));
  }

  _mcpStatus(st) {
    this.mcp = st;
    const pill = document.getElementById('aiStatus');
    pill.classList.toggle('ready', !!st.listening && !st.clientConnected);
    pill.classList.toggle('connected', !!st.clientConnected);
    pill.querySelector('.label').textContent = st.clientConnected ? `AI connected${st.clientName ? ` · ${st.clientName}` : ''}` : st.listening ? 'AI link ready' : 'AI link off';
    document.getElementById('mcpInfo').textContent = st.listening ? `MCP: ${st.url}` : `MCP server error: ${st.error || 'not running'}`;
  }

  _aiFeed(name, args, err) {
    const box = document.getElementById('aiActivity');
    const summary = args ? Object.entries(args).filter(([k]) => k !== 'code').slice(0, 3).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`).join(' ') : '';
    const it = h('div', { class: `ai-item ${err ? 'err' : ''}` }, h('b', {}, '🤖 ' + name), ' ', err ? err.slice(0, 140) : summary);
    box.prepend(it);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => it.remove(), err ? 9000 : 5000);
  }

  async showConnectDialog() {
    const st = bridge ? await bridge.getMcpStatus() : { url: 'http://127.0.0.1:47800/mcp' };
    const cfg = bridge ? await bridge.getClaudeConfig() : null;
    const copy = (txt) => { navigator.clipboard.writeText(txt); toast('Copied', 'ok'); };
    const claudeCode = `claude mcp add --transport http carforge ${st.url}`;
    const desktopJson = cfg ? JSON.stringify(cfg.snippet, null, 2) : '(desktop app only)';
    const content = h('div', {},
      h('h2', {}, '🤖 Connect Claude to CarForge'),
      h('p', {}, 'CarForge runs a local MCP server while it is open. Claude can then create and edit cars, take screenshots of the viewport to check its work, and export models.'),
      h('h3', {}, 'Claude Desktop (one click)'),
      h('p', {}, 'Adds CarForge to claude_desktop_config.json, then restart Claude Desktop. Uses a tiny stdio bridge bundled with this app.'),
      h('div', { class: 'row-btns' },
        h('button', { class: 'primary', onclick: async () => { try { const r = await bridge.installClaudeDesktop(); toast(`Installed into ${r.path} — restart Claude Desktop`, 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Install into Claude Desktop'),
        h('button', { onclick: () => copy(desktopJson) }, 'Copy JSON')),
      h('pre', {}, desktopJson),
      h('h3', {}, 'Claude Code (CLI)'),
      h('pre', {}, claudeCode),
      h('div', { class: 'row-btns' }, h('button', { onclick: () => copy(claudeCode) }, 'Copy command')),
      h('h3', {}, 'Any MCP client (Streamable HTTP)'),
      h('pre', {}, st.url),
      h('p', {}, `Status: ${st.listening ? 'listening' : 'not running'}${st.clientConnected ? ` · connected client: ${st.clientName || 'unknown'}` : ''}. The server only accepts connections from this computer.`),
      h('h3', {}, 'Try asking Claude'),
      h('pre', {}, '"Build a matte-black widebody sports coupe with bronze mesh wheels,\n a ducktail and quad exhausts, then show me front and rear 3/4 views."\n\n"Make the SUV more rugged: higher ride, bigger tyres, squarer arches,\n roof rails — and export it as GLB to my desktop."'),
    );
    modal(content);
  }

  showAiLog() {
    const rows = this.aiLog.map((l) => h('tr', {}, h('td', {}, l.time), h('td', {}, h('b', {}, l.name)), h('td', {}, `${l.ms} ms`), h('td', {}, l.error ? `❌ ${l.error}` : JSON.stringify(l.args).slice(0, 160))));
    modal(h('div', {}, h('h2', {}, 'AI activity log'), h('p', {}, 'Every tool call made by connected AI clients (newest first).'),
      h('div', { class: 'log' }, rows.length ? h('table', {}, rows) : h('p', {}, 'No calls yet.'))));
  }

  showHelp() {
    const keys = [['Left drag', 'Orbit'], ['Right drag / Shift+drag', 'Pan'], ['Wheel', 'Zoom'], ['Click / Shift+click', 'Select / multi-select'], ['Double click', 'Focus object'],
      ['Q W E R', 'Select / Move / Rotate / Scale'], ['S', 'Toggle snapping'], ['F', 'Frame selection'], ['0 1 3 7 9', 'Perspective / Front / Side / Top / Rear'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+D', 'Duplicate'], ['Ctrl+G', 'Group'], ['Del', 'Delete'], ['H', 'Hide'], ['Ctrl+S / Ctrl+O', 'Save / Open'], ['F12', 'Render image']];
    modal(h('div', {}, h('h2', {}, 'Keyboard & mouse'), h('table', {}, keys.map(([k, v]) => h('tr', {}, h('td', {}, h('b', {}, k)), h('td', {}, v))))));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try { new App(); } catch (e) {
    console.error(e);
    const gl = /WebGL/i.test(e.message);
    document.body.innerHTML = `<div style="padding:40px;max-width:760px;color:#e6e8ec;font:14px system-ui"><h2>CarForge could not start</h2>
      <p>${gl ? 'Your graphics driver did not provide WebGL 2. Please update your GPU driver (or enable hardware acceleration) and restart.' : 'An unexpected error occurred.'}</p>
      <pre style="color:#f88;white-space:pre-wrap">${e.stack}</pre></div>`;
    window.carforge?.setToolList([]);
  }
});
void THREE;
