// Body detail painter. Pure JS (no three.js) so it can run inside a Web Worker.
//
// For every texel of the body UV layout we reconstruct the 3D surface point, then evaluate
// signed-distance "features" in physical units (metres): glass areas, pillars, panel gaps,
// door handles, headlights, grilles, tail lights, vents, cladding... Each feature is a layer
// with anti-aliased coverage. Layers either write a fixed material (chrome, rubber, lamp lens)
// or a *dynamic* material weight (paint, roof paint, trim, glass) that is resolved later in
// compose(), so recolouring the car never needs a re-bake.
import { clamp, lerp, smoothstep, sdRoundBox, sdCircle, cover, hash2 } from './curves.js';

const P_BOTTOM = 0, P_SILL = 1, P_SIDE_LO = 2, P_SIDE_HI = 3, P_GLASS = 6, P_EDGE = 7, P_TOP = 8;

// fixed materials: albedo (sRGB 0..1), roughness, metalness, clearcoat, emissive
const MAT = {
  UNDER: { a: [0.03, 0.03, 0.03], r: 0.9, m: 0, c: 0 },
  PLASTIC: { a: [0.045, 0.045, 0.048], r: 0.62, m: 0, c: 0 },
  GLOSSBLACK: { a: [0.015, 0.015, 0.017], r: 0.1, m: 0, c: 1 },
  CHROME: { a: [0.94, 0.94, 0.95], r: 0.05, m: 1, c: 0 },
  HOUSING: { a: [0.5, 0.51, 0.53], r: 0.18, m: 1, c: 1 },
  REFLECTOR: { a: [0.93, 0.93, 0.95], r: 0.05, m: 1, c: 1 },
  LENS: { a: [0.02, 0.02, 0.025], r: 0.02, m: 0, c: 1 },
  DRL: { a: [0.96, 0.96, 0.98], r: 0.1, m: 0, c: 1, e: [1, 0.96, 0.9] },
  LAMP: { a: [0.98, 0.98, 1.0], r: 0.05, m: 0, c: 1, e: [0.95, 0.95, 1] },
  TAIL: { a: [0.62, 0.02, 0.03], r: 0.06, m: 0, c: 1, e: [1, 0.03, 0.02] },
  TAILDARK: { a: [0.2, 0.0, 0.01], r: 0.05, m: 0, c: 1 },
  REVERSE: { a: [0.85, 0.85, 0.87], r: 0.05, m: 0, c: 1 },
  AMBER: { a: [0.95, 0.45, 0.05], r: 0.08, m: 0, c: 1 },
  GRILLE: { a: [0.03, 0.03, 0.032], r: 0.35, m: 0.3, c: 0.4 },
  VENT: { a: [0.008, 0.008, 0.008], r: 0.8, m: 0, c: 0 },
  FRIT: { a: [0.01, 0.01, 0.01], r: 0.35, m: 0, c: 0.6 },
};
const DYN_PAINT = 0, DYN_ROOF = 1, DYN_TRIM = 2, DYN_GLASS = 3;

