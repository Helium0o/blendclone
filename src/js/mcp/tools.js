// MCP tool definitions + handlers (executed in the renderer, where the scene lives).
import * as THREE from 'three';
import { CAR_PRESETS, CAR_SCHEMA, CAR_GROUPS } from '../car/params.js';
import { PRIMITIVES } from '../geometry/primitives.js';
import { PART_TYPES } from '../car/standalone.js';
import { MATERIAL_PRESETS } from '../materials.js';
import { ENVIRONMENTS } from '../environment.js';
import { VIEWS } from '../viewport.js';
import { LIGHT_SCHEMA } from '../editor.js';
import { PAINT_COLORS } from '../ui/library.js';
import * as ops from '../geometry/ops.js';
import { exportScene, importModel, EXPORT_FORMATS, bridge, toB64 } from '../io.js';
import { GUIDE } from './guide.js';

const vec3 = (desc) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: desc });
const idProp = { type: 'string', description: 'Object id (e.g. "car1") or exact object name' };
const transformProps = {
  position: vec3('Position [x, y, z] in metres (Y up, ground at 0)'),
  rotation_deg: vec3('Rotation [x, y, z] in degrees'),
  scale: { description: 'Uniform number or [x, y, z]', oneOf: [{ type: 'number' }, vec3('Scale')] },
  name: { type: 'string', description: 'Display name' },
  parent: { type: 'string', description: 'Optional parent object id' },
};
const materialProp = {
  description: 'Material: a preset name string, or {preset?, color, metalness, roughness, clearcoat, transmission, opacity, emissive, emissiveIntensity, iridescence, sheen, pattern ("carbon"|"brushed"), flatShading, wireframe, side ("front"|"double")}',
  oneOf: [{ type: 'string' }, { type: 'object' }],
};
const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1) }] });

const commonOpts = (a) => ({
  name: a.name, parent: a.parent, position: a.position, rotation: a.rotation_deg, scale: a.scale,
});

