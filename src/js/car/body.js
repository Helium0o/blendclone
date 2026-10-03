// Procedural car body surface.
//
// The body is a single closed, watertight surface built from a stack of rings:
//   rear cap rings  ->  lofted cross-sections along X  ->  front cap rings.
// Each lofted ring is a car cross-section made of named parts (sill, side, shoulder,
// greenhouse, roof...). Cross-sections are evaluated from side-profile curves (roof line,
// sill line, beltline), plan-view width and per-feature sculpting terms (fender flares,
// character crease, power bulge, wheel arches). The ends are closed with superellipse
// "caps" that give a rounded nose/tail in both plan and elevation.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, deg, roundedProfile, superFalloff } from './curves.js';

// cross-section parts (index = part id)
export const PART = { BOTTOM: 0, SILL: 1, SIDE_LO: 2, SIDE_HI: 3, SHOULDER: 4, LEDGE: 5, GLASS_SIDE: 6, ROOF_EDGE: 7, TOP: 8 };
const PART_COUNTS = [5, 5, 10, 10, 7, 3, 10, 6, 12];
export const NH = 1 + PART_COUNTS.reduce((a, b) => a + b, 0); // points in a half section
export const PART_OF = (() => {
  const arr = new Int8Array(NH);
  let j = 1;
  arr[0] = 0;
  PART_COUNTS.forEach((cnt, p) => { for (let k = 0; k < cnt; k++) arr[j++] = p; });
  return arr;
})();
// fraction of each point inside its part (0..1)
export const PART_FRAC = (() => {
  const arr = new Float32Array(NH);
  let j = 1;
  PART_COUNTS.forEach((cnt) => { for (let k = 0; k < cnt; k++) arr[j++] = (k + 1) / cnt; });
  return arr;
})();

/** Derives all key positions from the parameter set. */
export function computeLayout(p) {
  const L = p.length, W = p.width, H = p.height;
  const wb = clamp(p.wheelbase, 1.5, L - 0.7);
  const fo = clamp(p.frontOverhang, 0.3, L - wb - 0.3);
  const ro = L - wb - fo;
  const fa = wb / 2, ra = -wb / 2;
  const xf = fa + fo, xr = ra - ro;
  const rimR = (p.rimDiameter * 0.0254) / 2;
  const tireW = p.tireWidth / 1000;
  const tireR = rimR + tireW * (p.tireAspect / 100);
  const archR = tireR + p.archGap;
  const gc = Math.min(p.groundClearance, tireR * 1.4);

  const noseH = clamp(p.noseHeight, gc + 0.15, H - 0.25);
  const noseB = clamp(p.noseBottom, 0.04, noseH - 0.12);
  const hoodH = clamp(p.hoodHeight, noseH, H - 0.15);
  const deckH = clamp(p.deckHeight, gc + 0.3, H - 0.06);
  const tailH = clamp(p.tailHeight, gc + 0.25, H - 0.06);
  const tailB = clamp(p.tailBottom, 0.04, tailH - 0.15);
  const roofEdgeH = H - clamp(p.roofCurve, 0, 0.3);

  let xc = clamp(fa - p.dashToAxle, ra + 0.15, xf - 0.3);
  let xrf = xc - Math.max(roofEdgeH - hoodH, 0.05) * Math.tan(deg(p.windshieldAngle));
  xrf = Math.max(xrf, xr + 0.5);
  let xrr = Math.max(xrf - p.roofLength, xr + 0.12);
  let xd = xrr - Math.max(roofEdgeH - deckH, 0.02) * Math.tan(deg(p.rearWindowAngle));
  xd = Math.max(xd, xr + 0.03);
  if (xrr - xd < 0.05) xrr = Math.min(xd + 0.05, xrf - 0.05);

  const isPickup = p.style === 'pickup';
  return {
    L, W, H, wb, fo, ro, fa, ra, xf, xr, rimR, tireW, tireR, archR, gc,
    noseH, noseB, hoodH, deckH, tailH, tailB, roofEdgeH, xc, xrf, xrr, xd,
    wheelY: tireR, isPickup,
    bedStart: xr + 0.07, bedEnd: xd - 0.06,
  };
}

