// Parameter schema + presets for the procedural car generator.
// All distances are metres, angles degrees. Coordinates: +X = front, +Y = up, Z = lateral.

const n = (key, label, def, min, max, step, group, description, extra = {}) =>
  ({ key, label, type: 'number', default: def, min, max, step, group, description, ...extra });
const c = (key, label, def, group, description) => ({ key, label, type: 'color', default: def, group, description });
const s = (key, label, def, options, group, description) => ({ key, label, type: 'select', default: def, options, group, description });
const b = (key, label, def, group, description) => ({ key, label, type: 'bool', default: def, group, description });
const t = (key, label, def, group, description) => ({ key, label, type: 'text', default: def, group, description });

export const CAR_GROUPS = [
  { id: 'paint', label: 'Paint & Materials', icon: '🎨' },
  { id: 'dims', label: 'Dimensions', icon: '📏' },
  { id: 'profile', label: 'Side Profile', icon: '🚗' },
  { id: 'shape', label: 'Body Sculpting', icon: '✋' },
  { id: 'cabin', label: 'Cabin & Glass', icon: '🪟' },
  { id: 'wheels', label: 'Wheels & Tyres', icon: '🛞' },
  { id: 'front', label: 'Front & Lights', icon: '💡' },
  { id: 'rear', label: 'Rear', icon: '🔴' },
  { id: 'aero', label: 'Aero & Extras', icon: '🏁' },
];

