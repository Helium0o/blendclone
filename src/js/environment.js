// Lighting environments tuned for automotive rendering (softbox reflections on paint).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const ENVIRONMENTS = {
  studio: { label: 'Studio softboxes', bg: ['#2a2d33', '#0d0e10'], key: 2.2, floor: '#18191c' },
  showroom: { label: 'Showroom', bg: ['#e9ebee', '#b9bcc2'], key: 2.0, floor: '#c9cbd0' },
  white: { label: 'White cyclorama', bg: ['#ffffff', '#e4e6ea'], key: 1.6, floor: '#f2f3f5' },
  sunset: { label: 'Sunset', bg: ['#f4a261', '#264653'], key: 3.0, floor: '#3a3430' },
  overcast: { label: 'Overcast', bg: ['#cfd6dd', '#8f9aa5'], key: 1.2, floor: '#6c7279' },
  night: { label: 'Night city', bg: ['#0b1026', '#03040a'], key: 0.6, floor: '#0c0d12' },
};

function gradientTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, top); grad.addColorStop(1, bottom);
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function envScene(name) {
  if (name === 'showroom') return new RoomEnvironment();
  const s = new THREE.Scene();
  const box = (w, h, d, color, intensity, pos, rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
    m.position.set(...pos); m.rotation.set(...rot);
    s.add(m);
  };
  const dome = (top, bottom) => {
    const geo = new THREE.SphereGeometry(50, 32, 16);
    const cols = [];
    const ct = new THREE.Color(top), cb = new THREE.Color(bottom), tmp = new THREE.Color();
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = THREE.MathUtils.clamp(p.getY(i) / 50 * 0.5 + 0.5, 0, 1); tmp.copy(cb).lerp(ct, t); cols.push(tmp.r, tmp.g, tmp.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  };
  switch (name) {
    case 'white':
      dome('#ffffff', '#d8dade');
      box(14, 0.2, 6, '#ffffff', 3, [0, 9, 0]);
      box(0.2, 5, 10, '#ffffff', 2, [10, 4, 0]);
      box(0.2, 5, 10, '#ffffff', 2, [-10, 4, 0]);
      break;
    case 'sunset':
      dome('#3d6c8c', '#f6b26b');
      box(30, 4, 1, '#ffcf99', 2.5, [0, 3, -30]);
      { const sun = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d6').multiplyScalar(30) })); sun.position.set(-20, 6, -30); s.add(sun); }
      break;
    case 'overcast':
      dome('#f2f5f8', '#7d8590');
      box(40, 0.2, 40, '#ffffff', 1.4, [0, 20, 0]);
      break;
    case 'night':
      dome('#101830', '#020308');
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const col = ['#ff9a3c', '#5ec8ff', '#ff4f8b', '#fff1c1'][i % 4];
        box(1.5, 0.15 + (i % 3) * 0.2, 0.1, col, 6, [Math.cos(a) * 25, 2 + (i % 5), Math.sin(a) * 25], [0, -a, 0]);
      }
      box(10, 0.2, 2, '#cfe3ff', 2.5, [0, 10, 0]);
      break;
    default: // studio: dark room with large overhead softbox + strip lights (classic car photography)
      dome('#202226', '#060607');
      box(12, 0.1, 3.2, '#ffffff', 7, [0, 8, 0]);
      box(0.1, 1.2, 9, '#ffffff', 5, [9, 3.2, 0]);
      box(0.1, 1.2, 9, '#ffffff', 5, [-9, 3.2, 0]);
      box(9, 1.2, 0.1, '#ffffff', 3.5, [0, 3.2, 10]);
      box(9, 1.2, 0.1, '#ffffff', 3.5, [0, 3.2, -10]);
      box(4, 0.05, 4, '#dfe8ff', 2.5, [6, 7, 6]);
  }
  return s;
}

export class EnvironmentManager {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cache = new Map();
    this.group = new THREE.Group();
    this.group.name = '__environment';
    this.group.userData.helper = true;
    scene.add(this.group);

    this.key = new THREE.DirectionalLight(0xffffff, 2);
    this.key.position.set(5, 9, 4);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 6;
    const sc = this.key.shadow.camera;
    sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 0.5; sc.far = 40;
    this.group.add(this.key, this.key.target);

    const floorTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(256, 256, 30, 256, 256, 256);
      grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.55, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
      return new THREE.CanvasTexture(c);
    })();
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(14, 96).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: '#18191c', roughness: 0.55, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.2, envMapIntensity: 0.45, alphaMap: floorTex, transparent: true }));
    this.floor.receiveShadow = true;
    this.floor.position.y = -0.001;
    this.floor.userData.helper = true;
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.35 }));
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.userData.helper = true;
    this.group.add(this.floor, this.shadowCatcher);
    this.settings = { preset: 'studio', background: 'gradient', floor: 'studio', exposure: 1, rotation: 0, backgroundColor: '#1d1f23', shadows: true };
    this.apply({});
  }

  apply(patch) {
    Object.assign(this.settings, patch);
    const s = this.settings;
    const def = ENVIRONMENTS[s.preset] || ENVIRONMENTS.studio;
    if (!this.cache.has(s.preset)) {
      const rt = this.pmrem.fromScene(envScene(s.preset), 0.035);
      this.cache.set(s.preset, rt.texture);
    }
    const env = this.cache.get(s.preset);
    this.scene.environment = env;
    this.scene.environmentRotation.set(0, THREE.MathUtils.degToRad(s.rotation), 0);
    this.scene.backgroundRotation.set(0, THREE.MathUtils.degToRad(s.rotation), 0);
    if (s.background === 'environment') { this.scene.background = env; this.scene.backgroundBlurriness = 0.35; this.scene.backgroundIntensity = 0.8; }
    else if (s.background === 'color') { this.scene.background = new THREE.Color(s.backgroundColor); }
    else if (s.background === 'transparent') { this.scene.background = null; }
    else { this.scene.background = gradientTexture(def.bg[0], def.bg[1]); }
    this.renderer.toneMappingExposure = s.exposure;
    this.key.intensity = def.key;
    this.key.castShadow = !!s.shadows;
    this.floor.visible = s.floor === 'studio';
    this.floor.material.color.set(def.floor);
    this.shadowCatcher.visible = s.floor === 'shadow';
    return { ...this.settings };
  }

  /** Fit the shadow camera around a bounding box. */
  fitShadows(box) {
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(3, box.getSize(new THREE.Vector3()).length() * 0.6);
    this.key.target.position.copy(c);
    this.key.position.copy(c).add(new THREE.Vector3(0.45, 1, 0.35).normalize().multiplyScalar(r * 3));
    const sc = this.key.shadow.camera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.far = r * 8;
    sc.updateProjectionMatrix();
  }
}
