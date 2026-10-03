// CarModel: owns a THREE.Group with the generated body, wheels and parts and keeps it in
// sync with a parameter set, rebuilding only what changed.
import * as THREE from 'three';
import { buildBody, sideZAt } from './body.js';
import { bakeBody, composeBody, PAINT_FINISHES } from './bake.js';
import { buildWheel, rimMaterial, tyreDims } from './wheel.js';
import { buildParts } from './parts.js';
import { carbonTextures } from './textures.js';
import { carParams, sanitizeCarParams, MATERIAL_ONLY_KEYS } from './params.js';

const WHEEL_ONLY = new Set(['rimStyle', 'spokeCount', 'rimDish', 'camber', 'steer', 'wheelInset']);
const PARTS_ONLY = new Set(['spoiler', 'wingHeight', 'splitter', 'sideSkirts', 'diffuser', 'roofRails', 'sharkFin', 'wipers', 'mirrors', 'exhaust', 'exhaustShape', 'plateText']);
const BAKE_ONLY = new Set(['headlightStyle', 'headlightWidth', 'headlightHeight', 'headlightDrop', 'headlightWrap', 'grilleStyle', 'grilleWidth', 'grilleHeight',
  'grilleDrop', 'lowerIntake', 'fogLights', 'hoodVents', 'sideVents', 'taillightStyle', 'taillightWidth', 'taillightHeight', 'taillightDrop', 'doorHandles',
  'sunroof', 'blackPillars', 'cPillar', 'pillarWidth', 'doors', 'cladding']);

// shared worker for high resolution bakes
let worker = null, workerFailed = false, jobId = 0;
const pending = new Map();
function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./bake-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data.r);
    };
    worker.onerror = () => { workerFailed = true; worker = null; for (const j of pending.values()) j.reject(new Error('worker failed')); pending.clear(); };
  } catch { workerFailed = true; worker = null; }
  return worker;
}
function bakeAsync(grid, lay, p, TW, TH) {
  const local = () => new Promise((res) => setTimeout(() => res(bakeBody(grid, lay, p, TW, TH)), 0));
  const w = getWorker();
  if (!w) return local();
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, grid, lay, p, TW, TH });
  }).catch((err) => { console.warn('bake worker unavailable, baking on main thread', err); return local(); });
}

export const BAKE_QUALITY = { draft: 512, normal: 1024, high: 2048, ultra: 4096 };

export class CarModel {
  constructor(params = 'sedan', options = {}) {
    this.params = typeof params === 'string' ? carParams(params) : sanitizeCarParams({ ...carParams('sedan'), ...params });
    this.quality = options.quality || 'high';
    this.group = new THREE.Group();
    this.group.name = 'Car';
    this.bodyMesh = null;
    this.wheels = new THREE.Group(); this.wheels.name = 'wheels';
    this.parts = new THREE.Group(); this.parts.name = 'parts';
    this.group.add(this.wheels, this.parts);
    this.mats = this._makeMaterials();
    this.bake = null;
    this.bakeToken = 0;
    this.onUpdate = options.onUpdate || null;
    this.rebuild('all');
  }

