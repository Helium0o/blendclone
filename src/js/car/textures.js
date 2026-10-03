// Procedural textures (canvas based) shared by car parts and the material library.
import * as THREE from 'three';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Converts a greyscale height canvas into a tangent-space normal map canvas. */
export function heightToNormal(src, strength = 2, wrapX = true) {
  const w = src.width, h = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const dst = canvas(w, h);
  const ctx = dst.getContext('2d');
  const img = ctx.createImageData(w, h);
  const H = (x, y) => {
    if (wrapX) x = (x + w) % w; else x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    return sd[(y * w + x) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * w + x) * 4;
      img.data[o] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return dst;
}

function tex(c, { srgb = false, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = aniso;
  return t;
}

/**
 * Tyre texture set. `bands` describes where (in v, 0 = inner bead, 1 = outer bead) the tread
 * and the outer sidewall lettering live.
 */
export function tyreTextures(bands, label) {
  const key = `tyre:${bands.treadA.toFixed(3)}:${bands.treadB.toFixed(3)}:${bands.wallA.toFixed(3)}:${bands.wallB.toFixed(3)}:${label}`;
  if (cache.has(key)) return cache.get(key);
  const W = 2048, H = 512;
  const hc = canvas(W, H);
  const g = hc.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  // canvas y = (1 - v) * H because CanvasTexture uses flipY
  const yOf = (v) => (1 - v) * H;
  // tread blocks: directional V grooves
  const tA = yOf(bands.treadB), tB = yOf(bands.treadA);
  const mid = (tA + tB) / 2;
  g.strokeStyle = '#202020';
  g.lineWidth = 7;
  const n = 72;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * W;
    g.beginPath();
    g.moveTo(x, tA - 4); g.lineTo(x + 26, mid - 8); g.lineTo(x + 26, mid + 8); g.lineTo(x, tB + 4);
    g.stroke();
  }
  g.lineWidth = 2.5; g.strokeStyle = '#4a4a4a';
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * W;
    g.beginPath(); g.moveTo(x + 4, tA + (mid - tA) * 0.25); g.lineTo(x + 16, mid - 14); g.stroke();
    g.beginPath(); g.moveTo(x + 4, tB - (tB - mid) * 0.25); g.lineTo(x + 16, mid + 14); g.stroke();
  }
  // sidewall lettering (raised)
  const wA = yOf(bands.wallB), wB = yOf(bands.wallA);
  const wh = Math.abs(wB - wA);
  g.fillStyle = '#b8b8b8';
  g.font = `bold ${Math.max(10, wh * 0.42)}px Arial, sans-serif`;
  g.textBaseline = 'middle';
  const txt = label;
  for (let k = 0; k < 2; k++) {
    g.save();
    g.translate(k * W / 2 + W * 0.06, (wA + wB) / 2);
    g.scale(1, -1); // flip so letters read correctly from outside
    g.fillText(txt, 0, 0);
    g.restore();
  }
  // rim protector line
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, wB + wh * 0.25, W, Math.max(2, wh * 0.06));

  const albedo = canvas(W, H);
  const a = albedo.getContext('2d');
  a.fillStyle = '#1b1b1c'; a.fillRect(0, 0, W, H);
  a.globalAlpha = 0.5; a.drawImage(hc, 0, 0); a.globalAlpha = 1;
  // darken back to rubber but keep lettering slightly lighter
  a.globalCompositeOperation = 'multiply';
  a.fillStyle = '#383838'; a.fillRect(0, 0, W, H);
  a.globalCompositeOperation = 'source-over';
  const res = { map: tex(albedo, { srgb: true }), normalMap: tex(heightToNormal(hc, 3.5, true)) };
  cache.set(key, res);
  return res;
}

