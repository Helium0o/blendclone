// Left panel: draggable library of cars, parts, shapes, paints and lights.
import * as THREE from 'three';
import { h } from './dom.js';
import { CAR_PRESETS } from '../car/params.js';
import { CarModel } from '../car/car.js';
import { PRIMITIVES } from '../geometry/primitives.js';
import { PART_TYPES } from '../car/standalone.js';
import { MATERIAL_PRESETS } from '../materials.js';

export const PAINT_COLORS = [
  ['Rosso Corsa', '#c8000a', 'metallic'], ['Nardo Grey', '#8b8d8f', 'gloss'], ['British Racing Green', '#0b3d2a', 'metallic'],
  ['Grabber Blue', '#1f63d1', 'metallic'], ['Miami Blue', '#00a3e0', 'gloss'], ['Lime Rock', '#9fd11b', 'pearl'],
  ['Obsidian Black', '#0b0b0d', 'metallic'], ['Pearl White', '#f2f1ec', 'pearl'], ['Liquid Silver', '#b9bdc2', 'metallic'],
  ['Gulf Blue', '#8ec5e6', 'gloss'], ['Gulf Orange', '#f37021', 'gloss'], ['Sunburst Yellow', '#f2b705', 'pearl'],
  ['Champagne', '#c9b38a', 'metallic'], ['Velvet Purple', '#4b1f6f', 'candy'], ['Candy Red', '#7a0614', 'candy'],
  ['Matte Black', '#18191b', 'matte'], ['Satin Graphite', '#3b3f45', 'satin'], ['Chrome', '#e6e8ea', 'chrome'],
];

const LIGHTS = {
  area: { label: 'Softbox (area)', icon: '▭', desc: 'Large soft light, great for paint reflections' },
  spot: { label: 'Spot light', icon: '🔦', desc: 'Focused cone' },
  point: { label: 'Point light', icon: '💡', desc: 'Omni bulb' },
  directional: { label: 'Sun', icon: '☀', desc: 'Parallel light with shadows' },
  rig: { label: '3-point studio rig', icon: '🎬', desc: 'Key, fill and rim softboxes' },
};

// ---------------------------------------------------------------- thumbnails for car presets
const THUMB_VERSION = 'v3';
let thumbRenderer = null;
async function carThumb(preset) {
  const key = `cf-thumb-${THUMB_VERSION}-${preset}`;
  try { const c = localStorage.getItem(key); if (c) return c; } catch { /* ignore */ }
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(240, 132);
    thumbRenderer.toneMapping = THREE.NeutralToneMapping;
  }
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(thumbRenderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const car = new CarModel(preset, { quality: 'draft' });
  scene.add(car.group);
  const box = new THREE.Box3().setFromObject(car.group);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.PerspectiveCamera(28, 240 / 132, 0.1, 100);
  cam.position.copy(c).add(new THREE.Vector3(1, 0.32, 1.0).normalize().multiplyScalar(r * 3.0));
  cam.lookAt(c.x, c.y - r * 0.08, c.z);
  thumbRenderer.render(scene, cam);
  const url = thumbRenderer.domElement.toDataURL('image/png');
  car.dispose();
  scene.environment.dispose();
  pm.dispose();
  try { localStorage.setItem(key, url); } catch { /* quota */ }
  return url;
}

export class Library {
  constructor(app) {
    this.app = app;
    this.tab = 'cars';
    this.grid = document.getElementById('libGrid');
    this.search = document.getElementById('libSearch');
    document.querySelectorAll('#libTabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#libTabs button').forEach((x) => x.classList.toggle('active', x === b));
      this.tab = b.dataset.tab;
      this.render();
    }));
    this.search.addEventListener('input', () => this.render());
    this.render();
    this._thumbQueue();
  }

  items() {
    switch (this.tab) {
      case 'cars': return Object.entries(CAR_PRESETS).map(([k, v]) => ({ key: k, name: v.label, desc: v.description, icon: '🚗', thumb: `car:${k}`, data: { type: 'car', preset: k } }));
      case 'parts': return Object.entries(PART_TYPES).map(([k, v]) => ({ key: k, name: v.label, icon: v.icon, desc: k === 'wheel' ? 'Rim + tyre + brake' : 'Adjustable airfoil', data: { type: 'part', partType: k } }));
      case 'shapes': return Object.entries(PRIMITIVES).map(([k, v]) => ({ key: k, name: v.label, icon: v.icon, data: { type: 'primitive', shape: k } }));
      case 'materials': return [
        ...PAINT_COLORS.map(([name, color, finish]) => ({ key: name, name, swatch: color, desc: finish, data: { type: 'paint', color, finish } })),
        ...Object.entries(MATERIAL_PRESETS).map(([k, v]) => ({ key: k, name: v.label, swatch: v.color, desc: 'material', data: { type: 'material', preset: k } })),
      ];
      case 'lights': return Object.entries(LIGHTS).map(([k, v]) => ({ key: k, name: v.label, icon: v.icon, desc: v.desc, data: { type: k === 'rig' ? 'rig' : 'light', lightType: k } }));
      default: return [];
    }
  }

  render() {
    const q = this.search.value.trim().toLowerCase();
    this.grid.innerHTML = '';
    this.grid.classList.toggle('single', this.tab === 'cars');
    for (const it of this.items()) {
      if (q && !`${it.name} ${it.desc || ''} ${it.key}`.toLowerCase().includes(q)) continue;
      const thumb = h('div', { class: 'thumb' });
      if (it.swatch) {
        thumb.style.background = `radial-gradient(circle at 35% 30%, #ffffff55, transparent 45%), ${it.swatch}`;
      } else if (it.thumb) {
        thumb.textContent = it.icon;
        thumb.dataset.thumb = it.thumb;
        const cached = (() => { try { return localStorage.getItem(`cf-thumb-${THUMB_VERSION}-${it.key}`); } catch { return null; } })();
        if (cached) { thumb.textContent = ''; thumb.append(h('img', { src: cached, draggable: 'false' })); }
      } else thumb.textContent = it.icon || '■';
      const card = h('div', { class: `card ${it.swatch ? 'swatch' : ''}`, draggable: 'true', title: 'Drag into the viewport, or click to add' },
        thumb, h('div', { class: 'name' }, it.name), it.desc ? h('div', { class: 'desc' }, it.desc) : null);
      if (this.tab === 'cars') { card.style.flexDirection = 'row'; card.style.alignItems = 'center'; thumb.style.width = '110px'; thumb.style.flex = 'none'; const txt = h('div', {}, card.querySelector('.name'), card.querySelector('.desc')); card.append(txt); }
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-carforge', JSON.stringify(it.data));
        e.dataTransfer.effectAllowed = 'copy';
      });
      card.addEventListener('click', () => this.app.handleDrop(it.data, null));
      this.grid.append(card);
    }
  }

  async _thumbQueue() {
    for (const k of Object.keys(CAR_PRESETS)) {
      await new Promise((r) => (window.requestIdleCallback || setTimeout)(r, { timeout: 600 }));
      try {
        const url = await carThumb(k);
        const el = this.grid.querySelector(`[data-thumb="car:${k}"]`);
        if (el && !el.querySelector('img')) { el.textContent = ''; el.append(h('img', { src: url, draggable: 'false' })); }
      } catch (e) { console.warn('thumb', k, e); }
    }
  }
}