export const CAR_SCHEMA = [
  // ---------------- paint
  c('paintColor', 'Paint colour', '#b3121d', 'paint', 'Main body paint colour (hex).'),
  s('paintFinish', 'Paint finish', 'metallic', ['metallic', 'gloss', 'pearl', 'candy', 'satin', 'matte', 'chrome'], 'paint', 'Physical paint type. metallic/pearl/candy have flake + clearcoat, matte has no clearcoat.'),
  b('twoTone', 'Two-tone roof', false, 'paint', 'Paint the roof (and pillars) in roofColor.'),
  c('roofColor', 'Roof colour', '#111111', 'paint', 'Roof colour when twoTone is on.'),
  s('trimFinish', 'Trim finish', 'black', ['black', 'chrome', 'body'], 'paint', 'Window surrounds / trim pieces.'),
  n('glassTint', 'Glass tint', 0.75, 0, 1, 0.01, 'paint', '0 = clear-ish, 1 = limo black.'),
  b('lightsOn', 'Lights on', true, 'paint', 'Headlights / DRL / tail lights emissive.'),

  // ---------------- dimensions
  n('length', 'Length', 4.70, 2.8, 6.5, 0.01, 'dims', 'Overall body length (bumper to bumper).', { unit: 'm' }),
  n('width', 'Width', 1.85, 1.4, 2.4, 0.01, 'dims', 'Overall body width excluding mirrors.', { unit: 'm' }),
  n('height', 'Height', 1.44, 0.95, 2.4, 0.01, 'dims', 'Overall height (ground to roof).', { unit: 'm' }),
  n('wheelbase', 'Wheelbase', 2.82, 1.8, 4.2, 0.01, 'dims', 'Distance between front and rear axle.', { unit: 'm' }),
  n('frontOverhang', 'Front overhang', 0.92, 0.35, 1.5, 0.01, 'dims', 'Front axle to front bumper. Rear overhang = length - wheelbase - frontOverhang.', { unit: 'm' }),
  n('groundClearance', 'Ground clearance', 0.14, 0.05, 0.40, 0.005, 'dims', 'Height of the sills above ground.', { unit: 'm' }),

  // ---------------- side profile
  n('noseHeight', 'Nose height', 0.68, 0.35, 1.3, 0.01, 'profile', 'Height of the hood leading edge / top of front face.', { unit: 'm' }),
  n('noseBottom', 'Nose bottom', 0.24, 0.06, 0.7, 0.01, 'profile', 'Height of the front lip (approach angle).', { unit: 'm' }),
  n('hoodHeight', 'Cowl height', 0.97, 0.5, 1.5, 0.01, 'profile', 'Height of the hood at the base of the windshield.', { unit: 'm' }),
  n('hoodCurve', 'Hood arc', 0.03, -0.05, 0.15, 0.005, 'profile', 'Convexity of the hood in side view.', { unit: 'm' }),
  n('dashToAxle', 'Dash-to-axle', 0.80, 0.2, 2.0, 0.01, 'profile', 'Front axle to windshield base. Long = premium RWD, short = cab-forward.', { unit: 'm' }),
  n('windshieldAngle', 'Windshield rake', 61, 30, 82, 0.5, 'profile', 'Windshield angle from vertical.', { unit: '°' }),
  n('roofLength', 'Roof length', 1.20, 0.1, 3.8, 0.01, 'profile', 'Length of the roof between windshield top and rear-glass top.', { unit: 'm' }),
  n('roofCurve', 'Roof arc', 0.035, 0, 0.2, 0.005, 'profile', 'How much the roof bows in side view.', { unit: 'm' }),
  n('rearWindowAngle', 'Rear glass rake', 64, 5, 84, 0.5, 'profile', 'Rear window angle from vertical. Low = hatch/SUV, high = fastback.', { unit: '°' }),
  n('deckHeight', 'Deck height', 1.03, 0.4, 1.9, 0.01, 'profile', 'Height of the trunk lid / rear deck.', { unit: 'm' }),
  n('tailHeight', 'Tail height', 1.00, 0.4, 1.9, 0.01, 'profile', 'Height of the top of the rear face.', { unit: 'm' }),
  n('tailBottom', 'Tail bottom', 0.32, 0.08, 0.8, 0.01, 'profile', 'Height of the rear bumper bottom (departure angle).', { unit: 'm' }),
  n('beltHeight', 'Beltline height', 0.99, 0.5, 1.6, 0.01, 'profile', 'Height of the window sill line at the windshield base.', { unit: 'm' }),
  n('beltRise', 'Beltline rise', 0.05, -0.1, 0.3, 0.005, 'profile', 'How much the beltline rises towards the rear (wedge).', { unit: 'm' }),

  // ---------------- sculpting
  n('noseRoundness', 'Nose plan rounding', 0.38, 0.05, 1.0, 0.01, 'shape', 'How far the front corners sweep back in plan view.', { unit: 'm' }),
  n('noseShape', 'Nose squareness', 3.2, 1.6, 8, 0.1, 'shape', 'Superellipse exponent of the nose: 2 = round, 6 = square.'),
  n('tailRoundness', 'Tail plan rounding', 0.28, 0.05, 1.0, 0.01, 'shape', 'How far the rear corners sweep forward in plan view.', { unit: 'm' }),
  n('tailShape', 'Tail squareness', 3.6, 1.6, 8, 0.1, 'shape', 'Superellipse exponent of the tail.'),
  n('faceRoll', 'Edge roll', 0.09, 0.01, 0.3, 0.005, 'shape', 'Rounding of the top/bottom edges of the front and rear faces.', { unit: 'm' }),
  n('noseLean', 'Nose lean', 0.10, -0.1, 0.4, 0.005, 'shape', 'How far the top of the front face sits behind its bottom (face rake).', { unit: 'm' }),
  n('tailLean', 'Tail lean', 0.06, -0.1, 0.4, 0.005, 'shape', 'How far the top of the rear face sits ahead of its bottom.', { unit: 'm' }),
  n('frontTaper', 'Front taper', 0.05, 0, 0.3, 0.005, 'shape', 'Narrowing of the body towards the nose.', { unit: 'm' }),
  n('rearTaper', 'Rear taper', 0.035, 0, 0.3, 0.005, 'shape', 'Narrowing of the body towards the tail.', { unit: 'm' }),
  n('sideTuck', 'Rocker tuck', 0.06, 0, 0.2, 0.005, 'shape', 'How much the lower body tucks in towards the sills.', { unit: 'm' }),
  n('upperLean', 'Shoulder lean', 0.035, 0, 0.15, 0.005, 'shape', 'Inward lean of the upper body side below the shoulder.', { unit: 'm' }),
  n('frontFlare', 'Front fender flare', 0.025, 0, 0.15, 0.002, 'shape', 'Bulge of the front fenders over the wheels.', { unit: 'm' }),
  n('rearFlare', 'Rear haunch flare', 0.035, 0, 0.18, 0.002, 'shape', 'Bulge of the rear haunches over the wheels.', { unit: 'm' }),
  n('characterLine', 'Character line', 0.008, 0, 0.03, 0.001, 'shape', 'Depth of the crisp crease along the body side.', { unit: 'm' }),
  n('characterHeight', 'Crease height', 0.78, 0.3, 0.95, 0.01, 'shape', 'Crease height as a fraction between sill and beltline.'),
  n('shoulderRadius', 'Shoulder radius', 0.06, 0.01, 0.2, 0.005, 'shape', 'Radius where the body side turns into the hood/deck.', { unit: 'm' }),
  n('bottomRadius', 'Sill radius', 0.05, 0.01, 0.15, 0.005, 'shape', 'Radius of the lower body edge.', { unit: 'm' }),
  n('hoodCrown', 'Hood crown', 0.03, -0.05, 0.12, 0.002, 'shape', 'Cross-section curvature of hood and deck. Negative = fenders stand proud.', { unit: 'm' }),
  n('hoodBulge', 'Power bulge', 0.0, 0, 0.08, 0.002, 'shape', 'Raised centre section of the hood.', { unit: 'm' }),

  // ---------------- cabin
  n('shoulderInset', 'Shoulder width', 0.10, 0.0, 0.35, 0.005, 'cabin', 'Inset of the greenhouse from the body side.', { unit: 'm' }),
  n('tumblehome', 'Tumblehome', 0.28, 0, 0.8, 0.01, 'cabin', 'Inward lean of the side windows (dz/dy).'),
  n('roofCrown', 'Roof crown', 0.05, 0, 0.15, 0.002, 'cabin', 'Cross-section curvature of the roof.', { unit: 'm' }),
  n('roofRadius', 'Roof edge radius', 0.07, 0.01, 0.2, 0.005, 'cabin', 'Radius of the roof side edge (A-pillar roundness).', { unit: 'm' }),
  s('doors', 'Doors', '4', ['2', '4'], 'cabin', 'Door count (affects B-pillar and panel gaps).'),
  n('pillarWidth', 'Pillar width', 0.07, 0.03, 0.2, 0.005, 'cabin', 'A/B pillar width.', { unit: 'm' }),
  n('cPillar', 'C-pillar width', 0.55, 0.04, 0.8, 0.01, 'cabin', 'Width of the C/D pillar at the beltline.', { unit: 'm' }),
  b('blackPillars', 'Floating roof', false, 'cabin', 'Black out the pillars for a floating-roof look.'),
  s('sunroof', 'Roof glass', 'none', ['none', 'sunroof', 'panoramic'], 'cabin', 'Glass roof options.'),
  s('doorHandles', 'Door handles', 'classic', ['classic', 'flush', 'hidden'], 'cabin', 'Door handle style.'),
  b('mirrors', 'Side mirrors', true, 'cabin', 'Add side mirrors.'),

  // ---------------- wheels
  n('rimDiameter', 'Rim diameter', 19, 13, 24, 1, 'wheels', 'Rim diameter in inches.', { unit: 'in' }),
  n('tireWidth', 'Tyre width', 245, 145, 355, 5, 'wheels', 'Tyre section width in millimetres (e.g. 245/40R19).', { unit: 'mm' }),
  n('tireAspect', 'Tyre profile', 40, 25, 85, 5, 'wheels', 'Sidewall height as % of width.', { unit: '%' }),
  s('rimStyle', 'Rim style', 'five_spoke', ['five_spoke', 'multi_spoke', 'split_spoke', 'y_spoke', 'mesh', 'turbine', 'aero', 'steelie', 'deep_dish'], 'wheels', 'Wheel design.'),
  n('spokeCount', 'Spokes', 5, 3, 20, 1, 'wheels', 'Number of spokes / spoke pairs.'),
  s('rimFinish', 'Rim finish', 'silver', ['silver', 'gunmetal', 'black', 'chrome', 'gold', 'bronze', 'white', 'body'], 'wheels', 'Rim material.'),
  n('rimDish', 'Rim concavity', 0.025, 0, 0.08, 0.002, 'wheels', 'How concave the rim face is.', { unit: 'm' }),
  c('caliperColor', 'Caliper colour', '#c8141e', 'wheels', 'Brake caliper colour.'),
  n('archGap', 'Arch gap', 0.035, 0.005, 0.15, 0.001, 'wheels', 'Clearance between tyre and wheel arch.', { unit: 'm' }),
  n('archSquareness', 'Arch shape', 2.0, 2.0, 5.0, 0.1, 'wheels', '2 = round arches, higher = squared (SUV).'),
  n('wheelInset', 'Wheel inset', 0.025, -0.06, 0.12, 0.002, 'wheels', 'How far the tyre face sits inside the body side (negative pokes out).', { unit: 'm' }),
  n('camber', 'Camber', 0, -8, 3, 0.1, 'wheels', 'Wheel camber angle (negative = stance).', { unit: '°' }),
  n('steer', 'Steering angle', 0, -35, 35, 0.5, 'wheels', 'Front wheel steering angle.', { unit: '°' }),

  // ---------------- front
  s('headlightStyle', 'Headlights', 'sleek', ['sleek', 'round', 'rect', 'slim', 'split', 'projector'], 'front', 'Headlight graphic.'),
  n('headlightWidth', 'Headlight width', 0.40, 0.12, 0.8, 0.01, 'front', 'Width of each headlight.', { unit: 'm' }),
  n('headlightHeight', 'Headlight height', 0.11, 0.03, 0.4, 0.005, 'front', 'Height of each headlight.', { unit: 'm' }),
  n('headlightDrop', 'Headlight drop', 0.09, 0.0, 0.5, 0.005, 'front', 'Distance of the headlight centre below the nose top.', { unit: 'm' }),
  n('headlightWrap', 'Headlight wrap', 0.22, 0.0, 0.7, 0.01, 'front', 'How far the headlights wrap back over the fenders.', { unit: 'm' }),
  s('grilleStyle', 'Grille', 'honeycomb', ['honeycomb', 'bars', 'mesh', 'kidney', 'shield', 'slot', 'none'], 'front', 'Grille design (none = EV face).'),
  n('grilleWidth', 'Grille width', 0.70, 0.1, 1.6, 0.01, 'front', 'Grille width.', { unit: 'm' }),
  n('grilleHeight', 'Grille height', 0.17, 0.03, 0.6, 0.005, 'front', 'Grille height.', { unit: 'm' }),
  n('grilleDrop', 'Grille drop', 0.20, 0.03, 0.6, 0.005, 'front', 'Grille centre below the nose top.', { unit: 'm' }),
  b('lowerIntake', 'Lower intake', true, 'front', 'Wide lower air intake.'),
  b('fogLights', 'Fog lights', false, 'front', 'Round fog lights in the bumper.'),
  b('hoodVents', 'Hood vents', false, 'front', 'Heat extractor vents on the hood.'),
  b('sideVents', 'Fender vents', false, 'front', 'Gills behind the front wheels.'),

  // ---------------- rear
  s('taillightStyle', 'Tail lights', 'split', ['split', 'bar', 'round', 'lshape', 'slim'], 'rear', 'Tail light graphic.'),
  n('taillightWidth', 'Tail light width', 0.42, 0.1, 0.9, 0.01, 'rear', 'Width of each tail light.', { unit: 'm' }),
  n('taillightHeight', 'Tail light height', 0.09, 0.02, 0.35, 0.005, 'rear', 'Height of tail lights.', { unit: 'm' }),
  n('taillightDrop', 'Tail light drop', 0.16, 0.0, 0.5, 0.005, 'rear', 'Tail light centre below the tail top.', { unit: 'm' }),
  s('exhaust', 'Exhaust', 'dual', ['none', 'single', 'dual', 'dual_split', 'quad', 'center'], 'rear', 'Exhaust tip layout.'),
  s('exhaustShape', 'Exhaust tips', 'round', ['round', 'oval', 'square'], 'rear', 'Exhaust tip shape.'),
  t('plateText', 'Plate text', 'CARFORGE', 'rear', 'License plate text (empty = no plates).'),
  s('style', 'Body type', 'sedan', ['sedan', 'coupe', 'hatchback', 'wagon', 'suv', 'pickup', 'van', 'sports', 'supercar', 'muscle'], 'rear', 'Body type tag. "pickup" carves an open bed behind the cab.'),
  n('bedDepth', 'Bed depth', 0.5, 0.2, 0.8, 0.01, 'rear', 'Pickup bed depth.', { unit: 'm' }),

  // ---------------- aero / extras
  s('spoiler', 'Spoiler', 'none', ['none', 'lip', 'ducktail', 'wing'], 'aero', 'Rear spoiler type.'),
  n('wingHeight', 'Wing height', 0.24, 0.05, 0.6, 0.01, 'aero', 'Height of the rear wing above the deck.', { unit: 'm' }),
  s('aeroFinish', 'Aero finish', 'carbon', ['carbon', 'body', 'black'], 'aero', 'Material for splitter, wing, skirts, diffuser, mirrors caps.'),
  b('splitter', 'Front splitter', false, 'aero', 'Front splitter lip.'),
  b('sideSkirts', 'Side skirts', false, 'aero', 'Side skirts between the wheels.'),
  b('diffuser', 'Rear diffuser', false, 'aero', 'Rear diffuser with fins.'),
  b('cladding', 'Plastic cladding', false, 'aero', 'Black wheel-arch and sill cladding (SUV / off-road).'),
  b('roofRails', 'Roof rails', false, 'aero', 'Roof rails.'),
  b('sharkFin', 'Shark-fin antenna', true, 'aero', 'Roof antenna.'),
  b('wipers', 'Wipers', true, 'aero', 'Windshield wipers.'),
];