  // ------------------------------------------------------------- materials
  _makeMaterials() {
    const carbon = carbonTextures();
    const m = {
      body: new THREE.MeshPhysicalMaterial({ name: 'car_body', clearcoat: 1, clearcoatRoughness: 0.03, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 0 }),
      paint: new THREE.MeshPhysicalMaterial({ name: 'car_paint', clearcoat: 1, clearcoatRoughness: 0.03 }),
      roof: new THREE.MeshPhysicalMaterial({ name: 'car_roof_paint', clearcoat: 1, clearcoatRoughness: 0.03 }),
      carbon: new THREE.MeshPhysicalMaterial({ name: 'carbon_fibre', map: carbon.map, normalMap: carbon.normalMap, roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02 }),
      gloss: new THREE.MeshPhysicalMaterial({ name: 'gloss_black', color: 0x0b0b0c, roughness: 0.2, clearcoat: 1 }),
      chrome: new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xf2f2f2, metalness: 1, roughness: 0.05 }),
      chromeDouble: new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xe8e8e8, metalness: 1, roughness: 0.08, side: THREE.DoubleSide }),
      blackPlastic: new THREE.MeshStandardMaterial({ name: 'black_plastic', color: 0x111112, roughness: 0.6 }),
      satinBlack: new THREE.MeshStandardMaterial({ name: 'satin_black', color: 0x18191b, roughness: 0.45, metalness: 0.3 }),
      liner: new THREE.MeshStandardMaterial({ name: 'wheel_liner', color: 0x050505, roughness: 0.95, side: THREE.DoubleSide }),
      soot: new THREE.MeshStandardMaterial({ name: 'exhaust_soot', color: 0x020202, roughness: 1 }),
      tyre: null, rim: null, caliper: null,
    };
    return m;
  }

  _applyPaint() {
    const p = this.params;
    const f = PAINT_FINISHES[p.paintFinish] || PAINT_FINISHES.metallic;
    for (const [mat, col] of [[this.mats.paint, p.paintColor], [this.mats.roof, p.twoTone ? p.roofColor : p.paintColor]]) {
      mat.color.set(col);
      mat.roughness = f.r; mat.metalness = f.m; mat.clearcoat = f.c;
      mat.iridescence = p.paintFinish === 'pearl' ? 0.5 : 0;
      mat.needsUpdate = true;
    }
    this.mats.body.iridescence = p.paintFinish === 'pearl' ? 0.6 : 0;
    this.mats.body.emissiveIntensity = p.lightsOn ? 2.2 : 0;
    this.mats.aero = p.aeroFinish === 'carbon' ? this.mats.carbon : p.aeroFinish === 'body' ? this.mats.paint : this.mats.gloss;
    if (this.mats.caliper) this.mats.caliper.color.set(p.caliperColor);
  }

  // ------------------------------------------------------------- update API
  setParams(patch) {
    const next = sanitizeCarParams({ ...this.params, ...patch });
    const changed = Object.keys(next).filter((k) => next[k] !== this.params[k]);
    if (!changed.length) return [];
    this.params = next;
    let level = 'material';
    for (const k of changed) {
      if (MATERIAL_ONLY_KEYS.has(k)) continue;
      if (WHEEL_ONLY.has(k)) level = level === 'material' ? 'wheels' : level === 'parts' ? 'wheels+parts' : level;
      else if (PARTS_ONLY.has(k)) level = level === 'material' ? 'parts' : level === 'wheels' ? 'wheels+parts' : level;
      else if (BAKE_ONLY.has(k)) level = level === 'all' ? 'all' : 'bake+' + level;
      else level = 'all';
    }
    if (changed.includes('rimFinish') && level === 'material') level = 'wheels';
    if (changed.includes('aeroFinish') && level === 'material') level = 'parts';
    this.rebuild(level);
    return changed;
  }

  rebuild(level = 'all') {
    const p = this.params;
    this._applyPaint();
    if (level === 'all') {
      this.body = buildBody(p);
      if (!this.bodyMesh) {
        this.bodyMesh = new THREE.Mesh(this.body.geometry, this.mats.body);
        this.bodyMesh.name = 'body';
        this.bodyMesh.castShadow = true; this.bodyMesh.receiveShadow = true;
        this.group.add(this.bodyMesh);
      } else {
        this.bodyMesh.geometry.dispose();
        this.bodyMesh.geometry = this.body.geometry;
      }
      this._bake();
      this._buildWheels();
      this._buildParts();
    } else {
      if (level.includes('bake')) this._bake();
      else this._compose();
      if (level.includes('wheels')) this._buildWheels();
      if (level.includes('parts')) this._buildParts();
    }
    this._tagParts();
  }

  _bake() {
    const p = this.params;
    const token = ++this.bakeToken;
    const target = BAKE_QUALITY[this.quality] || 2048;
    // immediate low-res preview so edits feel instant
    const pre = Math.min(512, target);
    this.bake = bakeBody(this.body.grid, this.body.layout, p, pre, pre / 2);
    this._compose(true);
    this.hiResPending = target > pre;
    if (target > pre) {
      const body = this.body;
      clearTimeout(this._bakeTimer);
      this._bakeTimer = setTimeout(() => {
        if (token !== this.bakeToken) return;
        this.bakeBusy = true;
        bakeAsync(body.grid, body.layout, p, target, target / 2).then((r) => {
          if (token !== this.bakeToken) return;
          this.bake = r;
          this._compose(true);
          this.bakeBusy = false;
          this.hiResPending = false;
          this.onUpdate?.(this);
        }).catch((err) => { this.bakeBusy = false; this.hiResPending = false; console.warn('bake failed', err); });
      }, 120);
    }
  }

  /** Wait until the high-res bake finished (used before exports / screenshots). */
  async whenReady(timeout = 20000) {
    const t0 = performance.now();
    while (this.hiResPending && performance.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 50));
    return !this.hiResPending;
  }

  _compose(newSize = false) {
    if (!this.bake) return;
    const { TW, TH } = this.bake;
    const m = this.mats.body;
    const sizeChanged = !m.map || m.map.image.width !== TW;
    const target = sizeChanged ? null : { map: m.map.image.data, orm: m.roughnessMap.image.data, emis: m.emissiveMap.image.data, mask: m.iridescenceMap.image.data };
    void newSize;
    const c = composeBody(this.bake, this.params, target);
    const mk = (data, srgb) => {
      const t = new THREE.DataTexture(data, TW, TH, THREE.RGBAFormat);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.anisotropy = 8; t.needsUpdate = true;
      return t;
    };
    if (sizeChanged) {
      for (const k of ['map', 'roughnessMap', 'emissiveMap', 'normalMap', 'iridescenceMap']) m[k]?.dispose();
      m.map = mk(c.map, true);
      const orm = mk(c.orm, false);
      m.roughnessMap = orm; m.metalnessMap = orm; m.clearcoatMap = orm;
      m.emissiveMap = mk(c.emis, true);
      m.normalMap = mk(this.bake.normal, false);
      m.iridescenceMap = mk(c.mask, false);
      m.needsUpdate = true;
    } else {
      m.iridescenceMap.image.data = c.mask; m.iridescenceMap.needsUpdate = true;
      m.map.image.data = c.map; m.map.needsUpdate = true;
      m.roughnessMap.image.data = c.orm; m.roughnessMap.needsUpdate = true;
      m.emissiveMap.image.data = c.emis; m.emissiveMap.needsUpdate = true;
      m.normalMap.image.data = this.bake.normal; m.normalMap.needsUpdate = true;
    }
  }

  _wheelMats() {
    const p = this.params;
    if (!this.mats.caliper) this.mats.caliper = new THREE.MeshPhysicalMaterial({ name: 'brake_caliper', color: p.caliperColor, roughness: 0.32, clearcoat: 1 });
    this.mats.caliper.color.set(p.caliperColor);
    this.mats.rim = rimMaterial(p, this.mats.paint);
    if (this.mats.rim !== this.mats.paint) this.mats.rim.name = 'rim_' + p.rimFinish;
    return { rim: this.mats.rim, caliper: this.mats.caliper, paint: this.mats.paint };
  }

  _buildWheels() {
    const p = this.params, L = this.body.layout;
    this.wheels.clear();
    const mats = this._wheelMats();
    const proto = buildWheel(p, mats, 2.55);
    if (!this.mats.tyre) this.mats.tyre = proto.userData.materials.tyre;
    const { tw } = tyreDims(p);
    for (const [name, ax, side] of [['wheel_FL', L.fa, 1], ['wheel_FR', L.fa, -1], ['wheel_RL', L.ra, 1], ['wheel_RR', L.ra, -1]]) {
      const w = proto.clone();
      void name;
      const sv = this.body.stationValues(ax);
      const zSide = Math.max(sv.w, sideZAt(this.body.grid, ax + L.archR * 0.98, L.wheelY + 0.02));
      const zc = zSide - p.wheelInset - tw / 2 - 0.016;
      w.position.set(ax, L.tireR, side * zc);
      if (side < 0) w.scale.z = -1;
      w.rotation.order = 'YXZ';
      const cam = THREE.MathUtils.degToRad(p.camber);
      w.rotation.x = side > 0 ? cam : -cam;
      if (ax === L.fa) w.rotation.y = THREE.MathUtils.degToRad(p.steer);
      // name based on driver's view: +z is right
      w.name = `wheel_${ax === L.fa ? 'F' : 'R'}${side > 0 ? 'R' : 'L'}`;
      this.wheels.add(w);
    }
  }

  _buildParts() {
    this.parts.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.parts.clear();
    const meshes = buildParts(this.params, this.body, this.mats);
    for (const m of meshes) this.parts.add(m);
  }

  _tagParts() {
    // material slot hints for drag & drop / AI ("which param controls this mesh?")
    const map = {
      body: 'paintColor', mirrors: 'paintColor', spoiler: 'paintColor', antenna: 'paintColor', rim: 'rimFinish', rim_lip: 'rimFinish',
      caliper: 'caliperColor', wing: 'aeroFinish', splitter: 'aeroFinish', side_skirts: 'aeroFinish', diffuser: 'aeroFinish',
    };
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.carPart = o.name;
      if (map[o.name]) o.userData.carParam = map[o.name];
    });
  }

  /** Summary for the AI / UI. */
  describe() {
    const L = this.body.layout;
    return {
      lengthM: +L.L.toFixed(3), widthM: +L.W.toFixed(3), heightM: +L.H.toFixed(3), wheelbaseM: +L.wb.toFixed(3),
      frontOverhangM: +L.fo.toFixed(3), rearOverhangM: +L.ro.toFixed(3), tyreOuterDiameterM: +(L.tireR * 2).toFixed(3),
      keyPointsX: { frontBumper: +L.xf.toFixed(3), frontAxle: +L.fa.toFixed(3), windshieldBase: +L.xc.toFixed(3), roofFront: +L.xrf.toFixed(3), roofRear: +L.xrr.toFixed(3), rearWindowBase: +L.xd.toFixed(3), rearAxle: +L.ra.toFixed(3), rearBumper: +L.xr.toFixed(3) },
      triangles: this.triangleCount(),
      bakeResolution: this.bake ? `${this.bake.TW}x${this.bake.TH}` : null,
    };
  }

  triangleCount() {
    let n = 0;
    this.group.traverse((o) => { if (o.isMesh && o.geometry) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return Math.round(n);
  }

  dispose() {
    this.bakeToken++;
    this.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
  }
}