/** Profile functions of x (side view + plan view). */
function buildProfiles(p, lay) {
  const { xr, xf, xd, xrr, xrf, xc, H, roofEdgeH, deckH, tailH, hoodH, noseH } = lay;
  const top = [{ x: xr, y: tailH, r: 0 }];
  if (xd - xr > 0.12) {
    top.push({ x: xr + Math.min(0.25, (xd - xr) * 0.4), y: lerp(tailH, deckH, 0.7), r: 0.2 });
    top.push({ x: xd, y: deckH, r: lay.isPickup ? 0.01 : 0.05 });
  }
  top.push({ x: xrr, y: roofEdgeH, r: lay.isPickup ? 0.08 : 0.32 });
  top.push({ x: (xrr + xrf) / 2, y: H, r: (xrf - xrr) * 0.5 });
  top.push({ x: xrf, y: roofEdgeH, r: 0.22 });
  top.push({ x: xc, y: hoodH, r: 0.07 });
  top.push({ x: (xc + xf) / 2, y: (hoodH + noseH) / 2 + p.hoodCurve, r: (xf - xc) * 0.5 });
  top.push({ x: xf, y: noseH, r: 0 });
  const topFn = roundedProfile(top, 18);

  const bot = roundedProfile([
    { x: xr, y: lay.tailB, r: 0 },
    { x: lay.ra - lay.archR * 0.2, y: lay.gc, r: 0.35 },
    { x: lay.fa + lay.archR * 0.2, y: lay.gc, r: 0.35 },
    { x: xf, y: lay.noseB, r: 0 },
  ], 14);

  const halfW = (q) => lay.W / 2
    - p.frontTaper * Math.pow(smoothstep(lay.fa - 0.4, xf, q), 1.6)
    - p.rearTaper * Math.pow(smoothstep(lay.ra + 0.4, xr, q), 1.6);

  const belt = (q) => {
    const t = clamp((xc - q) / Math.max(0.1, xc - xd), 0, 1);
    return p.beltHeight + p.beltRise * t;
  };

  const archTop = (q) => {
    let best = -Infinity;
    for (const ax of [lay.fa, lay.ra]) {
      const d = Math.abs(q - ax);
      if (d < lay.archR) {
        const nE = p.archSquareness;
        best = Math.max(best, lay.wheelY + lay.archR * Math.pow(1 - Math.pow(d / lay.archR, nE), 1 / nE));
      }
    }
    return best;
  };

  return { top: topFn, bot, halfW, belt, archTop };
}

/** Evaluates all scalar section values at station q. */
function stationValues(p, lay, prof, q) {
  const top = prof.top(q);
  const b0 = prof.bot(q);
  const w = prof.halfW(q);
  const ghH = top - p.roofCrown - prof.belt(q);
  const gf = smoothstep(0.0, 0.12, ghH);
  const crown = lerp(p.hoodCrown, p.roofCrown, gf);
  const edgeY = top - crown;
  const inBed = lay.isPickup && q > lay.bedStart && q < lay.bedEnd;
  let yb = Math.min(prof.belt(q), edgeY);
  if (inBed) yb = top;
  let b = Math.max(b0, prof.archTop(q));
  b = Math.min(b, yb - 0.1);
  const rB = Math.min(p.bottomRadius, (yb - b) * 0.2);
  const rS = Math.min(p.shoulderRadius, (yb - b) * 0.25);
  const ySS = yb - rS;
  const yR = inBed ? yb : edgeY;
  return { q, top, b0, b, w, yb, yR, crown, rB, rS, ySS, inBed, gh: Math.max(0, yR - yb) };
}