export const CAR_DEFAULTS = Object.fromEntries(CAR_SCHEMA.map((p) => [p.key, p.default]));

// ---------------------------------------------------------------- presets
// Proportions are based on typical class dimensions (e.g. D-segment sedan ~4.7 x 1.85 x 1.45 m, 2.8 m wheelbase;
// mid-engine supercars ~4.5 x 2.0 x 1.15 m with cab-forward cabins; full-size pickups ~5.9 m with 3.7 m wheelbase).
export const CAR_PRESETS = {
  sedan: {
    label: 'Sedan', description: 'Mid-size 4-door saloon (D-segment).',
    params: {},
  },
  sports_coupe: {
    label: 'Sports Coupe', description: 'Front-engine RWD 2+2 coupe with long hood and fastback.',
    params: {
      style: 'coupe', length: 4.55, width: 1.90, height: 1.30, wheelbase: 2.70, frontOverhang: 0.90, groundClearance: 0.12,
      noseHeight: 0.60, noseBottom: 0.16, hoodHeight: 0.90, hoodCurve: 0.04, dashToAxle: 1.15, windshieldAngle: 64,
      roofLength: 0.85, roofCurve: 0.05, rearWindowAngle: 73, deckHeight: 0.95, tailHeight: 0.93, tailBottom: 0.30,
      beltHeight: 0.92, beltRise: 0.06, doors: '2', rimDiameter: 20, tireWidth: 275, tireAspect: 35, rearFlare: 0.06, frontFlare: 0.03,
      tumblehome: 0.38, shoulderInset: 0.13, paintColor: '#0d3fa6', rimStyle: 'y_spoke', rimFinish: 'gunmetal', spoiler: 'ducktail',
      exhaust: 'quad', headlightStyle: 'slim', taillightStyle: 'slim', cPillar: 0.5, splitter: true, diffuser: true, grilleStyle: 'mesh',
      grilleWidth: 0.62, grilleHeight: 0.13,
    },
  },
  supercar: {
    label: 'Supercar', description: 'Mid-engine, cab-forward, very low and wide.',
    params: {
      style: 'supercar', length: 4.55, width: 2.02, height: 1.14, wheelbase: 2.70, frontOverhang: 1.02, groundClearance: 0.10,
      noseHeight: 0.50, noseBottom: 0.12, hoodHeight: 0.80, hoodCurve: 0.07, dashToAxle: 0.32, windshieldAngle: 70,
      roofLength: 0.55, roofCurve: 0.05, rearWindowAngle: 78, deckHeight: 0.98, tailHeight: 0.96, tailBottom: 0.30,
      beltHeight: 0.80, beltRise: 0.14, doors: '2', rimDiameter: 21, tireWidth: 305, tireAspect: 30, frontFlare: 0.05, rearFlare: 0.09,
      tumblehome: 0.55, shoulderInset: 0.22, noseRoundness: 0.45, noseShape: 2.6, faceRoll: 0.06, paintColor: '#f2b705', paintFinish: 'pearl',
      rimStyle: 'split_spoke', spokeCount: 5, rimFinish: 'black', caliperColor: '#f2b705', spoiler: 'wing', wingHeight: 0.16,
      exhaust: 'center', headlightStyle: 'slim', headlightWidth: 0.36, headlightHeight: 0.07, headlightWrap: 0.35, grilleStyle: 'none', lowerIntake: true,
      taillightStyle: 'bar', splitter: true, sideSkirts: true, diffuser: true, sideVents: true, hoodVents: true, cPillar: 0.42, characterLine: 0.012,
      blackPillars: true, upperLean: 0.06, sideTuck: 0.09, hoodCrown: -0.02, archGap: 0.03, wheelInset: 0.015,
    },
  },
  hatchback: {
    label: 'Hatchback', description: 'Compact 5-door hatch (C-segment).',
    params: {
      style: 'hatchback', length: 4.28, width: 1.80, height: 1.46, wheelbase: 2.64, frontOverhang: 0.88, groundClearance: 0.14,
      noseHeight: 0.70, noseBottom: 0.24, hoodHeight: 0.98, hoodCurve: 0.03, dashToAxle: 0.62, windshieldAngle: 60,
      roofLength: 1.55, roofCurve: 0.04, rearWindowAngle: 32, deckHeight: 1.05, tailHeight: 1.05, tailBottom: 0.36,
      beltHeight: 0.99, beltRise: 0.06, rimDiameter: 17, tireWidth: 225, tireAspect: 45, paintColor: '#e8e8e6', paintFinish: 'gloss',
      rimStyle: 'multi_spoke', spokeCount: 10, taillightStyle: 'lshape', cPillar: 0.3, tailRoundness: 0.2, roofCrown: 0.04, exhaust: 'single',
    },
  },
  suv: {
    label: 'SUV', description: 'Mid-size 5-seat SUV with high ride and squared arches.',
    params: {
      style: 'suv', length: 4.80, width: 1.95, height: 1.74, wheelbase: 2.86, frontOverhang: 0.92, groundClearance: 0.21,
      noseHeight: 0.98, noseBottom: 0.36, hoodHeight: 1.20, hoodCurve: 0.03, dashToAxle: 0.82, windshieldAngle: 57,
      roofLength: 1.95, roofCurve: 0.03, rearWindowAngle: 28, deckHeight: 1.30, tailHeight: 1.30, tailBottom: 0.48,
      beltHeight: 1.22, beltRise: 0.04, rimDiameter: 20, tireWidth: 265, tireAspect: 50, archSquareness: 3.2, archGap: 0.045,
      cladding: true, roofRails: true, paintColor: '#2f3a33', paintFinish: 'metallic', rimStyle: 'y_spoke', rimFinish: 'gunmetal',
      tumblehome: 0.18, shoulderInset: 0.08, noseShape: 4.2, tailShape: 4.5, noseRoundness: 0.30, grilleStyle: 'bars', grilleWidth: 0.85,
      grilleHeight: 0.28, grilleDrop: 0.25, headlightStyle: 'rect', headlightHeight: 0.10, taillightStyle: 'split', cPillar: 0.26, fogLights: true,
      sideTuck: 0.05, faceRoll: 0.08, exhaust: 'dual_split',
    },
  },
  pickup: {
    label: 'Pickup Truck', description: 'Full-size crew-cab pickup with open bed.',
    params: {
      style: 'pickup', length: 5.88, width: 2.03, height: 1.92, wheelbase: 3.68, frontOverhang: 0.98, groundClearance: 0.24,
      noseHeight: 1.22, noseBottom: 0.42, hoodHeight: 1.36, hoodCurve: 0.02, dashToAxle: 1.05, windshieldAngle: 56,
      roofLength: 1.40, roofCurve: 0.02, rearWindowAngle: 8, deckHeight: 1.30, tailHeight: 1.30, tailBottom: 0.60,
      beltHeight: 1.36, beltRise: 0.0, bedDepth: 0.52, rimDiameter: 20, tireWidth: 275, tireAspect: 60, archSquareness: 3.6, archGap: 0.05,
      cladding: false, paintColor: '#1b1d22', paintFinish: 'metallic', rimStyle: 'steelie', spokeCount: 6, rimFinish: 'black',
      tumblehome: 0.10, shoulderInset: 0.06, noseShape: 6.0, tailShape: 6.0, noseRoundness: 0.18, tailRoundness: 0.10, faceRoll: 0.05,
      grilleStyle: 'bars', grilleWidth: 1.25, grilleHeight: 0.42, grilleDrop: 0.30, headlightStyle: 'rect', headlightWidth: 0.30, headlightHeight: 0.14,
      headlightDrop: 0.12, headlightWrap: 0.08, taillightStyle: 'slim', taillightWidth: 0.10, taillightHeight: 0.40, taillightDrop: 0.25,
      cPillar: 0.12, frontTaper: 0.02, rearTaper: 0.0, sideTuck: 0.03, upperLean: 0.015, frontFlare: 0.02, rearFlare: 0.02, roofCrown: 0.03,
      exhaust: 'single', fogLights: true, hoodCrown: 0.0, characterHeight: 0.6,
    },
  },
  wagon: {
    label: 'Estate / Wagon', description: 'Long-roof estate with near-vertical tailgate.',
    params: {
      style: 'wagon', length: 4.90, width: 1.86, height: 1.48, wheelbase: 2.90, frontOverhang: 0.92, groundClearance: 0.14,
      noseHeight: 0.68, noseBottom: 0.24, hoodHeight: 0.97, dashToAxle: 0.85, windshieldAngle: 61, roofLength: 2.05, roofCurve: 0.025,
      rearWindowAngle: 30, deckHeight: 1.03, tailHeight: 1.03, tailBottom: 0.34, beltHeight: 0.99, beltRise: 0.05, roofRails: true,
      paintColor: '#5b6770', rimStyle: 'multi_spoke', spokeCount: 10, cPillar: 0.22, tailRoundness: 0.22, taillightStyle: 'split',
    },
  },
  muscle: {
    label: 'Muscle Car', description: 'Classic long-hood, short-deck American muscle.',
    params: {
      style: 'muscle', length: 4.80, width: 1.92, height: 1.36, wheelbase: 2.72, frontOverhang: 0.95, groundClearance: 0.13,
      noseHeight: 0.78, noseBottom: 0.24, hoodHeight: 0.95, hoodCurve: 0.01, dashToAxle: 1.30, windshieldAngle: 60,
      roofLength: 0.90, roofCurve: 0.03, rearWindowAngle: 70, deckHeight: 0.98, tailHeight: 0.96, tailBottom: 0.36,
      beltHeight: 0.96, beltRise: 0.03, doors: '2', noseShape: 5.5, tailShape: 6.0, noseRoundness: 0.18, tailRoundness: 0.12, faceRoll: 0.05,
      rimDiameter: 20, tireWidth: 275, tireAspect: 40, rimStyle: 'deep_dish', spokeCount: 5, rimFinish: 'chrome', hoodBulge: 0.04,
      paintColor: '#d6560f', paintFinish: 'gloss', twoTone: false, grilleStyle: 'bars', grilleWidth: 1.40, grilleHeight: 0.24, grilleDrop: 0.16,
      headlightStyle: 'round', headlightWidth: 0.17, headlightHeight: 0.17, headlightDrop: 0.16, headlightWrap: 0.0,
      taillightStyle: 'bar', taillightHeight: 0.10, rearFlare: 0.05, frontFlare: 0.02, exhaust: 'dual_split', cPillar: 0.48, sideTuck: 0.04,
      upperLean: 0.02, hoodCrown: -0.01, characterLine: 0.01, trimFinish: 'chrome',
    },
  },
  van: {
    label: 'Van / MPV', description: 'One-box people carrier.',
    params: {
      style: 'van', length: 5.10, width: 1.95, height: 1.95, wheelbase: 3.20, frontOverhang: 0.95, groundClearance: 0.16,
      noseHeight: 0.98, noseBottom: 0.30, hoodHeight: 1.12, hoodCurve: 0.02, dashToAxle: 0.35, windshieldAngle: 58,
      roofLength: 2.85, roofCurve: 0.02, rearWindowAngle: 12, deckHeight: 1.12, tailHeight: 1.12, tailBottom: 0.45,
      beltHeight: 1.12, beltRise: 0.0, rimDiameter: 17, tireWidth: 235, tireAspect: 60, paintColor: '#f4f4f2', paintFinish: 'gloss',
      noseShape: 4.0, tailShape: 6.0, noseRoundness: 0.35, tailRoundness: 0.12, tumblehome: 0.08, shoulderInset: 0.05, roofCrown: 0.03,
      cPillar: 0.12, rimStyle: 'aero', taillightStyle: 'slim', taillightWidth: 0.12, taillightHeight: 0.38, taillightDrop: 0.32, grilleStyle: 'slot',
      sideTuck: 0.03, upperLean: 0.015, exhaust: 'none', sharkFin: true,
    },
  },
};

