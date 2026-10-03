// Scene tree with selection, visibility toggles, rename and drag-to-parent.
import { h } from './dom.js';

const ICONS = { car: '🚗', primitive: '◆', part: '⚙', mesh: '△', group: '📁', light: '💡', model: '📦' };

export class Outliner {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('outliner');
    const ed = app.editor;
    ed.on('change', () => this.render());
    ed.on('select', () => this.render());
    this.el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-cf-node')) e.preventDefault(); });
    this.el.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-cf-node');
      if (id && e.target === this.el) { try { ed.setParent(id, null); } catch (err) { this.app.toast(err.message, 'err'); } }
    });
    this.render();
  }

  render() {
    const ed = this.app.editor;
    this.el.innerHTML = '';
    const sel = new Set(ed.selection);
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const eye = h('button', { class: `eye ${n.visible ? '' : 'off'}`, title: 'Show / hide' }, n.visible ? '👁' : '◌');
        eye.addEventListener('click', (e) => { e.stopPropagation(); ed.setVisible(n.id, !n.visible); });
        const row = h('div', { class: `row ${sel.has(n.id) ? 'selected' : ''}`, draggable: 'true', style: { paddingLeft: `${8 + depth * 14}px` } },
          h('span', { class: 'ico' }, ICONS[n.kind] || '•'), h('span', { class: 'nm', title: n.id }, n.name), h('span', { class: 'kid' }, n.id), eye);
        row.addEventListener('click', (e) => {
          if (e.shiftKey || e.ctrlKey) { const s = new Set(ed.selection); s.has(n.id) ? s.delete(n.id) : s.add(n.id); ed.select([...s]); }
          else ed.select([n.id]);
        });
        row.addEventListener('dblclick', () => {
          const input = h('input', { value: n.name, style: { flex: 1 } });
          row.querySelector('.nm').replaceWith(input);
          input.focus(); input.select();
          const done = () => { if (input.value.trim() && input.value !== n.name) ed.rename(n.id, input.value.trim()); else this.render(); };
          input.addEventListener('blur', done);
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = n.name; input.blur(); } e.stopPropagation(); });
        });
        row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-cf-node', n.id); });
        row.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-cf-node')) { e.preventDefault(); row.classList.add('drop-target'); } });
        row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
        row.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation(); row.classList.remove('drop-target');
          const id = e.dataTransfer.getData('application/x-cf-node');
          if (id && id !== n.id) { try { ed.setParent(id, n.id); } catch (err) { this.app.toast(err.message, 'err'); } }
        });
        this.el.append(row);
        if (n.children?.length) walk(n.children, depth + 1);
      }
    };
    walk(ed.tree(), 0);
    if (!ed.objects.size) this.el.append(h('div', { class: 'row', style: { color: 'var(--muted)', cursor: 'default' } }, 'Empty scene'));
  }
}
