// Editor core: object registry, parametric objects, selection, undo/redo, serialization.
import * as THREE from 'three';
import { CarModel } from './car/car.js';
import { CAR_PRESETS, carParams, CAR_SCHEMA } from './car/params.js';
import { buildPrimitive, primitiveDefaults, PRIMITIVES, loadFont } from './geometry/primitives.js';
import { buildPart, partDefaults, PART_TYPES } from './car/standalone.js';
import { createMaterial, applyMaterialSpec, resolveSpec, specFromMaterial } from './materials.js';
import * as ops from './geometry/ops.js';

const deg = THREE.MathUtils.degToRad, rad2deg = THREE.MathUtils.radToDeg;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

export const LIGHT_SCHEMA = [
  { key: 'type', label: 'Type', type: 'select', options: ['point', 'spot', 'directional', 'area'], default: 'point', group: 'light' },
  { key: 'color', label: 'Colour', type: 'color', default: '#ffffff', group: 'light' },
  { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 500, step: 0.1, default: 20, group: 'light' },
  { key: 'distance', label: 'Range', type: 'number', min: 0, max: 200, step: 0.1, default: 0, unit: 'm', group: 'light' },
  { key: 'angle', label: 'Spot angle', type: 'number', min: 1, max: 89, step: 1, default: 35, unit: '°', group: 'light' },
  { key: 'width', label: 'Area width', type: 'number', min: 0.05, max: 20, step: 0.05, default: 2, unit: 'm', group: 'light' },
  { key: 'height', label: 'Area height', type: 'number', min: 0.05, max: 20, step: 0.05, default: 1, unit: 'm', group: 'light' },
  { key: 'castShadow', label: 'Cast shadows', type: 'bool', default: false, group: 'light' },
];
const lightDefaults = () => Object.fromEntries(LIGHT_SCHEMA.map((s) => [s.key, s.default]));

export class Editor extends EventTarget {
  constructor() {
    super();
    this.scene = new THREE.Scene();
    this.world = new THREE.Group();
    this.world.name = 'World';
    this.scene.add(this.world);
    this.objects = new Map();
    this.cars = new Map();
    this.graveyard = new Map();
    this.selection = [];
    this.counter = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.current = null;
    this.maxHistory = 80;
    this.dirty = false;
    this.bakeQuality = 'high';
    this.commit('New scene', true);
  }

