// Geometry operations: booleans, deformers, generators (lathe / extrude / loft / tube / custom).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

/** Bakes a mesh (or every mesh under an object) into one world-space geometry with position/normal/uv. */
export function worldGeometry(object, relativeTo = null) {
  const geos = [];
  object.updateWorldMatrix(true, true);
  const inv = relativeTo ? relativeTo.matrixWorld.clone().invert() : new THREE.Matrix4();
  object.traverse((o) => {
    if (!o.isMesh || o.userData.helper || !o.visible) return;
    let g = o.geometry.clone();
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.morphAttributes = {};
    g.clearGroups();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    geos.push(g);
  });
  if (!geos.length) throw new Error('Object has no mesh geometry');
  return geos.length === 1 ? geos[0] : mergeGeometries(geos);
}

const OPS = { union: ADDITION, add: ADDITION, subtract: SUBTRACTION, difference: SUBTRACTION, intersect: INTERSECTION, intersection: INTERSECTION };

/** CSG boolean between two objects; returns world-space geometry. */
export function booleanGeometry(a, b, op = 'subtract') {
  const mode = OPS[op];
  if (mode === undefined) throw new Error(`Unknown boolean op "${op}" (union | subtract | intersect)`);
  const ga = worldGeometry(a), gb = worldGeometry(b);
  const ba = new Brush(ga), bb = new Brush(gb);
  ba.updateMatrixWorld(); bb.updateMatrixWorld();
  const ev = new Evaluator();
  ev.attributes = ['position', 'normal', 'uv'];
  ev.useGroups = false;
  const res = ev.evaluate(ba, bb, mode);
  const g = res.geometry;
  g.computeBoundingBox();
  return g;
}

/** Deformers applied in object-local space. */
export function deformGeometry(geoIn, type, opts = {}) {
  let g = geoIn.clone();
  if (g.index) g = g.toNonIndexed();
  const axis = opts.axis || 'y';
  const amount = opts.amount ?? 0.5;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const ai = { x: 0, y: 1, z: 2 }[axis] ?? 1;
  const min = bb.min.getComponent(ai), max = bb.max.getComponent(ai);
  const len = Math.max(1e-6, max - min);
  if (['bend', 'twist', 'taper'].includes(type) && opts.subdivide !== false) {
    const maxEdge = Math.max(len / 40, 0.005);
    g = new TessellateModifier(maxEdge, 6).modify(g);
  }
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.getComponent(ai) - min) / len; // 0..1 along axis
    switch (type) {
      case 'twist': {
        const ang = THREE.MathUtils.degToRad(amount * 360) * (t - 0.5);
        const c = Math.cos(ang), s = Math.sin(ang);
        if (ai === 1) { const x = v.x * c - v.z * s, z = v.x * s + v.z * c; v.x = x; v.z = z; }
        else if (ai === 0) { const y = v.y * c - v.z * s, z = v.y * s + v.z * c; v.y = y; v.z = z; }
        else { const x = v.x * c - v.y * s, y = v.x * s + v.y * c; v.x = x; v.y = y; }
        break;
      }
      case 'taper': {
        const k = 1 + amount * (t - 0.5) * 2;
        for (let a = 0; a < 3; a++) if (a !== ai) v.setComponent(a, v.getComponent(a) * Math.max(0, k));
        break;
      }
      case 'bend': {
        // bend around the axis perpendicular to `axis` and the bend direction (x by default)
        const angle = THREE.MathUtils.degToRad(amount * 180);
        if (Math.abs(angle) < 1e-5) break;
        const r = len / angle;
        const along = v.getComponent(ai) - min;
        const dirAxis = ai === 0 ? 1 : 0;
        const off = v.getComponent(dirAxis);
        const th = (along / len) * angle;
        v.setComponent(ai, min + (r - off) * Math.sin(th));
        v.setComponent(dirAxis, r - (r - off) * Math.cos(th));
        break;
      }
      case 'inflate': {
        const n = g.attributes.normal;
        if (n) { v.x += n.getX(i) * amount * 0.1; v.y += n.getY(i) * amount * 0.1; v.z += n.getZ(i) * amount * 0.1; }
        break;
      }
      case 'noise': {
        const f = opts.frequency ?? 4;
        const d = amount * 0.05 * (Math.sin(v.x * f * 1.7 + v.y * f * 0.3) + Math.sin(v.y * f * 1.3 + v.z * f * 0.7) + Math.sin(v.z * f * 1.1 + v.x * f * 0.5)) / 3;
        const n = g.attributes.normal;
        if (n) { v.x += n.getX(i) * d; v.y += n.getY(i) * d; v.z += n.getZ(i) * d; }
        break;
      }
      case 'scale_axis': v.setComponent(ai, v.getComponent(ai) * (1 + amount)); break;
      default: throw new Error(`Unknown deformer "${type}" (bend | twist | taper | inflate | noise | smooth | subdivide)`);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return finalize(g);
}

