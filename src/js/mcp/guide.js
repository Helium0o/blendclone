// Text returned by the get_modeling_guide tool: how to drive CarForge well, plus car design knowledge.
export const GUIDE = `# CarForge Studio – modelling guide for AI agents

## Coordinate system & units
- Metres and degrees. +Y is up, the ground is Y=0.
- Cars face +X (front bumper at +X). +Z is the car's RIGHT side, -Z its left.
- A car's origin is on the ground, midway between the axles.

## Recommended workflow
1. get_scene → see what exists (ids like "car1", "box3").
2. create_car with the closest preset (sedan, sports_coupe, supercar, hatchback, suv, pickup, wagon, muscle, van) and override params.
3. capture_view with views ["three_quarter_front","side","front","rear"] to LOOK at the result. Always verify visually after big changes.
4. Iterate with update_car (only send changed params – rebuilds are incremental).
5. Add custom detail with primitives / lathe / extrusion / loft / tube meshes, position them with place_on_surface, and combine with boolean_operation.
6. export_model as GLB (keeps PBR materials) when done.

## How the procedural body works (so you can steer it)
- Side profile = roof line through key points: front bumper (noseHeight) → hood → cowl (hoodHeight at dashToAxle behind the front axle)
  → windshield (windshieldAngle from vertical) → roof (roofLength, roofCurve) → rear glass (rearWindowAngle) → deck (deckHeight) → tail (tailHeight).
- Plan view: width, frontTaper/rearTaper, noseRoundness/tailRoundness (how far corners sweep back) and noseShape/tailShape (2 = round, 6 = boxy).
- Cross-section: sideTuck (rocker tuck-in), upperLean, shoulderInset (shoulder width), tumblehome (greenhouse lean), roofCrown, hoodCrown.
- Sculpting: frontFlare / rearFlare (muscular haunches), characterLine + characterHeight (side crease), hoodBulge (power dome).
- Wheel arches follow the tyre (rimDiameter in inches, tireWidth mm, tireAspect %) + archGap; archSquareness >2 gives SUV-style arches.
- Details are baked into PBR textures: windows/pillars, panel gaps, door handles, headlights, grilles, intakes, tail lights, vents, cladding.

## Typical real-world proportions (good starting points)
| Class | L × W × H (m) | Wheelbase | Notes |
|---|---|---|---|
| City car (A) | 3.6 × 1.65 × 1.50 | 2.40 | short overhangs, tall greenhouse |
| Compact hatch (C) | 4.3 × 1.80 × 1.45 | 2.65 | rearWindowAngle 25–35° |
| Mid-size sedan (D) | 4.7–4.9 × 1.85 × 1.45 | 2.80–2.90 | dashToAxle 0.6 (FWD) – 0.95 (RWD) |
| Executive sedan (E/F) | 5.0–5.3 × 1.90 × 1.48 | 3.0–3.2 | long dash-to-axle signals RWD premium |
| Sports coupe | 4.4–4.6 × 1.90 × 1.25–1.32 | 2.45–2.70 | windshieldAngle 62–66°, low beltline |
| Mid-engine supercar | 4.5–4.7 × 1.95–2.05 × 1.10–1.20 | 2.65–2.70 | cab-forward: dashToAxle 0.25–0.4, long rear deck |
| Mid-size SUV | 4.7–4.9 × 1.95 × 1.70–1.78 | 2.85–2.95 | groundClearance 0.20+, cladding, roof rails |
| Full-size pickup | 5.8–6.0 × 2.03 × 1.90–1.98 | 3.6–3.7 | style "pickup" carves the bed |
| Van / MPV | 5.0–5.2 × 1.95 × 1.80–2.00 | 3.0–3.2 | one-box, steep windshield base far forward |

Design rules of thumb:
- Overhang beyond the tyre: mainstream ~0.85–0.95 m front; performance cars push wheels to the corners (smaller overhangs).
- Longer dash-to-axle + rearward cabin = premium/RWD "cab-rearward" stance; short = cab-forward (FWD, MPV, mid-engine).
- Height-to-width ratio < 0.65 reads sporty; > 0.85 reads utility.
- Big wheels + low tyre profile (30–40%) + small archGap (0.02–0.035) = aggressive stance. Add camber -2…-4 for "stance" look.
- Beltline rise (beltRise 0.05–0.15) adds a forward-leaning wedge.
- Tumblehome 0.35–0.6 makes cabins look narrower and sportier; 0.1–0.2 for trucks/vans.

## Detail tips
- Colours: paintColor hex + paintFinish (metallic, gloss, pearl, candy, satin, matte, chrome). twoTone + roofColor for contrast roofs.
- blackPillars = floating roof. trimFinish chrome for classic cars.
- Supercar look: grilleStyle none, lowerIntake on, sideVents, hoodVents, splitter, sideSkirts, diffuser, spoiler wing, exhaust center.
- Off-road look: cladding, roofRails, archSquareness 3+, tireAspect 60–70, groundClearance 0.25.
- Use capture_view with a "target" id to frame one object, ortho:true + views front/side/top for blueprint-style checks.

## Custom geometry
- create_lathe: [radius, height] profile revolved around Y (exhaust tips, knobs, lamps).
- create_extrusion: 2D outline [x, y] extruded along Z with optional holes and bevel (badges, vents, brackets).
- create_loft: list of cross-sections (same point count) at positions → smooth surface (custom bodies, spoilers, mirrors).
- create_tube: pipe along 3D points (roll cages, exhaust pipes, roof rails).
- create_custom_mesh: raw vertices + faces for anything else.
- boolean_operation subtract/union/intersect (works on meshes & primitives), modify_mesh (bend/twist/taper/inflate/noise/smooth/subdivide),
  mirror_object, array_object, merge_objects, convert_to_mesh (bakes a car into editable meshes).
- run_script gives full JavaScript access (THREE, editor, viewport, api.<tool>) for anything not covered by a tool.
`;
