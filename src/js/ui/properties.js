// Right panel: auto-generated property editor for the selection (or scene settings).
import * as THREE from 'three';
import { h, fmt } from './dom.js';
import { CAR_SCHEMA, CAR_GROUPS, CAR_PRESETS } from '../car/params.js';
import { PRIMITIVES } from '../geometry/primitives.js';
import { PART_TYPES } from '../car/standalone.js';
import { MATERIAL_SCHEMA } from '../materials.js';
import { LIGHT_SCHEMA } from '../editor.js';
import { ENVIRONMENTS } from '../environment.js';
import { PAINT_COLORS } from './library.js';

const rad2deg = THREE.MathUtils.radToDeg;

/** Builds one field control. onInput(value) fires while dragging, onChange(value) when released. */
export function field(def, value, onInput, onChange) {
  const label = h('label', { title: def.description || def.label }, def.label);
  const ctl = h('div', { class: 'ctl' });
  let set = () => {};
  if (def.type === 'number') {
    const range = h('input', { type: 'range', min: def.min, max: def.max, step: def.step || 0.01 });
    const num = h('input', { class: 'num', type: 'number', min: def.min, max: def.max, step: def.step || 0.01 });
    set = (v) => { range.value = v; if (document.activeElement !== num) num.value = fmt(+v, 4); };
    range.addEventListener('input', () => { num.value = range.value; onInput(+range.value); });
    range.addEventListener('change', () => onChange(+range.value));
    num.addEventListener('change', () => { const v = Math.min(def.max, Math.max(def.min, +num.value)); range.value = v; onInput(v); onChange(v); });
    num.addEventListener('keydown', (e) => e.stopPropagation());
    ctl.append(range, num, def.unit ? h('span', { class: 'unit' }, def.unit) : null);
  } else if (def.type === 'color') {
    const inp = h('input', { type: 'color' });
    const txt = h('input', { class: 'txt', style: { width: '78px', flex: 'none' } });
    set = (v) => { inp.value = v; txt.value = v; };
    inp.addEventListener('input', () => { txt.value = inp.value; onInput(inp.value); });
    inp.addEventListener('change', () => onChange(inp.value));
    txt.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(txt.value)) { inp.value = txt.value; onInput(txt.value); onChange(txt.value); } });
    txt.addEventListener('keydown', (e) => e.stopPropagation());
    ctl.append(inp, txt);
  } else if (def.type === 'select') {
    const sel = h('select', {}, def.options.map((o) => h('option', { value: o }, String(o).replace(/_/g, ' '))));
    set = (v) => { sel.value = v; };
    sel.addEventListener('change', () => { onInput(sel.value); onChange(sel.value); });
    ctl.append(sel);
  } else if (def.type === 'bool') {
    const inp = h('input', { type: 'checkbox' });
    set = (v) => { inp.checked = !!v; };
    inp.addEventListener('change', () => { onInput(inp.checked); onChange(inp.checked); });
    ctl.append(h('label', { class: 'switch' }, inp, h('span')));
  } else {
    const inp = h('input', { class: 'txt' });
    set = (v) => { if (document.activeElement !== inp) inp.value = v ?? ''; };
    inp.addEventListener('change', () => { onInput(inp.value); onChange(inp.value); });
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    ctl.append(inp);
  }
  set(value);
  const el = h('div', { class: 'field' }, label, ctl);
  return { el, set };
}

function vec3(label, values, onChange, step = 0.01) {
  const inputs = values.map((v) => h('input', { type: 'number', step, value: fmt(v, 4) }));
  inputs.forEach((inp) => {
    inp.addEventListener('change', () => onChange(inputs.map((i) => +i.value)));
    inp.addEventListener('keydown', (e) => e.stopPropagation());
  });
  const el = h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'vec3' }, inputs));
  return { el, set: (vals) => vals.forEach((v, i) => { if (document.activeElement !== inputs[i]) inputs[i].value = fmt(v, 4); }) };
}

function group(title, open, ...children) {
  const d = h('details', { class: 'group' }, h('summary', {}, title), h('div', { class: 'fields' }, children));
  if (open) d.open = true;
  return d;
}