/** Builds one half cross-section (z >= 0) as arrays of [z, y]. */
function halfSection(p, lay, prof, sv, out) {
  const { q, b, b0, w, yb, yR, rB, rS, ySS, top } = sv;
  const tp = 0.42;
  const span = Math.max(0.05, ySS - b0);
  const flareAt = (y) => {
    let f = 0;
    const yc = lay.wheelY + lay.archR * 0.3, ys = lay.archR * 0.95;
    const vf = Math.exp(-Math.pow((y - yc) / ys, 2));
    f += p.frontFlare * Math.exp(-Math.pow((q - lay.fa) / (lay.archR * 1.3), 2)) * vf;
    f += p.rearFlare * Math.exp(-Math.pow((q - lay.ra) / (lay.archR * 1.45), 2)) * vf;
    return f;
  };
  let yChar = b0 + p.characterHeight * span;
  yChar = clamp(yChar, b + rB + 0.012, ySS - 0.012);
  const zSide = (y) => {
    const t = clamp((y - b0) / span, 0, 1);
    let z = t < tp ? w - p.sideTuck * Math.pow((tp - t) / tp, 2) : w - p.upperLean * Math.pow((t - tp) / (1 - tp), 2);
    z += flareAt(y);
    const dc = Math.abs(y - yChar) / 0.05;
    if (dc < 1) z += p.characterLine * (1 - dc) * (1 - dc);
    return z;
  };

  let k = 0;
  const push = (z, y) => { out[k * 2] = Math.max(0, z); out[k * 2 + 1] = y; k++; };

  // A bottom
  const zB = zSide(b + rB);
  push(0, b);
  for (let i = 1; i <= PART_COUNTS[0]; i++) push(((zB - rB) * i) / PART_COUNTS[0], b);
  // B sill radius
  for (let i = 1; i <= PART_COUNTS[1]; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / PART_COUNTS[1]);
    const zz = zB - rB + rB * Math.cos(a);
    const yy = b + rB + rB * Math.sin(a);
    push(i === PART_COUNTS[1] ? zSide(yy) : zz, yy);
  }
  // C1/C2 sides
  for (let i = 1; i <= PART_COUNTS[2]; i++) { const y = lerp(b + rB, yChar, i / PART_COUNTS[2]); push(zSide(y), y); }
  for (let i = 1; i <= PART_COUNTS[3]; i++) { const y = lerp(yChar, ySS, i / PART_COUNTS[3]); push(zSide(y), y); }
  // D shoulder
  const zS1 = zSide(ySS);
  for (let i = 1; i <= PART_COUNTS[4]; i++) {
    const a = (Math.PI / 2) * (i / PART_COUNTS[4]);
    push(zS1 - rS + rS * Math.cos(a), ySS + rS * Math.sin(a));
  }
  // E ledge
  const wg = clamp(w - p.shoulderInset, 0.05, zS1 - rS - 0.001);
  for (let i = 1; i <= PART_COUNTS[5]; i++) push(lerp(zS1 - rS, wg, i / PART_COUNTS[5]), yb);

  if (sv.inBed) {
    // pickup bed: inner wall down to the floor, floor to the centre
    const floor = Math.max(b + 0.12, top - p.bedDepth);
    const wIn = wg - 0.015, rr = 0.04;
    for (let i = 1; i <= PART_COUNTS[6]; i++) { const t2 = i / PART_COUNTS[6]; push(lerp(wg, wIn, t2), lerp(yb, floor + rr, t2)); }
    for (let i = 1; i <= PART_COUNTS[7]; i++) {
      const a = -(Math.PI / 2) * (i / PART_COUNTS[7]);
      push(wIn - rr + rr * Math.cos(a), floor + rr + rr * Math.sin(a));
    }
    for (let i = 1; i <= PART_COUNTS[8]; i++) push((wIn - rr) * (1 - i / PART_COUNTS[8]), floor);
    sv.wg = wg; sv.wr = wIn; sv.zH0 = wIn - rr; sv.floor = floor;
    return;
  }

  // F greenhouse side
  const gh = Math.max(0, yR - yb);
  const wr = Math.max(0.04, wg - p.tumblehome * gh);
  const rR = Math.min(p.roofRadius, gh * 0.45, wr * 0.4);
  const fy1 = yR - rR;
  for (let i = 1; i <= PART_COUNTS[6]; i++) {
    const t2 = i / PART_COUNTS[6];
    push(lerp(wg, wr, t2) + 0.006 * Math.sin(Math.PI * t2) * smoothstep(0, 0.15, gh), lerp(yb, fy1, t2));
  }
  // G roof edge (quadratic bezier continuing the greenhouse direction)
  const dz = wr - wg, dy = fy1 - yb, dl = Math.hypot(dz, dy) || 1;
  const cz = wr + (dz / dl) * rR, cy = fy1 + (dy / dl) * rR;
  const ez = cz - rR, ey = yR;
  for (let i = 1; i <= PART_COUNTS[7]; i++) {
    const t2 = i / PART_COUNTS[7], it = 1 - t2;
    push(it * it * wr + 2 * it * t2 * cz + t2 * t2 * ez, it * it * fy1 + 2 * it * t2 * cy + t2 * t2 * ey);
  }
  // H top (roof / hood / deck) with crown and power bulge
  const zH0 = Math.max(0.01, ez);
  const bulgeWin = p.hoodBulge * smoothstep(lay.xf - 0.08, lay.xf - 0.45, q) * smoothstep(lay.xc - 0.02, lay.xc + 0.2, q);
  for (let i = 1; i <= PART_COUNTS[8]; i++) {
    const z = zH0 * (1 - i / PART_COUNTS[8]);
    const u = z / zH0;
    let y = yR + (top - yR) * (1 - u * u);
    if (bulgeWin > 0) y += bulgeWin * Math.exp(-Math.pow(z / 0.32, 4));
    push(z, y);
  }
  sv.wg = wg; sv.wr = wr; sv.zH0 = zH0; sv.rR = rR;
}