/** Carbon-fibre twill weave. */
export function carbonTextures() {
  if (cache.has('carbon')) return cache.get('carbon');
  const S = 512, cell = 32;
  const c = canvas(S, S), h = canvas(S, S);
  const g = c.getContext('2d'), gh = h.getContext('2d');
  for (let y = 0; y < S / cell; y++) {
    for (let x = 0; x < S / cell; x++) {
      const horiz = ((x + y) >> 1) % 2 === 0;
      const grad = horiz ? g.createLinearGradient(x * cell, 0, (x + 1) * cell, 0) : g.createLinearGradient(0, y * cell, 0, (y + 1) * cell);
      grad.addColorStop(0, '#0b0c0e'); grad.addColorStop(0.5, '#2a2d33'); grad.addColorStop(1, '#0b0c0e');
      g.fillStyle = grad; g.fillRect(x * cell, y * cell, cell, cell);
      const gg = horiz ? gh.createLinearGradient(0, y * cell, 0, (y + 1) * cell) : gh.createLinearGradient(x * cell, 0, (x + 1) * cell, 0);
      gg.addColorStop(0, '#404040'); gg.addColorStop(0.5, '#c0c0c0'); gg.addColorStop(1, '#404040');
      gh.fillStyle = gg; gh.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const res = { map: tex(c, { srgb: true, repeat: [6, 6] }), normalMap: tex(heightToNormal(h, 1.5, true), { repeat: [6, 6] }) };
  cache.set('carbon', res);
  return res;
}

/** Brake disc with radial machining marks and cross-drilled holes. */
export function discTextures() {
  if (cache.has('disc')) return cache.get('disc');
  const W = 1024, H = 128;
  const c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#7d7f82'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.08})`;
    g.fillRect(0, Math.random() * H, W, 1);
  }
  g.fillStyle = '#151515';
  for (let i = 0; i < 48; i++) {
    for (let r = 0; r < 3; r++) {
      g.beginPath();
      g.arc((i / 48) * W + r * 7, H * (0.3 + r * 0.2), 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const res = { map: tex(c, { srgb: true }) };
  cache.set('disc', res);
  return res;
}

/** License plate. */
export function plateTexture(text, style = 'eu') {
  const key = `plate:${text}:${style}`;
  if (cache.has(key)) return cache.get(key);
  const W = 1040, H = 220;
  const c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#f4f4ef'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(8, 8, W - 16, H - 16);
  if (style === 'eu') {
    g.fillStyle = '#1d3f9a'; g.fillRect(14, 14, 90, H - 28);
    g.fillStyle = '#ffd400';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.arc(59 + Math.cos(a) * 28, 80 + Math.sin(a) * 28, 5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#fff'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.fillText('CF', 59, 175);
  }
  g.fillStyle = '#111';
  g.font = 'bold 150px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(text).slice(0, 10).toUpperCase(), W / 2 + 45, H / 2 + 6, W - 150);
  const res = tex(c, { srgb: true });
  cache.set(key, res);
  return res;
}

/** Soft rounded-rectangle contact shadow. */
export function contactShadowTexture() {
  if (cache.has('shadow')) return cache.get('shadow');
  const S = 256;
  const c = canvas(S, S), g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = Math.abs(x / (S - 1) * 2 - 1), v = Math.abs(y / (S - 1) * 2 - 1);
    const d = Math.pow(Math.pow(u, 6) + Math.pow(v, 6), 1 / 6);
    const a = Math.pow(Math.max(0, Math.min(1, (1 - d) / 0.45)), 1.6);
    const o = (y * S + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
    img.data[o + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = tex(c);
  cache.set('shadow', t);
  return t;
}

/** Brushed metal (anisotropic look via fine streaks). */
export function brushedTextures() {
  if (cache.has('brushed')) return cache.get('brushed');
  const S = 512;
  const c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.1})`;
    g.fillRect(0, Math.random() * S, S, 1);
  }
  const res = { roughnessMap: tex(c, { repeat: [2, 2] }) };
  cache.set('brushed', res);
  return res;
}

/** Small logo for wheel centre caps. */
export function logoTexture() {
  if (cache.has('logo')) return cache.get('logo');
  const S = 256;
  const c = canvas(S, S), g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2);
  grad.addColorStop(0, '#2b2d31'); grad.addColorStop(1, '#0c0d0f');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#c9ccd1'; g.lineWidth = 12;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 14, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#e6e8eb'; g.font = 'bold 110px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('CF', S / 2, S / 2 + 6);
  const t = tex(c, { srgb: true });
  cache.set('logo', t);
  return t;
}
