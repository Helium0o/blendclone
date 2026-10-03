// Runs the body texture bake off the UI thread.
import { bakeBody } from './bake.js';

self.onmessage = (e) => {
  const { id, grid, lay, p, TW, TH } = e.data;
  try {
    const r = bakeBody(grid, lay, p, TW, TH);
    self.postMessage({ id, r }, [r.fixed.buffer, r.orm.buffer, r.emis.buffer, r.w.buffer, r.normal.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