/** Build the full body. Returns { geometry, grid, layout, profiles } */
export function buildBody(p) {
  const lay = computeLayout(p);
  const prof = buildProfiles(p, lay);

  // ---- choose loft stations (critical ones are kept exactly, others keep a minimum spacing)
  const cand = [];
  const N = 190;
  for (let i = 0; i <= N; i++) cand.push([lerp(lay.xr, lay.xf, i / N), false]);
  for (const ax of [lay.fa, lay.ra]) {
    const R = lay.archR;
    for (let i = 1; i < 28; i++) cand.push([ax - R * Math.cos((Math.PI * i) / 28), false]);
    for (const q of [ax - R - 0.0015, ax - R + 0.0008, ax + R - 0.0008, ax + R + 0.0015]) cand.push([q, true]);
  }
  for (let i = 1; i <= 14; i++) {
    const t = i / 15;
    cand.push([lay.xf - 0.35 * t * t, false], [lay.xr + 0.35 * t * t, false]);
  }
  for (const q of [lay.xc, lay.xrf, lay.xrr, lay.xd]) cand.push([q, false]);
  if (lay.isPickup) for (const q of [lay.bedStart - 0.0008, lay.bedStart + 0.0008, lay.bedEnd - 0.0008, lay.bedEnd + 0.0008]) cand.push([q, true]);
  cand.push([lay.xr, true], [lay.xf, true]);
  cand.sort((a, b) => a[0] - b[0]);
  const stations = [], crit = [];
  for (const [q, c] of cand) {
    if (q < lay.xr - 1e-9 || q > lay.xf + 1e-9) continue;
    const n = stations.length;
    const gap = n ? q - stations[n - 1] : Infinity;
    const minGap = Math.min(0.006, Math.max(0.0012, 0.02 * Math.min(q - lay.xr, lay.xf - q) + 0.0012));
    if (gap < 1e-5) { if (c) crit[n - 1] = true; continue; }
    if (gap < minGap && !(c && crit[n - 1])) {
      if (c && !crit[n - 1]) { stations[n - 1] = q; crit[n - 1] = true; }
      else if (!c) continue;
      else { stations.push(q); crit.push(c); }
      continue;
    }
    stations.push(q); crit.push(c);
  }

  // ---- evaluate sections
  const secs = stations.map((q) => {
    const sv = stationValues(p, lay, prof, q);
    const pts = new Float64Array(NH * 2);
    halfSection(p, lay, prof, sv, pts);
    return { sv, pts };
  });

  // ---- end caps setback depth per point
  const room = Math.max(0.12, lay.xf - (lay.fa + lay.archR) - 0.03);
  const roomR = Math.max(0.12, (lay.ra - lay.archR) - lay.xr - 0.03);
  const capDepths = (sec, plan, roll, roomLen, n, lean) => {
    const { pts, sv } = sec;
    const yc = (sv.b + sv.top) / 2;
    let hw = 0.05, hh = 0.05;
    for (let j = 0; j < NH; j++) { hw = Math.max(hw, pts[j * 2]); hh = Math.max(hh, Math.abs(pts[j * 2 + 1] - yc)); }
    const maxD = plan + roll + Math.abs(lean) * 0.6;
    const Lb = Math.min(roomLen, Math.max(0.2, maxD * 2.4));
    const scale = Math.min(1, Lb / (1.75 * maxD));
    // smooth superellipsoid-like setback: plan rounding by |z|, edge roll by |y - yc|
    const D = (z, y) => (plan * superFalloff(Math.abs(z) / hw, n) + roll * superFalloff(Math.abs(y - yc) / hh, Math.max(2, n))) * scale;
    const d = new Float64Array(NH);
    for (let j = 0; j < NH; j++) d[j] = D(pts[j * 2], pts[j * 2 + 1]) + lean * (pts[j * 2 + 1] - yc) / (2 * hh);
    return { lean, d, D, Lb, yc, plan: plan * scale, roll: roll * scale, hw, hh };
  };
  const capF = capDepths(secs[secs.length - 1], p.noseRoundness, p.faceRoll, room, p.noseShape, p.noseLean);
  const capR = capDepths(secs[0], p.tailRoundness, p.faceRoll, roomR, p.tailShape, p.tailLean);

  // ---- assemble rings (half) : [kind, q, rho, points(x,y,z)...]
  const rings = [];
  const K = 22;
  const capRing = (sec, cap, rho, front) => {
    const arr = new Float64Array(NH * 3);
    for (let j = 0; j < NH; j++) {
      const z = sec.pts[j * 2] * rho, y = cap.yc + (sec.pts[j * 2 + 1] - cap.yc) * rho;
      const d = cap.D(z, y) + cap.lean * (y - cap.yc) / (2 * cap.hh);
      arr[j * 3] = front ? lay.xf - d : lay.xr + d;
      arr[j * 3 + 1] = y;
      arr[j * 3 + 2] = z;
    }
    return arr;
  };
  // rear cap from centre outwards
  for (let k = K; k >= 1; k--) {
    const rho = 1 - Math.pow(k / K, 1.6);
    rings.push({ kind: 0, q: lay.xr, rho, sv: secs[0].sv, pos: capRing(secs[0], capR, rho, false) });
  }
  for (const sec of secs) {
    const q = sec.sv.q;
    const arr = new Float64Array(NH * 3);
    const tf = clamp((q - (lay.xf - capF.Lb)) / capF.Lb, 0, 1);
    const tr = clamp(((lay.xr + capR.Lb) - q) / capR.Lb, 0, 1);
    for (let j = 0; j < NH; j++) {
      arr[j * 3] = q - capF.d[j] * Math.pow(tf, 1.5) + capR.d[j] * Math.pow(tr, 1.5);
      arr[j * 3 + 1] = sec.pts[j * 2 + 1];
      arr[j * 3 + 2] = sec.pts[j * 2];
    }
    rings.push({ kind: 1, q, rho: 1, sv: sec.sv, pos: arr });
  }
  for (let k = 1; k <= K; k++) {
    const rho = 1 - Math.pow(k / K, 1.6);
    rings.push({ kind: 2, q: lay.xf, rho, sv: secs[secs.length - 1].sv, pos: capRing(secs[secs.length - 1], capF, rho, true) });
  }

  // ---- UV tables from average spacing
  const NR = rings.length;
  const uArr = new Float64Array(NR);
  for (let i = 1; i < NR; i++) {
    let s = 0;
    const a = rings[i - 1].pos, b2 = rings[i].pos;
    for (let j = 0; j < NH; j += 3) s += Math.hypot(b2[j * 3] - a[j * 3], b2[j * 3 + 1] - a[j * 3 + 1], b2[j * 3 + 2] - a[j * 3 + 2]);
    uArr[i] = uArr[i - 1] + s / Math.ceil(NH / 3) + 1e-5;
  }
  const uLen = uArr[NR - 1];
  for (let i = 0; i < NR; i++) uArr[i] /= uLen;
  const vArr = new Float64Array(NH);
  for (let j = 1; j < NH; j++) {
    let s = 0, c = 0;
    for (let i = 0; i < NR; i += 4) {
      if (rings[i].kind !== 1) continue;
      const a = rings[i].pos;
      s += Math.hypot(a[j * 3 + 1] - a[(j - 1) * 3 + 1], a[j * 3 + 2] - a[(j - 1) * 3 + 2]);
      c++;
    }
    vArr[j] = vArr[j - 1] + s / Math.max(1, c) + 1e-5;
  }
  const vLen = vArr[NH - 1];
  for (let j = 0; j < NH; j++) vArr[j] /= vLen;

  // ---- full geometry (mirror half sections)
  const RS = 2 * NH - 2;
  const pos = new Float32Array(NR * RS * 3);
  const uv = new Float32Array(NR * RS * 2);
  for (let i = 0; i < NR; i++) {
    const a = rings[i].pos;
    for (let m = 0; m < RS; m++) {
      const j = m < NH ? m : RS - m;
      const sgn = m < NH ? 1 : -1;
      const o = (i * RS + m) * 3;
      pos[o] = a[j * 3]; pos[o + 1] = a[j * 3 + 1]; pos[o + 2] = a[j * 3 + 2] * sgn;
      uv[(i * RS + m) * 2] = uArr[i];
      uv[(i * RS + m) * 2 + 1] = vArr[j];
    }
  }
  const idx = new Uint32Array((NR - 1) * RS * 6);
  let t = 0;
  for (let i = 0; i < NR - 1; i++) {
    for (let m = 0; m < RS; m++) {
      const a = i * RS + m, b2 = i * RS + ((m + 1) % RS), c = (i + 1) * RS + m, d = (i + 1) * RS + ((m + 1) % RS);
      idx[t++] = a; idx[t++] = c; idx[t++] = b2;
      idx[t++] = b2; idx[t++] = c; idx[t++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  // orientation check: a vertex at the roof centre must face up
  const mid = rings.findIndex((r) => r.kind === 1 && r.q > (lay.xrr + lay.xrf) / 2);
  const nrm = geo.attributes.normal;
  if (mid >= 0 && nrm.getY(mid * RS + (NH - 1)) < 0) {
    for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }
    geo.index.needsUpdate = true;
    geo.computeVertexNormals();
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // half-grid normals for baking
  const nrmHalf = new Float32Array(NR * NH * 3);
  for (let i = 0; i < NR; i++) for (let j = 0; j < NH; j++) {
    const s = (i * RS + j) * 3, d = (i * NH + j) * 3;
    nrmHalf[d] = nrm.array[s]; nrmHalf[d + 1] = nrm.array[s + 1]; nrmHalf[d + 2] = nrm.array[s + 2];
  }
  const posHalf = new Float32Array(NR * NH * 3);
  for (let i = 0; i < NR; i++) posHalf.set(rings[i].pos, i * NH * 3);

  const grid = { NR, NH, partOf: PART_OF, uArr, vArr, uLen, vLen, capF: { plan: capF.plan, roll: capF.roll, hw: capF.hw, hh: capF.hh, yc: capF.yc }, capR: { plan: capR.plan, roll: capR.roll, hw: capR.hw, hh: capR.hh, yc: capR.yc }, pos: posHalf, nrm: nrmHalf, rings: rings.map((r) => ({ kind: r.kind, q: r.q, rho: r.rho, sv: r.sv })) };
  return { geometry: geo, grid, layout: lay, profiles: prof, stationValues: (q) => stationValues(p, lay, prof, q) };
}

// ---------------------------------------------------------------- surface queries (for placing parts)
function loftRingIndex(grid, x) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < grid.NR; i++) {
    if (grid.rings[i].kind !== 1) continue;
    const d = Math.abs(grid.rings[i].q - x);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Outer z of the body side at station x and height y. */
export function sideZAt(grid, x, y) {
  const i = loftRingIndex(grid, x);
  const P = grid.pos;
  let best = 0;
  for (let j = 1; j < grid.NH; j++) {
    const y0 = P[(i * grid.NH + j - 1) * 3 + 1], y1 = P[(i * grid.NH + j) * 3 + 1];
    if ((y - y0) * (y - y1) <= 0 && y1 !== y0) {
      const t = (y - y0) / (y1 - y0);
      const z = lerp(P[(i * grid.NH + j - 1) * 3 + 2], P[(i * grid.NH + j) * 3 + 2], t);
      best = Math.max(best, z);
    }
  }
  return best;
}

/** Height of the upper surface at station x and lateral position z. */
export function topYAt(grid, x, z) {
  const i = loftRingIndex(grid, x);
  const P = grid.pos;
  const az = Math.abs(z);
  let best = -Infinity;
  for (let j = grid.NH - 1; j > 0; j--) {
    const z0 = P[(i * grid.NH + j) * 3 + 2], z1 = P[(i * grid.NH + j - 1) * 3 + 2];
    if ((az - z0) * (az - z1) <= 0 && z1 !== z0) {
      const t = (az - z0) / (z1 - z0);
      best = Math.max(best, lerp(P[(i * grid.NH + j) * 3 + 1], P[(i * grid.NH + j - 1) * 3 + 1], t));
    }
  }
  return best === -Infinity ? P[(i * grid.NH + grid.NH - 1) * 3 + 1] : best;
}

/** X of the front (front=true) or rear face at lateral z / height y. */
export function endXAt(grid, front, z, y) {
  const P = grid.pos;
  const xf = grid.rings[grid.NR - 1].q, xr = grid.rings[0].q;
  const az = Math.abs(z);
  for (let tol = 0.02; tol < 0.5; tol *= 2) {
    let best = front ? -Infinity : Infinity;
    for (let i = 0; i < grid.NR; i++) {
      const q = grid.rings[i].q;
      if (front ? q < xf - 1.2 : q > xr + 1.2) continue;
      for (let j = 0; j < grid.NH; j++) {
        const o = (i * grid.NH + j) * 3;
        if (Math.hypot(P[o + 2] - az, P[o + 1] - y) < tol) best = front ? Math.max(best, P[o]) : Math.min(best, P[o]);
      }
    }
    if (Number.isFinite(best)) return best;
  }
  return front ? xf : xr;
}
