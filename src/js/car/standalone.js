// Stand-alone car parts that can be dropped into the scene on their own.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWheel, WHEEL_SCHEMA } from './wheel.js';
import { sweepProfile, airfoil } from './parts.js';
import { carbonTextures } from './textures.js';

const N = (key, label, def, min, max, step, unit) => ({ key, label, type: 'number', default: def, min, max, step, unit, group: 'part' });

export const PART_TYPES = {
  wheel: { label: 'Wheel + tyre', icon: '🛞', schema: WHEEL_SCHEMA.map((s) => ({ ...s, group: 'part' })) },
  wing: {
    label: 'Rear wing', icon: '🪽',
    schema: [N('span', 'Span', 1.6, 0.4, 2.4, 0.01, 'm'), N('chord', 'Chord', 0.28, 0.08, 0.6, 0.005, 'm'), N('thickness', 'Thickness', 0.12, 0.04, 0.25, 0.005),
      N('camber', 'Camber', 0.06, 0, 0.12, 0.005), N('standHeight', 'Stand height', 0.25, 0.02, 0.8, 0.01, 'm'), N('angle', 'Angle of attack', 6, -10, 25, 0.5, '°'),
      { key: 'endplates', label: 'End plates', type: 'bool', default: true, group: 'part' },
      { key: 'finish', label: 'Finish', type: 'select', default: 'carbon', options: ['carbon', 'black', 'paint'], group: 'part' },
      { key: 'color', label: 'Paint colour', type: 'color', default: '#b3121d', group: 'part' }],
  },
};

export function partDefaults(type) {
  const t = PART_TYPES[type];
  if (!t) throw new Error(`Unknown part "${type}". Available: ${Object.keys(PART_TYPES).join(', ')}`);
  return Object.fromEntries(t.schema.map((s) => [s.key, s.default]));
}

/** Returns a Group. */
export function buildPart(type, pIn) {
  const p = { ...partDefaults(type), ...pIn };
  if (type === 'wheel') {
    const g = buildWheel(p);
    return g;
  }
  if (type === 'wing') {
    const g = new THREE.Group();
    const mat = p.finish === 'carbon'
      ? new THREE.MeshPhysicalMaterial({ ...carbonTextures(), roughness: 0.35, metalness: 0.3, clearcoat: 1, name: 'carbon_fibre' })
      : new THREE.MeshPhysicalMaterial({ color: p.finish === 'paint' ? p.color : '#0b0b0c', roughness: 0.2, clearcoat: 1, metalness: p.finish === 'paint' ? 0.5 : 0 });
    const prof = airfoil(p.chord, p.thickness, p.camber).map(([u, v]) => [u + p.chord * 0.4, v]);
    const ang = THREE.MathUtils.degToRad(p.angle);
    const rot = prof.map(([u, v]) => [u * Math.cos(ang) + v * Math.sin(ang), -u * Math.sin(ang) + v * Math.cos(ang)]);
    let area = 0;
    for (let i = 0; i < rot.length; i++) { const [a, b] = rot[i], [c, d] = rot[(i + 1) % rot.length]; area += a * d - c * b; }
    const ccw = area < 0 ? rot.slice().reverse() : rot;
    const frames = [-p.span / 2, p.span / 2].map((z) => ({ o: new THREE.Vector3(0, p.standHeight, z), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) }));
    const wing = new THREE.Mesh(sweepProfile(ccw, frames), mat); wing.name = 'wing_blade';
    g.add(wing);
    const extra = [];
    if (p.endplates) for (const s of [1, -1]) { const b = new THREE.BoxGeometry(p.chord * 1.25, p.chord * 0.5, 0.008); b.translate(0, p.standHeight - p.chord * 0.1, s * (p.span / 2 + 0.004)); extra.push(b); }
    for (const s of [1, -1]) { const b = new THREE.BoxGeometry(p.chord * 0.3, p.standHeight, 0.012); b.translate(-p.chord * 0.05, p.standHeight / 2, s * p.span * 0.22); extra.push(b); }
    const em = new THREE.Mesh(mergeGeometries(extra), mat); em.name = 'wing_supports';
    g.add(em);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
  throw new Error(`Unknown part "${type}"`);
}
