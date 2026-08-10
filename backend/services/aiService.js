/**
 * AI service for Arch-3d build.
 *
 * If GEMINI_API_KEY is set (free tier key from https://aistudio.google.com/apikey),
 * requests go to Google's Gemini API for real vision + language analysis,
 * photorealistic rendering, and cost estimation.
 *
 * If no key is configured, everything falls back to OFFLINE_ENGINE: a
 * deterministic, rule-based system that still returns a complete, usable
 * result so the app is fully functional with zero setup and zero cost.
 */

const { GoogleGenAI } = require('@google/genai');

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
// Note: Google retires/renames Gemini models often. If any model below ever
// 404s, check https://ai.google.dev/gemini-api/docs/models for the current
// free-tier model names and update here — the offline engine keeps the app
// working in the meantime either way.
const TEXT_MODEL = 'gemini-3.1-flash-lite';
// Blueprint reading is a precision task (real dimensions, real wall/room
// layout) rather than a creative one, so it gets the stronger non-lite
// Flash model — still free-tier, just more capable at careful spatial
// reading of a photographed/scanned drawing than the lite text model used
// for open-ended chat/estate generation.
const VISION_MODEL = 'gemini-3.6-flash';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

const genAI = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

// ---------------------------------------------------------------------------
// Shared JSON contract for a buildable design (blueprint analysis and chat
// design both produce this same shape, with mode-specific instructions).
// ---------------------------------------------------------------------------
function schemaInstructions({ furnish }) {
  return `
Respond with ONLY valid JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "title": "short project name",
  "category": "one of: house | table | shelving | seating | cabinet | outdoor-structure | frame | generic",
  "summary": "2-3 sentence plain-language description of the design",
  "dimensions": [ {"label": "Height", "value": "5.0 m"}, {"label": "Width", "value": "10.0 m"}, {"label": "Depth", "value": "8.0 m"} ],
  "materials": [ {"name": "Fiber-cement siding", "purpose": "exterior cladding" }, ... 4-8 items ],
  "equipment": [ {"name": "Framing nailer", "note": "wall assembly"}, ... 4-8 items ],
  "steps": [ "short build step 1", "short build step 2", ... 4-6 items ],
  "modelSpec": {
    "parts": [
      {"type":"box","size":[width,height,depth],"position":[x,y,z],"material":"wood|metal|glass|fabric","color":"#hexcode (optional)","group":"structure|roof|window|door|interior|furniture","floor":1,"room":"optional short room name e.g. 'Parlor'"},
      {"type":"cylinder","radiusTop":r,"radiusBottom":r,"height":h,"position":[x,y,z],"material":"wood|metal|glass|fabric","color":"#hexcode (optional)","group":"structure|roof|window|door|interior|furniture","floor":1,"room":"optional short room name"},
      {"group":"roof","roofStyle":"hip|gable|flat|shed","pitch":0.35,"overhang":0.35,"material":"metal|wood","color":"#hexcode","floor":1}
    ]
  }
}
Every part needs a "group" tag:
- "structure": the building envelope. Its own "material" must be "wood", "metal", or "fabric" — NEVER "glass", even for designs described as glassy/floor-to-ceiling windows (represent that with more/larger "window" parts instead; a glass envelope makes the whole building see-through, which is wrong). If the building is a SINGLE story, exactly ONE box for the whole envelope. If it has MULTIPLE stories/floors (e.g. described as two-story, a penthouse atop other floors, an apartment building), create ONE separate structure box PER FLOOR, each stacked at the correct height and each tagged with its own "floor" number (1 = ground floor, 2 = next floor up, etc.) — the viewer turns each floor's envelope into its own real hollow walls with door/window cutouts, and makes each floor independently selectable and draggable so a person can pull one floor away to inspect the others. Every floor needs its own full room layout (not just the ground floor). Never add separate wall boxes alongside a structure envelope — the viewer builds the walls automatically from it.
- "roof": use the SIMPLE roof contract shown above — do NOT hand-place a box/cylinder for the roof. Give ONLY: "roofStyle" (one of "hip", "gable", "flat", "shed" — pick "flat" for anything described as modern/minimalist/contemporary-flat-roofed, "gable" for anything described as pitched/A-frame/traditional-peaked/cabin-style, "shed" for a single mono-pitch lean-to roof, "hip" as the general-purpose default for most houses), "pitch" (roof steepness as rise/run, 0.15=very shallow to 0.9=very steep, 0.35-0.45 is typical), "overhang" (eave overhang in meters past the walls, 0.3-0.6 typical), "material", "color", and "floor" (which floor's envelope it sits on — normally the topmost floor). The renderer computes the actual roof geometry itself, sized exactly to that floor's real envelope — do not, and cannot, get this wrong, so do not add "size" or "position" to a roof part.
- "window": becomes a REAL cut-through opening with a frame, glass, and (on larger windows) a mullion bar automatically added — you only specify the opening. Width ~0.9-1.5m, height ~1-1.4m. At least 3-5 per floor across different walls for a house. Tag with the matching "floor" number of the wall it belongs to.
- "door": becomes a REAL cut-through opening with a door panel filling it. ~0.8-1.0m wide, ~2.0-2.1m tall, base at y=0 relative to its floor. At least one exterior door on the ground floor. Tag with the matching "floor" number.
- "interior": a floor slab per story, PLUS mandatory partition walls that physically divide the floor into distinct enclosed rooms — this is the single most important part of a good response, do not skip or minimize it. First mentally list the rooms this floor needs (a home needs, at minimum: one living/parlor room, one kitchen, one bathroom/toilet, and one bedroom per bedroom described — plus a dining area, garage, or terrace if mentioned), then output real partition wall boxes that physically separate every one of those rooms from its neighbors (walls on at least 2-3 sides per room, not a single line down the middle). A floor with fewer than (room count − 1) × 2 partition wall parts is not acceptable. Tag each with the "room" it belongs to (e.g. "Parlor", "Kitchen", "Toilet", "Bedroom 1", "Garage") and the correct "floor".
  CRITICAL — every partition must have a real doorway opening, never a solid uninterrupted wall: whenever a partition wall would run the full distance between two other walls, split it into TWO separate shorter "interior" box parts placed end-to-end with a gap of about 0.8-1.0m left empty between them (that gap is the doorway — leave it as empty space, do not fill it with anything). Every enclosed room needs at least one such gap in one of its walls connecting it to a hallway or an adjacent room, so a person walking through the model can pass from room to room instead of finding every room sealed shut. Do not center every gap in the middle of its wall — offset most of them toward one end so they don't all form one straight corridor down the center of the building.
- "furniture": ${furnish ? 'REQUIRED — furnish every room appropriately for what it is: sofa/coffee table/TV console for a living room or parlor, table and chairs for a dining room, counters/island for a kitchen, toilet/sink/tub blocks for a bathroom, bed/wardrobe/nightstand for a bedroom, workbench or storage for a garage. Give each piece a fitting "color" so the space reads as warm and professionally decorated, and tag each with the matching "room" and "floor". Add at least 3-5 furniture parts per room — a room with zero furniture is not acceptable.' : 'do not use this group — do not invent furniture that was not shown in the source material; only include structural/fixed elements actually present.'}
The optional "color" field is a specific hex color (e.g. "#3a5f7d") you choose because it suits the design — used instead of the generic material default. Vary it thoughtfully across parts for a designed, non-monotone look. Never use gradients — one flat, considered color per part.
Never represent the object as a single primitive. Break every object into the distinct parts a builder would actually assemble. Buildings must include one "structure" envelope per floor, a "roof" group, several "window" openings, at least one "door" opening, and genuinely room-planned "interior" + "furniture" parts as described above — never a single flat-topped box, and never a single undivided open interior for anything larger than a one-room structure. A response that just adds one or two stray divider walls without enclosing real, separate, named rooms is a failing response — plan the full room layout before writing the parts list.
Keep "parts" between 3 and 60 primitives (furnished multi-room, multi-story buildings need the higher end — a real house/penthouse routinely needs 30-50+ parts once every room is properly walled and furnished) using meters, centered around x=0, resting on y=0 upward, with floor 1 starting at y=0 and each additional floor stacked directly on top of the one below.
`.trim();
}