  // ---------------------------------------------------------------- events
  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }

  // ---------------------------------------------------------------- registry
  _newId(prefix) {
    let id;
    do { id = `${prefix}${++this.counter}`; } while (this.objects.has(id) || this.graveyard.has(id));
    return id;
  }
  _uniqueName(base) {
    const names = new Set([...this.objects.values()].map((o) => o.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }
  get(idOrName) {
    if (idOrName && typeof idOrName === 'object' && idOrName.isObject3D) return idOrName;
    if (this.objects.has(idOrName)) return this.objects.get(idOrName);
    for (const o of this.objects.values()) if (o.name === idOrName) return o;
    return null;
  }
  require(idOrName) {
    const o = this.get(idOrName);
    if (!o) throw new Error(`Object "${idOrName}" not found. Use get_scene to list object ids.`);
    return o;
  }
  idOf(o) { return o?.userData?.cf?.id || null; }
  /** Finds the registry object owning a (possibly nested) three object. */
  ownerOf(obj) {
    let o = obj;
    while (o && o !== this.world) {
      if (o.userData?.cf?.id && this.objects.has(o.userData.cf.id)) return o;
      o = o.parent;
    }
    return null;
  }

  _register(obj, kind, data, opts = {}) {
    const id = opts.id && !this.objects.has(opts.id) ? opts.id : this._newId(opts.idPrefix || kind);
    obj.userData.cf = { id, kind, ...data };
    obj.name = opts.name ? this._uniqueName(opts.name) : this._uniqueName(obj.name || kind);
    const parent = opts.parent ? this.require(opts.parent) : this.world;
    parent.add(obj);
    this.objects.set(id, obj);
    this._applyTransformOpts(obj, opts);
    obj.traverse((c) => { if (c.isMesh && !c.userData.helper) { c.castShadow = true; c.receiveShadow = true; } });
    if (opts.select !== false) this.select([id], false);
    this.emit('change', { added: id });
    if (opts.commit !== false) this.commit(`Add ${obj.name}`);
    return obj;
  }

  _applyTransformOpts(obj, t = {}) {
    if (t.position) obj.position.set(...t.position);
    if (t.rotation) obj.rotation.set(deg(t.rotation[0] || 0), deg(t.rotation[1] || 0), deg(t.rotation[2] || 0));
    if (t.scale !== undefined) {
      if (typeof t.scale === 'number') obj.scale.setScalar(t.scale);
      else obj.scale.set(...t.scale);
    }
    obj.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- creation
  addCar(preset = 'sedan', opts = {}) {
    const params = typeof preset === 'object' ? carParams(preset.preset || 'sedan', preset) : carParams(preset, opts.params || {});
    const model = new CarModel(params, { quality: this.bakeQuality, onUpdate: () => this.emit('render') });
    const g = model.group;
    g.name = opts.name || (CAR_PRESETS[typeof preset === 'string' ? preset : 'sedan']?.label ?? 'Car');
    const obj = this._register(g, 'car', { params: { ...model.params } }, { ...opts, idPrefix: 'car', commit: false, select: false });
    this.cars.set(obj.userData.cf.id, model);
    if (opts.select !== false) this.select([obj.userData.cf.id]);
    if (opts.commit !== false) this.commit(`Add ${obj.name}`);
    return obj;
  }

  addPrimitive(shape = 'box', params = {}, opts = {}) {
    const p = { ...primitiveDefaults(shape), ...params };
    const mesh = new THREE.Mesh(buildPrimitive(shape, p), createMaterial(opts.material || { preset: 'clay' }));
    mesh.name = opts.name || PRIMITIVES[shape].label;
    const obj = this._register(mesh, 'primitive', { shape, params: p, material: resolveSpec(opts.material || { preset: 'clay' }) }, { ...opts, idPrefix: shape });
    if (shape === 'text') loadFont().then(() => { if (this.objects.has(obj.userData.cf.id)) this._rebuild(obj); this.emit('render'); });
    return obj;
  }

  addPart(type, params = {}, opts = {}) {
    const p = { ...partDefaults(type), ...params };
    const g = buildPart(type, p);
    g.name = opts.name || PART_TYPES[type].label;
    return this._register(g, 'part', { partType: type, params: p }, { ...opts, idPrefix: type });
  }

  addMesh(geometry, material = { preset: 'clay' }, opts = {}) {
    const spec = resolveSpec(material);
    const mesh = new THREE.Mesh(geometry, createMaterial(spec));
    mesh.name = opts.name || 'Mesh';
    return this._register(mesh, 'mesh', { material: spec }, { ...opts, idPrefix: 'mesh' });
  }

  addGroup(childIds = [], opts = {}) {
    const g = new THREE.Group();
    g.name = opts.name || 'Group';
    const obj = this._register(g, 'group', {}, { ...opts, commit: false, select: false });
    if (childIds.length) {
      const box = new THREE.Box3();
      for (const id of childIds) box.expandByObject(this.require(id));
      if (!opts.position && !box.isEmpty()) { const c = box.getCenter(new THREE.Vector3()); obj.position.set(c.x, 0, c.z); obj.updateMatrixWorld(true); }
      for (const id of childIds) this._reparent(this.require(id), obj);
    }
    this.select([obj.userData.cf.id], false);
    this.emit('change', {});
    if (opts.commit !== false) this.commit(`Group ${obj.name}`);
    return obj;
  }

  addLight(type = 'point', params = {}, opts = {}) {
    const p = { ...lightDefaults(), type, ...params };
    const holder = new THREE.Group();
    holder.name = opts.name || `${type[0].toUpperCase() + type.slice(1)} light`;
    this._buildLight(holder, p);
    return this._register(holder, 'light', { params: p }, { ...opts, idPrefix: 'light', position: opts.position || [2, 3, 2] });
  }

  _buildLight(holder, p) {
    holder.clear();
    let l;
    if (p.type === 'spot') { l = new THREE.SpotLight(p.color, p.intensity, p.distance, deg(p.angle), 0.4, 2); l.target.position.set(0, -1, 0); holder.add(l.target); }
    else if (p.type === 'directional') { l = new THREE.DirectionalLight(p.color, p.intensity / 10); l.target.position.set(0, -1, 0); holder.add(l.target); }
    else if (p.type === 'area') { l = new THREE.RectAreaLight(p.color, p.intensity / 4, p.width, p.height); l.lookAt(0, -1, 0); }
    else l = new THREE.PointLight(p.color, p.intensity, p.distance, 2);
    l.castShadow = !!p.castShadow && p.type !== 'area';
    if (l.shadow) { l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0005; }
    holder.add(l);
    // pickable marker
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: p.color, wireframe: true }));
    marker.userData.helper = true; marker.userData.picker = true;
    holder.add(marker);
  }

  // ---------------------------------------------------------------- modification
  setTransform(id, t = {}, { commit = true, relative = false } = {}) {
    const o = this.require(id);
    if (relative) {
      if (t.position) o.position.add(new THREE.Vector3(...t.position));
      if (t.rotation) { o.rotation.x += deg(t.rotation[0] || 0); o.rotation.y += deg(t.rotation[1] || 0); o.rotation.z += deg(t.rotation[2] || 0); }
      if (t.scale !== undefined) { if (typeof t.scale === 'number') o.scale.multiplyScalar(t.scale); else o.scale.multiply(new THREE.Vector3(...t.scale)); }
      o.updateMatrixWorld(true);
    } else this._applyTransformOpts(o, t);
    this.emit('update', { id: this.idOf(o) });
    if (commit) this.commit(`Transform ${o.name}`);
    return o;
  }

  setParams(id, patch, { commit = true } = {}) {
    const o = this.require(id);
    const cf = o.userData.cf;
    if (!cf.params) throw new Error(`${o.name} (${cf.kind}) has no parameters`);
    if (cf.kind === 'car') {
      const model = this.cars.get(cf.id);
      const unknown = Object.keys(patch).filter((k) => !CAR_SCHEMA.some((s) => s.key === k));
      if (unknown.length) throw new Error(`Unknown car parameter(s): ${unknown.join(', ')}. Use describe_car_parameters.`);
      model.setParams(patch);
      cf.params = { ...model.params };
    } else {
      cf.params = { ...cf.params, ...patch };
      this._rebuild(o);
    }
    this.emit('update', { id: cf.id, params: true });
    if (commit) this.commit(`Edit ${o.name}`);
    return o;
  }

  _rebuild(o) {
    const cf = o.userData.cf;
    if (cf.kind === 'primitive') {
      o.geometry.dispose();
      o.geometry = buildPrimitive(cf.shape, cf.params);
    } else if (cf.kind === 'part') {
      const g = buildPart(cf.partType, cf.params);
      o.clear();
      for (const c of [...g.children]) o.add(c);
      o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    } else if (cf.kind === 'light') {
      this._buildLight(o, cf.params);
    } else if (cf.kind === 'car') {
      this.cars.get(cf.id).setParams(cf.params);
    }
  }

  setMaterial(id, spec, { commit = true, part = null } = {}) {
    const o = this.require(id);
    const cf = o.userData.cf;
    if (cf.kind === 'car') {
      // map onto car paint params
      const s = resolveSpec(spec);
      const patch = {};
      const target = part || 'body';
      if (/wheel|rim/.test(target)) {
        const fin = { chrome: 'chrome', gold: 'gold', gunmetal: 'gunmetal', black_plastic: 'black', gloss_black: 'black', copper: 'bronze', ceramic_white: 'white' }[spec.preset || spec] || null;
        patch.rimFinish = fin || 'silver';
      } else if (/caliper/.test(target)) patch.caliperColor = s.color;
      else if (/wing|splitter|skirt|diffuser/.test(target)) patch.aeroFinish = (spec.preset || spec) === 'carbon_fibre' ? 'carbon' : 'black';
      else {
        patch.paintColor = s.color;
        const pr = spec.preset || (typeof spec === 'string' ? spec : '');
        const map = { car_paint_metallic: 'metallic', car_paint_gloss: 'gloss', car_paint_pearl: 'pearl', car_paint_matte: 'matte', candy: 'candy', chrome: 'chrome', gold: 'chrome', copper: 'chrome' };
        if (map[pr]) patch.paintFinish = map[pr];
      }
      return this.setParams(id, patch, { commit });
    }
    const resolved = resolveSpec({ ...(cf.material || {}), ...(typeof spec === 'string' ? { preset: spec } : spec) });
    if (typeof spec === 'string' || spec.preset) Object.assign(resolved, resolveSpec(spec));
    cf.material = resolved;
    o.traverse((c) => {
      if (!c.isMesh || c.userData.helper) return;
      if (c.material?.userData?.spec && c.material.userData.owner === cf.id) applyMaterialSpec(c.material, resolved);
      else { c.material = createMaterial(resolved); c.material.userData.owner = cf.id; }
    });
    this.emit('update', { id: cf.id, material: true });
    if (commit) this.commit(`Material ${o.name}`);
    return o;
  }

  rename(id, name, { commit = true } = {}) {
    const o = this.require(id);
    o.name = this._uniqueName(String(name));
    this.emit('change', {});
    if (commit) this.commit('Rename');
    return o;
  }

  setVisible(id, visible, { commit = true } = {}) {
    const o = this.require(id);
    o.visible = !!visible;
    this.emit('change', {});
    if (commit) this.commit(visible ? 'Show' : 'Hide');
  }

  _reparent(o, parent) {
    o.updateMatrixWorld(true);
    parent.updateMatrixWorld(true);
    parent.attach(o);
  }

  setParent(id, parentId, { commit = true } = {}) {
    const o = this.require(id);
    const p = parentId ? this.require(parentId) : this.world;
    let q = p;
    while (q) { if (q === o) throw new Error('Cannot parent an object to its own child'); q = q.parent; }
    this._reparent(o, p);
    this.emit('change', {});
    if (commit) this.commit('Parent');
  }

  remove(ids, { commit = true } = {}) {
    const list = (Array.isArray(ids) ? ids : [ids]).map((i) => this.require(i));
    for (const o of list) {
      o.traverse((c) => {
        const id = c.userData?.cf?.id;
        if (id && this.objects.has(id)) { this.objects.delete(id); this.graveyard.set(id, c); }
      });
      o.parent?.remove(o);
    }
    this.selection = this.selection.filter((id) => this.objects.has(id));
    this.emit('change', {}); this.emit('select', { ids: this.selection });
    if (commit) this.commit(`Delete ${list.map((o) => o.name).join(', ')}`);
  }

  duplicate(id, { offset = [0, 0, 0], commit = true, name } = {}) {
    const src = this.require(id);
    const data = this._serializeObject(src, true);
    const parentId = src.parent && src.parent !== this.world ? this.idOf(src.parent) : null;
    const copy = this._deserializeObject(data, parentId, true);
    copy.position.add(new THREE.Vector3(...offset));
    copy.name = this._uniqueName(name || src.name);
    copy.updateMatrixWorld(true);
    this.select([this.idOf(copy)], false);
    this.emit('change', {});
    if (commit) this.commit(`Duplicate ${src.name}`);
    return copy;
  }

  // ---------------------------------------------------------------- operations
  booleanOp(aId, bId, op = 'subtract', { keepOriginals = false, name } = {}) {
    const a = this.require(aId), b = this.require(bId);
    const geo = ops.booleanGeometry(a, b, op);
    const matSpec = a.userData.cf.material || specFromMaterial(this._firstMaterial(a));
    const obj = this.addMesh(geo, matSpec, { name: name || `${a.name} ${op} ${b.name}`, commit: false });
    if (!keepOriginals) this.remove([aId, bId], { commit: false });
    this.select([this.idOf(obj)], false);
    this.commit(`Boolean ${op}`);
    return obj;
  }

  _firstMaterial(o) { let m = null; o.traverse((c) => { if (!m && c.isMesh) m = Array.isArray(c.material) ? c.material[0] : c.material; }); return m; }

  /** Converts a primitive / part / car into editable mesh object(s). */
  convertToMesh(id, { commit = true } = {}) {
    const o = this.require(id);
    const cf = o.userData.cf;
    if (cf.kind === 'mesh') return o;
    if (cf.kind === 'primitive') {
      cf.kind = 'mesh'; delete cf.shape; delete cf.params;
      o.geometry = o.geometry.clone();
      this.emit('change', {});
      if (commit) this.commit('Convert to mesh');
      return o;
    }
    if (cf.kind === 'car' || cf.kind === 'part' || cf.kind === 'model') {
      // bake every visible mesh into separate mesh objects inside a group
      const group = this.addGroup([], { name: `${o.name} (mesh)`, commit: false, position: [0, 0, 0] });
      group.position.copy(o.position); group.quaternion.copy(o.quaternion); group.scale.copy(o.scale);
      group.updateMatrixWorld(true);
      o.updateMatrixWorld(true);
      o.traverse((c) => {
        if (!c.isMesh || c.userData.helper) return;
        const g = ops.worldGeometry(c, group);
        const mat = Array.isArray(c.material) ? c.material[0] : c.material;
        const m = new THREE.Mesh(g, mat.clone());
        m.name = c.name || 'part';
        this._register(m, 'mesh', { material: specFromMaterial(mat), baked: true }, { parent: this.idOf(group), commit: false, select: false });
      });
      this.remove(id, { commit: false });
      this.select([this.idOf(group)], false);
      if (commit) this.commit('Convert to mesh');
      return group;
    }
    throw new Error(`Cannot convert ${cf.kind}`);
  }

  deform(id, type, opts = {}, { commit = true } = {}) {
    const o = this.require(id);
    if (!o.isMesh) throw new Error('Deformers work on single meshes (primitive or mesh). Use convert_to_mesh first for cars/groups.');
    if (o.userData.cf.kind === 'primitive') this.convertToMesh(id, { commit: false });
    let g;
    if (type === 'smooth') g = ops.smoothGeometry(o.geometry, opts.iterations ?? 2, opts.amount ?? 0.5);
    else if (type === 'subdivide') g = ops.subdivideGeometry(o.geometry, opts.maxEdge ?? 0.05);
    else g = ops.deformGeometry(o.geometry, type, opts);
    o.geometry = g;
    this.emit('update', { id: this.idOf(o) });
    if (commit) this.commit(`Deform ${type}`);
    return o;
  }

  mirror(id, axis = 'z', { merge = false, commit = true } = {}) {
    const o = this.require(id);
    const copy = this.duplicate(id, { commit: false, name: `${o.name} mirror` });
    const ai = { x: 0, y: 1, z: 2 }[axis];
    copy.position.setComponent(ai, -copy.position.getComponent(ai));
    const s = copy.scale.clone(); s.setComponent(ai, -s.getComponent(ai)); copy.scale.copy(s);
    // mirror rotation: negate the two other rotation components
    const r = copy.rotation;
    if (ai === 0) { r.y = -r.y; r.z = -r.z; } else if (ai === 1) { r.x = -r.x; r.z = -r.z; } else { r.x = -r.x; r.y = -r.y; }
    copy.updateMatrixWorld(true);
    if (merge) {
      const g = this.addGroup([this.idOf(o), this.idOf(copy)], { name: `${o.name} (mirrored)`, commit: false });
      if (commit) this.commit('Mirror');
      return g;
    }
    if (commit) this.commit('Mirror');
    return copy;
  }

  array(id, count = 3, { offset = [1, 0, 0], rotation = [0, 0, 0], scale = 1, group = true, commit = true } = {}) {
    const src = this.require(id);
    const ids = [this.idOf(src)];
    for (let i = 1; i < count; i++) {
      const c = this.duplicate(id, { commit: false });
      c.position.copy(src.position).add(new THREE.Vector3(...offset).multiplyScalar(i));
      c.rotation.set(src.rotation.x + deg(rotation[0]) * i, src.rotation.y + deg(rotation[1]) * i, src.rotation.z + deg(rotation[2]) * i);
      c.scale.copy(src.scale).multiplyScalar(Math.pow(scale, i));
      c.updateMatrixWorld(true);
      ids.push(this.idOf(c));
    }
    const out = group ? this.addGroup(ids, { name: `${src.name} array`, commit: false }) : null;
    if (commit) this.commit('Array');
    return out || this.require(ids[ids.length - 1]);
  }

  mergeObjects(ids, { name = 'Merged', commit = true } = {}) {
    const list = ids.map((i) => this.require(i));
    const geos = list.map((o) => ops.worldGeometry(o));
    const g = geos.length === 1 ? geos[0] : mergeAll(geos);
    const spec = list[0].userData.cf.material || specFromMaterial(this._firstMaterial(list[0]));
    this.remove(ids, { commit: false });
    const obj = this.addMesh(g, spec, { name, commit: false });
    if (commit) this.commit('Merge');
    return obj;
  }

  dropToGround(id, { commit = true } = {}) {
    const o = this.require(id);
    const box = new THREE.Box3().setFromObject(o);
    if (!box.isEmpty()) { o.position.y -= box.min.y; o.updateMatrixWorld(true); }
    this.emit('update', { id }); if (commit) this.commit('Drop to ground');
  }

  // ---------------------------------------------------------------- selection
  select(ids, emit = true) {
    this.selection = (ids || []).map((i) => this.idOf(this.require(i))).filter(Boolean);
    this.emit('select', { ids: this.selection });
    void emit;
  }
  get selected() { return this.selection.length ? this.objects.get(this.selection[0]) : null; }

  // ---------------------------------------------------------------- info
  bbox(o) {
    const box = new THREE.Box3();
    o.updateMatrixWorld(true);
    o.traverse((c) => { if (c.isMesh && !c.userData.helper && c.visible) box.expandByObject(c, true); });
    return box;
  }

  info(id, { detailed = false } = {}) {
    const o = this.require(id);
    const cf = o.userData.cf;
    const box = this.bbox(o);
    const size = box.isEmpty() ? [0, 0, 0] : box.getSize(new THREE.Vector3()).toArray().map((v) => round(v, 3));
    const out = {
      id: cf.id, name: o.name, kind: cf.kind, visible: o.visible,
      parent: o.parent && o.parent !== this.world ? this.idOf(o.parent) : null,
      position: o.position.toArray().map((v) => round(v)), rotationDeg: [o.rotation.x, o.rotation.y, o.rotation.z].map((v) => round(rad2deg(v), 2)),
      scale: o.scale.toArray().map((v) => round(v)), sizeM: size,
      boundsMin: box.isEmpty() ? null : box.min.toArray().map((v) => round(v, 3)), boundsMax: box.isEmpty() ? null : box.max.toArray().map((v) => round(v, 3)),
    };
    if (cf.shape) out.shape = cf.shape;
    if (cf.partType) out.partType = cf.partType;
    if (detailed) {
      if (cf.params) out.params = cf.params;
      if (cf.material) out.material = cf.material;
      if (cf.kind === 'car') {
        const m = this.cars.get(cf.id);
        out.car = m.describe();
        out.parts = []; m.group.traverse((c) => { if (c.isMesh && !c.userData.helper) out.parts.push(c.name); });
      }
      let tris = 0; o.traverse((c) => { if (c.isMesh && c.geometry) tris += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3; });
      out.triangles = Math.round(tris);
    }
    return out;
  }

  tree() {
    const walk = (parent) => parent.children.filter((c) => c.userData?.cf?.id && this.objects.has(c.userData.cf.id)).map((c) => ({ ...this.info(this.idOf(c)), children: walk(c) }));
    return walk(this.world);
  }

  stats() {
    let tris = 0, meshes = 0;
    this.world.traverse((c) => { if (c.isMesh && !c.userData.helper && c.visible) { meshes++; tris += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3; } });
    return { objects: this.objects.size, meshes, triangles: Math.round(tris) };
  }

  // ---------------------------------------------------------------- history
  _captureState() {
    const objs = [];
    const order = [];
    this.world.traverse((o) => { const id = o.userData?.cf?.id; if (id && this.objects.has(id)) order.push(o); });
    for (const o of order) {
      const cf = o.userData.cf;
      objs.push({
        id: cf.id, kind: cf.kind, parent: o.parent && o.parent !== this.world ? this.idOf(o.parent) : null, name: o.name, visible: o.visible,
        p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(),
        params: cf.params ? JSON.stringify(cf.params) : null, material: cf.material ? JSON.stringify(cf.material) : null,
        geometry: cf.kind === 'mesh' && o.isMesh ? o.geometry : null,
      });
    }
    return { objs, selection: [...this.selection] };
  }

  _restoreState(st) {
    const keep = new Set(st.objs.map((s) => s.id));
    for (const [id, o] of [...this.objects]) if (!keep.has(id)) { this.objects.delete(id); this.graveyard.set(id, o); o.parent?.remove(o); }
    for (const s of st.objs) {
      let o = this.objects.get(s.id) || this.graveyard.get(s.id);
      if (!o) continue;
      this.graveyard.delete(s.id);
      this.objects.set(s.id, o);
      const parent = s.parent ? this.objects.get(s.parent) : this.world;
      if (o.parent !== parent) parent.add(o);
      o.name = s.name; o.visible = s.visible;
      o.position.fromArray(s.p); o.quaternion.fromArray(s.q); o.scale.fromArray(s.s);
      const cf = o.userData.cf;
      if (s.params && JSON.stringify(cf.params) !== s.params) { cf.params = JSON.parse(s.params); this._rebuild(o); }
      if (s.material && JSON.stringify(cf.material) !== s.material) { cf.material = JSON.parse(s.material); o.traverse((c) => { if (c.isMesh && !c.userData.helper) applyMaterialSpec(c.material, cf.material); }); }
      if (s.geometry && o.geometry !== s.geometry) o.geometry = s.geometry;
      o.updateMatrixWorld(true);
    }
    this.selection = st.selection.filter((id) => this.objects.has(id));
    this.emit('change', {}); this.emit('select', { ids: this.selection });
  }

  commit(label = 'Edit', initial = false) {
    const st = this._captureState();
    st.label = label;
    if (this.current && !initial) {
      this.undoStack.push(this.current);
      if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
      this.redoStack = [];
      this.dirty = true;
    }
    this.current = st;
    this.emit('history', { label, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.current);
    this.current = this.undoStack.pop();
    this._restoreState(this.current);
    this.emit('history', { label: 'Undo', canUndo: this.undoStack.length > 0, canRedo: true });
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.current);
    this.current = this.redoStack.pop();
    this._restoreState(this.current);
    this.emit('history', { label: 'Redo', canUndo: true, canRedo: this.redoStack.length > 0 });
    return true;
  }

  // ---------------------------------------------------------------- serialization
  _serializeObject(o, forCopy = false) {
    const cf = o.userData.cf;
    const d = {
      id: forCopy ? undefined : cf.id, kind: cf.kind, name: o.name, visible: o.visible,
      position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: o.scale.toArray(),
    };
    if (cf.params) d.params = JSON.parse(JSON.stringify(cf.params));
    if (cf.material) d.material = { ...cf.material };
    if (cf.shape) d.shape = cf.shape;
    if (cf.partType) d.partType = cf.partType;
    if (cf.kind === 'mesh') d.geometry = o.geometry.toJSON();
    if (cf.kind === 'model') d.source = cf.source;
    d.children = o.children.filter((c) => c.userData?.cf?.id && this.objects.has(c.userData.cf.id)).map((c) => this._serializeObject(c, forCopy));
    return d;
  }

  _deserializeObject(d, parentId = null, forCopy = false) {
    const common = { name: d.name, parent: parentId, commit: false, select: false, id: forCopy ? undefined : d.id };
    let o;
    switch (d.kind) {
      case 'car': o = this.addCar({ ...d.params }, common); break;
      case 'primitive': o = this.addPrimitive(d.shape, d.params, { ...common, material: d.material }); break;
      case 'part': o = this.addPart(d.partType, d.params, common); break;
      case 'light': o = this.addLight(d.params?.type, d.params, common); break;
      case 'group': o = this.addGroup([], common); break;
      case 'mesh': {
        const geo = d.geometry?.isBufferGeometry ? d.geometry.clone() : new THREE.BufferGeometryLoader().parse(d.geometry);
        o = this.addMesh(geo, d.material, common);
        break;
      }
      case 'model': {
        if (!this.modelLoader) throw new Error('model loader unavailable');
        o = this.modelLoader(d.source, common);
        break;
      }
      default: throw new Error(`Unknown kind ${d.kind}`);
    }
    o.name = forCopy ? o.name : d.name;
    o.visible = d.visible !== false;
    o.position.fromArray(d.position); o.quaternion.fromArray(d.quaternion); o.scale.fromArray(d.scale);
    o.updateMatrixWorld(true);
    for (const c of d.children || []) this._deserializeObject(c, this.idOf(o), forCopy);
    return o;
  }

  serialize(extra = {}) {
    return {
      format: 'carforge-project', version: 1,
      objects: this.world.children.filter((c) => c.userData?.cf?.id && this.objects.has(c.userData.cf.id)).map((c) => this._serializeObject(c)),
      ...extra,
    };
  }

  clear({ commit = true } = {}) {
    for (const o of [...this.world.children]) if (o.userData?.cf?.id) this.remove(this.idOf(o), { commit: false });
    this.graveyard.clear();
    this.selection = [];
    this.emit('change', {}); this.emit('select', { ids: [] });
    if (commit) this.commit('Clear scene');
  }

  load(data) {
    if (!data || data.format !== 'carforge-project') throw new Error('Not a CarForge project file');
    this.clear({ commit: false });
    for (const d of data.objects || []) this._deserializeObject(d, null, false);
    this.undoStack = []; this.redoStack = [];
    this.commit('Open project', true);
    this.dirty = false;
    this.emit('change', {});
  }
}

function mergeAll(geos) {
  // lazy import-free merge (geometries are already non-indexed with position/normal/uv)
  const attrs = ['position', 'normal', 'uv'];
  const out = new THREE.BufferGeometry();
  for (const a of attrs) {
    const size = a === 'uv' ? 2 : 3;
    const total = geos.reduce((n, g) => n + (g.attributes[a] ? g.attributes[a].count : g.attributes.position.count), 0);
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of geos) {
      const src = g.index ? g.toNonIndexed() : g;
      const at = src.attributes[a];
      if (at) arr.set(at.array, off); off += (at ? at.count : src.attributes.position.count) * size;
    }
    out.setAttribute(a, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingBox();
  return out;
}
