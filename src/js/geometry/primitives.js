// Parametric primitive shapes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';

const N = (key, label, def, min, max, step, unit) => ({ key, label, type: 'number', default: def, min, max, step, unit, group: 'shape' });

export const PRIMITIVES = {
  box: { label: 'Box', icon: '◼', schema: [N('width', 'Width', 1, 0.001, 50, 0.01, 'm'), N('height', 'Height', 1, 0.001, 50, 0.01, 'm'), N('depth', 'Depth', 1, 0.001, 50, 0.01, 'm'), N('bevel', 'Bevel radius', 0, 0, 1, 0.005, 'm'), N('segments', 'Segments', 1, 1, 64, 1)] },
  sphere: { label: 'Sphere', icon: '●', schema: [N('radius', 'Radius', 0.5, 0.001, 50, 0.01, 'm'), N('widthSegments', 'Segments', 48, 3, 256, 1), N('heightSegments', 'Rings', 32, 2, 256, 1)] },
  cylinder: { label: 'Cylinder', icon: '▮', schema: [N('radiusTop', 'Top radius', 0.5, 0, 50, 0.01, 'm'), N('radiusBottom', 'Bottom radius', 0.5, 0, 50, 0.01, 'm'), N('height', 'Height', 1, 0.001, 50, 0.01, 'm'), N('radialSegments', 'Segments', 48, 3, 256, 1)] },
  cone: { label: 'Cone', icon: '▲', schema: [N('radius', 'Radius', 0.5, 0.001, 50, 0.01, 'm'), N('height', 'Height', 1, 0.001, 50, 0.01, 'm'), N('radialSegments', 'Segments', 48, 3, 256, 1)] },
  torus: { label: 'Torus', icon: '◯', schema: [N('radius', 'Radius', 0.5, 0.001, 50, 0.01, 'm'), N('tube', 'Tube radius', 0.15, 0.001, 20, 0.005, 'm'), N('radialSegments', 'Tube segments', 24, 3, 128, 1), N('tubularSegments', 'Segments', 96, 3, 512, 1), N('arc', 'Arc', 360, 1, 360, 1, '°')] },
  capsule: { label: 'Capsule', icon: '💊', schema: [N('radius', 'Radius', 0.3, 0.001, 20, 0.01, 'm'), N('length', 'Length', 1, 0, 50, 0.01, 'm'), N('capSegments', 'Cap segments', 12, 1, 64, 1), N('radialSegments', 'Segments', 32, 3, 128, 1)] },
  plane: { label: 'Plane', icon: '▭', schema: [N('width', 'Width', 2, 0.001, 200, 0.01, 'm'), N('height', 'Length', 2, 0.001, 200, 0.01, 'm'), N('segments', 'Segments', 1, 1, 256, 1)] },
  tube: { label: 'Pipe', icon: '◎', schema: [N('outerRadius', 'Outer radius', 0.5, 0.002, 20, 0.005, 'm'), N('innerRadius', 'Inner radius', 0.4, 0, 20, 0.005, 'm'), N('height', 'Height', 1, 0.001, 50, 0.01, 'm'), N('radialSegments', 'Segments', 48, 3, 256, 1)] },
  wedge: { label: 'Wedge', icon: '◢', schema: [N('width', 'Width', 1, 0.001, 50, 0.01, 'm'), N('height', 'Height', 1, 0.001, 50, 0.01, 'm'), N('depth', 'Depth', 1, 0.001, 50, 0.01, 'm')] },
  torusKnot: { label: 'Torus knot', icon: '➰', schema: [N('radius', 'Radius', 0.4, 0.01, 20, 0.01, 'm'), N('tube', 'Tube', 0.12, 0.001, 5, 0.005, 'm'), N('p', 'P', 2, 1, 20, 1), N('q', 'Q', 3, 1, 20, 1)] },
  text: { label: '3D Text', icon: 'T', schema: [{ key: 'text', label: 'Text', type: 'text', default: 'CarForge', group: 'shape' }, N('size', 'Size', 0.3, 0.01, 10, 0.01, 'm'), N('depth', 'Depth', 0.05, 0.001, 5, 0.005, 'm'), N('bevel', 'Bevel', 0.005, 0, 0.1, 0.001, 'm')] },
};