// ---------------------------------------------------------------------------
// Deterministic safety net: if the model still returns a sparse, barely
// partitioned interior despite the instructions above (smaller/faster free
// models sometimes under-deliver on complex structured output), fill in a
// simple room grid and, for furnished designs, basic furniture — so the
// viewer always shows real room demarcation rather than one open box. Only
// runs for live Gemini output (never touches the hand-authored offline
// templates), and only adds to floors the AI left essentially unplanned.
// ---------------------------------------------------------------------------
function reinforceDesign(result, { furnish }) {
  const spec = result?.modelSpec;
  if (!spec || !Array.isArray(spec.parts) || !spec.parts.length) return result;

  // Belt-and-suspenders: never let the envelope itself be glass, even if
  // the prompt instruction above gets ignored.
  spec.parts.forEach(p => {
    if (p.group === 'structure' && p.material === 'glass') p.material = 'wood';
  });

  const isBuildingLike = spec.parts.some(p => p.group === 'door' || p.group === 'window');
  if (!isBuildingLike) return result;

  const floors = [...new Set(spec.parts.filter(p => p.group === 'structure').map(p => p.floor ?? 1))];

  // Roof safety net: if the AI dropped the roof entirely, or fell back to
  // the old free-form box/cylinder shape instead of the roofStyle contract,
  // replace/add a sane default per floor that actually has a structure
  // envelope to sit on — real geometry beats a missing or malformed roof.
  const topFloorNum = floors.length ? Math.max(...floors) : 1;
  spec.parts = spec.parts.filter(p => !(p.group === 'roof' && !p.roofStyle));
  const hasStyledRoof = spec.parts.some(p => p.group === 'roof' && p.roofStyle);
  if (!hasStyledRoof && floors.length) {
    spec.parts.push({ group: 'roof', roofStyle: 'hip', pitch: 0.4, overhang: 0.4, material: 'metal', color: '#5a4a3a', floor: topFloorNum });
  }

  const palette = ['#8a6d5c', '#5c7a6d', '#7a5230', '#6d5c8a', '#a08a5c', '#5c8a76'];
  let paletteIdx = 0;
  let addedAny = false;

  floors.forEach(floorNum => {
    const envelope = spec.parts.find(p => p.group === 'structure' && (p.floor ?? 1) === floorNum);
    if (!envelope || !envelope.size) return;

    const existingRooms = new Set(
      spec.parts.filter(p => (p.floor ?? 1) === floorNum && p.group === 'interior' && p.room).map(p => p.room)
    );
    if (existingRooms.size >= 3) return; // AI already planned real rooms for this floor — leave it alone

    const [w, h, d] = envelope.size;
    const [cx, cy, cz] = envelope.position || [0, h / 2, 0];
    const baseY = cy - h / 2;
    const thickness = 0.08;
    const wallH = h * 0.85;
    const wallY = baseY + wallH / 2;

    const area = w * d;
    const cols = area > 70 ? 3 : 2;
    const rows = area > 45 ? 2 : 1;
    const colW = w / cols;
    const rowD = d / rows;

    // Pushes a partition segment as two shorter boxes with a gap between
    // them — a real doorway opening — instead of one unbroken wall, so
    // every room this partition encloses still has a way through to its
    // neighbor. Falls back to one solid segment only if the wall is too
    // short to fit a doorway.
    const doorGap = 0.9;
    const pushGappedPartition = (isVertical, fixed, spanStart, spanLen, gapFrac) => {
      const gapCenter = spanStart + spanLen * gapFrac;
      const gapStart = gapCenter - doorGap / 2;
      const gapEnd = gapCenter + doorGap / 2;
      const seg1Len = gapStart - spanStart;
      const seg2Len = (spanStart + spanLen) - gapEnd;
      if (seg1Len < 0.6 || seg2Len < 0.6) {
        const size = isVertical ? [thickness, wallH, spanLen] : [spanLen, wallH, thickness];
        const position = isVertical ? [fixed, wallY, spanStart + spanLen / 2] : [spanStart + spanLen / 2, wallY, fixed];
        spec.parts.push({ type: 'box', size, position, material: 'wood', color: '#d8cdb8', group: 'interior', room: 'auto', floor: floorNum });
        addedAny = true;
        return;
      }
      const seg1Center = spanStart + seg1Len / 2;
      const seg2Center = gapEnd + seg2Len / 2;
      [[seg1Center, seg1Len], [seg2Center, seg2Len]].forEach(([center, len]) => {
        const size = isVertical ? [thickness, wallH, len] : [len, wallH, thickness];
        const position = isVertical ? [fixed, wallY, center] : [center, wallY, fixed];
        spec.parts.push({ type: 'box', size, position, material: 'wood', color: '#d8cdb8', group: 'interior', room: 'auto', floor: floorNum });
      });
      addedAny = true;
    };

    for (let c = 1; c < cols; c++) {
      const x = cx - w / 2 + colW * c;
      pushGappedPartition(true, x, cz - d / 2, d, c % 2 === 0 ? 0.25 : 0.75);
    }
    for (let r = 1; r < rows; r++) {
      const z = cz - d / 2 + rowD * r;
      pushGappedPartition(false, z, cx - w / 2, w, r % 2 === 0 ? 0.7 : 0.3);
    }

    if (furnish) {
      let idx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          idx++;
          const roomCx = cx - w / 2 + colW * (c + 0.5);
          const roomCz = cz - d / 2 + rowD * (r + 0.5);
          const fw = Math.min(colW, rowD) * 0.3;
          spec.parts.push({
            type: 'box', size: [fw, 0.45, fw * 1.4], position: [roomCx, baseY + 0.23, roomCz],
            material: 'fabric', color: palette[paletteIdx++ % palette.length],
            group: 'furniture', room: `Room ${idx}`, floor: floorNum,
          });
        }
      }
    }
  });

  if (addedAny) {
    result.summary = `${result.summary || ''} (Room layout supplemented by Arch-3d build's fallback partitioning where the AI response was under-detailed.)`.trim();
  }
  return result;
}

