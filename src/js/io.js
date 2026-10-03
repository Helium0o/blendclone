// Import / export / project files. Uses the Electron bridge when available, browser downloads otherwise.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

export const bridge = window.carforge || null;

export const EXPORT_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'ply', 'usdz'];
export const IMPORT_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply'];

const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a.buffer; };

/** Exports the World group with helpers and non-requested objects hidden. */
async function withExportable(editor, ids, fn) {
  for (const id of editor.cars.keys()) if (editor.objects.has(id)) await editor.cars.get(id).whenReady();
  const keep = ids && ids.length ? new Set(ids.map((i) => editor.require(i))) : null;
  const hidden = [];
  const hide = (o) => { if (o.visible) { o.visible = false; hidden.push(o); } };
  editor.world.traverse((o) => { if (o.userData.helper) hide(o); });
  if (keep) {
    // hide everything that is neither a requested object, nor inside one, nor an ancestor of one
    const needed = new Set();
    for (const o of keep) { o.traverse((c) => needed.add(c)); let p = o.parent; while (p) { needed.add(p); p = p.parent; } }
    editor.world.traverse((o) => { if (o !== editor.world && !needed.has(o)) hide(o); });
  }
  // exporters need drawable images: temporarily swap DataTextures for canvas-backed copies
  const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'clearcoatMap', 'aoMap', 'alphaMap', 'sheenColorMap', 'iridescenceMap'];
  const swaps = [];
  const canvasCache = new Map();
  editor.world.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    for (const m of [].concat(o.material)) {
      for (const slot of SLOTS) {
        const t = m[slot];
        if (!t || !t.isDataTexture || !t.image?.data) continue;
        let ct = canvasCache.get(t);
        if (!ct) {
          const c = document.createElement('canvas');
          c.width = t.image.width; c.height = t.image.height;
          const ctx = c.getContext('2d');
          const id = ctx.createImageData(c.width, c.height);
          id.data.set(t.image.data.subarray(0, id.data.length));
          ctx.putImageData(id, 0, 0);
          ct = new THREE.CanvasTexture(c);
          ct.flipY = false; ct.colorSpace = t.colorSpace; ct.channel = t.channel; ct.wrapS = t.wrapS; ct.wrapT = t.wrapT;
          canvasCache.set(t, ct);
        }
        swaps.push([m, slot, t]);
        m[slot] = ct;
      }
    }
  });
  try {
    editor.world.updateMatrixWorld(true);
    return await fn(editor.world);
  } finally {
    for (const [m, slot, t] of swaps) m[slot] = t;
    for (const ct of canvasCache.values()) ct.dispose();
    for (const o of hidden) o.visible = true;
  }
}

