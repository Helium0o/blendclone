// Parametric wheel: tyre (real sizing), rim (9 designs), brake disc and caliper.
// Local frame: axle along +Z (outer face at +Z), wheel centre at the origin.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { tyreTextures, discTextures, logoTexture } from './textures.js';

export const RIM_FINISHES = {
  silver: { color: '#c9cbce', metalness: 1, roughness: 0.28 },
  gunmetal: { color: '#4b4e54', metalness: 1, roughness: 0.34 },
  black: { color: '#141516', metalness: 0.4, roughness: 0.38, clearcoat: 0.6 },
  chrome: { color: '#f4f4f4', metalness: 1, roughness: 0.04 },
  gold: { color: '#c9a04a', metalness: 1, roughness: 0.26 },
  bronze: { color: '#8b6a3e', metalness: 1, roughness: 0.3 },
  white: { color: '#ececec', metalness: 0, roughness: 0.3, clearcoat: 1 },
};

const geoCache = new Map();

export function tyreDims(p) {
  const rimR = (p.rimDiameter * 0.0254) / 2;
  const tw = p.tireWidth / 1000;
  const sh = tw * (p.tireAspect / 100);
  return { rimR, tw, sh, outerR: rimR + sh };
}

// ---------------------------------------------------------------- tyre
function tyreGeometry(p) {
  const { rimR, tw, sh, outerR } = tyreDims(p);
  const key = `tyre:${rimR}:${tw}:${sh}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const h = tw / 2;
  const pts = [];
  const side = (sign) => {
    const out = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const r = rimR - 0.004 + (outerR - 0.022 - rimR) * t;
      const bulge = Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.014 + 0.004;
      out.push([r, sign * (h * 0.86 + bulge * (t < 0.15 ? t / 0.15 : 1))]);
    }
    return out;
  };
  const inner = side(-1);
  const outer = side(1).reverse();
  pts.push(...inner);
  // shoulders + tread with 4 circumferential grooves
  const sh1 = 8;
  for (let i = 1; i <= sh1; i++) {
    const a = (Math.PI / 2) * (i / sh1);
    pts.push([outerR - 0.022 + 0.022 * Math.sin(a), -(h * 0.86 + 0.004) + (0.03) * (1 - Math.cos(a))]);
  }
  const grooves = [-0.36, -0.13, 0.13, 0.36].map((g) => g * tw);
  const gw = 0.006, gd = 0.007;
  const tread = [];
  const a0 = -(h * 0.86 + 0.004) + 0.03, a1 = -a0;
  tread.push([outerR, a0]);
  for (const g of grooves) {
    tread.push([outerR, g - gw], [outerR - gd, g - gw * 0.6], [outerR - gd, g + gw * 0.6], [outerR, g + gw]);
  }
  tread.push([outerR, a1]);
  pts.push(...tread);
  for (let i = 0; i < sh1; i++) {
    const a = (Math.PI / 2) * (1 - i / sh1);
    pts.push([outerR - 0.022 + 0.022 * Math.sin(a), (h * 0.86 + 0.004) - 0.03 * (1 - Math.cos(a))]);
  }
  pts.push(...outer);
  const v2 = pts.map(([r, a]) => new THREE.Vector2(r, a));
  const geo = new THREE.LatheGeometry(v2, 96);
  // arc-length based v so the texture bands are predictable
  const lens = [0];
  for (let i = 1; i < v2.length; i++) lens.push(lens[i - 1] + v2[i].distanceTo(v2[i - 1]));
  const total = lens[lens.length - 1];
  const uv = geo.attributes.uv;
  const segs = 97;
  for (let s = 0; s < segs; s++) for (let j = 0; j < v2.length; j++) uv.setY(s * v2.length + j, lens[j] / total);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  const vOf = (idx) => lens[idx] / total;
  const treadStart = inner.length + sh1, treadEnd = treadStart + tread.length - 1;
  const outerStart = treadEnd + sh1 + 1;
  const bands = {
    treadA: vOf(treadStart), treadB: vOf(treadEnd),
    wallA: vOf(outerStart + Math.floor(outer.length * 0.2)), wallB: vOf(outerStart + Math.floor(outer.length * 0.62)),
  };
  const res = { geo, bands };
  geoCache.set(key, res);
  return res;
}

// ---------------------------------------------------------------- rim face
function chaikin(pts, iters = 2) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push(new THREE.Vector2(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25));
      q.push(new THREE.Vector2(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75));
    }
    p = q;
  }
  return p;
}

/** Window between two spokes, from radius r0 to r1. widthFn(r) = half spoke width (m). sweep(r) = angular twist. */
function spokeWindow(theta0, theta1, r0, r1, widthFn, sweep = () => 0, steps = 10) {
  const pts = [];
  // leading edge of spoke k (theta0) outward
  for (let i = 0; i <= steps; i++) {
    const r = r0 + ((r1 - r0) * i) / steps;
    const a = theta0 + widthFn(r) / r + sweep(r);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  // outer arc
  const aOut0 = theta0 + widthFn(r1) / r1 + sweep(r1), aOut1 = theta1 - widthFn(r1) / r1 + sweep(r1);
  for (let i = 1; i < 8; i++) {
    const a = aOut0 + ((aOut1 - aOut0) * i) / 8;
    pts.push(new THREE.Vector2(Math.cos(a) * r1, Math.sin(a) * r1));
  }
  for (let i = steps; i >= 0; i--) {
    const r = r0 + ((r1 - r0) * i) / steps;
    const a = theta1 - widthFn(r) / r + sweep(r);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const aIn0 = theta1 - widthFn(r0) / r0 + sweep(r0), aIn1 = theta0 + widthFn(r0) / r0 + sweep(r0);
  for (let i = 1; i < 5; i++) {
    const a = aIn0 + ((aIn1 - aIn0) * i) / 5;
    pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0));
  }
  return pts;
}

function rimHoles(style, n, R1, hubR) {
  const holes = [];
  const r0 = hubR * 1.25, r1 = R1 * 0.88;
  const step = (Math.PI * 2) / n;
  const add = (pts) => {
    const sm = chaikin(pts, 2);
    // ensure clockwise for holes
    if (THREE.ShapeUtils.isClockWise(sm) === false) sm.reverse();
    holes.push(new THREE.Path(sm));
  };
  switch (style) {
    case 'multi_spoke': {
      const w = (r) => 0.006 + 0.004 * (1 - r / R1);
      for (let k = 0; k < n; k++) add(spokeWindow(k * step, (k + 1) * step, r0, r1, w));
      break;
    }
    case 'split_spoke': {
      const w = (r) => 0.012 + 0.008 * (1 - r / R1);
      for (let k = 0; k < n; k++) {
        add(spokeWindow(k * step, (k + 1) * step, r0, r1, w));
        // slot splitting each spoke
        const a = k * step;
        const slot = [];
        const rs0 = r0 + (r1 - r0) * 0.28, rs1 = r1 - 0.01;
        for (let i = 0; i <= 6; i++) { const r = rs0 + (rs1 - rs0) * i / 6; const dw = 0.0035 * Math.min(1, i / 2) / r; slot.push(new THREE.Vector2(Math.cos(a + dw) * r, Math.sin(a + dw) * r)); }
        for (let i = 6; i >= 0; i--) { const r = rs0 + (rs1 - rs0) * i / 6; const dw = 0.0035 * Math.min(1, i / 2) / r; slot.push(new THREE.Vector2(Math.cos(a - dw) * r, Math.sin(a - dw) * r)); }
        add(slot);
      }
      break;
    }
    case 'y_spoke': {
      const w = (r) => (r < R1 * 0.55 ? 0.022 : 0.03) + 0.01 * (1 - r / R1);
      for (let k = 0; k < n; k++) {
        add(spokeWindow(k * step, (k + 1) * step, r0, r1, w));
        const a = k * step, rf = R1 * 0.56;
        add([
          new THREE.Vector2(Math.cos(a) * rf, Math.sin(a) * rf),
          new THREE.Vector2(Math.cos(a + 0.11) * (r1 - 0.005), Math.sin(a + 0.11) * (r1 - 0.005)),
          new THREE.Vector2(Math.cos(a - 0.11) * (r1 - 0.005), Math.sin(a - 0.11) * (r1 - 0.005)),
        ].reverse());
      }
      break;
    }
    case 'mesh': {
      const m = n * 2;
      const st = (Math.PI * 2) / m;
      const rm = (r0 + r1) / 2;
      const w = () => 0.006;
      for (let k = 0; k < m; k++) add(spokeWindow(k * st, (k + 1) * st, r0, rm - 0.006, w));
      for (let k = 0; k < m; k++) add(spokeWindow(k * st + st / 2, (k + 1) * st + st / 2, rm + 0.006, r1, w));
      break;
    }
    case 'turbine': {
      const w = (r) => 0.008 + 0.006 * (1 - r / R1);
      const sw = (r) => ((r - r0) / (r1 - r0)) * 0.55;
      for (let k = 0; k < n; k++) add(spokeWindow(k * step, (k + 1) * step, r0, r1, w, sw, 14));
      break;
    }
    case 'aero': {
      for (let k = 0; k < n; k++) {
        const a = k * step;
        const pts = [];
        for (let i = 0; i < 24; i++) {
          const t = (i / 24) * Math.PI * 2;
          const rr = R1 * 0.74 + Math.cos(t) * R1 * 0.09;
          const aa = a + Math.sin(t) * 0.16;
          pts.push(new THREE.Vector2(Math.cos(aa) * rr, Math.sin(aa) * rr));
        }
        add(pts.reverse());
      }
      break;
    }
    case 'steelie': {
      for (let k = 0; k < n; k++) {
        const a = k * step + step / 2;
        const pts = [];
        for (let i = 0; i < 24; i++) {
          const t = (i / 24) * Math.PI * 2;
          pts.push(new THREE.Vector2(Math.cos(a) * R1 * 0.66 + Math.cos(t) * R1 * 0.12, Math.sin(a) * R1 * 0.66 + Math.sin(t) * R1 * 0.12));
        }
        add(pts.reverse());
      }
      break;
    }
    default: { // five_spoke, deep_dish: chunky tapering spokes
      const span = (step * R1 * 0.5);
      const w = (r) => { const t = (r - r0) / (r1 - r0); return Math.min(span * 0.6, 0.019 + 0.012 * t + 0.012 * t * t * t); };
      for (let k = 0; k < n; k++) add(spokeWindow(k * step, (k + 1) * step, r0, r1, w));
    }
  }
  return holes;
}

function rimGeometry(p) {
  const { rimR, tw } = tyreDims(p);
  const style = p.rimStyle;
  const n = style === 'steelie' ? Math.max(4, Math.min(10, p.spokeCount)) : p.spokeCount;
  const key = `rim:${rimR}:${tw}:${style}:${n}:${p.rimDish}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const h = tw / 2;
  const deep = style === 'deep_dish';
  const R1 = deep ? rimR * 0.8 : rimR - 0.012;
  const hubR = rimR * 0.2;
  const faceZ = deep ? h * 0.72 - 0.06 : h * 0.72;
  const thick = 0.026;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R1, 0, Math.PI * 2, false);
  shape.holes = rimHoles(style, n, R1, hubR);
  let face = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.003, bevelSegments: 2, curveSegments: 72,
  });
  face = new TessellateModifier(0.014, 8).modify(face);
  face.translate(0, 0, faceZ - thick);
  // concave dish: push the centre inwards
  const pos = face.attributes.position;
  const dish = style === 'aero' || style === 'steelie' ? p.rimDish * 0.4 : p.rimDish;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.sqrt(x * x + y * y);
    const t = Math.min(1, Math.max(0, (r - hubR) / (R1 - hubR)));
    let dz = dish * (1 - t * t * (3 - 2 * t));
    if (style === 'steelie') dz -= 0.012 * Math.sin(Math.PI * Math.min(1, r / (R1 * 0.5)));
    pos.setZ(i, pos.getZ(i) - dz);
  }
  face.deleteAttribute('normal');
  face = toCreasedNormals(face, 0.6);

  // lip + barrel
  const lipPts = [];
  const zOut = h * 0.74;
  lipPts.push([rimR - 0.03, -h * 0.85]);
  lipPts.push([rimR - 0.012, -h * 0.85]);
  lipPts.push([rimR - 0.012, zOut - 0.03]);
  if (deep) {
    lipPts.push([R1 + 0.003, faceZ - 0.004]);
    lipPts.push([R1 + 0.005, faceZ + 0.006]);
    lipPts.push([rimR - 0.006, zOut - 0.004]);
  } else {
    lipPts.push([rimR - 0.01, zOut - 0.012]);
  }
  lipPts.push([rimR + 0.004, zOut]);
  lipPts.push([rimR + 0.016, zOut - 0.006]);
  lipPts.push([rimR + 0.016, zOut - 0.016]);
  const lip = new THREE.LatheGeometry(lipPts.map(([r, z]) => new THREE.Vector2(r, z)), 96);
  lip.rotateX(Math.PI / 2);
  lip.computeVertexNormals();

  // hub with lug nuts
  const hubGeo = [];
  const hubDisc = new THREE.CylinderGeometry(hubR * 1.02, hubR * 1.1, 0.02, 48);
  hubDisc.rotateX(Math.PI / 2);
  hubDisc.translate(0, 0, faceZ - dish - 0.004);
  hubGeo.push(hubDisc);
  const nuts = style === 'steelie' ? 6 : 5;
  for (let k = 0; k < nuts; k++) {
    const a = (k / nuts) * Math.PI * 2 + Math.PI / 2;
    const nut = new THREE.CylinderGeometry(0.0095, 0.0095, 0.024, 6);
    nut.rotateX(Math.PI / 2);
    nut.translate(Math.cos(a) * hubR * 0.68, Math.sin(a) * hubR * 0.68, faceZ - dish + 0.008);
    hubGeo.push(nut);
  }
  const hub = mergeGeometries(hubGeo.map((g) => g.toNonIndexed()));
  const cap = new THREE.CylinderGeometry(hubR * 0.42, hubR * 0.45, 0.012, 40);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, 0, faceZ - dish + 0.016);
  // map uv for the cap face from x/y
  const cuv = cap.attributes.uv, cpos = cap.attributes.position;
  for (let i = 0; i < cpos.count; i++) cuv.setXY(i, cpos.getX(i) / (hubR * 0.9) + 0.5, cpos.getY(i) / (hubR * 0.9) + 0.5);

  const res = { face, lip, hub, cap, faceZ, R1, hubR };
  geoCache.set(key, res);
  return res;
}

