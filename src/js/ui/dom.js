// Tiny DOM helpers.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
}

export function modal(content, { onClose } = {}) {
  const root = document.getElementById('modalRoot');
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: 'modal' });
  const close = () => { back.remove(); onClose?.(); };
  box.append(h('button', { class: 'close', onclick: close }, '✕'), content);
  back.append(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  root.append(back);
  return { close, box };
}

export const fmt = (v, d = 3) => (Math.round(v * 10 ** d) / 10 ** d).toString();
