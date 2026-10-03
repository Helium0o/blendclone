// Material library: presets + JSON spec <-> THREE material conversion.
import * as THREE from 'three';
import { carbonTextures, brushedTextures } from './car/textures.js';

export const MATERIAL_PRESETS = {
  car_paint_metallic: { label: 'Metallic paint', color: '#b3121d', metalness: 0.7, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 },
  car_paint_gloss: { label: 'Gloss paint', color: '#f2f2f0', metalness: 0, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03 },
  car_paint_pearl: { label: 'Pearl paint', color: '#e8e6f0', metalness: 0.55, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.7 },
  car_paint_matte: { label: 'Matte paint', color: '#3b4048', metalness: 0.25, roughness: 0.62, clearcoat: 0 },
  candy: { label: 'Candy', color: '#7a0614', metalness: 0.85, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 },
  chrome: { label: 'Chrome', color: '#f4f4f4', metalness: 1, roughness: 0.04 },
  brushed_aluminium: { label: 'Brushed aluminium', color: '#c9ccd0', metalness: 1, roughness: 0.35, pattern: 'brushed' },
  gunmetal: { label: 'Gunmetal', color: '#4b4e54', metalness: 1, roughness: 0.34 },
  gold: { label: 'Gold', color: '#d4a64a', metalness: 1, roughness: 0.22 },
  copper: { label: 'Copper', color: '#b8693f', metalness: 1, roughness: 0.28 },
  carbon_fibre: { label: 'Carbon fibre', color: '#ffffff', metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.02, pattern: 'carbon' },
  rubber: { label: 'Rubber', color: '#161616', metalness: 0, roughness: 0.85 },
  black_plastic: { label: 'Black plastic', color: '#121213', metalness: 0, roughness: 0.55 },
  gloss_black: { label: 'Piano black', color: '#0a0a0b', metalness: 0, roughness: 0.12, clearcoat: 1 },
  glass_clear: { label: 'Clear glass', color: '#ffffff', metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.004, ior: 1.5 },
  glass_tinted: { label: 'Tinted glass', color: '#1c2228', metalness: 0, roughness: 0.02, transmission: 0.6, thickness: 0.004, ior: 1.5, clearcoat: 1 },
  headlight_lens: { label: 'Headlight lens', color: '#f4f8ff', metalness: 0, roughness: 0.0, transmission: 0.95, thickness: 0.01, ior: 1.49 },
  led_white: { label: 'LED white', color: '#ffffff', emissive: '#f4f6ff', emissiveIntensity: 3, roughness: 0.2 },
  tail_light: { label: 'Tail light', color: '#8a0207', emissive: '#ff1a10', emissiveIntensity: 2, roughness: 0.1, clearcoat: 1 },
  amber_light: { label: 'Indicator', color: '#c26a07', emissive: '#ff8a00', emissiveIntensity: 1.5, roughness: 0.1, clearcoat: 1 },
  leather: { label: 'Leather', color: '#4a2a1c', metalness: 0, roughness: 0.55, sheen: 0.4, sheenColor: '#7a5a48' },
  alcantara: { label: 'Alcantara', color: '#232427', metalness: 0, roughness: 0.95, sheen: 1, sheenColor: '#55575c', sheenRoughness: 0.5 },
  ceramic_white: { label: 'Ceramic', color: '#f1f0ec', metalness: 0, roughness: 0.25, clearcoat: 0.6 },
  concrete: { label: 'Concrete', color: '#8c8b88', metalness: 0, roughness: 0.92 },
  neon_blue: { label: 'Neon blue', color: '#0a2a5a', emissive: '#1f7bff', emissiveIntensity: 4, roughness: 0.3 },
  clay: { label: 'Clay (design model)', color: '#b9b4ab', metalness: 0, roughness: 0.6 },
};

const MAT_KEYS = ['color', 'metalness', 'roughness', 'clearcoat', 'clearcoatRoughness', 'transmission', 'thickness', 'ior', 'opacity', 'emissive',
  'emissiveIntensity', 'iridescence', 'sheen', 'sheenColor', 'sheenRoughness', 'flatShading', 'wireframe', 'side', 'pattern', 'preset', 'patternScale'];