export function primitiveDefaults(shape) {
  const def = PRIMITIVES[shape];
  if (!def) throw new Error(`Unknown primitive "${shape}". Available: ${Object.keys(PRIMITIVES).join(', ')}`);
  return Object.fromEntries(def.schema.map((s) => [s.key, s.default]));
}

let font = null;
let fontPromise = null;
export function loadFont() {
  if (font) return Promise.resolve(font);
  if (!fontPromise) {
    const url = new URL("../../vendor/three/fonts/helvetiker_bold.typeface.json", import.meta.url).href;
    fontPromise = new Promise((res, rej) => new FontLoader().load(url, (f) => { font = f; res(f); }, undefined, rej));
  }
  return fontPromise;
}

export function buildPrimitive(shape, pIn) {
  const p = { ...primitiveDefaults(shape), ...pIn };
  let g;
  switch (shape) {
    case 'box':
      g = p.bevel > 0
        ? new RoundedBoxGeometry(p.width, p.height, p.depth, Math.max(2, Math.round(p.segments * 2)), Math.min(p.bevel, Math.min(p.width, p.height, p.depth) / 2 - 1e-4))
        : new THREE.BoxGeometry(p.width, p.height, p.depth, p.segments, p.segments, p.segments);
      break;
    case 'sphere': g = new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments); break;
    case 'cylinder': g = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments); break;
    case 'cone': g = new THREE.ConeGeometry(p.radius, p.height, p.radialSegments); break;
    case 'torus': g = new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments, THREE.MathUtils.degToRad(p.arc)); break;
    case 'capsule': g = new THREE.CapsuleGeometry(p.radius, p.length, p.capSegments, p.radialSegments); break;
    case 'plane': g = new THREE.PlaneGeometry(p.width, p.height, p.segments, p.segments); g.rotateX(-Math.PI / 2); break;
    case 'tube': {
      const ri = Math.min(p.innerRadius, p.outerRadius - 0.001), ro = p.outerRadius, h = p.height / 2;
      g = new THREE.LatheGeometry([new THREE.Vector2(ri, -h), new THREE.Vector2(ro, -h), new THREE.Vector2(ro, h), new THREE.Vector2(ri, h), new THREE.Vector2(ri, -h)], p.radialSegments);
      g.computeVertexNormals();
      break;
    }
    case 'wedge': {
      const s = new THREE.Shape();
      s.moveTo(-p.depth / 2, -p.height / 2); s.lineTo(p.depth / 2, -p.height / 2); s.lineTo(-p.depth / 2, p.height / 2); s.lineTo(-p.depth / 2, -p.height / 2);
      g = new THREE.ExtrudeGeometry(s, { depth: p.width, bevelEnabled: false });
      g.translate(0, 0, -p.width / 2);
      g.rotateY(Math.PI / 2);
      break;
    }
    case 'torusKnot': g = new THREE.TorusKnotGeometry(p.radius, p.tube, 200, 24, p.p, p.q); break;
    case 'text': {
      if (!font) { g = new THREE.BoxGeometry(p.size * String(p.text).length * 0.6, p.size, p.depth); break; }
      g = new TextGeometry(String(p.text || ' '), { font, size: p.size, depth: p.depth, curveSegments: 8, bevelEnabled: p.bevel > 0, bevelThickness: p.bevel, bevelSize: p.bevel * 0.8, bevelSegments: 3 });
      g.computeBoundingBox();
      const bb = g.boundingBox;
      g.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, -(bb.max.z + bb.min.z) / 2);
      break;
    }
    default: throw new Error(`Unknown primitive "${shape}"`);
  }
  g.computeBoundingBox();
  return g;
}
