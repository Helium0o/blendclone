// Small numeric helpers used by the car generator.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const deg = (d) => (d * Math.PI) / 180;

/**
 * Builds a corner-rounded polyline through control points (x must increase) and
 * returns a fast lookup function y(x). Each point may carry its own fillet radius `r`.
 */
export function roundedProfile(points, samplesPerCorner = 14) {
  const pts = points.filter((p, i) => i === 0 || p.x > points[i - 1].x + 1e-4);
  const out = [];
  out.push([pts[0].x, pts[0].y]);
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const ax = p0.x - p1.x, ay = p0.y - p1.y;
    const bx = p2.x - p1.x, by = p2.y - p1.y;
    const la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
    const r = Math.min(p1.r || 0, la * 0.48, lb * 0.48);
    if (r < 1e-4) { out.push([p1.x, p1.y]); continue; }
    const sx = p1.x + (ax / la) * r, sy = p1.y + (ay / la) * r;
    const ex = p1.x + (bx / lb) * r, ey = p1.y + (by / lb) * r;
    for (let k = 0; k <= samplesPerCorner; k++) {
      const t = k / samplesPerCorner, it = 1 - t;
      out.push([
        it * it * sx + 2 * it * t * p1.x + t * t * ex,
        it * it * sy + 2 * it * t * p1.y + t * t * ey,
      ]);
    }
  }
  out.push([pts[pts.length - 1].x, pts[pts.length - 1].y]);
  return makeLookup(out);
}

/** Linear-interpolating lookup over [[x,y],...] sorted by x. */
export function makeLookup(samples) {
  const xs = new Float64Array(samples.length);
  const ys = new Float64Array(samples.length);
  let n = 0;
  for (const [x, y] of samples) {
    if (n > 0 && x <= xs[n - 1]) continue;
    xs[n] = x; ys[n] = y; n++;
  }
  const fn = (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + (ys[hi] - ys[lo]) * t;
  };
  fn.samples = samples;
  return fn;
}

/** Superellipse falloff used for rounded ends: 0 at rho=0, 1 at rho=1, vertical tangent at 1. */
export const superFalloff = (rho, n) => 1 - Math.pow(Math.max(0, 1 - Math.pow(clamp(rho, 0, 1), n)), 1 / n);

// ---- 2D signed distance helpers (negative = inside) ----
export function sdRoundBox(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}
export function sdEllipse(px, py, cx, cy, rx, ry) {
  // cheap approximation, good enough for masks
  const dx = (px - cx) / rx, dy = (py - cy) / ry;
  const k = Math.sqrt(dx * dx + dy * dy);
  return (k - 1) * Math.min(rx, ry);
}
export function sdCircle(px, py, cx, cy, r) {
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) - r;
}
export function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1), 0, 1);
  return Math.sqrt((pax - bax * h) * (pax - bax * h) + (pay - bay * h) * (pay - bay * h));
}
/** Coverage (0..1) of an SDF with anti-aliasing width w. */
export const cover = (d, w) => clamp(0.5 - d / w, 0, 1);

/** Deterministic hash noise in [0,1). */
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