export function carParams(presetOrParams = 'sedan', overrides = {}) {
  const preset = typeof presetOrParams === 'string' ? CAR_PRESETS[presetOrParams] : null;
  const base = preset ? preset.params : presetOrParams || {};
  return sanitizeCarParams({ ...CAR_DEFAULTS, ...base, ...overrides });
}

export function sanitizeCarParams(p) {
  const out = { ...p };
  for (const def of CAR_SCHEMA) {
    let v = out[def.key];
    if (v === undefined || v === null) { out[def.key] = def.default; continue; }
    if (def.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) v = def.default;
      out[def.key] = Math.min(def.max, Math.max(def.min, v));
    } else if (def.type === 'bool') out[def.key] = v === true || v === 'true' || v === 1;
    else if (def.type === 'select') out[def.key] = def.options.includes(String(v)) ? String(v) : def.default;
    else if (def.type === 'color') out[def.key] = /^#?[0-9a-f]{6}$/i.test(String(v)) ? (String(v).startsWith('#') ? String(v) : '#' + v) : def.default;
    else out[def.key] = String(v);
  }
  return out;
}

// Which params affect which part of the build (so the editor can avoid full rebuilds).
export const MATERIAL_ONLY_KEYS = new Set(['paintColor', 'paintFinish', 'twoTone', 'roofColor', 'glassTint', 'lightsOn', 'rimFinish', 'caliperColor', 'aeroFinish', 'trimFinish']);
