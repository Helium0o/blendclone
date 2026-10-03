// Car accessory parts that are placed on the generated body surface.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sideZAt, topYAt, endXAt } from './body.js';
import { plateTexture, contactShadowTexture } from './textures.js';

/**
 * Sweeps a closed 2D profile ([[u,v],...], CCW) through a list of frames
 * {o: Vector3, u: Vector3, v: Vector3, s?: number} and caps both ends.
 */
export function sweepProfile(profile, frames, capEnds = true) {
  const n = profile.length, m = frames.length;
  const pos = [], idx = [];
  for (const f of frames) {
    const s = f.s ?? 1;
    for (const [pu, pv] of profile) {
      pos.push(f.o.x + (f.u.x * pu + f.v.x * pv) * s, f.o.y + (f.u.y * pu + f.v.y * pv) * s, f.o.z + (f.u.z * pu + f.v.z * pv) * s);
    }
  }
  for (let i = 0; i < m - 1; i++) {
    for (let k = 0; k < n; k++) {
      const a = i * n + k, b = i * n + ((k + 1) % n), c = (i + 1) * n + k, d = (i + 1) * n + ((k + 1) % n);
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  if (capEnds) {
    const tris = THREE.ShapeUtils.triangulateShape(profile.map(([u, v]) => new THREE.Vector2(u, v)), []);
    const base0 = pos.length / 3;
    for (let k = 0; k < n; k++) pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const base1 = pos.length / 3;
    for (let k = 0; k < n; k++) { const o = ((m - 1) * n + k) * 3; pos.push(pos[o], pos[o + 1], pos[o + 2]); }
    for (const [a, b, c] of tris) { idx.push(base0 + a, base0 + c, base0 + b); idx.push(base1 + a, base1 + b, base1 + c); }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const airfoil = (chord, thick, camber = 0.05, n = 18) => {
  // NACA-like 4-digit section; returned CCW, inverted (lift downwards)
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((Math.PI * i) / n)) / 2;
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    const yc = camber * (x < 0.4 ? (2 * 0.4 * x - x * x) / 0.16 : (1 - 0.8 + 2 * 0.4 * x - x * x) / 0.36);
    up.push([-x * chord, (-yc + yt) * chord]);
    lo.push([-x * chord, (-yc - yt) * chord]);
  }
  return [...up, ...lo.reverse().slice(1, -1)];
};

function ensureCCW(profile) {
  let a = 0;
  for (let i = 0; i < profile.length; i++) {
    const [x0, y0] = profile[i], [x1, y1] = profile[(i + 1) % profile.length];
    a += x0 * y1 - x1 * y0;
  }
  return a < 0 ? profile.slice().reverse() : profile;
}

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** Builds all accessory meshes; returns array of {name, mesh}. */
export function buildParts(p, body, mats) {
  const { grid, layout: L } = body;
  const out = [];
  const add = (name, geo, mat, opts = {}) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = opts.cast !== false; mesh.receiveShadow = true;
    out.push(mesh);
    return mesh;
  };
  const sv = (x) => body.stationValues(x);

  // ---- wheel well liners (block the view through the arches)
  {
    const geos = [];
    for (const ax of [L.fa, L.ra]) {
      const s = new THREE.Shape();
      const R = L.archR + 0.01;
      s.moveTo(ax - R, L.gc - 0.02);
      s.lineTo(ax - R, L.wheelY);
      s.absarc(ax, L.wheelY, R, Math.PI, 0, true);
      s.lineTo(ax + R, L.gc - 0.02);
      s.lineTo(ax - R, L.gc - 0.02);
      const depth = L.tireW + 0.09;
      for (const side of [1, -1]) {
        const g = new THREE.ShapeGeometry(s, 24);
        const zz = side * (sv(ax).w - depth);
        g.translate(0, 0, zz);
        geos.push(g);
      }
    }
    add('wheel_wells', mergeGeometries(geos), mats.liner, { cast: false });
  }

  // ---- mirrors
  if (p.mirrors) {
    const xm = Math.min(L.xc - 0.1, L.xc - 0.04);
    const s0 = sv(xm);
    const ym = s0.yb + 0.055;
    const zs = Math.max(sideZAt(grid, xm, s0.yb - 0.02), (s0.wg || 0.7) + 0.02);
    const housing = new THREE.SphereGeometry(1, 32, 20);
    const hp = housing.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      let x = hp.getX(i);
      if (x < 0) x *= 0.22;
      hp.setXYZ(i, x * 0.085, hp.getY(i) * 0.072, hp.getZ(i) * 0.115);
    }
    housing.computeVertexNormals();
    const glass = new THREE.CircleGeometry(1, 32);
    glass.rotateY(-Math.PI / 2);
    glass.scale(1, 0.058, 0.098);
    glass.translate(-0.0195, 0, 0);
    const stalk = new THREE.BoxGeometry(0.07, 0.035, 0.1);
    const hG = [], gG = [], sG = [];
    for (const side of [1, -1]) {
      const cz = side * (zs + 0.095);
      const h = housing.clone(); h.translate(xm, ym, cz); hG.push(h);
      const gg = glass.clone(); gg.translate(xm, ym, cz); gG.push(gg);
      const st = stalk.clone(); st.translate(xm + 0.015, ym - 0.03, side * (zs + 0.03)); sG.push(st);
    }
    add('mirrors', mergeGeometries(hG), p.aeroFinish === 'carbon' && (p.style === 'supercar' || p.style === 'sports') ? mats.aero : mats.paint);
    add('mirror_glass', mergeGeometries(gG), mats.chrome);
    add('mirror_stalks', mergeGeometries(sG), mats.blackPlastic);
  }

  // ---- spoilers
  const xEdge = L.xr + grid.capR.roll + 0.03;
  if (p.spoiler !== 'none' && !L.isPickup) {
    const zMax = sv(xEdge + 0.05).w - 0.12;
    if (p.spoiler === 'wing') {
      const deckX = Math.max(L.xr + 0.18, Math.min(L.xd - 0.05, L.xr + 0.35));
      const yDeck = topYAt(grid, deckX, 0);
      const yW = yDeck + p.wingHeight;
      const chord = 0.26;
      const prof = ensureCCW(airfoil(chord, 0.12, 0.06).map(([u, v]) => [u + chord * 0.35, v]));
      const frames = [];
      const span = zMax * 1.02;
      for (let i = 0; i <= 2; i++) {
        const z = -span + (2 * span * i) / 2;
        frames.push({ o: new THREE.Vector3(deckX, yW, z), u: X, v: Y });
      }
      add('wing', sweepProfile(prof, frames), mats.aero);
      // end plates
      const plates = [];
      for (const side of [1, -1]) {
        const b = new THREE.BoxGeometry(0.34, 0.13, 0.008);
        b.translate(deckX - 0.02, yW - 0.03, side * (span + 0.004));
        plates.push(b);
      }
      add('wing_endplates', mergeGeometries(plates), mats.aero);
      // swan-neck stands
      const stands = [];
      for (const side of [1, -1]) {
        const sp = ensureCCW([[-0.05, 0], [0.05, 0], [0.04, 1], [-0.03, 1]]);
        const z = side * span * 0.45;
        const fr = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          fr.push({ o: new THREE.Vector3(deckX - 0.02 + Math.sin(t * Math.PI) * 0.03, yDeck - 0.01 + (yW - yDeck - 0.005) * t, z), u: X, v: Z, s: 1 });
        }
        const pr = ensureCCW([[-0.045, -0.006], [0.045, -0.006], [0.045, 0.006], [-0.045, 0.006]]);
        stands.push(sweepProfile(pr, fr));
        void sp;
      }
      add('wing_stands', mergeGeometries(stands), mats.aero);
    } else {
      const big = p.spoiler === 'ducktail';
      const len = big ? 0.2 : 0.09, hgt = big ? 0.065 : 0.028;
      const prof = ensureCCW([[0, 0], [len, 0], [len * 0.15, hgt * 0.85], [-0.012, hgt]]);
      const frames = [];
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const z = -zMax + (2 * zMax * i) / n;
        const y = topYAt(grid, xEdge + len * 0.4, z) - 0.004;
        frames.push({ o: new THREE.Vector3(xEdge, y, z), u: X, v: Y });
      }
      add('spoiler', sweepProfile(prof, frames), big ? mats.paint : (p.aeroFinish === 'body' ? mats.paint : mats.aero));
    }
  }

  // ---- front splitter
  if (p.splitter) {
    const pts = [];
    const hw = grid.capF.hw;
    const n = 24;
    const yS = L.noseB + 0.01;
    for (let i = 0; i <= n; i++) {
      const z = -hw * 0.98 + (hw * 1.96 * i) / n;
      pts.push(new THREE.Vector2(endXAt(grid, true, z, yS + 0.02) + 0.045, z));
    }
    const back = L.fa + L.archR + 0.04;
    pts.push(new THREE.Vector2(back, hw * 0.98), new THREE.Vector2(back, -hw * 0.98));
    const s = new THREE.Shape(pts);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 4 });
    // shape is in (x, z) -> rotate so extrusion goes along y
    g.rotateX(Math.PI / 2);
    g.translate(0, yS + 0.006, 0);
    add('splitter', g, mats.aero);
  }

  // ---- side skirts
  if (p.sideSkirts) {
    const x0 = L.fa - L.archR - 0.02, x1 = L.ra + L.archR + 0.02;
    const geos = [];
    for (const side of [1, -1]) {
      const frames = [];
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        const s0 = sv(x);
        const z = sideZAt(grid, x, s0.b0 + 0.06);
        frames.push({ o: new THREE.Vector3(x, s0.b0 - 0.005, side * (z - 0.03)), u: new THREE.Vector3(0, 0, side), v: Y });
      }
      const prof = ensureCCW([[0, 0], [0.075, 0], [0.07, 0.02], [0.0, 0.07]]);
      const g = sweepProfile(side > 0 ? prof : prof.map(([u, v]) => [u, v]).reverse(), frames);
      geos.push(g);
    }
    add('side_skirts', mergeGeometries(geos), mats.aero);
  }

  // ---- diffuser
  if (p.diffuser) {
    const hw = grid.capR.hw * 0.72;
    const x0 = L.xr + 0.04, x1 = L.ra - L.archR * 0.4;
    const y0 = Math.max(L.gc, L.tailB - 0.03);
    const geos = [];
    const plate = new THREE.BoxGeometry(x1 - x0, 0.01, hw * 2);
    plate.rotateZ(-0.12);
    plate.translate((x0 + x1) / 2, y0 + 0.03, 0);
    geos.push(plate);
    for (let k = -2; k <= 2; k++) {
      const fin = new THREE.BoxGeometry(x1 - x0, 0.09, 0.008);
      fin.translate((x0 + x1) / 2, y0 + 0.01, (k * hw) / 2.4);
      geos.push(fin);
    }
    add('diffuser', mergeGeometries(geos), mats.aero);
  }

  // ---- exhaust tips
  if (p.exhaust !== 'none') {
    const hw = grid.capR.hw;
    const zs = {
      single: [-hw * 0.55], dual: [-hw * 0.6, hw * 0.6], dual_split: [-hw * 0.62, -hw * 0.45],
      quad: [-hw * 0.66, -hw * 0.49, hw * 0.49, hw * 0.66], center: [-0.07, 0.07],
    }[p.exhaust] || [];
    const yE = L.tailB + 0.055;
    const tips = [], inner = [];
    for (const z of zs) {
      const xb = endXAt(grid, false, z, yE + 0.05);
      let tip;
      if (p.exhaustShape === 'square') {
        tip = new THREE.BoxGeometry(0.14, 0.07, 0.1);
      } else {
        tip = new THREE.CylinderGeometry(0.042, 0.04, 0.14, 32, 1, true);
        tip.rotateZ(Math.PI / 2);
        if (p.exhaustShape === 'oval') tip.scale(1, 0.75, 1.45);
      }
      tip.translate(xb + 0.03, yE, z);
      tips.push(tip);
      const d = new THREE.CircleGeometry(p.exhaustShape === 'square' ? 0.045 : 0.034, 24);
      d.rotateY(-Math.PI / 2);
      if (p.exhaustShape === 'oval') d.scale(1, 0.75, 1.45);
      d.translate(xb + 0.0, yE, z);
      inner.push(d);
    }
    if (tips.length) {
      const tm = new THREE.Mesh(mergeGeometries(tips.map((g) => g.index ? g.toNonIndexed() : g)), mats.chromeDouble);
      tm.name = 'exhaust'; tm.castShadow = true; out.push(tm);
      add('exhaust_inner', mergeGeometries(inner), mats.soot, { cast: false });
    }
  }

  // ---- license plates
  if (p.plateText && p.plateText.trim()) {
    const ptex = plateTexture(p.plateText.trim());
    const pm = new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.4, metalness: 0.2 });
    const plateGeo = new THREE.BoxGeometry(0.004, 0.11, 0.52);
    // map the texture onto the +x face only
    const uv = plateGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) if (i >= 4) uv.setXY(i, 0.01, 0.01);
    const yF = L.noseB + 0.11;
    const xF = endXAt(grid, true, 0, yF) + 0.004;
    const front = add('plate_front', plateGeo.clone(), pm, { cast: false });
    front.position.set(xF, yF, 0);
    const yR = L.tailB + 0.2;
    const xR = endXAt(grid, false, 0, yR) - 0.004;
    const rear = add('plate_rear', plateGeo.clone(), pm, { cast: false });
    rear.position.set(xR, yR, 0);
    rear.rotation.y = Math.PI;
  }

  // ---- roof rails
  if (p.roofRails) {
    const geos = [];
    const x0 = L.xrr + 0.05, x1 = L.xrf - 0.08;
    for (const side of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const x = x0 + ((x1 - x0) * i) / 12;
        const s0 = sv(x);
        const zr = (s0.wr || 0.6) - 0.09;
        pts.push(new THREE.Vector3(x, topYAt(grid, x, zr) + 0.05, side * zr));
      }
      geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.013, 10, false));
      for (const x of [x0 + 0.03, x1 - 0.03]) {
        const s0 = sv(x);
        const zr = (s0.wr || 0.6) - 0.09;
        const b = new THREE.BoxGeometry(0.07, 0.06, 0.03);
        b.translate(x, topYAt(grid, x, zr) + 0.025, side * zr);
        geos.push(b.toNonIndexed());
      }
    }
    add('roof_rails', mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g)), mats.satinBlack);
  }

  // ---- shark fin antenna
  if (p.sharkFin && L.xrr < L.xrf - 0.3) {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0.17, 0); s.quadraticCurveTo(0.02, 0.02, 0.0, 0.055); s.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 4, curveSegments: 12 });
    g.translate(0, 0, -0.015);
    g.rotateY(Math.PI);
    const x = L.xrr + 0.2;
    g.translate(x + 0.17, topYAt(grid, x, 0) - 0.003, 0);
    add('antenna', g, p.twoTone ? mats.roof : mats.paint);
  }

  // ---- wipers
  if (p.wipers) {
    const geos = [];
    const s0 = sv(L.xc - 0.08);
    const ang = Math.atan2(L.roofEdgeH - L.hoodH, L.xc - L.xrf);
    for (const zc of [0.32, -0.25]) {
      const blade = new THREE.BoxGeometry(0.012, 0.012, 0.6);
      blade.rotateY(0.18);
      blade.rotateZ(ang);
      const x = L.xc - 0.07;
      blade.translate(x, topYAt(grid, x, zc) + 0.012, zc);
      geos.push(blade);
    }
    void s0;
    add('wipers', mergeGeometries(geos), mats.satinBlack);
  }

  // ---- soft contact shadow (helper: not exported)
  {
    const g = new THREE.PlaneGeometry(L.L + 0.7, L.W + 0.6);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.75, color: 0x000000 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set((L.xf + L.xr) / 2, 0.003, 0);
    mesh.name = 'contact_shadow';
    mesh.renderOrder = -1;
    mesh.userData.helper = true;
    out.push(mesh);
  }
  return out;
}

// re-export for the material system
export { airfoil };
