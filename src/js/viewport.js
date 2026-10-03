// 3D viewport: rendering, camera navigation, gizmo, picking, drag & drop target, captures.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EnvironmentManager } from './environment.js';

export const VIEWS = {
  perspective: { dir: [1, 0.42, 1.05] },
  front: { dir: [1, 0.08, 0] },
  rear: { dir: [-1, 0.08, 0] },
  left: { dir: [0, 0.08, -1] },
  right: { dir: [0, 0.08, 1] },
  side: { dir: [0, 0.08, 1] },
  top: { dir: [0.0001, 1, 0] },
  bottom: { dir: [0.0001, -1, 0] },
  three_quarter_front: { dir: [1, 0.35, 0.9] },
  three_quarter_rear: { dir: [-1, 0.35, 0.9] },
  front_left: { dir: [1, 0.3, -0.9] },
  rear_left: { dir: [-1, 0.3, -0.9] },
  low_front: { dir: [1, 0.06, 0.75] },
  hero: { dir: [0.9, 0.18, 1.0] },
};

export class Viewport {
  constructor(container, editor) {
    this.container = container;
    this.editor = editor;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.NeutralToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    RectAreaLightUniformsLib.init();

    this.scene = editor.scene;
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.02, 500);
    this.camera.position.set(7, 3, 7);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0.6, 0);
    this.controls.maxPolarAngle = Math.PI * 0.98;
    this.controls.screenSpacePanning = true;

    this.env = new EnvironmentManager(r, this.scene);

    this.grid = new THREE.GridHelper(40, 80, 0x4a4f58, 0x2a2e35);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.35;
    this.grid.position.y = 0.0005;
    this.grid.userData.helper = true;
    this.grid.name = '__grid';
    this.scene.add(this.grid);

    this.gizmo = new TransformControls(this.camera, r.domElement);
    this.gizmo.setSize(0.9);
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmoHelper.userData.helper = true;
    this.scene.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value && this.gizmo.object) {
        editor.emit('update', { id: editor.idOf(this.gizmo.object) });
        editor.commit(`Transform ${this.gizmo.object.name}`);
      }
    });
    this.gizmo.addEventListener('objectChange', () => editor.emit('update', { id: editor.idOf(this.gizmo.object), live: true }));

    // post-processing for the selection outline
    const size = new THREE.Vector2(1, 1);
    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.outline = new OutlinePass(size, this.scene, this.camera);
    this.outline.edgeStrength = 4; this.outline.edgeThickness = 1; this.outline.edgeGlow = 0;
    this.outline.visibleEdgeColor.set('#ff8a1f'); this.outline.hiddenEdgeColor.set('#7a3d05');
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._down = null;
    this.onPick = null;
    this.mode = 'translate';
    this._bindEvents();

    editor.on('select', ({ ids }) => this._syncSelection(ids));
    editor.on('change', () => this._syncSelection(editor.selection));
    editor.on('update', () => this.requestFit());
    editor.on('render', () => {});
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this._fitPending = true;
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  _bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this._down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener('pointerup', (e) => {
      if (!this._down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
      this._down = null;
      if (moved > 4 || this.gizmo.dragging) return;
      const hit = this.pick(e.clientX, e.clientY);
      const owner = hit ? this.editor.ownerOf(hit.object) : null;
      if (owner) {
        const id = this.editor.idOf(owner);
        if (e.shiftKey || e.ctrlKey) {
          const sel = new Set(this.editor.selection);
          sel.has(id) ? sel.delete(id) : sel.add(id);
          this.editor.select([...sel]);
        } else this.editor.select([id]);
        this.onPick?.(owner, hit);
      } else if (!e.shiftKey) this.editor.select([]);
    });
    el.addEventListener('dblclick', () => { if (this.editor.selected) this.frame(this.editor.selected); });
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'select') { this.gizmo.detach(); return; }
    this.gizmo.setMode(mode);
    this._syncSelection(this.editor.selection);
  }

  setSnap(on) {
    this.gizmo.setTranslationSnap(on ? 0.05 : null);
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(on ? 0.1 : null);
  }

  _syncSelection(ids) {
    const objs = ids.map((id) => this.editor.objects.get(id)).filter(Boolean);
    const meshes = [];
    for (const o of objs) o.traverse((c) => { if (c.isMesh && !c.userData.helper) meshes.push(c); });
    this.outline.selectedObjects = meshes;
    if (objs.length === 1 && this.mode !== 'select') this.gizmo.attach(objs[0]);
    else this.gizmo.detach();
  }

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.editor.world, true).filter((h) => h.object.visible && (!h.object.userData.helper || h.object.userData.picker));
    return hits[0] || null;
  }

  /** Point on the ground plane (or on a surface) under the cursor; used for drops. */
  dropPoint(clientX, clientY) {
    const hit = this.pick(clientX, clientY);
    if (hit) return { point: hit.point, object: this.editor.ownerOf(hit.object), mesh: hit.object };
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, p)) return { point: p, object: null };
    return { point: new THREE.Vector3(), object: null };
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.outline.resolution?.set(w, h);
  }

  requestFit() { this._fitPending = true; }

  animate() {
    requestAnimationFrame(this.animate);
    this.controls.update();
    if (this._fitPending) { this._fitPending = false; this.env.fitShadows(this.sceneBox()); }
    this.composer.render();
  }

  sceneBox(objects = null) {
    const box = new THREE.Box3();
    const list = objects || [...this.editor.world.children];
    for (const o of list) { if (o.visible) box.union(this.editor.bbox(o)); }
    return box;
  }

  /** Point the camera at objects (or the whole scene) from a named view direction. */
  frame(target = null, view = null, { distanceScale = 1, fov = null, cam = this.camera, controls = this.controls } = {}) {
    const objs = target ? (Array.isArray(target) ? target : [target]) : null;
    let box = this.sceneBox(objs);
    if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-2.5, 0, -1), new THREE.Vector3(2.5, 1.5, 1));
    const center = box.getCenter(new THREE.Vector3());
    const sizeV = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.2, sizeV.length() / 2);
    if (fov && cam.isPerspectiveCamera) { cam.fov = fov; cam.updateProjectionMatrix(); }
    let dir;
    if (view && VIEWS[view]) dir = new THREE.Vector3(...VIEWS[view].dir).normalize();
    else if (Array.isArray(view)) dir = new THREE.Vector3(...view).normalize();
    else dir = cam.position.clone().sub(controls ? controls.target : center).normalize();
    if (cam.isPerspectiveCamera) {
      const vfov = THREE.MathUtils.degToRad(cam.fov);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
      const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.92 * distanceScale;
      cam.position.copy(center).add(dir.multiplyScalar(dist));
    } else {
      cam.position.copy(center).add(dir.multiplyScalar(radius * 4));
      const a = cam.right - cam.left > 0 ? (cam.right - cam.left) / (cam.top - cam.bottom) : 1;
      const half = radius * 1.05 * distanceScale;
      cam.top = half; cam.bottom = -half; cam.left = -half * a; cam.right = half * a;
      cam.updateProjectionMatrix();
    }
    cam.up.set(0, 1, 0);
    if (view === 'top' || view === 'bottom') cam.up.set(-1, 0, 0);
    cam.lookAt(center);
    if (controls) { controls.target.copy(center); controls.update(); }
    return { center, radius };
  }

  /**
   * Off-screen capture. Returns a data URL. Helpers (grid, gizmo, selection outline) are hidden.
   */
  capture({ width = 1280, height = 800, view = null, target = null, format = 'png', quality = 0.92, ortho = false, transparent = false, showGrid = false, camera = null, fov = 35, distanceScale = 1 } = {}) {
    const r = this.renderer;
    const prevSize = r.getSize(new THREE.Vector2());
    const prevPR = r.getPixelRatio();
    const prevBg = this.scene.background;
    const hidden = [];
    const hide = (o) => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
    if (!showGrid) hide(this.grid);
    hide(this.gizmoHelper);
    this.editor.world.traverse((o) => { if (o.userData.picker) hide(o); });
    let cam;
    if (camera) {
      cam = new THREE.PerspectiveCamera(camera.fov || fov, width / height, 0.02, 500);
      cam.position.set(...camera.position);
      cam.lookAt(new THREE.Vector3(...(camera.target || [0, 0.6, 0])));
    } else if (view || target || ortho) {
      cam = ortho ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500) : new THREE.PerspectiveCamera(fov, width / height, 0.02, 500);
      if (ortho) { cam.left = -width / height; cam.right = width / height; }
      const objs = target ? (Array.isArray(target) ? target : [target]).map((t) => this.editor.require(t)) : null;
      this.frame(objs, view || 'perspective', { cam, controls: null, distanceScale });
    } else {
      cam = this.camera.clone();
      cam.aspect = width / height; cam.updateProjectionMatrix();
    }
    if (transparent) this.scene.background = null;
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    r.render(this.scene, cam);
    const url = r.domElement.toDataURL(format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : 'image/png', quality);
    for (const o of hidden) o.visible = true;
    this.scene.background = prevBg;
    r.setPixelRatio(prevPR);
    r.setSize(prevSize.x, prevSize.y, false);
    this.resize();
    this.composer.render();
    return url;
  }
}