async function callGemini(parts, { json = true, model = TEXT_MODEL, temperature = 0.5 } = {}) {
  if (!genAI) throw new Error('No Gemini API key configured');
  const response = await genAI.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: json ? { temperature, responseMimeType: 'application/json' } : { temperature },
  });
  return response.text || '';
}

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

// ---------------------------------------------------------------------------
// OFFLINE_ENGINE: keyword-driven templates so the app works with no API key
// ---------------------------------------------------------------------------
const TEMPLATES = {
  table: {
    title: 'Modular Work Table', category: 'table',
    summary: 'A four-legged work table with a flat rectangular top, sized for a workshop or dining setting.',
    dimensions: [ { label: 'Height', value: '0.75 m' }, { label: 'Width', value: '1.40 m' }, { label: 'Depth', value: '0.70 m' } ],
    materials: [
      { name: 'Solid pine or birch plywood, 25mm', purpose: 'tabletop' },
      { name: '4x4 in timber posts', purpose: 'legs' },
      { name: '1x4 in pine boards', purpose: 'stretchers and aprons' },
      { name: 'Wood glue + 3in screws', purpose: 'joinery' },
    ],
    equipment: [
      { name: 'Circular saw or table saw', note: 'straight cuts' },
      { name: 'Drill/driver', note: 'pilot holes and screws' },
      { name: 'Orbital sander', note: 'surface finishing' },
      { name: 'Bar clamps', note: 'glue-up' },
    ],
    steps: [
      'Cut the tabletop panel and four legs to final dimensions.',
      'Cut apron boards and attach to legs with pocket screws.',
      'Add a lower stretcher between legs for rigidity.',
      'Attach the tabletop to the base.',
      'Sand progressively from 120 to 220 grit.',
      'Apply finish.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [1.4, 0.05, 0.7], position: [0, 0.75, 0], material: 'wood' },
      { type: 'box', size: [0.08, 0.7, 0.08], position: [-0.65, 0.35, -0.3], material: 'wood' },
      { type: 'box', size: [0.08, 0.7, 0.08], position: [0.65, 0.35, -0.3], material: 'wood' },
      { type: 'box', size: [0.08, 0.7, 0.08], position: [-0.65, 0.35, 0.3], material: 'wood' },
      { type: 'box', size: [0.08, 0.7, 0.08], position: [0.65, 0.35, 0.3], material: 'wood' },
    ] },
  },
  shelving: {
    title: 'Wall Shelving Unit', category: 'shelving',
    summary: 'An open shelving unit with evenly spaced shelves on two side panels.',
    dimensions: [ { label: 'Height', value: '1.80 m' }, { label: 'Width', value: '0.90 m' }, { label: 'Depth', value: '0.30 m' } ],
    materials: [
      { name: 'Plywood or MDF, 18mm', purpose: 'shelves and sides' },
      { name: 'Edge banding', purpose: 'clean edges' },
      { name: 'Shelf pins', purpose: 'adjustable support' },
    ],
    equipment: [
      { name: 'Track saw', note: 'sheet breakdown' },
      { name: 'Drill/driver', note: 'shelf-pin holes' },
      { name: 'Level', note: 'straight mounting' },
    ],
    steps: [
      'Cut side panels and shelf boards.',
      'Drill shelf-pin holes.',
      'Assemble sides and top/bottom shelves.',
      'Insert adjustable shelves.',
      'Anchor to wall studs.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [0.03, 1.8, 0.3], position: [-0.43, 0.9, 0], material: 'wood' },
      { type: 'box', size: [0.03, 1.8, 0.3], position: [0.43, 0.9, 0], material: 'wood' },
      { type: 'box', size: [0.9, 0.02, 0.3], position: [0, 0.1, 0], material: 'wood' },
      { type: 'box', size: [0.9, 0.02, 0.3], position: [0, 0.9, 0], material: 'wood' },
      { type: 'box', size: [0.9, 0.02, 0.3], position: [0, 1.7, 0], material: 'wood' },
    ] },
  },
  seating: {
    title: 'Slat-Back Bench', category: 'seating',
    summary: 'A sturdy bench with a slatted seat and angled back support.',
    dimensions: [ { label: 'Height', value: '0.85 m' }, { label: 'Width', value: '1.20 m' }, { label: 'Depth', value: '0.45 m' } ],
    materials: [
      { name: 'Cedar or oak boards, 20mm', purpose: 'seat and back slats' },
      { name: '4x4 in timber posts', purpose: 'legs' },
      { name: 'Exterior-grade screws', purpose: 'joinery' },
    ],
    equipment: [
      { name: 'Miter saw', note: 'angled cuts' },
      { name: 'Drill/driver', note: 'assembly' },
      { name: 'Sander', note: 'smooth surfaces' },
    ],
    steps: [
      'Cut legs, seat slats, and back supports.',
      'Assemble leg frames and lower stretcher.',
      'Fasten seat slats.',
      'Attach back uprights and slats.',
      'Sand and finish.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [1.2, 0.04, 0.08], position: [0, 0.45, -0.18], material: 'wood' },
      { type: 'box', size: [1.2, 0.04, 0.08], position: [0, 0.45, 0.18], material: 'wood' },
      { type: 'box', size: [0.08, 0.45, 0.08], position: [-0.55, 0.22, -0.15], material: 'wood' },
      { type: 'box', size: [0.08, 0.45, 0.08], position: [0.55, 0.22, -0.15], material: 'wood' },
      { type: 'box', size: [0.08, 0.4, 0.06], position: [-0.55, 0.68, -0.2], material: 'wood' },
      { type: 'box', size: [0.08, 0.4, 0.06], position: [0.55, 0.68, -0.2], material: 'wood' },
      { type: 'box', size: [1.2, 0.04, 0.06], position: [0, 0.82, -0.22], material: 'wood' },
    ] },
  },
  cabinet: {
    title: 'Enclosed Storage Cabinet', category: 'cabinet',
    summary: 'A boxed storage cabinet with a hinged door and one interior shelf.',
    dimensions: [ { label: 'Height', value: '0.90 m' }, { label: 'Width', value: '0.60 m' }, { label: 'Depth', value: '0.40 m' } ],
    materials: [
      { name: 'Plywood, 18mm', purpose: 'carcass' },
      { name: 'Concealed hinges', purpose: 'door movement' },
    ],
    equipment: [
      { name: 'Track saw', note: 'sheet breakdown' },
      { name: 'Hinge-boring bit', note: 'hinge cups' },
    ],
    steps: [
      'Cut carcass panels.',
      'Assemble carcass square.',
      'Fit interior shelf.',
      'Hang and align door.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [0.6, 0.02, 0.4], position: [0, 0.89, 0], material: 'wood' },
      { type: 'box', size: [0.6, 0.02, 0.4], position: [0, 0.01, 0], material: 'wood' },
      { type: 'box', size: [0.02, 0.9, 0.4], position: [-0.29, 0.45, 0], material: 'wood' },
      { type: 'box', size: [0.02, 0.9, 0.4], position: [0.29, 0.45, 0], material: 'wood' },
      { type: 'box', size: [0.58, 0.85, 0.02], position: [0, 0.46, 0.2], material: 'metal' },
    ] },
  },
  'outdoor-structure': {
    title: 'Garden Storage Shed', category: 'outdoor-structure',
    summary: 'A small hip-roofed outdoor structure for tool storage.',
    dimensions: [ { label: 'Height', value: '2.20 m' }, { label: 'Width', value: '2.40 m' }, { label: 'Depth', value: '1.80 m' } ],
    materials: [
      { name: '2x4 in pressure-treated lumber', purpose: 'framing' },
      { name: 'Exterior plywood, 12mm', purpose: 'sheathing' },
      { name: 'Asphalt roofing shingles', purpose: 'weatherproofing' },
    ],
    equipment: [
      { name: 'Circular saw', note: 'framing cuts' },
      { name: 'Framing nailer', note: 'assembly' },
      { name: 'Level', note: 'square foundation' },
    ],
    steps: [
      'Set the foundation.',
      'Build and raise wall frames.',
      'Sheath walls.',
      'Frame and raise the roof.',
      'Install shingles and door.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [2.4, 1.6, 1.8], position: [0, 0.8, 0], material: 'wood', group: 'structure' },
      { group: 'roof', roofStyle: 'hip', pitch: 0.5, overhang: 0.35, material: 'metal', color: '#5a4a3a', floor: 1 },
      { type: 'box', size: [0.55, 0.55, 0.03], position: [-0.7, 0.95, 0.92], material: 'glass', group: 'window' },
      { type: 'box', size: [0.55, 0.55, 0.03], position: [0.7, 0.95, 0.92], material: 'glass', group: 'window' },
      { type: 'box', size: [0.6, 1.3, 0.03], position: [-0.05, 0.65, 0.92], material: 'wood', group: 'door' },
      { type: 'box', size: [2.3, 0.03, 1.7], position: [0, 0.03, 0], material: 'wood', group: 'interior' },
    ] },
  },
  frame: {
    title: 'Structural Frame', category: 'frame',
    summary: 'A rectangular support frame for general fabrication.',
    dimensions: [ { label: 'Height', value: '1.00 m' }, { label: 'Width', value: '1.00 m' }, { label: 'Depth', value: '0.50 m' } ],
    materials: [ { name: 'Steel box tubing, 25x25mm', purpose: 'frame members' } ],
    equipment: [ { name: 'Angle grinder', note: 'cutting' }, { name: 'MIG welder', note: 'joining' } ],
    steps: [ 'Cut tubing to length.', 'Dry-fit and clamp square.', 'Weld and grind smooth.', 'Prime and paint.' ],
    modelSpec: { parts: [
      { type: 'box', size: [1.0, 0.03, 0.03], position: [0, 1.0, -0.25], material: 'metal' },
      { type: 'box', size: [1.0, 0.03, 0.03], position: [0, 1.0, 0.25], material: 'metal' },
      { type: 'box', size: [0.03, 1.0, 0.03], position: [-0.5, 0.5, -0.25], material: 'metal' },
      { type: 'box', size: [0.03, 1.0, 0.03], position: [0.5, 0.5, -0.25], material: 'metal' },
      { type: 'box', size: [0.03, 1.0, 0.03], position: [-0.5, 0.5, 0.25], material: 'metal' },
      { type: 'box', size: [0.03, 1.0, 0.03], position: [0.5, 0.5, 0.25], material: 'metal' },
    ] },
  },
  house: {
    title: 'Three-Bedroom House', category: 'house',
    summary: 'A single-story, three-bedroom home with a hip roof, exterior windows, a front door, and a furnished interior layout, viewable once the roof is toggled off.',
    dimensions: [ { label: 'Height (to roof peak)', value: '5.00 m' }, { label: 'Width', value: '10.00 m' }, { label: 'Depth', value: '8.00 m' } ],
    materials: [
      { name: 'Concrete slab foundation', purpose: 'base structure' },
      { name: '2x6 in timber wall framing', purpose: 'load-bearing walls' },
      { name: 'Fiber-cement exterior siding', purpose: 'weatherproof cladding' },
      { name: 'Asphalt shingle roofing', purpose: 'roof weatherproofing' },
      { name: 'Double-glazed vinyl windows', purpose: 'natural light, insulation' },
      { name: 'Drywall interior partitions', purpose: 'room division' },
    ],
    equipment: [
      { name: 'Concrete mixer', note: 'foundation pour' },
      { name: 'Framing nailer', note: 'wall and roof framing' },
      { name: 'Circular saw', note: 'lumber cuts' },
      { name: 'Level & laser level', note: 'square, plumb walls' },
      { name: 'Ladder / scaffolding', note: 'roof work' },
    ],
    steps: [
      'Pour and cure the concrete slab foundation.',
      'Frame and raise exterior walls, then interior partitions.',
      'Frame and sheath the hip roof.',
      'Install windows, door, and exterior siding.',
      'Apply roofing shingles.',
      'Complete interior drywall and finish work.',
    ],
    modelSpec: { parts: [
      { type: 'box', size: [10, 3.2, 8], position: [0, 1.6, 0], material: 'wood', group: 'structure' },
      { group: 'roof', roofStyle: 'hip', pitch: 0.4, overhang: 0.45, material: 'metal', color: '#5a4a3a', floor: 1 },
      { type: 'box', size: [1.2, 1.2, 0.05], position: [-2.5, 1.8, 4.02], material: 'glass', group: 'window' },
      { type: 'box', size: [1.2, 1.2, 0.05], position: [2.5, 1.8, 4.02], material: 'glass', group: 'window' },
      { type: 'box', size: [0.05, 1.2, 1.2], position: [-5.02, 1.8, -1], material: 'glass', group: 'window' },
      { type: 'box', size: [0.05, 1.2, 1.2], position: [5.02, 1.8, 1.5], material: 'glass', group: 'window' },
      { type: 'box', size: [0.9, 2.05, 0.05], position: [0, 1.025, 4.02], material: 'wood', color: '#6b4a2f', group: 'door' },
      { type: 'box', size: [9.6, 0.05, 7.6], position: [0, 0.03, 0], material: 'wood', color: '#c9b28a', group: 'interior' },
      { type: 'box', size: [0.05, 3.0, 7.6], position: [-2, 1.6, 0], material: 'wood', group: 'interior' },
      { type: 'box', size: [0.05, 3.0, 7.6], position: [2, 1.6, 0], material: 'wood', group: 'interior' },
      { type: 'box', size: [1.6, 0.5, 2.0], position: [-3.5, 0.28, 2.5], material: 'fabric', color: '#8a6d5c', group: 'furniture' },
      { type: 'box', size: [1.2, 0.75, 0.7], position: [3.5, 0.4, -3], material: 'wood', color: '#7a5230', group: 'furniture' },
      { type: 'box', size: [1.8, 0.45, 0.9], position: [-3.5, 0.23, -3], material: 'fabric', color: '#5c7a6d', group: 'furniture' },
    ] },
  },
};