/** Flattened copy (shared geometry/material) of every visible mesh, for exporters that ignore visibility. */
function visibleMeshes(root) {
  const out = new THREE.Group();
  const walk = (o) => {
    if (!o.visible) return;
    if (o.isMesh) {
      const m = new THREE.Mesh(o.geometry, o.material);
      m.name = o.name;
      o.matrixWorld.decompose(m.position, m.quaternion, m.scale);
      out.add(m);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  out.updateMatrixWorld(true);
  return out;
}

export async function exportScene(editor, format = 'glb', { ids = null } = {}) {
  format = format.toLowerCase();
  // stash user-data that must not leak into exports
  const stash = [];
  editor.world.traverse((o) => { if (o.userData && Object.keys(o.userData).length) { stash.push([o, o.userData]); o.userData = o.userData.cf ? { carforge: { id: o.userData.cf.id, kind: o.userData.cf.kind } } : {}; } });
  try {
    return await withExportable(editor, ids, async (world) => {
      const root = format === 'glb' || format === 'gltf' ? world : visibleMeshes(world);
      switch (format) {
        case 'glb':
        case 'gltf': {
          const res = await new GLTFExporter().parseAsync(root, { binary: format === 'glb', onlyVisible: true, maxTextureSize: 4096 });
          return format === 'glb' ? { data: res, mime: 'model/gltf-binary' } : { data: JSON.stringify(res), mime: 'model/gltf+json' };
        }
        case 'obj': return { data: new OBJExporter().parse(root), mime: 'text/plain' };
        case 'stl': return { data: new STLExporter().parse(root, { binary: true }).buffer, mime: 'model/stl' };
        case 'ply': return { data: await new Promise((res) => new PLYExporter().parse(root, res, { binary: true })), mime: 'application/octet-stream' };
        case 'usdz': return { data: (await new USDZExporter().parseAsync(root)).buffer, mime: 'model/vnd.usdz+zip' };
        default: throw new Error(`Unsupported export format "${format}". Use one of ${EXPORT_FORMATS.join(', ')}`);
      }
    });
  } finally {
    for (const [o, ud] of stash) o.userData = ud;
  }
}

/** Parses a model file buffer and returns a THREE.Group. */
export async function parseModel(buffer, name) {
  const ext = name.split('.').pop().toLowerCase();
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const data = ext === 'gltf' ? new TextDecoder().decode(buffer) : buffer;
      const gltf = await new GLTFLoader().parseAsync(data, '');
      return gltf.scene;
    }
    case 'obj': return new OBJLoader().parse(new TextDecoder().decode(buffer));
    case 'fbx': return new FBXLoader().parse(buffer, '');
    case 'stl': {
      const g = new STLLoader().parse(buffer);
      g.computeVertexNormals();
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb9b4ab, roughness: 0.6 })));
      return grp;
    }
    case 'ply': {
      const g = new PLYLoader().parse(buffer);
      g.computeVertexNormals();
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb9b4ab, roughness: 0.6, vertexColors: !!g.attributes.color })));
      return grp;
    }
    default: throw new Error(`Unsupported import format ".${ext}". Use ${IMPORT_FORMATS.join(', ')}`);
  }
}

/** Registers the 'model' loader on the editor (used for undo/duplicate/project load). */
export function installModelLoader(editor) {
  editor.modelLoader = (source, opts) => {
    const holder = new THREE.Group();
    holder.name = opts.name || source.name;
    const obj = editor._register(holder, 'model', { source }, { ...opts, idPrefix: 'model' });
    parseModel(fromB64(source.data), source.name).then((g) => {
      for (const c of [...g.children]) holder.add(c);
      holder.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      editor.emit('change', {}); editor.emit('update', { id: editor.idOf(holder) });
    }).catch((e) => console.error('model load failed', e));
    return obj;
  };
}

export async function importModel(editor, buffer, name, opts = {}) {
  const g = await parseModel(buffer, name);
  // auto-scale absurd units (e.g. millimetre exports) to something car-sized
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3()).length();
  let autoScale = 1;
  if (opts.autoScale !== false && size > 0) { if (size > 200) autoScale = 0.001; else if (size > 40) autoScale = 0.01; }
  const holder = new THREE.Group();
  holder.name = opts.name || name.replace(/\.[^.]+$/, '');
  for (const c of [...g.children]) holder.add(c);
  holder.scale.setScalar(autoScale);
  const obj = editor._register(holder, 'model', { source: { name, data: toB64(buffer) } }, { ...opts, idPrefix: 'model', commit: false });
  if (opts.position) obj.position.set(...opts.position);
  if (opts.scale) obj.scale.setScalar(opts.scale * autoScale);
  if (opts.dropToGround !== false) editor.dropToGround(editor.idOf(obj), { commit: false });
  editor.commit(`Import ${name}`);
  return obj;
}

// ---------------------------------------------------------------- user-facing file actions
function download(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function saveDialog(data, defaultName, mime, filters) {
  if (bridge) return bridge.saveFile({ defaultPath: defaultName, filters, data: typeof data === 'string' ? data : data instanceof ArrayBuffer ? data : await new Blob([data]).arrayBuffer() });
  download(data, defaultName, mime);
  return defaultName;
}

export async function openDialog(filters, accept) {
  if (bridge) return bridge.openFile({ filters });
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      resolve({ path: f.name, name: f.name, data: await f.arrayBuffer() });
    };
    input.click();
  });
}

export { toB64, fromB64 };
