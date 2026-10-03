# CarForge Studio

A desktop 3D model builder (Windows `.exe`, also macOS/Linux) specialised in **cars**, with a
drag-and-drop interface for people and a built-in **MCP server** so Claude (or any MCP client)
can build, inspect, adjust and export models for you.

![icon](build/icon.png)

## What it does

- **Procedural, highly detailed cars** — 9 body styles (sedan, sports coupe, mid-engine supercar,
  hatchback, SUV, pickup with open bed, wagon, muscle car, van) and ~100 parameters:
  - side profile (nose/cowl/deck heights, dash-to-axle, windshield & rear-glass rake, roof length/arc, beltline wedge)
  - plan view & sculpting (nose/tail rounding & squareness, tapers, rocker tuck, shoulder, tumblehome,
    fender flares, character crease, power bulge, face rake)
  - wheels with real tyre sizing (e.g. `245/40 R19`), 9 rim designs, concavity, camber, steering, brake discs & calipers,
    sidewall lettering and tread
  - baked PBR details: glass & pillars (floating roof, two-tone), panel gaps, door handles, 6 headlight styles with DRLs,
    7 grille styles, intakes, fog lights, 5 tail-light styles, vents, cladding, badges
  - parts: mirrors, lip/ducktail/GT wing, splitter, skirts, diffuser, exhausts (4 layouts × 3 shapes), plates,
    roof rails, shark fin, wipers
  - paint: metallic, gloss, pearl, candy, satin, matte, chrome — recolouring is instant (no rebuild)
- **General modelling**: primitives (box with bevel, sphere, cylinder, cone, torus, capsule, pipe, wedge, 3D text…),
  lathe, extrusion, loft, tube, raw meshes, CSG booleans, bend/twist/taper/inflate/noise/smooth/subdivide,
  mirror, array, merge, groups, lights (incl. area softboxes), undo/redo for everything.
- **Easy UI**: drag cars, parts, shapes, paints and lights from the library into the viewport, drop paint onto any
  object, move/rotate/scale gizmo with snapping, outliner with drag-to-parent, auto-generated property sliders,
  studio lighting presets tuned for car paint, one-click render images.
- **Files**: export GLB/glTF (with all PBR textures), OBJ, STL, PLY, USDZ; import GLB/glTF/OBJ/FBX/STL/PLY
  (or drag files in); `.carforge` project files keep everything parametric.

## Connecting Claude (MCP)

While CarForge is open it serves MCP (Streamable HTTP) on `http://127.0.0.1:47800/mcp` — local connections only.
Click **AI link** in the top-right corner for copy-paste configs.

**Claude Desktop** – press *Install into Claude Desktop* in that dialog (it edits `claude_desktop_config.json`
for you), or add manually:

```json
{
  "mcpServers": {
    "carforge": {
      "command": "C:\\Users\\<you>\\AppData\\Local\\Programs\\CarForge Studio\\CarForge Studio.exe",
      "args": ["C:\\Users\\<you>\\AppData\\Local\\Programs\\CarForge Studio\\resources\\mcp-bridge.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

(The bridge is a tiny stdio↔HTTP relay that ships inside the app; it even starts CarForge if it isn't running.)

**Claude Code**

```bash
claude mcp add --transport http carforge http://127.0.0.1:47800/mcp
```

### Tools exposed to the AI (36)

| Area | Tools |
|---|---|
| Inspect | `get_scene`, `get_object`, `list_presets`, `describe_car_parameters`, `get_modeling_guide` |
| Cars | `create_car`, `update_car` |
| Create | `create_primitive`, `create_part`, `create_lathe`, `create_extrusion`, `create_loft`, `create_tube`, `create_custom_mesh`, `add_light` |
| Edit | `set_params`, `set_transform`, `set_material`, `update_object`, `delete_objects`, `duplicate_object`, `group_objects`, `boolean_operation`, `modify_mesh`, `mirror_object`, `array_object`, `merge_objects`, `convert_to_mesh`, `place_on_surface`, `select_objects`, `undo`, `redo`, `new_scene` |
| View | `capture_view` (returns images — the AI checks its own work), `set_camera`, `set_environment` |
| Files | `export_model`, `import_model`, `save_project`, `open_project` |
| Anything else | `run_script` (JavaScript with full access to three.js and the editor API) |

Example prompts:

> Build a matte-black widebody sports coupe with bronze mesh wheels, a ducktail and quad exhausts, then show me
> front and rear three-quarter views.

> Make the SUV more rugged: higher ride, 70-profile tyres, squarer arches, roof rails — and export it as GLB.

## Download / build the .exe

Every push builds the Windows installer and portable `.exe` with GitHub Actions
(**Actions → Build desktop app → Artifacts → CarForge-Studio-Windows**). Tagging `v*` attaches them to a release.

Build locally (on Windows):

```bash
npm install          # also copies three.js into src/vendor
npm start            # run in development
npm run dist:win     # dist/CarForge Studio-Setup-1.0.0.exe and the portable exe
```

`npm run serve` + open `http://localhost:5173/src/index.html` runs the editor in a browser (no MCP server there).
`npm test` launches the app and runs an end-to-end MCP check (HTTP and stdio bridge); on Linux use `xvfb-run -a npm test`.

## Controls

| | |
|---|---|
| Left drag / right drag / wheel | orbit / pan / zoom |
| Click, Shift+click, double-click | select, multi-select, focus |
| Q W E R | select / move / rotate / scale, **S** snap |
| F, 0 1 3 7 9 | frame, perspective / front / side / top / rear |
| Ctrl+Z / Ctrl+Y / Ctrl+D / Ctrl+G / Del | undo / redo / duplicate / group / delete |
| Ctrl+S / Ctrl+O / F12 | save / open / render image |

## Project layout

```
electron/        main process, MCP HTTP server, stdio bridge, preload
src/js/car/      procedural car: body lofting, texture detail baker (runs in a worker), wheels, parts, presets
src/js/geometry/ primitives and geometry operations (CSG, deformers, lathe/extrude/loft/tube)
src/js/mcp/      MCP tool definitions + AI modelling guide
src/js/ui/       library, outliner, properties panels
```

Coordinates: metres, +Y up, cars face +X, +Z is the car's right-hand side.