export function createTools(app) {
  const ed = app.editor, vp = app.viewport;
  const info = (o, detailed = false) => ed.info(ed.idOf(o), { detailed });

  const tools = [
    // ------------------------------------------------------------- inspection
    {
      name: 'get_scene',
      description: 'List every object in the scene as a tree (ids, kinds, transforms, sizes, bounds), plus environment settings and stats. Call this first.',
      inputSchema: { type: 'object', properties: { include_params: { type: 'boolean', description: 'Include full parameter sets (verbose)' } } },
      handler: (a) => {
        const tree = ed.tree();
        if (a.include_params) { const add = (nodes) => nodes.forEach((n) => { const d = ed.info(n.id, { detailed: true }); n.params = d.params; n.material = d.material; add(n.children); }); add(tree); }
        return { objects: tree, selection: ed.selection, environment: vp.env.settings, stats: ed.stats(), canUndo: ed.undoStack.length > 0 };
      },
    },
    {
      name: 'get_object',
      description: 'Full details of one object: params, material, size, bounds, triangle count; for cars also key measurements (axle/windshield/roof x-positions) and part mesh names.',
      inputSchema: { type: 'object', properties: { id: idProp }, required: ['id'] },
      handler: (a) => ed.info(a.id, { detailed: true }),
    },
    {
      name: 'list_presets',
      description: 'Lists everything that can be created: car presets, primitive shapes, stand-alone parts, material presets, named paint colours, lighting environments, light types and camera views.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({
        carPresets: Object.fromEntries(Object.entries(CAR_PRESETS).map(([k, v]) => [k, v.description])),
        primitives: Object.fromEntries(Object.entries(PRIMITIVES).map(([k, v]) => [k, Object.fromEntries(v.schema.map((s) => [s.key, s.default]))])),
        parts: Object.fromEntries(Object.entries(PART_TYPES).map(([k, v]) => [k, Object.fromEntries(v.schema.map((s) => [s.key, s.default]))])),
        materialPresets: Object.fromEntries(Object.entries(MATERIAL_PRESETS).map(([k, v]) => [k, v.label])),
        paintColors: Object.fromEntries(PAINT_COLORS.map(([n, c, f]) => [n, `${c} (${f})`])),
        environments: Object.keys(ENVIRONMENTS), lights: LIGHT_SCHEMA.find((s) => s.key === 'type').options, views: Object.keys(VIEWS),
        exportFormats: EXPORT_FORMATS,
      }),
    },
    {
      name: 'describe_car_parameters',
      description: 'Returns the full car parameter schema (key, type, default, min/max, unit, description), grouped. Use before update_car to know what can be tuned.',
      inputSchema: { type: 'object', properties: { group: { type: 'string', enum: CAR_GROUPS.map((g) => g.id), description: 'Optional group filter' } } },
      handler: (a) => CAR_GROUPS.filter((g) => !a.group || g.id === a.group).map((g) => ({
        group: g.id, label: g.label,
        params: CAR_SCHEMA.filter((s) => s.group === g.id).map((s) => ({ key: s.key, type: s.type, default: s.default, ...(s.min !== undefined ? { min: s.min, max: s.max } : {}), ...(s.options ? { options: s.options } : {}), ...(s.unit ? { unit: s.unit } : {}), description: s.description })),
      })),
    },
    {
      name: 'get_modeling_guide',
      description: 'Returns the CarForge guide: coordinate system, how the procedural car body works, real-world car proportions by class, and tips. Read once per session.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => GUIDE,
    },

    // ------------------------------------------------------------- creation
    {
      name: 'create_car',
      description: 'Creates a fully detailed procedural car (body with baked windows/lights/grille/panel gaps, wheels, tyres, brakes, mirrors, aero parts). Start from a preset and override any parameter (see describe_car_parameters).',
      inputSchema: {
        type: 'object', properties: {
          preset: { type: 'string', enum: Object.keys(CAR_PRESETS), description: 'Body style preset (default sedan)' },
          params: { type: 'object', description: 'Parameter overrides, e.g. {"paintColor":"#0d3fa6","length":4.9,"rimStyle":"mesh"}' },
          ...transformProps,
        },
      },
      handler: (a) => {
        const o = ed.addCar(a.preset || 'sedan', { ...commonOpts(a), params: a.params || {} });
        if (!a.position && ed.cars.size > 1) placeBesideOthers(o);
        return { created: info(o), car: ed.cars.get(ed.idOf(o)).describe() };
      },
    },
    {
      name: 'update_car',
      description: 'Changes car parameters (only send the keys you want to change). Only the affected parts are rebuilt. Returns the changed keys and new measurements.',
      inputSchema: { type: 'object', properties: { id: idProp, params: { type: 'object', description: 'Parameter patch' } }, required: ['id', 'params'] },
      handler: (a) => {
        const o = ed.require(a.id);
        if (o.userData.cf.kind !== 'car') throw new Error(`${a.id} is not a car (kind ${o.userData.cf.kind}); use set_params`);
        const before = { ...o.userData.cf.params };
        ed.setParams(a.id, a.params);
        const after = o.userData.cf.params;
        const changed = Object.keys(after).filter((k) => after[k] !== before[k]).map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
        const clamped = Object.keys(a.params).filter((k) => a.params[k] !== after[k]).map((k) => `${k} requested ${JSON.stringify(a.params[k])} → applied ${JSON.stringify(after[k])}`);
        return { changed, clampedOrNormalised: clamped, car: ed.cars.get(ed.idOf(o)).describe() };
      },
    },
    {
      name: 'create_primitive',
      description: `Adds a parametric primitive: ${Object.keys(PRIMITIVES).join(', ')}. Params depend on the shape (see list_presets).`,
      inputSchema: { type: 'object', properties: { shape: { type: 'string', enum: Object.keys(PRIMITIVES) }, params: { type: 'object' }, material: materialProp, ...transformProps }, required: ['shape'] },
      handler: (a) => info(ed.addPrimitive(a.shape, a.params || {}, { ...commonOpts(a), material: a.material })),
    },
    {
      name: 'create_part',
      description: 'Adds a stand-alone car part: "wheel" (rim + tyre + brake, same params as the car wheels) or "wing" (adjustable airfoil rear wing). Axle of a wheel is along Z.',
      inputSchema: { type: 'object', properties: { type: { type: 'string', enum: Object.keys(PART_TYPES) }, params: { type: 'object' }, ...transformProps }, required: ['type'] },
      handler: (a) => info(ed.addPart(a.type, a.params || {}, commonOpts(a))),
    },
    {
      name: 'create_lathe',
      description: 'Revolves a 2D profile of [radius, height] points around the Y axis (exhaust tips, lamps, knobs, wheels, bottles).',
      inputSchema: { type: 'object', properties: { points: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, segments: { type: 'integer', default: 64 }, angle_deg: { type: 'number', default: 360 }, material: materialProp, ...transformProps }, required: ['points'] },
      handler: (a) => info(ed.addMesh(ops.latheGeometry(a.points, a.segments || 64, a.angle_deg || 360), a.material || { preset: 'clay' }, { ...commonOpts(a), name: a.name || 'Lathe' })),
    },
    {
      name: 'create_extrusion',
      description: 'Extrudes a 2D outline ([x, y] points in the XY plane) along Z, centred on Z=0. Supports holes, bevel and spline smoothing (badges, vents, brackets, logos).',
      inputSchema: {
        type: 'object', properties: {
          outline: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, holes: { type: 'array', items: { type: 'array' } },
          depth: { type: 'number', default: 0.1 }, bevel: { type: 'number', default: 0 }, smooth_curve: { type: 'boolean' }, material: materialProp, ...transformProps,
        }, required: ['outline'],
      },
      handler: (a) => info(ed.addMesh(ops.extrudeGeometry(a.outline, { holes: a.holes || [], depth: a.depth ?? 0.1, bevel: a.bevel || 0, smoothCurve: !!a.smooth_curve }), a.material || { preset: 'clay' }, { ...commonOpts(a), name: a.name || 'Extrusion' })),
    },
    {
      name: 'create_loft',
      description: 'Lofts a smooth surface through cross-sections. Each section: {points: [[x,y],...] closed loop (same count for all), position: [x,y,z], rotation: [rx,ry,rz] deg, scale}. Sections lie in their local XY plane. Great for custom body panels, spoilers, mirrors, intakes.',
      inputSchema: {
        type: 'object', properties: {
          sections: { type: 'array', items: { type: 'object' } }, smooth: { type: 'boolean', default: true }, cap_ends: { type: 'boolean', default: true },
          material: materialProp, ...transformProps,
        }, required: ['sections'],
      },
      handler: (a) => info(ed.addMesh(ops.loftGeometry(a.sections, { smooth: a.smooth !== false, capEnds: a.cap_ends !== false }), a.material || { preset: 'clay' }, { ...commonOpts(a), name: a.name || 'Loft' })),
    },
    {
      name: 'create_tube',
      description: 'Creates a pipe along a smooth curve through 3D points (roll cages, exhaust pipes, rails, cables).',
      inputSchema: { type: 'object', properties: { points: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, radius: { type: 'number', default: 0.03 }, closed: { type: 'boolean' }, material: materialProp, ...transformProps }, required: ['points'] },
      handler: (a) => info(ed.addMesh(ops.tubeGeometry(a.points, { radius: a.radius || 0.03, closed: !!a.closed, segments: Math.max(32, a.points.length * 16) }), a.material || { preset: 'chrome' }, { ...commonOpts(a), name: a.name || 'Tube' })),
    },
    {
      name: 'create_custom_mesh',
      description: 'Creates a mesh from raw vertices [[x,y,z],...] and faces [[i,j,k] or [i,j,k,l],...] (counter-clockwise when seen from outside).',
      inputSchema: { type: 'object', properties: { vertices: { type: 'array' }, faces: { type: 'array' }, smooth: { type: 'boolean', default: true }, material: materialProp, ...transformProps }, required: ['vertices', 'faces'] },
      handler: (a) => info(ed.addMesh(ops.customGeometry(a.vertices, a.faces, { smooth: a.smooth !== false }), a.material || { preset: 'clay' }, { ...commonOpts(a), name: a.name || 'Custom mesh' })),
    },
    {
      name: 'add_light',
      description: 'Adds a light: point, spot, directional (sun) or area (softbox, best for car paint). Params: color, intensity, distance, angle, width, height, castShadow. Lights aim down -Y of their own rotation.',
      inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['point', 'spot', 'directional', 'area'] }, params: { type: 'object' }, ...transformProps }, required: ['type'] },
      handler: (a) => info(ed.addLight(a.type, a.params || {}, commonOpts(a))),
    },

    // ------------------------------------------------------------- editing
    {
      name: 'set_params',
      description: 'Changes the parameters of any parametric object (car, primitive, part, light). Only send changed keys.',
      inputSchema: { type: 'object', properties: { id: idProp, params: { type: 'object' } }, required: ['id', 'params'] },
      handler: (a) => ed.info(ed.idOf(ed.setParams(a.id, a.params)), { detailed: true }),
    },
    {
      name: 'set_transform',
      description: 'Moves / rotates / scales an object. relative=true adds to the current values (scale multiplies).',
      inputSchema: { type: 'object', properties: { id: idProp, position: transformProps.position, rotation_deg: transformProps.rotation_deg, scale: transformProps.scale, relative: { type: 'boolean' } }, required: ['id'] },
      handler: (a) => info(ed.setTransform(a.id, { position: a.position, rotation: a.rotation_deg, scale: a.scale }, { relative: !!a.relative })),
    },
    {
      name: 'set_material',
      description: 'Sets the material of a mesh/primitive/model. For cars it maps onto paint params: part "body" (default) → paintColor/paintFinish, "wheel" → rimFinish, "caliper" → caliperColor, "aero" → aeroFinish. (For full car control prefer update_car.)',
      inputSchema: { type: 'object', properties: { id: idProp, material: materialProp, part: { type: 'string', description: 'For cars: body | wheel | caliper | aero' } }, required: ['id', 'material'] },
      handler: (a) => ed.info(ed.idOf(ed.setMaterial(a.id, a.material, { part: a.part })), { detailed: true }),
    },
    {
      name: 'update_object',
      description: 'Rename, show/hide or re-parent an object (parent null = top level).',
      inputSchema: { type: 'object', properties: { id: idProp, name: { type: 'string' }, visible: { type: 'boolean' }, parent: { type: ['string', 'null'] } }, required: ['id'] },
      handler: (a) => {
        const id = ed.idOf(ed.require(a.id));
        if (a.name) ed.rename(id, a.name);
        if (a.visible !== undefined) ed.setVisible(id, a.visible);
        if (a.parent !== undefined) ed.setParent(id, a.parent);
        return ed.info(id);
      },
    },
    {
      name: 'delete_objects',
      description: 'Deletes objects (and their children). Undoable.',
      inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
      handler: (a) => { ed.remove(a.ids); return { deleted: a.ids, remaining: ed.objects.size }; },
    },
    {
      name: 'duplicate_object',
      description: 'Duplicates an object (deep copy incl. children) with an optional position offset.',
      inputSchema: { type: 'object', properties: { id: idProp, offset: vec3('Offset [x,y,z]'), name: { type: 'string' } }, required: ['id'] },
      handler: (a) => info(ed.duplicate(a.id, { offset: a.offset || [0, 0, 0], name: a.name })),
    },
    {
      name: 'group_objects',
      description: 'Puts objects into a new group (transforms preserved).',
      inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, name: { type: 'string' } }, required: ['ids'] },
      handler: (a) => info(ed.addGroup(a.ids, { name: a.name })),
    },
    {
      name: 'boolean_operation',
      description: 'CSG boolean between two objects → new mesh object. operation: subtract (a minus b), union, intersect. Originals are removed unless keep_originals.',
      inputSchema: { type: 'object', properties: { a: idProp, b: idProp, operation: { type: 'string', enum: ['subtract', 'union', 'intersect'] }, keep_originals: { type: 'boolean' }, name: { type: 'string' } }, required: ['a', 'b', 'operation'] },
      handler: (a) => info(ed.booleanOp(a.a, a.b, a.operation, { keepOriginals: !!a.keep_originals, name: a.name }), true),
    },
    {
      name: 'modify_mesh',
      description: 'Applies a deformer to a mesh/primitive (primitives become meshes): bend (amount = fraction of 180°), twist (amount = turns), taper, inflate, noise, smooth (iterations), subdivide (max_edge in m). axis x|y|z.',
      inputSchema: { type: 'object', properties: { id: idProp, operation: { type: 'string', enum: ['bend', 'twist', 'taper', 'inflate', 'noise', 'smooth', 'subdivide'] }, amount: { type: 'number' }, axis: { type: 'string', enum: ['x', 'y', 'z'] }, iterations: { type: 'integer' }, max_edge: { type: 'number' }, frequency: { type: 'number' } }, required: ['id', 'operation'] },
      handler: (a) => info(ed.deform(a.id, a.operation, { amount: a.amount, axis: a.axis, iterations: a.iterations, maxEdge: a.max_edge, frequency: a.frequency }), true),
    },
    {
      name: 'mirror_object',
      description: 'Creates a mirrored copy across the world plane through the origin perpendicular to axis (z mirrors left/right on a car). merge=true groups original + copy.',
      inputSchema: { type: 'object', properties: { id: idProp, axis: { type: 'string', enum: ['x', 'y', 'z'] }, merge: { type: 'boolean' } }, required: ['id'] },
      handler: (a) => info(ed.mirror(a.id, a.axis || 'z', { merge: !!a.merge })),
    },
    {
      name: 'array_object',
      description: 'Repeats an object count times with a per-copy offset / rotation / scale factor, grouped.',
      inputSchema: { type: 'object', properties: { id: idProp, count: { type: 'integer' }, offset: vec3('Per-copy offset'), rotation_deg: vec3('Per-copy rotation'), scale: { type: 'number' } }, required: ['id', 'count'] },
      handler: (a) => info(ed.array(a.id, a.count, { offset: a.offset || [1, 0, 0], rotation: a.rotation_deg || [0, 0, 0], scale: a.scale || 1 })),
    },
    {
      name: 'merge_objects',
      description: 'Merges several objects into one static mesh (uses the first object material).',
      inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, name: { type: 'string' } }, required: ['ids'] },
      handler: (a) => info(ed.mergeObjects(a.ids, { name: a.name || 'Merged' })),
    },
    {
      name: 'convert_to_mesh',
      description: 'Bakes a car / part / primitive / imported model into plain editable mesh objects (loses parametric controls). Needed before booleans/deformers on cars.',
      inputSchema: { type: 'object', properties: { id: idProp }, required: ['id'] },
      handler: (a) => { const g = ed.convertToMesh(a.id); const gid = ed.idOf(g); return { result: ed.tree().find((n) => n.id === gid) || ed.info(gid) }; },
    },
    {
      name: 'place_on_surface',
      description: 'Ray-casts onto a target object to find its surface and (optionally) moves another object there. from: top (cast down at x,z), bottom, front (cast along -X at z,y), rear, left, right (cast along ±Z at x,y). Returns the hit point and surface normal.',
      inputSchema: {
        type: 'object', properties: {
          target: idProp, id: { type: 'string', description: 'Object to move onto the surface (optional)' }, from: { type: 'string', enum: ['top', 'bottom', 'front', 'rear', 'left', 'right'] },
          x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, offset: { type: 'number', description: 'Distance along the normal (m)' }, align: { type: 'boolean', description: "Rotate the object's +Y to the surface normal" },
        }, required: ['target'],
      },
      handler: (a) => placeOnSurface(ed, a),
    },
    {
      name: 'select_objects',
      description: 'Selects / highlights objects in the UI so the user can see what you are talking about.',
      inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
      handler: (a) => { ed.select(a.ids); return { selection: ed.selection }; },
    },
    {
      name: 'undo',
      description: 'Undo the last N edits (works for AI and user edits alike).',
      inputSchema: { type: 'object', properties: { steps: { type: 'integer', default: 1 } } },
      handler: (a) => { let n = 0; for (let i = 0; i < (a.steps || 1); i++) if (ed.undo()) n++; return { undone: n }; },
    },
    {
      name: 'redo',
      description: 'Redo N edits.',
      inputSchema: { type: 'object', properties: { steps: { type: 'integer', default: 1 } } },
      handler: (a) => { let n = 0; for (let i = 0; i < (a.steps || 1); i++) if (ed.redo()) n++; return { redone: n }; },
    },
    {
      name: 'new_scene',
      description: 'Deletes everything (undoable).',
      inputSchema: { type: 'object', properties: {} },
      handler: () => { ed.clear(); return { ok: true }; },
    },

    // ------------------------------------------------------------- view / render
    {
      name: 'set_environment',
      description: `Lighting & background. preset: ${Object.keys(ENVIRONMENTS).join(', ')}; background: gradient | environment | color | transparent; floor: studio | shadow | none.`,
      inputSchema: { type: 'object', properties: { preset: { type: 'string', enum: Object.keys(ENVIRONMENTS) }, background: { type: 'string', enum: ['gradient', 'environment', 'color', 'transparent'] }, background_color: { type: 'string' }, floor: { type: 'string', enum: ['studio', 'shadow', 'none'] }, exposure: { type: 'number' }, rotation_deg: { type: 'number' }, shadows: { type: 'boolean' } } },
      handler: (a) => {
        const patch = {};
        for (const [k, v] of Object.entries({ preset: a.preset, background: a.background, backgroundColor: a.background_color, floor: a.floor, exposure: a.exposure, rotation: a.rotation_deg, shadows: a.shadows })) if (v !== undefined) patch[k] = v;
        const r = vp.env.apply(patch); app.syncEnvSelect(); app.properties.render(); return r;
      },
    },
    {
      name: 'capture_view',
      description: `Renders the scene and returns image(s) so you can SEE the model. Use views (any of ${Object.keys(VIEWS).join(', ')}) for several angles at once, target to frame specific objects, ortho for blueprint views, or camera {position, target, fov} for an exact shot. Grid/gizmos are hidden.`,
      inputSchema: {
        type: 'object', properties: {
          view: { type: 'string', enum: Object.keys(VIEWS) }, views: { type: 'array', items: { type: 'string', enum: Object.keys(VIEWS) }, maxItems: 8 },
          target: { description: 'Object id or list of ids to frame', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          width: { type: 'integer', default: 1024 }, height: { type: 'integer', default: 640 }, ortho: { type: 'boolean' }, format: { type: 'string', enum: ['png', 'jpeg'] },
          camera: { type: 'object', description: '{position:[x,y,z], target:[x,y,z], fov}' }, zoom: { type: 'number', description: '<1 zooms in, >1 out (default 1)' },
          transparent: { type: 'boolean' }, show_grid: { type: 'boolean' }, save_path: { type: 'string', description: 'Optional: also save the (first) image to this file path' },
        },
      },
      handler: async (a) => {
        for (const m of ed.cars.values()) await m.whenReady(8000);
        const views = a.views?.length ? a.views : [a.view || (a.camera ? null : 'three_quarter_front')];
        const multi = views.length > 1;
        const w = Math.min(2048, a.width || (multi ? 800 : 1024)), hgt = Math.min(2048, a.height || (multi ? 500 : 640));
        const fmt = a.format || 'jpeg';
        const content = [];
        for (const v of views) {
          const url = vp.capture({ width: w, height: hgt, view: v, target: a.target, ortho: !!a.ortho, format: fmt, camera: a.camera, transparent: !!a.transparent, showGrid: !!a.show_grid, distanceScale: a.zoom || 1 });
          const [head, data] = url.split(',');
          content.push({ type: 'text', text: `view: ${v || 'custom camera'} (${w}x${hgt})` });
          content.push({ type: 'image', data, mimeType: head.includes('jpeg') ? 'image/jpeg' : 'image/png' });
          if (a.save_path && content.length === 2 && bridge) await bridge.writeFile(a.save_path, data, 'base64');
        }
        return { content };
      },
    },
    {
      name: 'set_camera',
      description: 'Moves the on-screen camera (what the user sees): a named view and/or framing target, or an explicit position/target.',
      inputSchema: { type: 'object', properties: { view: { type: 'string', enum: Object.keys(VIEWS) }, target: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, position: vec3('Camera position'), look_at: vec3('Point to look at') } },
      handler: (a) => {
        if (a.position) {
          vp.camera.position.set(...a.position);
          vp.controls.target.set(...(a.look_at || [0, 0.6, 0]));
          vp.controls.update();
        } else vp.frame(a.target ? [].concat(a.target).map((t) => ed.require(t)) : null, a.view || 'perspective');
        return { position: vp.camera.position.toArray(), target: vp.controls.target.toArray() };
      },
    },

    // ------------------------------------------------------------- files
    {
      name: 'export_model',
      description: `Exports the scene (or selected ids) to ${EXPORT_FORMATS.join(', ')}. GLB keeps all PBR materials/textures (best for Blender, Unity, Unreal, web). Without path, saves into Documents/CarForge/exports. Returns the saved path.`,
      inputSchema: { type: 'object', properties: { format: { type: 'string', enum: EXPORT_FORMATS }, ids: { type: 'array', items: { type: 'string' } }, path: { type: 'string', description: 'Absolute output path (optional)' }, file_name: { type: 'string' } } },
      handler: async (a) => {
        const format = a.format || 'glb';
        const res = await exportScene(ed, format, { ids: a.ids });
        const bytes = typeof res.data === 'string' ? new TextEncoder().encode(res.data).byteLength : res.data.byteLength;
        if (!bridge) return { note: 'Running in a browser – file offered as download', bytes };
        const p = await bridge.exportFile({ path: a.path, fileName: a.file_name || `carforge-${Date.now()}.${format}`, data: res.data });
        return { saved: p, bytes, format };
      },
    },
    {
      name: 'import_model',
      description: 'Imports a 3D file from disk (glb, gltf, obj, fbx, stl, ply) as an object. Very large unit scales (mm/cm) are auto-corrected.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, position: transformProps.position, scale: { type: 'number' }, name: { type: 'string' } }, required: ['path'] },
      handler: async (a) => {
        if (!bridge) throw new Error('File import by path requires the desktop app');
        const buf = await bridge.readFile(a.path);
        const o = await importModel(ed, buf, a.path.split(/[\\/]/).pop(), { position: a.position, scale: a.scale, name: a.name });
        return info(o, true);
      },
    },
    {
      name: 'save_project',
      description: 'Saves the editable project (.carforge JSON, keeps all parametric data). Without path saves to Documents/CarForge/projects.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, file_name: { type: 'string' } } },
      handler: async (a) => {
        const json = JSON.stringify(app.projectData());
        if (!bridge) return { note: 'browser mode', bytes: json.length };
        const p = await bridge.exportFile({ path: a.path, fileName: a.file_name || `project-${Date.now()}.carforge`, data: json, kind: 'projects' });
        app.projectPath = p; ed.dirty = false;
        return { saved: p };
      },
    },
    {
      name: 'open_project',
      description: 'Opens a .carforge project file (replaces the scene).',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: async (a) => {
        if (!bridge) throw new Error('requires the desktop app');
        const buf = await bridge.readFile(a.path);
        app.loadProjectData(JSON.parse(new TextDecoder().decode(buf)));
        app.projectPath = a.path;
        return { opened: a.path, objects: ed.tree().map((n) => ({ id: n.id, name: n.name, kind: n.kind })) };
      },
    },

    // ------------------------------------------------------------- scripting
    {
      name: 'run_script',
      description: 'Runs JavaScript inside the editor for anything the other tools cannot do. In scope: THREE, editor (scene graph API: objects, require(id), addMesh(geometry, material, opts), setParams...), viewport, scene, cars (Map id→CarModel), ops (geometry helpers), api (all tools by name, e.g. await api.create_car({...})), log(...). Use `return` to send back a JSON-serialisable result. Code runs as an async function.',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      handler: async (a) => {
        const logs = [];
        const log = (...x) => logs.push(x.map((v) => (typeof v === 'string' ? v : safeJSON(v))).join(' '));
        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
        const api = Object.fromEntries(tools.map((t) => [t.name, async (args = {}) => t.handler(args)]));
        const fn = new AsyncFunction('THREE', 'editor', 'viewport', 'scene', 'cars', 'ops', 'api', 'log', a.code);
        const result = await fn(THREE, ed, vp, ed.scene, ed.cars, ops, api, log);
        ed.emit('change', {});
        return { result: result === undefined ? null : JSON.parse(safeJSON(result)), logs };
      },
    },
  ];
  return tools;

  function placeBesideOthers(o) {
    const others = [...ed.cars.keys()].filter((k) => k !== ed.idOf(o) && ed.objects.has(k)).map((k) => ed.objects.get(k));
    if (!others.length) return;
    let maxZ = -Infinity;
    for (const c of others) maxZ = Math.max(maxZ, ed.bbox(c).max.z);
    const w = ed.bbox(o).getSize(new THREE.Vector3()).z;
    o.position.z = maxZ + 0.6 + w / 2;
    o.updateMatrixWorld(true);
    ed.commit('Place car');
  }
}