export function bakeBody(grid, lay, p, TW = 2048, TH = 1024) {
  const { NR, NH, uArr, vArr, pos, nrm, rings, partOf } = grid;
  const N = TW * TH;
  const out = {
    TW, TH,
    fixed: new Uint8Array(N * 3), orm: new Uint8Array(N * 3), emis: new Uint8Array(N * 3),
    w: new Uint8Array(N * 4), normal: new Uint8Array(N * 4),
  };
  const height = new Float32Array(N);

  // ---- column/row lookup tables
  const colI = new Int32Array(TW), colT = new Float32Array(TW);
  for (let c = 0, i = 0; c < TW; c++) {
    const u = (c + 0.5) / TW;
    while (i < NR - 2 && uArr[i + 1] < u) i++;
    colI[c] = i; colT[c] = clamp((u - uArr[i]) / (uArr[i + 1] - uArr[i]), 0, 1);
  }
  const rowJ = new Int32Array(TH), rowT = new Float32Array(TH);
  for (let r = 0, j = 0; r < TH; r++) {
    const v = (r + 0.5) / TH;
    while (j < NH - 2 && vArr[j + 1] < v) j++;
    rowJ[r] = j; rowT[r] = clamp((v - vArr[j]) / (vArr[j + 1] - vArr[j]), 0, 1);
  }

  const su = grid.uLen / TW, sv_ = grid.vLen / TH;
  const aa = 1.25 * Math.max(su, sv_);

  // ---- layout constants for features
  const { xf, xr, fa, ra, archR, wheelY, xc, xrf, xrr, xd, noseH, noseB, tailH, tailB, deckH, hoodH, roofEdgeH } = lay;
  const capF = grid.capF, capR = grid.capR;
  const hwF = capF.hw, hwR = capR.hw;
  const doors4 = p.doors === '4';
  const xDF = Math.min(xc - 0.04, fa - archR - 0.06);
  const cP = p.cPillar;
  const xBot = Math.min(Math.max(xd + cP, xr + capR.plan + cP * 0.6), xDF - 0.9);
  const xTop = Math.min(xrr + 0.06 + cP * 0.2, xrf - 0.25);
  const xDR = doors4 ? xBot : Math.max(xBot, xDF - 1.2);
  const xB = lerp(xDF, xDR, 0.5);
  const quarterDivider = !doors4 && xDR > xBot + 0.15;
  // rear edge line (xBot, yBelt) -> (xTop, yRoof) as normalised implicit line
  const lineBeltY = p.beltHeight + p.beltRise, lineRoofY = roofEdgeH;
  const lnx = lineRoofY - lineBeltY, lny = -(xTop - xBot);
  const lnl = Math.sqrt(lnx * lnx + lny * lny);
  const rearEdgeD = (x, y) => -((x - xBot) * lnx + (y - lineBeltY) * lny) / lnl; // >0 behind edge

  const hasGreenhouse = (sv) => sv.gh > 0.025;

  const hl = {
    W: p.headlightWidth, H: p.headlightHeight,
    zOuter: hwF - 0.035 + (p.headlightWrap > 0.05 ? 0.12 : 0),
    yc: noseH - p.headlightDrop,
    xLim: xf - capF.plan - p.headlightWrap,
  };
  hl.zInner = hl.zOuter - hl.W - (p.headlightWrap > 0.05 ? 0.12 : 0) * 0.5;
  hl.zc = (hl.zOuter + hl.zInner) / 2;
  const tl = {
    W: p.taillightWidth, H: p.taillightHeight,
    zOuter: hwR - 0.03 + 0.1,
    yc: tailH - p.taillightDrop,
    xLim: xr + capR.plan + 0.14,
  };
  tl.zInner = tl.zOuter - tl.W - 0.05;
  tl.zc = (tl.zOuter + tl.zInner) / 2;
  const gr = { W: p.grilleWidth, H: p.grilleHeight, yc: noseH - p.grilleDrop };

  // ---- accumulator (module-local for speed)
  const S = new Float64Array(16);
  const fixedLayer = (alpha, m) => {
    if (alpha <= 0.0001) return;
    if (alpha > 1) alpha = 1;
    const keep = 1 - alpha;
    const wF = 1 - (S[10] + S[11] + S[12] + S[13]);
    const wFn = wF * keep + alpha;
    const k = alpha / wFn;
    S[0] += (m.a[0] - S[0]) * k; S[1] += (m.a[1] - S[1]) * k; S[2] += (m.a[2] - S[2]) * k;
    S[3] += (m.r - S[3]) * k; S[4] += (m.m - S[4]) * k; S[5] += (m.c - S[5]) * k;
    S[10] *= keep; S[11] *= keep; S[12] *= keep; S[13] *= keep;
    S[6] *= keep; S[7] *= keep; S[8] *= keep;
    if (m.e) { S[6] += m.e[0] * alpha; S[7] += m.e[1] * alpha; S[8] += m.e[2] * alpha; }
  };
  const dynLayer = (alpha, id) => {
    if (alpha <= 0.0001) return;
    if (alpha > 1) alpha = 1;
    const keep = 1 - alpha;
    S[10] *= keep; S[11] *= keep; S[12] *= keep; S[13] *= keep;
    S[6] *= keep; S[7] *= keep; S[8] *= keep;
    if (id === 0) S[10] += alpha; else if (id === 1) S[11] += alpha; else if (id === 2) S[12] += alpha; else S[13] += alpha;
  };
  const groove = (d, depth = 0.0028, half = 0.0016) => {
    const a = cover(Math.abs(d) - half, aa);
    if (a > 0) S[9] -= depth * a;
  };
  const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k)) - 0.5 * k;

  // ---- shapes in front/rear view
  const headlightSD = (z, y) => {
    const t = clamp((z - hl.zInner) / Math.max(0.01, hl.zOuter - hl.zInner), 0, 1);
    switch (p.headlightStyle) {
      case 'round': {
        const r = hl.H / 2;
        const c1 = hl.zOuter - r - 0.06 - (p.headlightWrap > 0.05 ? 0.12 : 0);
        let d = sdCircle(z, y, c1, hl.yc, r);
        if (hl.W > hl.H * 2.1) d = Math.min(d, sdCircle(z, y, c1 - r * 2.3, hl.yc, r * 0.82));
        return d;
      }
      case 'rect': return sdRoundBox(z, y, hl.zc, hl.yc, (hl.zOuter - hl.zInner) / 2, hl.H / 2, 0.015);
      case 'slim': return sdRoundBox(z, y - (z - hl.zc) * 0.08, hl.zc, hl.yc, (hl.zOuter - hl.zInner) / 2, hl.H * 0.28, hl.H * 0.12);
      case 'split': return Math.min(
        sdRoundBox(z, y, hl.zc, hl.yc + hl.H * 0.55, (hl.zOuter - hl.zInner) / 2, hl.H * 0.16, hl.H * 0.08),
        sdRoundBox(z, y, hl.zc - hl.W * 0.08, hl.yc - hl.H * 0.55, (hl.zOuter - hl.zInner) * 0.34, hl.H * 0.38, 0.02));
      case 'projector': return sdRoundBox(z, y, hl.zc, hl.yc, (hl.zOuter - hl.zInner) / 2, hl.H / 2, hl.H * 0.3);
      default: { // sleek: tapered towards the grille, swept upwards outboard
        const yy = hl.yc + (y - hl.yc) / lerp(0.45, 1.0, t) - (z - hl.zc) * 0.16;
        return sdRoundBox(z, yy, hl.zc, hl.yc, (hl.zOuter - hl.zInner) / 2, hl.H / 2, Math.min(hl.H / 2, 0.035));
      }
    }
  };
  const taillightSD = (z, y) => {
    const t = clamp((z - tl.zInner) / Math.max(0.01, tl.zOuter - tl.zInner), 0, 1);
    switch (p.taillightStyle) {
      case 'bar': return Math.min(
        sdRoundBox(z, y, 0, tl.yc + tl.H * 0.2, hwR + 0.2, tl.H * 0.18, tl.H * 0.1),
        sdRoundBox(z, y, tl.zc, tl.yc, (tl.zOuter - tl.zInner) / 2, tl.H / 2, 0.02));
      case 'round': {
        const r = tl.H * 0.55;
        return Math.min(sdCircle(z, y, hwR - r - 0.06, tl.yc, r), sdCircle(z, y, hwR - r * 3.4 - 0.06, tl.yc, r));
      }
      case 'lshape': return Math.min(
        sdRoundBox(z, y, tl.zc, tl.yc, (tl.zOuter - tl.zInner) / 2, tl.H * 0.3, 0.012),
        sdRoundBox(z, y, hwR - 0.07, tl.yc - tl.H * 0.9, 0.09, tl.H * 1.1, 0.02));
      case 'slim': return sdRoundBox(z, y, hwR - tl.W / 2 + 0.04, tl.yc, tl.W / 2 + 0.04, tl.H / 2, Math.min(tl.W / 2, 0.03));
      default: {
        const yy = tl.yc + (y - tl.yc) / lerp(0.5, 1.0, t);
        return sdRoundBox(z, yy, tl.zc, tl.yc, (tl.zOuter - tl.zInner) / 2, tl.H / 2, Math.min(tl.H / 2, 0.025));
      }
    }
  };
  const grilleSD = (z, y) => {
    const W = gr.W / 2, Hh2 = gr.H / 2;
    switch (p.grilleStyle) {
      case 'none': return 1;
      case 'kidney': return sdRoundBox(Math.abs(z), y, W / 2 + 0.012, gr.yc, W / 2 - 0.012, Hh2, Math.min(W / 2, Hh2) * 0.6);
      case 'shield': {
        const box = sdRoundBox(z, y, 0, gr.yc, W, Hh2, 0.03);
        const ch = (Math.abs(z) - W * 0.55) * 0.7 + (gr.yc - Hh2 * 0.2 - y) - Hh2 * 0.6;
        return Math.max(box, ch * 0.7);
      }
      case 'slot': return sdRoundBox(z, y, 0, gr.yc, W, Math.max(0.012, Hh2 * 0.3), Math.max(0.01, Hh2 * 0.25));
      default: {
        const widen = 1 + 0.16 * clamp((gr.yc - y) / Hh2, -1, 1);
        return sdRoundBox(z / widen, y, 0, gr.yc, W, Hh2, Math.min(0.04, Hh2 * 0.6));
      }
    }
  };
  const grillePattern = (z, y) => {
    switch (p.grilleStyle) {
      case 'bars': { const f = ((y - gr.yc) / 0.05) - Math.floor((y - gr.yc) / 0.05); return f < 0.38 ? 1 : 0; }
      case 'kidney': { const f = (z / 0.028) - Math.floor(z / 0.028); return f < 0.3 ? 1 : 0; }
      case 'mesh': { const k = 95; return Math.abs(Math.sin(k * (z + y)) * Math.sin(k * (z - y))) > 0.35 ? 0 : 1; }
      case 'slot': return 0;
      default: { // honeycomb
        const k = 70;
        const f = Math.cos(k * z) + Math.cos(k * (0.5 * z + 0.866 * y)) + Math.cos(k * (0.5 * z - 0.866 * y));
        return f < -0.6 ? 0 : 1;
      }
    }
  };
  const archN = p.archSquareness;
  const archDist = (x, y) => {
    const ax = Math.abs(x - fa) < Math.abs(x - ra) ? fa : ra;
    const dx = Math.abs(x - ax) / archR, dy = Math.max(0, y - wheelY) / archR;
    const k = archN === 2 ? Math.sqrt(dx * dx + dy * dy) : Math.pow(Math.pow(dx, archN) + Math.pow(dy, archN), 1 / archN);
    return (k - 1) * archR;
  };
  const grilleTrim = p.grilleStyle === 'kidney' || p.grilleStyle === 'shield' || p.grilleStyle === 'bars';
  const sportyIntake = p.style === 'sports' || p.style === 'supercar' || p.style === 'coupe';
  const handles = p.doorHandles === 'hidden' ? [] : doors4 ? [xB + 0.17, xDR + 0.17] : [xDR + 0.2];

  const shade = (x, y, z, nx, ny, nz, part, kind, svv, loft) => {
  // paint base
  S[0] = S[1] = S[2] = 0; S[3] = 0.5; S[4] = 0; S[5] = 0; S[6] = S[7] = S[8] = 0; S[9] = 0;
  S[10] = 1; S[11] = 0; S[12] = 0; S[13] = 0;

  // ---------- underbody & arch tunnels
  if (loft && part === P_BOTTOM) fixedLayer(1, MAT.UNDER);
  else if (ny < -0.55 && y < svv.b0 + 0.08) fixedLayer(cover(-(-ny - 0.65), 0.1), MAT.UNDER);
  if (!loft && y < (kind === 2 ? noseB : tailB) + 0.03 && ny < 0.2) fixedLayer(cover(y - ((kind === 2 ? noseB : tailB) + 0.03), aa), MAT.PLASTIC);

  // ---------- cladding (SUV)
  if (p.cladding && Math.abs(nz) > 0.25) {
    const da = archDist(x, y);
    let a = cover(da - 0.075, aa) * cover(-da - 0.005, aa) * (y > svv.b0 ? 1 : 0);
    a = Math.max(a, cover(y - (svv.b0 + 0.14), aa) * (x > ra - archR - 0.4 && x < fa + archR + 0.4 ? 1 : 0));
    fixedLayer(a, MAT.PLASTIC);
  }
  if (p.cladding && !loft && y < (kind === 2 ? noseB + 0.13 : tailB + 0.12)) fixedLayer(1, MAT.PLASTIC);

  // ---------- greenhouse colouring (two-tone roof, black pillars)
  if (loft && hasGreenhouse(svv) && (part >= P_GLASS)) {
    if (p.twoTone) dynLayer(cover((svv.yb + 0.012) - y, aa), DYN_ROOF);
    if (p.blackPillars && part <= P_EDGE && x < xc + 0.03 && x > xr + 0.05) fixedLayer(cover((svv.yb + 0.012) - y, aa), MAT.GLOSSBLACK);
  }

  // ---------- glass: windshield / rear / side DLO / roof
  if (loft && part >= P_GLASS - 1) {
    const slope = Math.max(0.08, Math.sqrt(Math.max(0, 1 - ny * ny)));
    const zRel = z - svv.zH0;
    // windshield
    if (x < xc + 0.15 && x > xrf - 0.25 && part >= P_EDGE) {
      const yLo = hoodH + 0.025, yHi = roofEdgeH - 0.045;
      const d = Math.max((yLo - y) / slope, (y - yHi) / slope, zRel + 0.014);
      const a = cover(d, aa);
      dynLayer(a, DYN_GLASS);
      if (a > 0) fixedLayer(cover(-d - 0.035, aa) < 1 ? a * (1 - cover(-d - 0.035, aa)) : 0, MAT.FRIT);
      // cowl panel below the windshield
      if (y < yLo && y > hoodH - 0.03 && x > xc - 0.1) fixedLayer(cover(zRel + 0.01, aa) * cover((hoodH - 0.012 - y) / slope, aa * 2) , MAT.PLASTIC);
    }
    // rear window
    const rearLo = lay.isPickup ? p.beltHeight + 0.06 : Math.max(deckH, tailH) + 0.035;
    if (x < xrr + 0.2 && x > xr && part >= P_EDGE && (!lay.isPickup || x > xd - 0.15)) {
      const yHi = roofEdgeH - (lay.isPickup ? 0.08 : 0.05);
      const d = Math.max((rearLo - y) / slope, (y - yHi) / slope, zRel + (lay.isPickup ? 0.12 : 0.016));
      const a = cover(d, aa);
      dynLayer(a, DYN_GLASS);
      if (a > 0) fixedLayer(a * (1 - cover(-d - 0.03, aa)), MAT.FRIT);
    }
    // roof glass
    if (p.sunroof !== 'none' && part === P_TOP && x < xrf && x > xrr) {
      const mid = (xrr + xrf) / 2;
      const d = p.sunroof === 'panoramic'
        ? sdRoundBox(x, zRel, mid, -0.5, (xrf - xrr) / 2 - 0.16, 0.5 - 0.13, 0.05)
        : sdRoundBox(x, z, mid + 0.05, 0, 0.36, 0.38, 0.05);
      dynLayer(cover(d, aa), DYN_GLASS);
      groove(d, 0.002);
    }
    // side windows (daylight opening)
    if (part >= P_GLASS - 1 && part <= P_EDGE && hasGreenhouse(svv)) {
      const yTop = svv.yR - (svv.rR || 0) - 0.01;
      const dTop = y - yTop, dBot = (svv.yb + 0.02) - y;
      const dFront = x - (xc - 0.05);
      const dRear = rearEdgeD(x, y);
      let d = smax(smax(dTop, dBot, 0.02), smax(dFront, dRear, 0.04), 0.03);
      const a = cover(d, aa);
      // window surround trim
      dynLayer(cover(d - 0.013, aa) * (1 - a) * (d > -0.02 ? 1 : 0), DYN_TRIM);
      let g = a;
      if (doors4) {
        const dB = Math.abs(x - xB) - p.pillarWidth / 2;
        fixedLayer(a * cover(dB, aa), MAT.GLOSSBLACK);
        g *= 1 - cover(dB + 0.012, aa);
      }
      if (quarterDivider) {
        const dQ = Math.abs(x - (xDR + 0.02)) - 0.012;
        fixedLayer(a * cover(dQ, aa), MAT.GLOSSBLACK);
        g *= 1 - cover(dQ + 0.006, aa);
      }
      dynLayer(g, DYN_GLASS);
    }
  }

  // ---------- side body: panel gaps, handles, vents
  if (loft && part >= P_SILL && part <= 5 && Math.abs(nz) > 0.2) {
    const yTopDoor = svv.yb;
    const yBotDoor = svv.b0 + 0.07;
    if (y > yBotDoor - 0.003 && y < yTopDoor + 0.003) {
      // front door leading edge
      if (Math.abs(x - xDF) < 0.02) groove(x - xDF);
      if (doors4 && Math.abs(x - xB) < 0.02) groove(x - xB);
      if (Math.abs(x - xDR) < 0.02 && archDist(x, y) > 0.015) groove(x - xDR);
    }
    if (x < xDF && x > xDR && Math.abs(y - yBotDoor) < 0.02) groove(y - yBotDoor);
    // bumper seams
    const xfs = fa + archR + 0.07, xrs = ra - archR - 0.07;
    if (Math.abs(x - xfs) < 0.02 && y < noseH - 0.06 && archDist(x, y) > 0.01) groove(x - xfs, 0.002);
    if (Math.abs(x - xrs) < 0.02 && y < tailH - 0.12 && archDist(x, y) > 0.01) groove(x - xrs, 0.002);
    // door handles
    if (p.doorHandles !== 'hidden') {
      const hy = svv.yb - 0.075;
      for (let hi = 0; hi < handles.length; hi++) {
        const hx = handles[hi];
        if (Math.abs(x - hx) > 0.15 || Math.abs(y - hy) > 0.06) continue;
        if (p.doorHandles === 'flush') {
          const d = sdRoundBox(x, y, hx, hy, 0.075, 0.009, 0.009);
          groove(d, 0.0025, 0.0012);
          dynLayer(cover(d, aa) * 0.6, DYN_TRIM);
        } else {
          const pocket = sdRoundBox(x, y, hx, hy - 0.006, 0.06, 0.022, 0.02);
          fixedLayer(cover(pocket, aa) * 0.85, MAT.GLOSSBLACK);
          S[9] -= 0.006 * cover(pocket, aa * 2);
          const d = sdRoundBox(x, y, hx, hy + 0.004, 0.085, 0.014, 0.014);
          const a = cover(d, aa);
          if (a > 0) { S[9] = S[9] * (1 - a) + 0.004 * a; dynLayer(a, p.trimFinish === 'chrome' ? DYN_TRIM : DYN_PAINT); }
          groove(d, 0.0015, 0.001);
        }
      }
    }
    // fender gills
    if (p.sideVents && x < fa - archR + 0.02 && x > fa - archR - 0.4) {
      for (let k = 0; k < 3; k++) {
        const vx = fa - archR - 0.1 - k * 0.075;
        const d = sdRoundBox(x - (y - wheelY) * 0.35, y, vx, wheelY + 0.12, 0.012, 0.09, 0.012);
        fixedLayer(cover(d, aa), MAT.VENT);
        S[9] -= 0.008 * cover(d, aa);
      }
    }
  }
  // hood / deck seams
  if (loft && (part >= 5) && ny > 0.35) {
    if (!hasGreenhouse(svv) && x > xc && x < xf - 0.02) {
      const xh = xc + 0.035;
      if (Math.abs(x - xh) < 0.02) groove(x - xh, 0.0025);
      const zs = (svv.wg || 0.6) + 0.002;
      if (Math.abs(z - zs) < 0.02 && x > xh) groove(z - zs, 0.0025);
    }
    if (!lay.isPickup && !hasGreenhouse(svv) && x < xd && x > xr + 0.02 && xd - xr > 0.2) {
      const xt = xd - 0.035;
      if (Math.abs(x - xt) < 0.02) groove(x - xt, 0.0025);
      const zs = (svv.wg || 0.6) + 0.002;
      if (Math.abs(z - zs) < 0.02 && x < xt) groove(z - zs, 0.0025);
    }
    if (p.hoodVents && x > xc + 0.2 && x < xc + 0.65) {
      for (let k = 0; k < 4; k++) {
        const vx = xc + 0.28 + k * 0.085;
        const d = sdRoundBox(x, Math.abs(z), vx, 0.36, 0.014, 0.12, 0.012);
        fixedLayer(cover(d, aa), MAT.VENT); S[9] -= 0.006 * cover(d, aa);
      }
    }
    if (lay.isPickup && x > lay.bedStart - 0.02 && x < lay.bedEnd + 0.02 && part === P_TOP) {
      // bed floor ribs
      const f = (z / 0.09) - Math.floor(z / 0.09);
      fixedLayer(1, MAT.PLASTIC);
      S[9] += (f < 0.3 ? 0.006 : 0);
    }
  }
  if (lay.isPickup && loft && x > lay.bedStart && x < lay.bedEnd && (part === P_GLASS || part === P_EDGE)) fixedLayer(1, MAT.PLASTIC);

  // ---------- front face
  if (x > xf - capF.plan - Math.max(p.headlightWrap, 0.05) - 0.05 && nx > -0.4) {
    const fz = z, fy = y;
    // headlights
    if (x > hl.xLim - 0.05) {
      const d0 = headlightSD(fz, fy);
      const d = Math.max(d0, hl.xLim - x);
      const a = cover(d, aa);
      if (a > 0) {
        fixedLayer(a, MAT.HOUSING);
        // inner reflectors / projectors
        const nrefl = p.headlightStyle === 'round' ? 0 : Math.max(1, Math.round((hl.zOuter - hl.zInner) / 0.14));
        for (let k = 0; k < nrefl; k++) {
          const cz = lerp(hl.zInner + 0.06, hl.zOuter - 0.08 - (p.headlightWrap > 0.05 ? 0.1 : 0), nrefl === 1 ? 0.5 : k / (nrefl - 1));
          const rr = Math.min(hl.H * 0.32, 0.038);
          const cy = p.headlightStyle === 'split' ? hl.yc - hl.H * 0.55 : hl.yc - hl.H * 0.05;
          const dc = sdCircle(fz, fy, cz, cy, rr);
          fixedLayer(a * cover(dc, aa), MAT.REFLECTOR);
          fixedLayer(a * cover(dc + rr * 0.45, aa), MAT.LENS);
          fixedLayer(a * cover(dc + rr * 0.8, aa), MAT.LAMP);
        }
        if (p.headlightStyle === 'round') {
          const r = hl.H / 2;
          const c1 = hl.zOuter - r - 0.06 - (p.headlightWrap > 0.05 ? 0.12 : 0);
          const dc = sdCircle(fz, fy, c1, hl.yc, r * 0.62);
          fixedLayer(a * cover(dc, aa), MAT.REFLECTOR);
          fixedLayer(a * cover(dc + r * 0.35, aa), MAT.LAMP);
        }
        // DRL light guide hugging the upper edge
        const band = cover(-d0 - 0.004, aa) * (1 - cover(-d0 - 0.014, aa));
        const upper = p.headlightStyle === 'round' ? 1 : smoothstep(hl.yc - hl.H * 0.1, hl.yc + hl.H * 0.2, fy);
        fixedLayer(a * band * upper, MAT.DRL);
        if (p.headlightStyle === 'split') fixedLayer(a * cover(sdRoundBox(fz, fy, hl.zc, hl.yc + hl.H * 0.55, (hl.zOuter - hl.zInner) / 2 - 0.01, hl.H * 0.1, hl.H * 0.05), aa), MAT.DRL);
        // amber indicator at the outer end
        fixedLayer(a * cover(-d0 - 0.005, aa) * smoothstep(hl.zOuter - 0.2, hl.zOuter - 0.12, fz) * (1 - upper) * 0.9, MAT.AMBER);
      }
      groove(d, 0.002, 0.0012);
    }
    if (nx > 0.3) {
      // grille
      if (p.grilleStyle !== 'none') {
        const d = grilleSD(fz, fy);
        const a = cover(d, aa);
        if (a > 0) {
          const pat = grillePattern(fz, fy);
          fixedLayer(a, MAT.VENT);
          if (pat > 0) fixedLayer(a * pat, p.grilleStyle === 'bars' && p.trimFinish === 'chrome' ? MAT.CHROME : MAT.GRILLE);
          S[9] += a * (pat * 0.004 - 0.01);
        }
        if (grilleTrim) dynLayer(cover(d - 0.014, aa) * (1 - a), DYN_TRIM);
        groove(d, 0.002);
      }
      // lower intake
      if (p.lowerIntake) {
        const iy = noseB + 0.085;
        const d = sdRoundBox(fz, fy, 0, iy, hwF * 0.58, 0.055, 0.03);
        const a = cover(d, aa);
        if (a > 0) {
          fixedLayer(a, MAT.VENT);
          const k = 80;
          const f = Math.cos(k * fz) + Math.cos(k * (0.5 * fz + 0.866 * fy)) + Math.cos(k * (0.5 * fz - 0.866 * fy));
          if (f > -0.6) fixedLayer(a, MAT.GRILLE);
          S[9] -= 0.008 * a;
        }
        if (sportyIntake) {
          const ds = sdRoundBox(fz, fy - (fz - hwF) * 0.3, hwF - 0.2, iy + 0.06, 0.13, 0.07, 0.03);
          fixedLayer(cover(ds, aa), MAT.VENT); S[9] -= 0.008 * cover(ds, aa);
        }
      }
      if (p.fogLights) {
        const dfog = sdCircle(fz, fy, hwF - 0.24, noseB + 0.13, 0.036);
        fixedLayer(cover(dfog, aa), MAT.REFLECTOR);
        fixedLayer(cover(dfog + 0.012, aa), MAT.LAMP);
      }
      // badge
      const by = p.grilleStyle === 'none' || p.grilleStyle === 'slot' ? noseH - 0.06 : (p.grilleStyle === 'kidney' ? gr.yc + gr.H / 2 + 0.05 : gr.yc);
      const db = sdRoundBox(fz, fy, 0, by, 0.045, 0.026, 0.026);
      fixedLayer(cover(db, aa), MAT.CHROME);
      fixedLayer(cover(db + 0.007, aa), MAT.GLOSSBLACK);
      fixedLayer(cover(sdRoundBox(fz, fy, 0, by, 0.025, 0.004, 0.003), aa), MAT.CHROME);
      S[9] += 0.003 * cover(db, aa);
    }
  }

  // ---------- rear face
  if (x < xr + capR.plan + 0.2 && nx < 0.4) {
    const fz = z, fy = y;
    if (x < tl.xLim + 0.05) {
      const d0 = taillightSD(fz, fy);
      const d = Math.max(d0, x - tl.xLim);
      const a = cover(d, aa);
      if (a > 0) {
        fixedLayer(a, MAT.TAIL);
        // inner graphic: dark smoked bands with lit light-guides
        const band = Math.abs(((fy - tl.yc) / 0.022) % 1);
        fixedLayer(a * (band > 0.55 ? 0.6 : 0) * cover(-d0 - 0.01, aa), MAT.TAILDARK);
        fixedLayer(a * cover(-d0 - 0.004, aa) * (1 - cover(-d0 - 0.012, aa)), MAT.TAIL);
        // reverse light near the inner end
        if (p.taillightStyle !== 'slim') {
          const dr = sdRoundBox(fz, fy, tl.zInner + 0.08, tl.yc - tl.H * 0.18, 0.045, Math.max(0.012, tl.H * 0.18), 0.008);
          fixedLayer(a * cover(dr, aa), MAT.REVERSE);
        }
      }
      groove(d, 0.002, 0.0012);
    }
    if (nx < -0.3) {
      // trunk lid / tailgate shut lines
      if (xd - xr > 0.25 && !lay.isPickup) {
        const ty = tl.yc - tl.H * 0.7 - 0.02;
        if (Math.abs(fy - ty) < 0.02 && Math.abs(fz) < hwR - 0.12) groove(fy - ty, 0.0025);
      } else {
        const d = sdRoundBox(fz, fy, 0, (tailB + tailH) / 2 + 0.1, hwR - 0.14, (tailH - tailB) / 2, 0.05);
        if (Math.abs(d) < 0.02 && fy < tailH - 0.05) groove(d, 0.0025);
      }
      // plate recess shade + badge
      const db = sdRoundBox(fz, fy, 0, tailH - 0.1, 0.04, 0.024, 0.024);
      fixedLayer(cover(db, aa), MAT.CHROME);
      fixedLayer(cover(db + 0.007, aa), MAT.GLOSSBLACK);
      S[9] += 0.003 * cover(db, aa);
      if (fy < tailB + 0.11) fixedLayer(cover(fy - (tailB + 0.11), aa), MAT.PLASTIC);
      if (p.diffuser && fy < tailB + 0.13) fixedLayer(cover(fy - (tailB + 0.13), aa), MAT.GRILLE);
    }
  }

  };

  for (let c = 0; c < TW; c++) {
    const i0 = colI[c], ti = colT[c];
    const ring = rings[ti < 0.5 ? i0 : i0 + 1];
    const kind = ring.kind;
    const svv = ring.sv;
    const q = lerp(rings[i0].q, rings[i0 + 1].q, ti);
    const loft = kind === 1;
    for (let r = 0; r < TH; r++) {
      const j0 = rowJ[r], tj = rowT[r];
      const o00 = (i0 * NH + j0) * 3, o01 = o00 + 3, o10 = o00 + NH * 3, o11 = o10 + 3;
      const w00 = (1 - ti) * (1 - tj), w01 = (1 - ti) * tj, w10 = ti * (1 - tj), w11 = ti * tj;
      const x = pos[o00] * w00 + pos[o01] * w01 + pos[o10] * w10 + pos[o11] * w11;
      const y = pos[o00 + 1] * w00 + pos[o01 + 1] * w01 + pos[o10 + 1] * w10 + pos[o11 + 1] * w11;
      const z = pos[o00 + 2] * w00 + pos[o01 + 2] * w01 + pos[o10 + 2] * w10 + pos[o11 + 2] * w11;
      const nx = nrm[o00] * w00 + nrm[o01] * w01 + nrm[o10] * w10 + nrm[o11] * w11;
      const ny = nrm[o00 + 1] * w00 + nrm[o01 + 1] * w01 + nrm[o10 + 1] * w10 + nrm[o11 + 1] * w11;
      const nz = nrm[o00 + 2] * w00 + nrm[o01 + 2] * w01 + nrm[o10 + 2] * w10 + nrm[o11 + 2] * w11;
      const part = partOf[tj < 0.5 ? j0 : j0 + 1];

      shade(x, y, z, nx, ny, nz, part, kind, svv, loft);

      // ---------- write outputs
      const t = r * TW + c;
      out.fixed[t * 3] = S[0] * 255; out.fixed[t * 3 + 1] = S[1] * 255; out.fixed[t * 3 + 2] = S[2] * 255;
      out.orm[t * 3] = S[5] * 255; out.orm[t * 3 + 1] = S[3] * 255; out.orm[t * 3 + 2] = S[4] * 255;
      out.emis[t * 3] = Math.min(1, S[6]) * 255; out.emis[t * 3 + 1] = Math.min(1, S[7]) * 255; out.emis[t * 3 + 2] = Math.min(1, S[8]) * 255;
      out.w[t * 4] = S[10] * 255 + 0.5; out.w[t * 4 + 1] = S[11] * 255 + 0.5; out.w[t * 4 + 2] = S[12] * 255 + 0.5; out.w[t * 4 + 3] = S[13] * 255 + 0.5;
      height[t] = S[9];
    }
  }

  // ---- normal map from height (tangent space: +u, +v)
  const strength = 1.0;
  for (let r = 0; r < TH; r++) {
    const r0 = Math.max(0, r - 1), r1 = Math.min(TH - 1, r + 1);
    for (let c = 0; c < TW; c++) {
      const c0 = Math.max(0, c - 1), c1 = Math.min(TW - 1, c + 1);
      const dx = (height[r * TW + c1] - height[r * TW + c0]) / ((c1 - c0) * su) * strength;
      const dy = (height[r1 * TW + c] - height[r0 * TW + c]) / ((r1 - r0) * sv_) * strength;
      const l = Math.sqrt(dx * dx + dy * dy + 1 * 1);
      const t = (r * TW + c) * 4;
      out.normal[t] = (-dx / l * 0.5 + 0.5) * 255;
      out.normal[t + 1] = (-dy / l * 0.5 + 0.5) * 255;
      out.normal[t + 2] = (1 / l * 0.5 + 0.5) * 255;
      out.normal[t + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- composition (recolour without re-bake)
export const PAINT_FINISHES = {
  metallic: { r: 0.3, m: 0.7, c: 1 },
  gloss: { r: 0.15, m: 0.0, c: 1 },
  pearl: { r: 0.26, m: 0.55, c: 1 },
  candy: { r: 0.2, m: 0.85, c: 1 },
  satin: { r: 0.42, m: 0.45, c: 0.25 },
  matte: { r: 0.62, m: 0.25, c: 0 },
  chrome: { r: 0.04, m: 1.0, c: 0 },
};

const hexToRgb = (hex) => {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

export function composeBody(bake, p, target) {
  const N = bake.TW * bake.TH;
  const map = target?.map || new Uint8Array(N * 4);
  const orm = target?.orm || new Uint8Array(N * 4);
  const emis = target?.emis || new Uint8Array(N * 4);
  const mask = target?.mask || new Uint8Array(N * 4);
  const fin = PAINT_FINISHES[p.paintFinish] || PAINT_FINISHES.metallic;
  const paint = { a: hexToRgb(p.paintColor), ...fin };
  const roof = p.twoTone ? { a: hexToRgb(p.roofColor), r: 0.18, m: 0.2, c: 1 } : paint;
  const trim = p.trimFinish === 'chrome' ? { a: [0.94, 0.94, 0.95], r: 0.05, m: 1, c: 0 }
    : p.trimFinish === 'body' ? paint : { a: [0.015, 0.015, 0.017], r: 0.12, m: 0, c: 1 };
  const tint = clamp(p.glassTint, 0, 1);
  const glass = { a: [lerp(0.16, 0.012, tint), lerp(0.19, 0.014, tint), lerp(0.2, 0.018, tint)], r: 0.02, m: 0, c: 1 };
  const D = [paint, roof, trim, glass];
  const { fixed, orm: forms, emis: femis, w } = bake;
  for (let t = 0; t < N; t++) {
    const w0 = w[t * 4] / 255, w1 = w[t * 4 + 1] / 255, w2 = w[t * 4 + 2] / 255, w3 = w[t * 4 + 3] / 255;
    const wf = Math.max(0, 1 - w0 - w1 - w2 - w3);
    const ws = [w0, w1, w2, w3];
    let a0 = fixed[t * 3] / 255 * wf, a1 = fixed[t * 3 + 1] / 255 * wf, a2 = fixed[t * 3 + 2] / 255 * wf;
    let cc = forms[t * 3] / 255 * wf, rr = forms[t * 3 + 1] / 255 * wf, mm = forms[t * 3 + 2] / 255 * wf;
    for (let k = 0; k < 4; k++) {
      const wk = ws[k];
      if (wk <= 0) continue;
      const d = D[k];
      a0 += d.a[0] * wk; a1 += d.a[1] * wk; a2 += d.a[2] * wk;
      cc += d.c * wk; rr += d.r * wk; mm += d.m * wk;
    }
    map[t * 4] = a0 * 255; map[t * 4 + 1] = a1 * 255; map[t * 4 + 2] = a2 * 255; map[t * 4 + 3] = 255;
    orm[t * 4] = cc * 255; orm[t * 4 + 1] = rr * 255; orm[t * 4 + 2] = mm * 255; orm[t * 4 + 3] = 255;
    emis[t * 4] = femis[t * 3]; emis[t * 4 + 1] = femis[t * 3 + 1]; emis[t * 4 + 2] = femis[t * 3 + 2]; emis[t * 4 + 3] = 255;
    mask[t * 4] = (w0 + (p.twoTone ? 0 : w1)) * 255; mask[t * 4 + 1] = mask[t * 4 + 2] = 0; mask[t * 4 + 3] = 255;
  }
  return { map, orm, emis, mask };
}