export const MATERIAL_SCHEMA = [
  { key: 'preset', label: 'Preset', type: 'select', options: ['custom', ...Object.keys(MATERIAL_PRESETS)], default: 'custom', group: 'material', description: 'Start from a material preset; other fields override.' },
  { key: 'color', label: 'Colour', type: 'color', default: '#cccccc', group: 'material' },
  { key: 'metalness', label: 'Metalness', type: 'number', min: 0, max: 1, step: 0.01, default: 0, group: 'material' },
  { key: 'roughness', label: 'Roughness', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, group: 'material' },
  { key: 'clearcoat', label: 'Clearcoat', type: 'number', min: 0, max: 1, step: 0.01, default: 0, group: 'material' },
  { key: 'transmission', label: 'Transmission', type: 'number', min: 0, max: 1, step: 0.01, default: 0, group: 'material', description: 'Glass-like transparency.' },
  { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01, default: 1, group: 'material' },
  { key: 'emissive', label: 'Emissive', type: 'color', default: '#000000', group: 'material' },
  { key: 'emissiveIntensity', label: 'Glow', type: 'number', min: 0, max: 10, step: 0.1, default: 1, group: 'material' },
  { key: 'iridescence', label: 'Iridescence', type: 'number', min: 0, max: 1, step: 0.01, default: 0, group: 'material' },
  { key: 'sheen', label: 'Sheen', type: 'number', min: 0, max: 1, step: 0.01, default: 0, group: 'material' },
  { key: 'pattern', label: 'Pattern', type: 'select', options: ['none', 'carbon', 'brushed'], default: 'none', group: 'material' },
  { key: 'flatShading', label: 'Flat shading', type: 'bool', default: false, group: 'material' },
  { key: 'wireframe', label: 'Wireframe', type: 'bool', default: false, group: 'material' },
];

/** Normalises a spec: resolves preset, fills defaults. Accepts a preset name string too. */
export function resolveSpec(spec) {
  if (typeof spec === 'string') spec = { preset: spec };
  spec = { ...(spec || {}) };
  const base = spec.preset && MATERIAL_PRESETS[spec.preset] ? MATERIAL_PRESETS[spec.preset] : {};
  const out = { color: '#cccccc', metalness: 0, roughness: 0.5, ...base, ...spec };
  delete out.label;
  for (const k of Object.keys(out)) if (!MAT_KEYS.includes(k)) delete out[k];
  return out;
}

export function createMaterial(spec) {
  const m = new THREE.MeshPhysicalMaterial();
  applyMaterialSpec(m, spec);
  return m;
}

export function applyMaterialSpec(m, specIn) {
  const s = resolveSpec(specIn);
  m.color.set(s.color);
  m.metalness = s.metalness ?? 0;
  m.roughness = s.roughness ?? 0.5;
  m.clearcoat = s.clearcoat ?? 0;
  m.clearcoatRoughness = s.clearcoatRoughness ?? 0.03;
  m.transmission = s.transmission ?? 0;
  m.thickness = s.thickness ?? 0;
  m.ior = s.ior ?? 1.5;
  m.opacity = s.opacity ?? 1;
  m.transparent = m.opacity < 1;
  m.emissive.set(s.emissive || '#000000');
  m.emissiveIntensity = s.emissiveIntensity ?? 1;
  m.iridescence = s.iridescence ?? 0;
  m.sheen = s.sheen ?? 0;
  if (s.sheenColor) m.sheenColor.set(s.sheenColor);
  m.sheenRoughness = s.sheenRoughness ?? 0.5;
  m.flatShading = !!s.flatShading;
  m.wireframe = !!s.wireframe;
  m.side = s.side === 'double' ? THREE.DoubleSide : THREE.FrontSide;
  m.map = null; m.normalMap = null; m.roughnessMap = null;
  if (s.pattern === 'carbon') { const t = carbonTextures(); m.map = t.map; m.normalMap = t.normalMap; }
  if (s.pattern === 'brushed') { const t = brushedTextures(); m.roughnessMap = t.roughnessMap; }
  m.name = s.preset || 'material';
  m.userData.spec = s;
  m.needsUpdate = true;
  return m;
}

/** Best-effort spec from an arbitrary three material (for imported models). */
export function specFromMaterial(m) {
  if (!m) return resolveSpec({});
  if (m.userData?.spec) return { ...m.userData.spec };
  const s = { color: '#' + (m.color ? m.color.getHexString() : 'cccccc') };
  if (m.metalness !== undefined) s.metalness = m.metalness;
  if (m.roughness !== undefined) s.roughness = m.roughness;
  if (m.clearcoat) s.clearcoat = m.clearcoat;
  if (m.transmission) s.transmission = m.transmission;
  if (m.opacity !== undefined && m.opacity < 1) s.opacity = m.opacity;
  if (m.emissive && m.emissive.getHex() !== 0) { s.emissive = '#' + m.emissive.getHexString(); s.emissiveIntensity = m.emissiveIntensity; }
  return s;
}