const KEYWORD_MAP = [
  { cat: 'table', words: ['table', 'desk', 'workbench', 'counter'] },
  { cat: 'shelving', words: ['shelf', 'shelving', 'bookcase', 'rack'] },
  { cat: 'seating', words: ['bench', 'chair', 'seat', 'stool'] },
  { cat: 'cabinet', words: ['cabinet', 'cupboard', 'closet', 'wardrobe', 'drawer'] },
  { cat: 'house', words: ['house', 'home', 'bungalow', 'cottage', 'bedroom', 'apartment', 'duplex', 'floor plan', 'blueprint'] },
  { cat: 'outdoor-structure', words: ['shed', 'deck', 'pergola', 'fence', 'gazebo', 'coop', 'barn'] },
  { cat: 'frame', words: ['frame', 'stand', 'mount', 'bracket'] },
];

function detectCategory(text) {
  const t = (text || '').toLowerCase();
  for (const entry of KEYWORD_MAP) {
    if (entry.words.some(w => t.includes(w))) return entry.cat;
  }
  return null;
}

function offlineDesign(hintText, fileName) {
  const cat = detectCategory(hintText) || detectCategory(fileName) || 'house';
  const tpl = TEMPLATES[cat] || TEMPLATES.house;
  return JSON.parse(JSON.stringify(tpl));
}