function placeOnSurface(ed, a) {
  const target = ed.require(a.target);
  const box = ed.bbox(target);
  const c = box.getCenter(new THREE.Vector3());
  const big = box.getSize(new THREE.Vector3()).length() + 10;
  const from = a.from || 'top';
  const x = a.x ?? c.x, y = a.y ?? c.y, z = a.z ?? c.z;
  const dirs = {
    top: [[x, box.max.y + 5, z], [0, -1, 0]], bottom: [[x, box.min.y - 5, z], [0, 1, 0]],
    front: [[box.max.x + 5, y, z], [-1, 0, 0]], rear: [[box.min.x - 5, y, z], [1, 0, 0]],
    right: [[x, y, box.max.z + 5], [0, 0, -1]], left: [[x, y, box.min.z - 5], [0, 0, 1]],
  };
  const [o, d] = dirs[from];
  const ray = new THREE.Raycaster(new THREE.Vector3(...o), new THREE.Vector3(...d), 0, big);
  const hits = ray.intersectObject(target, true).filter((hh) => !hh.object.userData.helper && hh.object.visible);
  if (!hits.length) throw new Error(`No surface hit on ${a.target} from ${from} at the given coordinates (bounds ${box.min.toArray().map((v) => v.toFixed(2))} → ${box.max.toArray().map((v) => v.toFixed(2))})`);
  const hit = hits[0];
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize() : new THREE.Vector3(...d).negate();
  const out = { point: hit.point.toArray().map((v) => +v.toFixed(4)), normal: n.toArray().map((v) => +v.toFixed(4)), hitMesh: hit.object.name };
  if (a.id) {
    const obj = ed.require(a.id);
    const p = hit.point.clone().add(n.clone().multiplyScalar(a.offset || 0));
    obj.parent.updateMatrixWorld(true);
    obj.position.copy(obj.parent.worldToLocal(p));
    if (a.align) obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    obj.updateMatrixWorld(true);
    ed.emit('update', { id: ed.idOf(obj) });
    ed.commit('Place on surface');
    out.moved = ed.info(ed.idOf(obj));
  }
  return out;
}

function safeJSON(v) {
  const seen = new WeakSet();
  return JSON.stringify(v, (k, val) => {
    if (val && typeof val === 'object') {
      if (val.isObject3D) return { object3D: val.name, id: val.userData?.cf?.id, type: val.type };
      if (val.isVector3 || val.isVector2 || val.isEuler || val.isColor) return val.toArray ? val.toArray() : String(val);
      if (seen.has(val)) return '[circular]';
      seen.add(val);
    }
    if (typeof val === 'function') return undefined;
    return val;
  }) ?? 'null';
}

/** Executes a tool call and wraps the result in MCP content format. */
export async function runTool(tools, name, args) {
  const t = tools.find((x) => x.name === name);
  if (!t) return { content: [{ type: 'text', text: `Unknown tool "${name}"` }], isError: true };
  try {
    const r = await t.handler(args || {});
    if (r && Array.isArray(r.content)) return r;
    return text(r);
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

export { toB64 };
