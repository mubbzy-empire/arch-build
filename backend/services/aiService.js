/**
 * AI service for ArchVision.
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
      {"type":"box","size":[width,height,depth],"position":[x,y,z],"material":"wood|metal|glass|fabric","color":"#hexcode (optional)","group":"structure|roof|window|door|interior|furniture"},
      {"type":"cylinder","radiusTop":r,"radiusBottom":r,"height":h,"position":[x,y,z],"material":"wood|metal|glass|fabric","color":"#hexcode (optional)","group":"structure|roof|window|door|interior|furniture"}
    ]
  }
}
Every part needs a "group" tag:
- "structure": for buildings, exactly ONE box representing the outer building envelope (true exterior width/height/depth) — the viewer automatically turns this into real hollow walls with real door/window openings cut through it, so don't add separate wall boxes yourself. For furniture/objects, used normally for legs, frame, body, etc.
- "roof": roof/lid/top-cover geometry, its own separate part(s) so it can be toggled off in the viewer.
- "window": for buildings, becomes a REAL cut-through opening with glass filling it. Width ~0.9-1.5m, height ~1-1.4m, positioned at its center point on the relevant wall's outer face. At least 3-5 across different walls for a house.
- "door": for buildings, becomes a REAL cut-through opening with a door panel filling it. ~0.8-1.0m wide, ~2.0-2.1m tall, base touching the floor (y starting at 0). At least one required.
- "interior": floor slab, and for multi-room buildings, simple thin partition walls dividing space roughly per room.
- "furniture": ${furnish ? 'REQUIRED for houses/rooms — add realistic furniture and fixtures per room (beds, sofas, tables, chairs, kitchen counters, etc.) sized and positioned sensibly within the interior, each with a fitting "color" so the space reads as a warm, professionally decorated home once furnished. Add at least 6-14 furniture parts across the rooms for a house.' : 'do not use this group — do not invent furniture that was not shown in the source material; only include structural/fixed elements actually present.'}
The optional "color" field is a specific hex color (e.g. "#3a5f7d") you choose because it suits the design — used instead of the generic material default. Use it thoughtfully and vary it across parts for a designed, non-monotone look, especially for furniture and interior surfaces. Never use gradients — one flat, considered color per part.
Never represent the object as a single primitive — a lone box or cylinder is never an acceptable answer. Break every object into the distinct parts a builder would actually assemble. Buildings must include exactly one "structure" envelope box, a "roof" group, several "window" openings, at least one "door" opening, and "interior" parts (floor + room dividers) — never a single flat-topped box, and never extra solid wall boxes alongside the structure envelope since that would block the cutouts.
Keep "parts" between 3 and 30 primitives (furnished houses need the higher end) using meters, centered around x=0, resting on y=0 upward.
`.trim();
}

async function callGemini(parts, { json = true } = {}) {
  if (!genAI) throw new Error('No Gemini API key configured');
  const response = await genAI.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: 'user', parts }],
    config: json ? { temperature: 0.5, responseMimeType: 'application/json' } : { temperature: 0.3 },
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
      { type: 'cylinder', radiusTop: 0.001, radiusBottom: 1.3, height: 0.9, position: [0, 2.05, 0], material: 'metal', group: 'roof' },
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
      { type: 'cylinder', radiusTop: 0.001, radiusBottom: 7.2, height: 1.8, position: [0, 4.1, 0], material: 'metal', color: '#5a4a3a', group: 'roof' },
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
      const parts = [
        { text: `You are a professional architect's assistant. The uploaded image is likely a floor plan, blueprint, elevation drawing, or a photo of a building/structure. Read any labeled dimensions, room names, wall lines, door/window markers, and scale indicators as precisely as possible, and reconstruct them as an accurate to-scale 3D design — prioritize matching the real proportions and layout shown over creative interpretation. Do not invent furniture or decor that isn't indicated in the source. ${notes ? `Architect's notes: ${notes}.` : ''}\n${schemaInstructions({ furnish: false })}` },
        { inlineData: { mimeType, data: base64 } },
      ];
      const text = await callGemini(parts);
      const json = JSON.parse(stripFences(text));
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
        { text: `You are a professional architectural design assistant embedded in an app called ArchVision. A user is describing a building or space they want designed. Conversation so far:\n${convo}\nUser: ${message}\n\n${schemaInstructions({ furnish: true })}` },
      ];
      const text = await callGemini(parts);
      const json = JSON.parse(stripFences(text));
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
async function generateCostEstimate({ title, summary, materials, equipment, dimensions, budget }) {
  const materialList = (materials || []).map(m => m.name).join(', ');
  const equipmentList = (equipment || []).map(e => e.name).join(', ');
  const dimensionList = (dimensions || []).map(d => `${d.label}: ${d.value}`).join(', ');
  const basePrompt = `You are a construction cost estimator. Project: "${title}". ${summary} Dimensions: ${dimensionList}. Materials: ${materialList}. Equipment/labor involved: ${equipmentList}. ${budget ? `The person's stated budget is $${budget}.` : 'No budget was given.'}
Give a realistic, current, rough-order-of-magnitude cost estimate for a typical US project of this kind. Respond with ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{
  "materialsLow": number, "materialsHigh": number,
  "laborLow": number, "laborHigh": number,
  "timeline": "short human-readable estimate, e.g. '4-6 months'",
  "budgetNote": "1-2 sentences directly addressing whether the stated budget is realistic for this scope, or general advice if no budget was given",
  "notes": "1-2 sentences on what most affects the price range (region, finish level, etc.)"
}
All numbers in USD, no currency symbols or commas, just plain numbers.`;

  if (genAI) {
    // Attempt 1: with Google Search grounding for more current figures.
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
  const widthMatch = (dimensions || []).find(d => /width/i.test(d.label));
  const depthMatch = (dimensions || []).find(d => /depth/i.test(d.label));
  const width = widthMatch ? parseFloat(widthMatch.value) : 10;
  const depth = depthMatch ? parseFloat(depthMatch.value) : 8;
  const sqm = (isFinite(width) ? width : 10) * (isFinite(depth) ? depth : 8);
  const sqft = sqm * 10.76;
  return {
    materialsLow: Math.round(sqft * 90),
    materialsHigh: Math.round(sqft * 160),
    laborLow: Math.round(sqft * 60),
    laborHigh: Math.round(sqft * 110),
    timeline: sqft > 1500 ? '6-10 months' : '3-6 months',
    budgetNote: budget
      ? 'This offline estimate is a rough national average formula, not a live market lookup — connect a Gemini API key for a more informed estimate, and always get local contractor quotes.'
      : 'Add a budget above for a direct comparison. This is a rough national average, not a live estimate — connect a Gemini API key for better figures.',
    notes: 'Offline formula based on typical US per-square-foot ranges; actual costs vary heavily by region, finish level, and site conditions.',
    grounded: false,
    engine: 'offline',
  };
}

module.exports = {
  analyzeBlueprint,
  chatDesign,
  generateRenderImage,
  generateCostEstimate,
  isOnline: () => Boolean(GEMINI_KEY),
};