function brakeGeometry(p) {
  const { rimR } = tyreDims(p);
  const key = `brake:${rimR}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const rOut = rimR - 0.045, rIn = rimR * 0.36;
  const disc = new THREE.LatheGeometry([
    new THREE.Vector2(rIn, -0.014), new THREE.Vector2(rOut, -0.014), new THREE.Vector2(rOut, 0.014), new THREE.Vector2(rIn, 0.014), new THREE.Vector2(rIn, -0.014),
  ], 72);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, 0, -0.01);
  const hat = new THREE.CylinderGeometry(rIn * 1.05, rIn * 1.05, 0.05, 48);
  hat.rotateX(Math.PI / 2);
  hat.translate(0, 0, 0.0);
  // caliper: annular sector extruded
  const cs = new THREE.Shape();
  const a0 = -0.55, a1 = 0.55, ri = rOut - 0.07, ro = rOut + 0.014;
  cs.absarc(0, 0, ro, a0, a1, false);
  cs.absarc(0, 0, ri, a1, a0, true);
  const caliper = new THREE.ExtrudeGeometry(cs, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 24 });
  caliper.translate(0, 0, -0.045);
  const res = { disc, hat, caliper, rOut };
  geoCache.set(key, res);
  return res;
}

// ---------------------------------------------------------------- materials
export function rimMaterial(p, paintMaterial) {
  if (p.rimFinish === 'body' && paintMaterial) return paintMaterial;
  const f = RIM_FINISHES[p.rimFinish] || RIM_FINISHES.silver;
  return new THREE.MeshPhysicalMaterial({ color: f.color, metalness: f.metalness, roughness: f.roughness, clearcoat: f.clearcoat || 0, clearcoatRoughness: 0.05 });
}

/**
 * Builds a wheel group. `mats` lets the car share materials across its 4 wheels.
 * caliperAngle: rotation of the caliper around the axle (radians), so it can sit behind the axle.
 */
export function buildWheel(p, mats = {}, caliperAngle = 2.6) {
  const g = new THREE.Group();
  g.name = 'wheel';
  const tyre = tyreGeometry(p);
  const tTex = tyreTextures(tyre.bands, `CARFORGE  SPORT  ${p.tireWidth}/${p.tireAspect} R${p.rimDiameter}  ·  CARFORGE  SPORT`);
  const tyreMat = mats.tyre || new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: tTex.map, normalMap: tTex.normalMap, roughness: 0.82, metalness: 0, sheen: 0.3, sheenRoughness: 0.8, sheenColor: 0x222222 });
  const tyreMesh = new THREE.Mesh(tyre.geo, tyreMat);
  tyreMesh.name = 'tyre';
  g.add(tyreMesh);

  const rim = rimGeometry(p);
  const rMat = mats.rim || rimMaterial(p, mats.paint);
  const barrelMat = mats.barrel || new THREE.MeshStandardMaterial({ color: 0x3a3b3e, metalness: 0.9, roughness: 0.45, side: THREE.DoubleSide });
  const face = new THREE.Mesh(rim.face, rMat); face.name = 'rim';
  const lip = new THREE.Mesh(rim.lip, p.rimStyle === 'deep_dish' ? (mats.lip || new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, metalness: 1, roughness: 0.05 })) : rMat); lip.name = 'rim_lip';
  const barrel = new THREE.Mesh(rim.lip, barrelMat); barrel.name = 'rim_barrel'; barrel.scale.set(0.995, 0.995, 1);
  const hub = new THREE.Mesh(rim.hub, mats.hub || new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 1, roughness: 0.3 })); hub.name = 'hub';
  const cap = new THREE.Mesh(rim.cap, mats.cap || new THREE.MeshStandardMaterial({ map: logoTexture(), metalness: 0.6, roughness: 0.3 })); cap.name = 'center_cap';
  g.add(face, lip, barrel, hub, cap);

  const br = brakeGeometry(p);
  const dTex = discTextures();
  const disc = new THREE.Mesh(br.disc, mats.disc || new THREE.MeshStandardMaterial({ map: dTex.map, metalness: 0.85, roughness: 0.38 })); disc.name = 'brake_disc';
  const hat = new THREE.Mesh(br.hat, mats.hat || new THREE.MeshStandardMaterial({ color: 0x2a2b2d, metalness: 0.7, roughness: 0.5 })); hat.name = 'hub_hat';
  const caliperMat = mats.caliper || new THREE.MeshPhysicalMaterial({ color: p.caliperColor, metalness: 0.1, roughness: 0.32, clearcoat: 1 });
  const caliper = new THREE.Mesh(br.caliper, caliperMat); caliper.name = 'caliper';
  caliper.rotation.z = caliperAngle;
  g.add(disc, hat, caliper);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.materials = { tyre: tyreMat, rim: rMat, caliper: caliperMat, barrel: barrelMat };
  return g;
}

// standalone wheel part schema (for the Parts library)
export const WHEEL_SCHEMA = [
  { key: 'rimDiameter', label: 'Rim diameter', type: 'number', default: 19, min: 13, max: 24, step: 1, unit: 'in', group: 'wheel' },
  { key: 'tireWidth', label: 'Tyre width', type: 'number', default: 245, min: 145, max: 355, step: 5, unit: 'mm', group: 'wheel' },
  { key: 'tireAspect', label: 'Tyre profile', type: 'number', default: 40, min: 25, max: 85, step: 5, unit: '%', group: 'wheel' },
  { key: 'rimStyle', label: 'Rim style', type: 'select', default: 'five_spoke', options: ['five_spoke', 'multi_spoke', 'split_spoke', 'y_spoke', 'mesh', 'turbine', 'aero', 'steelie', 'deep_dish'], group: 'wheel' },
  { key: 'spokeCount', label: 'Spokes', type: 'number', default: 5, min: 3, max: 20, step: 1, group: 'wheel' },
  { key: 'rimFinish', label: 'Rim finish', type: 'select', default: 'silver', options: Object.keys(RIM_FINISHES), group: 'wheel' },
  { key: 'rimDish', label: 'Rim concavity', type: 'number', default: 0.025, min: 0, max: 0.08, step: 0.002, unit: 'm', group: 'wheel' },
  { key: 'caliperColor', label: 'Caliper colour', type: 'color', default: '#c8141e', group: 'wheel' },
];