function offlineChatReply(message) {
  const result = offlineDesign(message, '');
  const reply = `Here's a concept for "${result.title}" based on what you described — dimensions, materials, equipment, and a furnished 3D preview on the right. Tell me what to change (room count, size, style, colors) and I'll refine it.`;
  return { reply, result };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function analyzeBlueprint({ base64, mimeType, fileName, notes }) {
  if (genAI) {
    try {
      const groundingInstructions = `Before writing "modelSpec", first fill in a "sourceReading" object (this must appear FIRST in your JSON, before any other field) so you reason from what's actually on the page rather than guessing:
{
  "sourceReading": {
    "scale": "the drawing's stated scale/scale-bar, or 'not indicated — estimated from typical room sizes' if absent",
    "overallDimensions": "the building's overall footprint width x depth, converted to meters",
    "roomsDetected": [ {"name": "room label as written on the plan", "approxSize": "w x d in meters"}, ... one entry per labeled room ],
    "wallsAndOpenings": "brief note on wall lines, door swings, and window markers you can see and their approximate positions"
  }
}
Every numeric value you then put in "modelSpec" (envelope size, partition positions, window/door placement) must be consistent with the measurements you just wrote in "sourceReading" — do not silently change proportions or invent a different scale between the two. If a dimension truly isn't legible, say so in sourceReading and use a reasonable typical value rather than a random guess, and note the assumption in "summary".`;
      const parts = [
        { text: `You are a professional architect's assistant. The uploaded image is likely a floor plan, blueprint, elevation drawing, or a photo of a building/structure. Read any labeled dimensions, room names, wall lines, door/window markers, and scale indicators as precisely as possible, and reconstruct them as an accurate to-scale 3D design — prioritize matching the real proportions and layout shown over creative interpretation. Do not invent furniture or decor that isn't indicated in the source. ${notes ? `Architect's notes: ${notes}.` : ''}\n\n${groundingInstructions}\n\n${schemaInstructions({ furnish: false })}` },
        { inlineData: { mimeType, data: base64 } },
      ];
      // Blueprint reading needs faithful, low-variance extraction rather
      // than creative variety, so it uses the stronger vision model at a
      // low temperature (see VISION_MODEL note above) instead of the
      // lite/default-temperature settings used for open-ended chat design.
      const text = await callGemini(parts, { model: VISION_MODEL, temperature: 0.15 });
      const json = reinforceDesign(JSON.parse(stripFences(text)), { furnish: false });
      return { ...json, engine: 'gemini' };
    } catch (err) {
      console.error('Gemini blueprint analysis failed, falling back to offline engine:', err.message);
    }
  }
  const offline = offlineDesign(notes, fileName);
  return { ...offline, engine: 'offline' };
}

async function chatDesign({ message, history }) {
  if (genAI) {
    try {
      const convo = (history || []).map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
      const parts = [
        { text: `You are a professional architectural design assistant embedded in an app called Arch-3d build. A user is describing a building or space they want designed. Conversation so far:\n${convo}\nUser: ${message}\n\n${schemaInstructions({ furnish: true })}` },
      ];
      const text = await callGemini(parts);
      const json = reinforceDesign(JSON.parse(stripFences(text)), { furnish: true });
      return {
        reply: json.title ? `Here's a furnished concept for "${json.title}".` : 'Here is a concept based on your description.',
        result: { ...json, engine: 'gemini' },
      };
    } catch (err) {
      console.error('Gemini chat design failed, falling back to offline engine:', err.message);
    }
  }
  const offline = offlineChatReply(message);
  return { reply: offline.reply, result: { ...offline.result, engine: 'offline' } };
}

// ---------------------------------------------------------------------------
// Photorealistic concept render (separate from the interactive 3D preview)
// ---------------------------------------------------------------------------
// Note: gemini-2.5-flash-image is Google's free-tier image model as of
// mid-2026 but Google has scheduled it to retire Oct 2, 2026 — check
// https://ai.google.dev/gemini-api/docs/models for its replacement if this
// starts failing. Treated as optional/best-effort everywhere: if it fails
// for any reason, the rest of the app keeps working without it.
async function generateRenderImage({ title, summary, materials }) {
  if (!genAI) return null;
  try {
    const materialNames = (materials || []).slice(0, 4).map(m => m.name).join(', ');
    const prompt = `Professional architectural visualization photograph of: ${title}. ${summary} Primary materials: ${materialNames}. Style: photorealistic 3D architectural render, natural daylight, clean composition, high detail, no people, no text overlays, no watermark, no logo.`;
    const response = await genAI.models.generateContent({ model: IMAGE_MODEL, contents: prompt });
    const parts = response?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData);
    if (!imagePart) return null;
    return { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType || 'image/png' };
  } catch (err) {
    console.error('Render image generation failed (non-fatal):', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cost estimate — attempts real Google Search grounding for current pricing;
// falls back to reasoning-only AI estimate, then a rough offline formula.
// Always clearly labeled to the user as an approximation either way.
// ---------------------------------------------------------------------------
async function generateCostEstimate({ title, summary, materials, equipment, dimensions, budget, location }) {
  const materialList = (materials || []).map(m => m.name).join(', ');
  const equipmentList = (equipment || []).map(e => e.name).join(', ');
  const dimensionList = (dimensions || []).map(d => `${d.label}: ${d.value}`).join(', ');
  const basePrompt = `You are a construction cost estimator. Project: "${title}". ${summary} Dimensions: ${dimensionList}. Materials: ${materialList}. Equipment/labor involved: ${equipmentList}. ${budget ? `The person's stated budget is ${budget}.` : 'No budget was given.'} ${location ? `The project location is: ${location}. Use realistic costs and typical pricing for that specific location, and give the estimate in that location's local currency.` : 'No location was given — estimate for a typical US project and use USD.'}
Give a realistic, current, rough-order-of-magnitude cost estimate. Respond with ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{
  "currency": "3-letter ISO currency code appropriate for the location, e.g. USD, NGN, GBP, EUR, INR",
  "currencySymbol": "the common symbol or prefix for that currency, e.g. $, \u20a6, \u00a3, \u20ac, \u20b9",
  "materialsLow": number, "materialsHigh": number,
  "laborLow": number, "laborHigh": number,
  "timeline": "short human-readable estimate, e.g. '4-6 months'",
  "budgetNote": "1-2 sentences directly addressing whether the stated budget is realistic for this scope and location, or general advice if no budget was given",
  "notes": "1-2 sentences on what most affects the price range for this location (import costs, local labor rates, finish level, etc.)"
}
All numbers are plain numbers in the chosen local currency, no symbols or commas.`;

  if (genAI) {
    // Attempt 1: with Google Search grounding for more current, location-aware figures.
    try {
      const response = await genAI.models.generateContent({
        model: TEXT_MODEL,
        contents: [{ role: 'user', parts: [{ text: basePrompt }] }],
        config: { temperature: 0.3, tools: [{ googleSearch: {} }] },
      });
      const json = JSON.parse(stripFences(response.text || ''));
      return { ...json, grounded: true, engine: 'gemini' };
    } catch (err) {
      console.error('Grounded cost estimate failed, trying ungrounded:', err.message);
    }
    // Attempt 2: plain reasoning, no search grounding.
    try {
      const text = await callGemini([{ text: basePrompt }]);
      const json = JSON.parse(stripFences(text));
      return { ...json, grounded: false, engine: 'gemini' };
    } catch (err) {
      console.error('Ungrounded cost estimate failed, falling back to offline formula:', err.message);
    }
  }

  // Offline fallback: rough area-based US formula, clearly approximate.
  // No AI reasoning available offline, so this always estimates in USD
  // regardless of location — noted plainly to the person in budgetNote.
  const widthMatch = (dimensions || []).find(d => /width/i.test(d.label));
  const depthMatch = (dimensions || []).find(d => /depth/i.test(d.label));
  const width = widthMatch ? parseFloat(widthMatch.value) : 10;
  const depth = depthMatch ? parseFloat(depthMatch.value) : 8;
  const sqm = (isFinite(width) ? width : 10) * (isFinite(depth) ? depth : 8);
  const sqft = sqm * 10.76;
  return {
    currency: 'USD',
    currencySymbol: '$',
    materialsLow: Math.round(sqft * 90),
    materialsHigh: Math.round(sqft * 160),
    laborLow: Math.round(sqft * 60),
    laborHigh: Math.round(sqft * 110),
    timeline: sqft > 1500 ? '6-10 months' : '3-6 months',
    budgetNote: (location
      ? `This offline formula always estimates in USD and can't account for ${location} specifically — connect a Gemini API key for a location-aware, local-currency estimate. `
      : 'Add a budget and location above for a direct, location-aware comparison. ') +
      'This is a rough national average, not a live estimate — always get local contractor quotes.',
    notes: 'Offline formula based on typical US per-square-foot ranges; actual costs vary heavily by region, finish level, and site conditions.',
    grounded: false,
    engine: 'offline',
  };
}

// ---------------------------------------------------------------------------
// ESTATE / COMPOUND GENERATION
//
// An estate is generated as N independent buildings (each reusing the same
// proven single-building JSON contract above, so each house gets the same
// real walls/openings/rooms quality as a standalone design) plus a SEPARATE,
// purely procedural site-layout step that places them on the site.
//
// The layout is deliberately NOT left to the AI: grid math guarantees
// non-overlapping footprints and consistent road spacing every time, which
// is the "geometric correctness before visual decoration" principle this
// app is built around — an AI-guessed layout could plausibly overlap houses
// or ignore the site boundary, a procedural one cannot.
// ---------------------------------------------------------------------------

async function generateEstateBuilding({ description, index, total }) {
  if (genAI) {
    try {
      const variation = `This is building ${index} of ${total} in a residential estate/compound. Estate brief: "${description}". Give this specific building its own distinct footprint, room count, and roofline appropriate to the brief — vary its size/bedroom count/style slightly from a "typical" building matching the brief so the estate doesn't look like ${total} identical clones, while staying consistent with the overall estate description and any per-house instructions in it (e.g. "houses 2-5 should be 3-bedroom duplexes").`;
      const parts = [{ text: `You are a professional architectural design assistant generating ONE building within a larger estate project.\n${variation}\n\n${schemaInstructions({ furnish: true })}` }];
      const text = await callGemini(parts);
      const json = reinforceDesign(JSON.parse(stripFences(text)), { furnish: true });
      return { ...json, engine: 'gemini' };
    } catch (err) {
      console.error(`Estate building ${index}/${total} generation failed, using offline template:`, err.message);
    }
  }
  // Offline fallback: cycle a house template with a per-index scale variation
  // so buildings in the estate are still visually distinguishable from
  // each other, clearly labeled as offline/procedural (never claimed as AI).
  const offline = offlineDesign(description, '');
  const scale = 0.82 + ((index - 1) % 5) * 0.09;
  const scaled = JSON.parse(JSON.stringify(offline));
  scaled.title = `${offline.title} (variant ${index})`;
  scaled.modelSpec.parts = (scaled.modelSpec.parts || []).map(p => ({
    ...p,
    size: p.size ? p.size.map(v => v * scale) : p.size,
    radiusTop: p.radiusTop != null ? p.radiusTop * scale : p.radiusTop,
    radiusBottom: p.radiusBottom != null ? p.radiusBottom * scale : p.radiusBottom,
    height: p.type === 'cylinder' && p.height != null ? p.height * scale : p.height,
    position: p.position ? p.position.map(v => v * scale) : p.position,
  }));
  return { ...scaled, engine: 'offline' };
}

// Small bounded-concurrency helper — keeps several Gemini calls in flight
// at once (faster than fully sequential) without firing all N at once
// (which risks free-tier rate limits on larger estates).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Reads each building's own generated geometry to get its real footprint
// (bounding box in the X/Z plane), rather than assuming a fixed lot size —
// so the procedural layout below fits the buildings that actually exist.
function computeFootprint(modelSpec) {
  const parts = modelSpec?.parts || [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  parts.forEach(p => {
    const [x = 0, , z = 0] = p.position || [0, 0, 0];
    let halfW = 0.5, halfD = 0.5;
    if (p.type === 'cylinder') {
      const r = Math.max(p.radiusTop ?? 0, p.radiusBottom ?? 0, 0.3);
      halfW = r; halfD = r;
    } else if (p.size) {
      halfW = (p.size[0] || 1) / 2;
      halfD = (p.size[2] || 1) / 2;
    }
    minX = Math.min(minX, x - halfW); maxX = Math.max(maxX, x + halfW);
    minZ = Math.min(minZ, z - halfD); maxZ = Math.max(maxZ, z + halfD);
  });
  if (!isFinite(minX)) return { width: 10, depth: 8 };
  return { width: Math.max(maxX - minX, 3), depth: Math.max(maxZ - minZ, 3) };
}

// Deterministic grid placement with a fixed road-width gap between every
// building on both axes. Guarantees zero footprint overlap by construction.
function layoutEstate(buildings, siteWidth, siteDepth) {
  const ROAD_GAP = 6;
  const SETBACK = 3;
  const footprints = buildings.map(b => computeFootprint(b.modelSpec));
  const cellW = Math.max(...footprints.map(f => f.width), 6) + ROAD_GAP;
  const cellD = Math.max(...footprints.map(f => f.depth), 6) + ROAD_GAP;
  const usableWidth = Math.max((siteWidth || 0) - SETBACK * 2, cellW);
  const cols = Math.max(1, Math.min(buildings.length, Math.floor(usableWidth / cellW) || 1));
  const rows = Math.ceil(buildings.length / cols);

  const positions = buildings.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: -((cols - 1) * cellW) / 2 + col * cellW,
      z: -((rows - 1) * cellD) / 2 + row * cellD,
    };
  });

  return {
    positions,
    site: {
      width: Math.max(siteWidth || 0, cols * cellW + SETBACK * 2),
      depth: Math.max(siteDepth || 0, rows * cellD + SETBACK * 2),
      cols, rows, roadGap: ROAD_GAP,
    },
  };
}

async function generateEstate({ description, buildingCount, siteWidth, siteDepth }) {
  const count = Math.max(1, Math.min(10, Number(buildingCount) || 4));
  const indices = Array.from({ length: count }, (_, i) => i + 1);
  const buildingResults = await mapWithConcurrency(indices, 3, (i) =>
    generateEstateBuilding({ description, index: i, total: count })
  );

  const { positions, site } = layoutEstate(buildingResults, Number(siteWidth) || 60, Number(siteDepth) || 60);
  const engine = buildingResults.some(b => b.engine === 'gemini') ? 'gemini' : 'offline';

  const buildings = buildingResults.map((b, i) => ({
    name: b.title || `House ${String(i + 1).padStart(2, '0')}`,
    position: [positions[i].x, positions[i].z],
    rotation: 0,
    category: b.category || 'house',
    summary: b.summary || '',
    dimensions: b.dimensions || [],
    materials: b.materials || [],
    modelSpec: b.modelSpec || { parts: [] },
  }));

  return {
    title: description ? `Estate — ${description.slice(0, 60)}` : 'New Residential Estate',
    summary: `A ${count}-building estate generated from: "${description || 'no brief given'}".`,
    site,
    buildings,
    engine,
  };
}

module.exports = {
  analyzeBlueprint,
  chatDesign,
  generateRenderImage,
  generateCostEstimate,
  generateEstate,
  isOnline: () => Boolean(GEMINI_KEY),
};
