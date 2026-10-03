// Copies the browser-side libraries the renderer needs into src/vendor so the app is fully
// self-contained (no node_modules lookup at runtime, works inside the packaged .exe).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'src', 'vendor');

function copy(src, dst, filter = () => true) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(src)) {
      const s = path.join(src, f);
      if (!filter(s)) continue;
      copy(s, path.join(dst, f), filter);
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

fs.rmSync(out, { recursive: true, force: true });
const three = path.join(nm, 'three');
copy(path.join(three, 'build', 'three.module.js'), path.join(out, 'three', 'build', 'three.module.js'));
copy(path.join(three, 'build', 'three.core.js'), path.join(out, 'three', 'build', 'three.core.js'));
// addons: skip heavy/unneeded folders
const skip = new Set(['ammo', 'draco', 'basis', 'rhino3dm', 'zstddec.module.js', 'ktx-parse.module.js', 'webxr', 'offscreen', 'physics', 'inspector', 'transpiler', 'tsl', 'capabilities', 'gpgpu']);
copy(path.join(three, 'examples', 'jsm'), path.join(out, 'three', 'examples', 'jsm'), (p) => !skip.has(path.basename(p)));
copy(path.join(root, 'assets', 'fonts'), path.join(out, 'three', 'fonts'));
copy(path.join(three, 'LICENSE'), path.join(out, 'three', 'LICENSE'));
for (const pkg of ['three-mesh-bvh', 'three-bvh-csg']) {
  copy(path.join(nm, pkg, 'src'), path.join(out, pkg, 'src'), (p) => !p.endsWith('.d.ts') && !p.includes(`${path.sep}webgpu`));
  copy(path.join(nm, pkg, 'LICENSE'), path.join(out, pkg, 'LICENSE'));
}
console.log('vendored libraries into', path.relative(root, out));