/** Laplacian smoothing. */
export function smoothGeometry(geoIn, iterations = 2, factor = 0.5) {
  let g = geoIn.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g = mergeVertices(g, 1e-5);
  const pos = g.attributes.position;
  const idx = g.index.array;
  const nb = Array.from({ length: pos.count }, () => new Set());
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  const tmp = new Float32Array(pos.array.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < pos.count; i++) {
      let x = 0, y = 0, z = 0;
      for (const j of nb[i]) { x += pos.getX(j); y += pos.getY(j); z += pos.getZ(j); }
      const n = nb[i].size || 1;
      tmp[i * 3] = pos.getX(i) + (x / n - pos.getX(i)) * factor;
      tmp[i * 3 + 1] = pos.getY(i) + (y / n - pos.getY(i)) * factor;
      tmp[i * 3 + 2] = pos.getZ(i) + (z / n - pos.getZ(i)) * factor;
    }
    pos.array.set(tmp);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export function subdivideGeometry(geoIn, maxEdge = 0.05) {
  let g = geoIn.clone();
  if (g.index) g = g.toNonIndexed();
  g = new TessellateModifier(maxEdge, 8).modify(g);
  return finalize(g);
}

function finalize(g) {
  g.deleteAttribute('normal');
  const out = toCreasedNormals(g, THREE.MathUtils.degToRad(40));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------- generators
const v2 = (p) => new THREE.Vector2(p[0], p[1]);

export function latheGeometry(points, segments = 64, angleDeg = 360) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('lathe needs >= 2 [radius, height] points');
  const g = new THREE.LatheGeometry(points.map(v2), segments, 0, THREE.MathUtils.degToRad(angleDeg));
  g.computeVertexNormals();
  return g;
}

export function extrudeGeometry(outline, { holes = [], depth = 0.1, bevel = 0, bevelSegments = 3, curveSegments = 12, smoothCurve = false } = {}) {
  if (!Array.isArray(outline) || outline.length < 3) throw new Error('extrude needs an outline with >= 3 [x, y] points');
  const mk = (pts) => (smoothCurve ? new THREE.SplineCurve(pts.map(v2)).getPoints(pts.length * 8) : pts.map(v2));
  const shape = new THREE.Shape(mk(outline));
  for (const h of holes) shape.holes.push(new THREE.Path(mk(h)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments, curveSegments });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/**
 * Loft through cross-sections. Each section: { points: [[x,y],...] (closed loop), position: [x,y,z], rotation?: [rx,ry,rz] deg, scale?: n }
 * All sections must have the same point count. Sections are placed in their own XY plane, then transformed.
 */
export function loftGeometry(sections, { closed = true, capEnds = true, smooth = true, samples = 4 } = {}) {
  if (!Array.isArray(sections) || sections.length < 2) throw new Error('loft needs >= 2 sections');
  const n = sections[0].points.length;
  if (sections.some((s) => s.points.length !== n)) throw new Error('all loft sections need the same number of points');
  const rings = sections.map((s) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(s.position || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rotation || [0, 0, 0]).map(THREE.MathUtils.degToRad))),
      new THREE.Vector3(s.scale || 1, s.scale || 1, s.scale || 1));
    return s.points.map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(m));
  });
  // optional smooth interpolation between sections (Catmull-Rom per point index)
  let all = rings;
  if (smooth && rings.length > 2) {
    all = [];
    const curves = [];
    for (let k = 0; k < n; k++) curves.push(new THREE.CatmullRomCurve3(rings.map((r) => r[k]), false, 'centripetal'));
    const total = (rings.length - 1) * samples;
    for (let i = 0; i <= total; i++) all.push(curves.map((c) => c.getPoint(i / total)));
  }
  const pos = [], idx = [];
  for (const r of all) for (const p of r) pos.push(p.x, p.y, p.z);
  const m = all.length, cols = closed ? n : n - 1;
  for (let i = 0; i < m - 1; i++) for (let k = 0; k < cols; k++) {
    const a = i * n + k, b = i * n + ((k + 1) % n), c = (i + 1) * n + k, d = (i + 1) * n + ((k + 1) % n);
    idx.push(a, c, b, b, c, d);
  }
  if (capEnds && closed) {
    const tri = THREE.ShapeUtils.triangulateShape(sections[0].points.map(v2), []);
    const tri2 = THREE.ShapeUtils.triangulateShape(sections[sections.length - 1].points.map(v2), []);
    for (const [a, b, c] of tri) idx.push(a, b, c);
    const o = (m - 1) * n;
    for (const [a, b, c] of tri2) idx.push(o + a, o + c, o + b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function tubeGeometry(points, { radius = 0.05, segments = 64, radialSegments = 16, closed = false } = {}) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('tube needs >= 2 [x,y,z] points');
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return new THREE.TubeGeometry(curve, segments, radius, radialSegments, closed);
}

/** Raw mesh from vertices [[x,y,z]...] and faces [[i,j,k(,l)]...] (quads are split). */
export function customGeometry(vertices, faces, { smooth = true } = {}) {
  if (!Array.isArray(vertices) || vertices.length < 3) throw new Error('need >= 3 vertices');
  const pos = vertices.flatMap((v) => [v[0], v[1], v[2]]);
  const idx = [];
  for (const f of faces || []) {
    for (let k = 1; k < f.length - 1; k++) idx.push(f[0], f[k], f[k + 1]);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (idx.length) g.setIndex(idx);
  if (!smooth) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}