export class Properties {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('properties');
    this.setters = new Map();
    this.openGroups = new Set(['transform', 'paint', 'shape', 'part', 'light', 'material', 'dims', 'scene']);
    const ed = app.editor;
    ed.on('select', () => this.render());
    ed.on('change', () => { if (this.currentId && !ed.objects.has(this.currentId)) this.render(); });
    ed.on('update', (d) => { if (d.id === this.currentId) this.refresh(); });
    ed.on('history', () => this.refresh());
    this.render();
  }

  // throttle heavy rebuilds while a slider is dragged
  _live(fn) {
    this._pendingFn = fn;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; const f = this._pendingFn; this._pendingFn = null; try { f?.(); } catch (e) { this.app.toast(e.message, 'err'); } });
  }

  refresh() {
    const ed = this.app.editor;
    const o = this.currentId ? ed.objects.get(this.currentId) : null;
    if (!o) return;
    const cf = o.userData.cf;
    this.setters.get('pos')?.(o.position.toArray());
    this.setters.get('rot')?.([o.rotation.x, o.rotation.y, o.rotation.z].map(rad2deg));
    this.setters.get('scl')?.(o.scale.toArray());
    for (const [k, v] of Object.entries(cf.params || {})) this.setters.get(`p:${k}`)?.(v);
    for (const [k, v] of Object.entries(cf.material || {})) this.setters.get(`m:${k}`)?.(v);
    const nameInput = this.el.querySelector('input.title');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = o.name;
  }

  render() {
    const ed = this.app.editor;
    this.el.innerHTML = '';
    this.setters.clear();
    const o = ed.selected;
    this.currentId = o ? ed.idOf(o) : null;
    if (!o) return this.renderScene();
    const cf = o.userData.cf;
    const id = cf.id;

    // ---- header
    const title = h('input', { class: 'title', value: o.name });
    title.addEventListener('change', () => ed.rename(id, title.value));
    title.addEventListener('keydown', (e) => e.stopPropagation());
    const actions = h('div', { class: 'actions' },
      h('button', { onclick: () => this.app.viewport.frame(o) }, '⌖ Focus'),
      h('button', { onclick: () => ed.duplicate(id, { offset: [0, 0, cf.kind === 'car' ? 2.4 : 0.5] }) }, '⧉ Duplicate'),
      h('button', { onclick: () => ed.dropToGround(id) }, '⤓ Ground'),
      cf.kind !== 'mesh' && cf.kind !== 'group' && cf.kind !== 'light' ? h('button', { onclick: () => { ed.convertToMesh(id); }, title: 'Bake into plain editable meshes' }, '△ To mesh') : null,
      h('button', { onclick: () => ed.remove(id) }, '🗑 Delete'));
    this.el.append(h('div', { class: 'prop-head' }, title, h('div', { class: 'badges' }, h('span', { class: 'badge' }, cf.kind), h('span', { class: 'badge' }, id),
      ed.selection.length > 1 ? h('span', { class: 'badge' }, `${ed.selection.length} selected`) : null), actions));

    // ---- transform
    const t = (key, vals, apply, step) => { const f = vec3(key === 'pos' ? 'Position (m)' : key === 'rot' ? 'Rotation (°)' : 'Scale', vals, apply, step); this.setters.set(key, f.set); return f.el; };
    const tr = group('Transform', this.openGroups.has('transform'),
      t('pos', o.position.toArray(), (v) => ed.setTransform(id, { position: v })),
      t('rot', [o.rotation.x, o.rotation.y, o.rotation.z].map(rad2deg), (v) => ed.setTransform(id, { rotation: v }), 1),
      t('scl', o.scale.toArray(), (v) => ed.setTransform(id, { scale: v })));
    this._trackOpen(tr, 'transform');
    this.el.append(tr);

    // ---- kind specific
    if (cf.kind === 'car') this.renderCar(o);
    else if (cf.kind === 'primitive') { this.renderParams(o, PRIMITIVES[cf.shape].schema, 'Shape', 'shape'); this.renderMaterial(o); }
    else if (cf.kind === 'part') this.renderParams(o, PART_TYPES[cf.partType].schema, PART_TYPES[cf.partType].label, 'part');
    else if (cf.kind === 'light') this.renderParams(o, LIGHT_SCHEMA, 'Light', 'light');
    else if (cf.kind === 'mesh' || cf.kind === 'model') this.renderMaterial(o);
    if (cf.kind === 'mesh' || cf.kind === 'primitive') this.renderModifiers(o);
  }

  _trackOpen(d, key) { d.addEventListener('toggle', () => { d.open ? this.openGroups.add(key) : this.openGroups.delete(key); }); }

  renderParams(o, schema, title, key) {
    const ed = this.app.editor, id = ed.idOf(o), cf = o.userData.cf;
    const fields = schema.map((def) => {
      const f = field(def, cf.params[def.key], (v) => this._live(() => ed.setParams(id, { [def.key]: v }, { commit: false })), (v) => { ed.setParams(id, { [def.key]: v }, { commit: false }); ed.commit(`Edit ${def.label}`); });
      this.setters.set(`p:${def.key}`, f.set);
      return f.el;
    });
    const g = group(title, this.openGroups.has(key), fields);
    this._trackOpen(g, key);
    this.el.append(g);
  }

  renderCar(o) {
    const ed = this.app.editor, id = ed.idOf(o), cf = o.userData.cf;
    // preset switcher + quick paint swatches
    const presetSel = h('select', {}, h('option', { value: '' }, 'Apply body style…'), Object.entries(CAR_PRESETS).map(([k, v]) => h('option', { value: k }, v.label)));
    presetSel.addEventListener('change', () => {
      if (!presetSel.value) return;
      const keep = { paintColor: cf.params.paintColor, paintFinish: cf.params.paintFinish };
      ed.setParams(id, { ...CAR_PRESETS[presetSel.value].params, ...keep, ...Object.fromEntries(CAR_SCHEMA.filter((s) => !(s.key in CAR_PRESETS[presetSel.value].params) && !(s.key in keep)).map((s) => [s.key, s.default])) });
      presetSel.value = '';
    });
    const swatches = h('div', { class: 'swatches' }, PAINT_COLORS.slice(0, 16).map(([name, color, finish]) => h('button', { title: name, style: { background: color }, onclick: () => ed.setParams(id, { paintColor: color, paintFinish: finish }) })));
    const quick = h('div', { class: 'fields' }, presetSel, swatches);
    this.el.append(quick);
    const byGroup = new Map(CAR_GROUPS.map((g) => [g.id, []]));
    for (const def of CAR_SCHEMA) {
      const f = field(def, cf.params[def.key], (v) => this._live(() => ed.setParams(id, { [def.key]: v }, { commit: false })), (v) => { ed.setParams(id, { [def.key]: v }, { commit: false }); ed.commit(`Edit ${def.label}`); });
      this.setters.set(`p:${def.key}`, f.set);
      byGroup.get(def.group)?.push(f.el);
    }
    for (const g of CAR_GROUPS) {
      const d = group(`${g.icon}  ${g.label}`, this.openGroups.has(g.id), byGroup.get(g.id));
      this._trackOpen(d, g.id);
      this.el.append(d);
    }
    const m = ed.cars.get(id);
    const info = m.describe();
    this.el.append(group('ℹ  Measurements', false, h('div', { style: { color: 'var(--muted)', fontSize: '12px', lineHeight: '1.6' } },
      `L ${info.lengthM} m · W ${info.widthM} m · H ${info.heightM} m`, h('br'), `Wheelbase ${info.wheelbaseM} m · Overhangs F ${info.frontOverhangM} / R ${info.rearOverhangM} m`, h('br'),
      `Tyre Ø ${info.tyreOuterDiameterM} m · ${info.triangles.toLocaleString()} triangles · texture ${info.bakeResolution}`)));
  }

  renderMaterial(o) {
    const ed = this.app.editor, id = ed.idOf(o), cf = o.userData.cf;
    const spec = { preset: 'custom', ...(cf.material || {}) };
    const fields = MATERIAL_SCHEMA.map((def) => {
      const f = field(def, spec[def.key] ?? def.default, (v) => this._live(() => ed.setMaterial(id, def.key === 'preset' ? (v === 'custom' ? {} : { preset: v }) : { [def.key]: v }, { commit: false })),
        (v) => { ed.commit(`Material ${def.label}`); if (def.key === 'preset') this.render(); });
      this.setters.set(`m:${def.key}`, f.set);
      return f.el;
    });
    const g = group('🎨  Material', this.openGroups.has('material'), fields);
    this._trackOpen(g, 'material');
    this.el.append(g);
  }

  renderModifiers(o) {
    const ed = this.app.editor, id = ed.idOf(o);
    const amt = h('input', { type: 'number', value: 0.5, step: 0.05, style: { width: '64px' } });
    const axis = h('select', {}, ['y', 'x', 'z'].map((a) => h('option', { value: a }, a.toUpperCase())));
    const run = (type) => { try { ed.deform(id, type, { amount: +amt.value, axis: axis.value }); this.render(); } catch (e) { this.app.toast(e.message, 'err'); } };
    const g = group('🛠  Modifiers', false,
      h('div', { class: 'field' }, h('label', {}, 'Amount / axis'), h('div', { class: 'ctl' }, amt, axis)),
      h('div', { class: 'actions' }, ['bend', 'twist', 'taper', 'inflate', 'noise', 'smooth', 'subdivide'].map((t) => h('button', { onclick: () => run(t) }, t))),
      h('div', { class: 'actions' },
        h('button', { onclick: () => ed.mirror(id, 'z') }, 'Mirror Z'), h('button', { onclick: () => ed.mirror(id, 'x') }, 'Mirror X'),
        h('button', { onclick: () => ed.array(id, 4, { offset: [0.6, 0, 0] }) }, 'Array ×4')));
    this.el.append(g);
  }

  renderScene() {
    const app = this.app;
    const env = app.viewport.env;
    const s = env.settings;
    this.el.append(h('div', { class: 'prop-head' }, h('div', { style: { fontWeight: 600, fontSize: '14px' } }, 'Scene & rendering'), h('div', { style: { color: 'var(--muted)', fontSize: '12px' } }, 'Select an object to edit it. These settings affect lighting and screenshots.')));
    const defs = [
      { key: 'preset', label: 'Environment', type: 'select', options: Object.keys(ENVIRONMENTS) },
      { key: 'background', label: 'Background', type: 'select', options: ['gradient', 'environment', 'color', 'transparent'] },
      { key: 'backgroundColor', label: 'Bg colour', type: 'color' },
      { key: 'floor', label: 'Floor', type: 'select', options: ['studio', 'shadow', 'none'] },
      { key: 'exposure', label: 'Exposure', type: 'number', min: 0.1, max: 3, step: 0.01 },
      { key: 'rotation', label: 'Env rotation', type: 'number', min: 0, max: 360, step: 1, unit: '°' },
      { key: 'shadows', label: 'Shadows', type: 'bool' },
    ];
    const fields = defs.map((def) => field(def, s[def.key], (v) => { env.apply({ [def.key]: v }); app.syncEnvSelect(); }, () => {}).el);
    const quality = field({ key: 'q', label: 'Body texture', type: 'select', options: ['draft', 'normal', 'high', 'ultra'], description: 'Resolution of the baked body detail texture (affects new edits).' }, app.editor.bakeQuality,
      (v) => { app.editor.bakeQuality = v; for (const m of app.editor.cars.values()) { m.quality = v; m.rebuild('bake'); } }, () => {});
    const g = group('💡  Lighting & environment', true, fields, quality.el);
    this.el.append(g);
    const st = app.editor.stats();
    this.el.append(group('📊  Statistics', true, h('div', { style: { color: 'var(--muted)', fontSize: '12px', lineHeight: '1.6' } }, `${st.objects} objects · ${st.meshes} meshes · ${st.triangles.toLocaleString()} triangles`)));
  }
}
