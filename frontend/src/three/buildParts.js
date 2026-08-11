import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

export const MATERIAL_COLORS = { wood: 0xb98a55, metal: 0xaab2bd, glass: 0x8fd0e0, fabric: 0x6f6a63 };
export const GROUP_LABELS = { structure: 'Walls', roof: 'Roof', door: 'Door', window: 'Windows', interior: 'Interior', furniture: 'Furniture' };

// ---------------------------------------------------------------------------
// Cheap procedural textures — generated once on a <canvas> and cached at
// module scope, reused across every mesh/mount instead of regenerating.
// ---------------------------------------------------------------------------
let woodTextureCache = null;
export function getWoodTexture() {
  if (woodTextureCache) return woodTextureCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#bd905e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * size;
    const shade = 0.85 + Math.random() * 0.3;
    ctx.strokeStyle = `rgba(${Math.round(120 * shade)}, ${Math.round(80 * shade)}, ${Math.round(45 * shade)}, ${0.15 + Math.random() * 0.2})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + (Math.random() - 0.5) * 8, size * 0.7, y + (Math.random() - 0.5) * 8, size, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  woodTextureCache = texture;
  return texture;
}

let fabricTextureCache = null;
export function getFabricTexture() {
  if (fabricTextureCache) return fabricTextureCache;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#6f6a63';
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      if ((x + y) % 4 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(x, y, 2, 2); }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  fabricTextureCache = texture;
  return texture;
}

let shadowTextureCache = null;
export function getShadowTexture() {
  if (shadowTextureCache) return shadowTextureCache;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.7, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  shadowTextureCache = new THREE.CanvasTexture(canvas);
  return shadowTextureCache;
}

export function makeMaterial(materialName, colorHex) {
  const isGlass = materialName === 'glass';
  const isMetal = materialName === 'metal';
  const baseColor = colorHex
    ? new THREE.Color(colorHex)
    : new THREE.Color(materialName === 'wood' || materialName === 'fabric' ? 0xffffff : (MATERIAL_COLORS[materialName] ?? 0xc9a26a));
  const props = {
    color: baseColor,
    roughness: isGlass ? 0.05 : isMetal ? 0.35 : 0.7,
    metalness: isMetal ? 0.75 : isGlass ? 0.15 : 0.04,
    transparent: isGlass,
    opacity: isGlass ? 0.5 : 1,
    envMapIntensity: isGlass ? 1.4 : isMetal ? 1.1 : 0.6,
  };
  if (materialName === 'wood' && !colorHex) props.map = getWoodTexture();
  if (materialName === 'fabric' && !colorHex) props.map = getFabricTexture();
  return new THREE.MeshStandardMaterial(props);
}

export function buildMesh(part) {
  let geometry;
  if (part.type === 'cylinder') {
    geometry = new THREE.CylinderGeometry(part.radiusTop ?? 0.1, part.radiusBottom ?? 0.1, part.height ?? 1, 24);
  } else {
    const [w, h, d] = part.size || [0.5, 0.5, 0.5];
    geometry = new THREE.BoxGeometry(w, h, d);
  }
  const isGlass = part.material === 'glass';
  const mesh = new THREE.Mesh(geometry, makeMaterial(part.material, part.color));
  const [x, y, z] = part.position || [0, 0, 0];
  mesh.position.set(x, y, z);
  mesh.rotation.y = part.rotation || 0;
  mesh.castShadow = !isGlass;
  mesh.receiveShadow = true;
  mesh.userData.group = part.group || 'structure';
  mesh.userData.room = part.room || null;
  mesh.userData.material = part.material || null;
  mesh.userData.originalPosition = mesh.position.clone();
  return mesh;
}

// ---------------------------------------------------------------------------
// Door/window fill assembly, shared by both the whole-building envelope
// path (buildHollowShell) and the per-wall manual-modeler path
// (buildWallWithOpenings). A door becomes a single solid panel. A window
// becomes THREE parts layered along the wall's thin (through-wall) axis —
// an outer frame (fills the whole cut opening), an inset glass pane sitting
// slightly proud of the frame, and — for openings bigger than ~0.7m — a
// thin mullion cross-bar — so it reads as an assembled window rather than a
// flat colored rectangle in a hole.
//
// `dims` is the opening's own [width, height, depth] as authored on the
// part; `thinIdx` is whichever of those three axes runs through the wall's
// thickness; `thickness` is the WALL's real thickness (not the opening's
// own often-arbitrary thin dimension) so the frame/glass/mullion are sized
// to the wall they're actually sitting in.
// ---------------------------------------------------------------------------
function withThin(dims, thinIdx, thinValue, faceScale) {
  return dims.map((v, i) => (i === thinIdx ? thinValue : v * faceScale));
}

function buildOpeningFill(part, dims, thinIdx, thickness) {
  const isDoor = part.group === 'door';
  const [x, y, z] = part.position || [0, 0, 0];
  const rotY = part.rotation || 0;
  const frameColor = part.frameColor || '#e7e2d6';
  const meshes = [];

  const place = (mesh) => {
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.receiveShadow = true;
    mesh.userData.group = part.group || 'window';
    mesh.userData.room = part.room || null;
    mesh.userData.material = part.material || (isDoor ? 'wood' : 'glass');
    mesh.userData.originalPosition = mesh.position.clone();
    meshes.push(mesh);
    return mesh;
  };

  if (isDoor) {
    const panelDims = withThin(dims, thinIdx, thickness * 0.6, 0.94);
    const geo = new RoundedBoxGeometry(panelDims[0], panelDims[1], panelDims[2], 1, Math.min(0.02, panelDims[0] * 0.05));
    const panel = new THREE.Mesh(geo, makeMaterial(part.material || 'wood', part.color));
    panel.castShadow = true;
    place(panel);
    return meshes;
  }

  const frameDims = withThin(dims, thinIdx, thickness * 0.85, 1.0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(frameDims[0], frameDims[1], frameDims[2]), makeMaterial('metal', frameColor));
  place(frame);

  const glassDims = withThin(dims, thinIdx, thickness * 1.0, 0.84);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(glassDims[0], glassDims[1], glassDims[2]), makeMaterial(part.material || 'glass', part.color));
  place(glass);

  const faceIdxs = [0, 1, 2].filter(i => i !== thinIdx);
  const [wi, hi] = faceIdxs;
  if (dims[wi] > 0.7 && dims[hi] > 0.7) {
    const barThin = thickness * 1.05;
    const vDims = withThin(dims, thinIdx, barThin, 0.84);
    vDims[wi] = Math.min(dims[wi] * 0.05, 0.04);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(vDims[0], vDims[1], vDims[2]), makeMaterial('metal', frameColor));
    place(vBar);

    const hDims = withThin(dims, thinIdx, barThin, 0.84);
    hDims[hi] = Math.min(dims[hi] * 0.05, 0.04);
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(hDims[0], hDims[1], hDims[2]), makeMaterial('metal', frameColor));
    place(hBar);
  }

  return meshes;
}

// ---------------------------------------------------------------------------
// Building shell: turns a single "structure" envelope box into real hollow
// walls with actual cut-through door/window openings, using CSG boolean
// operations — computed locally in the browser, no external service.
// ---------------------------------------------------------------------------
export function buildHollowShell(structurePart, openingParts) {
  const [w, h, d] = structurePart.size || [4, 3, 4];
  const thickness = Math.min(0.25, Math.max(0.06, Math.min(w, d) * 0.02));
  const cornerRadius = Math.min(0.12, Math.min(w, d) * 0.015);

  const outer = new Brush(new RoundedBoxGeometry(w, h, d, 2, cornerRadius));
  outer.updateMatrixWorld();
  const inner = new Brush(new THREE.BoxGeometry(Math.max(w - thickness * 2, 0.05), h + 1, Math.max(d - thickness * 2, 0.05)));
  inner.updateMatrixWorld();

  const evaluator = new Evaluator();
  let shellBrush = evaluator.evaluate(outer, inner, SUBTRACTION);

  const fillMeshes = [];
  for (const part of openingParts) {
    const dims = part.size || [0.9, 1.2, 0.05];
    const thinIdx = dims.indexOf(Math.min(...dims));
    const cutDims = [...dims];
    cutDims[thinIdx] = thickness * 4;

    const cutter = new Brush(new THREE.BoxGeometry(cutDims[0], cutDims[1], cutDims[2]));
    const [x, y, z] = part.position || [0, 0, 0];
    cutter.position.set(x, y, z);
    cutter.updateMatrixWorld();
    shellBrush = evaluator.evaluate(shellBrush, cutter, SUBTRACTION);

    fillMeshes.push(...buildOpeningFill(part, dims, thinIdx, thickness));
  }

  shellBrush.material = makeMaterial(structurePart.material || 'wood', structurePart.color);
  shellBrush.castShadow = true;
  shellBrush.receiveShadow = true;
  shellBrush.userData.group = 'structure';
  shellBrush.userData.room = null;
  shellBrush.userData.material = structurePart.material || 'wood';
  shellBrush.userData.originalPosition = shellBrush.position.clone();

  return { shellMesh: shellBrush, fillMeshes };
}

// ---------------------------------------------------------------------------
// Manual modeler support: a wall drawn point-to-point (with its own
// position/rotation, not part of one whole-building envelope) gets its
// door/window openings cut directly out of that single wall segment —
// simpler than buildHollowShell (no outer/inner hollowing step, since a
// hand-drawn wall is already a thin solid slab) but still real CSG, so a
// door in a manually-drawn wall is an actual hole, not a decal.
// ---------------------------------------------------------------------------
export function buildWallWithOpenings(wallPart, openingParts) {
  const [w, h, d] = wallPart.size || [2, 3, 0.15];
  const rotY = wallPart.rotation || 0;
  const [wx, wy, wz] = wallPart.position || [0, h / 2, 0];

  const wallBrush = new Brush(new THREE.BoxGeometry(w, h, d));
  wallBrush.position.set(wx, wy, wz);
  wallBrush.rotation.y = rotY;
  wallBrush.updateMatrixWorld();

  if (!openingParts.length) {
    const solid = new THREE.Mesh(wallBrush.geometry, makeMaterial(wallPart.material || 'wood', wallPart.color));
    solid.position.copy(wallBrush.position);
    solid.rotation.y = rotY;
    solid.castShadow = true;
    solid.receiveShadow = true;
    solid.userData.group = 'structure';
    solid.userData.room = null;
    solid.userData.material = wallPart.material || 'wood';
    solid.userData.originalPosition = solid.position.clone();
    return { wallMesh: solid, fillGroups: [] };
  }

  const evaluator = new Evaluator();
  let shellBrush = wallBrush;
  const fillGroups = [];

  for (const part of openingParts) {
    const dims = part.size || [0.9, 1.2, 0.2];
    const [ox, oy, oz] = part.position || [wx, (dims[1] || 1.2) / 2, wz];
    const thinIdx = 2; // manual-modeler openings are always authored with depth (index 2) as the through-wall axis

    const cutter = new Brush(new THREE.BoxGeometry(dims[0], dims[1], Math.max(dims[2], d * 3)));
    cutter.position.set(ox, oy, oz);
    cutter.rotation.y = rotY;
    cutter.updateMatrixWorld();
    shellBrush = evaluator.evaluate(shellBrush, cutter, SUBTRACTION);

    fillGroups.push(buildOpeningFill({ ...part, position: [ox, oy, oz], rotation: rotY }, dims, thinIdx, d));
  }

  shellBrush.material = makeMaterial(wallPart.material || 'wood', wallPart.color);
  shellBrush.castShadow = true;
  shellBrush.receiveShadow = true;
  shellBrush.userData.group = 'structure';
  shellBrush.userData.room = null;
  shellBrush.userData.material = wallPart.material || 'wood';
  shellBrush.userData.originalPosition = shellBrush.position.clone();

  return { wallMesh: shellBrush, fillGroups };
}

// Builds the full mesh list for the manual modeler's flat parts array.
// Each part may be: a wall (group 'structure', has its own id), an opening
// attached to a wall (group 'door'/'window', carries wallId referencing the
// wall's part id), or a freestanding primitive (box/cylinder/floor/furniture
// with no wallId). Openings are grouped by wallId and cut into their own
// wall only — never the whole scene — so editing one wall never touches
// another's geometry.
export function buildManualMeshes(parts) {
  const walls = parts.filter(p => p.group === 'structure');
  const openings = parts.filter(p => p.group === 'door' || p.group === 'window');
  const freestanding = parts.filter(p => p.group !== 'structure' && p.group !== 'door' && p.group !== 'window');

  const meshes = [];
  const idToMeshes = {};

  walls.forEach(wall => {
    const wallOpenings = openings.filter(o => o.wallId === wall.id);
    const { wallMesh, fillGroups } = buildWallWithOpenings(wall, wallOpenings);
    wallMesh.userData.partId = wall.id;
    wallMesh.userData.floor = wall.floor ?? 1;
    meshes.push(wallMesh);
    idToMeshes[wall.id] = [wallMesh];

    // fillGroups[i] is the (1, 2, or 4-mesh) group belonging to
    // wallOpenings[i] — buildWallWithOpenings returns them in the same
    // order it received them, so this is a direct positional match, no
    // guessing about how many meshes a given opening produced.
    wallOpenings.forEach((o, i) => {
      const group = fillGroups[i] || [];
      group.forEach(fm => {
        fm.userData.partId = o.id;
        fm.userData.floor = wall.floor ?? 1;
        meshes.push(fm);
      });
      idToMeshes[o.id] = group;
    });
  });

  freestanding.forEach(p => {
    const m = buildMesh(p);
    m.userData.partId = p.id;
    m.userData.floor = p.floor ?? 1;
    meshes.push(m);
    idToMeshes[p.id] = [m];
  });

  return { meshes, idToMeshes };
}

// ---------------------------------------------------------------------------
// Procedural roofs. Rather than trust the AI to hand-place a roof primitive
// at the right size — a common source of roofs that float, clip through
// walls, or don't match a rectangular footprint (a cone never really fits a
// non-square building) — a roof part that specifies a "roofStyle" gets its
// actual geometry computed here directly from the matching floor's real
// envelope footprint, so it is geometrically guaranteed to fit regardless
// of what numbers the AI put on the part itself. Roof parts without a
// roofStyle (older saved designs) still render via the generic box/cylinder
// path in buildMesh, so nothing already saved breaks.
// ---------------------------------------------------------------------------
function hipRoofGeometry(width, depth, riseHeight) {
  const hw = width / 2, hd = depth / 2;
  const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd], P = [0, riseHeight, 0];
  const corners = [A, B, C, D];
  const verts = [];
  for (let i = 0; i < 4; i++) {
    const from = corners[i], to = corners[(i + 1) % 4];
    verts.push(...from, ...P, ...to);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function gableRoofGeometry(width, depth, riseHeight, ridgeAlongX) {
  const hw = width / 2, hd = depth / 2;
  const verts = [];
  if (ridgeAlongX) {
    const rL = [-hw, riseHeight, 0], rR = [hw, riseHeight, 0];
    const eaveFL = [-hw, 0, -hd], eaveFR = [hw, 0, -hd];
    const eaveBL = [-hw, 0, hd], eaveBR = [hw, 0, hd];
    verts.push(...eaveFL, ...eaveFR, ...rR, ...eaveFL, ...rR, ...rL); // front slope
    verts.push(...eaveBR, ...eaveBL, ...rL, ...eaveBR, ...rL, ...rR); // back slope
    verts.push(...eaveFL, ...rL, ...eaveBL); // gable end x = -hw
    verts.push(...eaveBR, ...rR, ...eaveFR); // gable end x = +hw
  } else {
    const rF = [0, riseHeight, -hd], rB = [0, riseHeight, hd];
    const eaveFL = [-hw, 0, -hd], eaveFR = [hw, 0, -hd];
    const eaveBL = [-hw, 0, hd], eaveBR = [hw, 0, hd];
    verts.push(...eaveFL, ...eaveBL, ...rB, ...eaveFL, ...rB, ...rF); // left slope
    verts.push(...eaveBR, ...eaveFR, ...rF, ...eaveBR, ...rF, ...rB); // right slope
    verts.push(...eaveFR, ...rF, ...eaveFL); // gable end z = -hd
    verts.push(...eaveBL, ...rB, ...eaveBR); // gable end z = +hd
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildRoofMesh(roofPart, footprint) {
  const style = roofPart.roofStyle || 'hip';
  const { width, depth, centerX, centerZ, topY } = footprint;
  const overhang = roofPart.overhang ?? Math.max(0.3, Math.min(width, depth) * 0.06);
  const spanW = width + overhang * 2;
  const spanD = depth + overhang * 2;
  const pitch = Math.min(Math.max(roofPart.pitch ?? 0.4, 0.15), 0.9);
  const material = makeMaterial(roofPart.material || 'metal', roofPart.color || '#5a4a3a');
  // DoubleSide is cheap insurance: hand-derived triangle winding on the
  // gable/hip geometry below is very likely correct, but if a face ever
  // ends up backwards it stays visible (just slightly different shading)
  // instead of disappearing entirely.
  material.side = THREE.DoubleSide;

  let mesh;
  if (style === 'flat') {
    const slabH = Math.max(Math.min(width, depth) * 0.04, 0.15);
    mesh = new THREE.Mesh(new THREE.BoxGeometry(spanW, slabH, spanD), material);
    mesh.position.set(centerX, topY + slabH / 2, centerZ);
  } else if (style === 'shed') {
    const rise = Math.min(spanW, spanD) * pitch * 0.6;
    const slopeLen = Math.sqrt(spanD * spanD + rise * rise);
    mesh = new THREE.Mesh(new THREE.BoxGeometry(spanW, Math.max(spanW, spanD) * 0.015 + 0.08, slopeLen), material);
    mesh.rotation.x = -Math.atan2(rise, spanD);
    mesh.position.set(centerX, topY + rise / 2, centerZ);
  } else if (style === 'gable') {
    const rise = Math.min(spanW, spanD) * pitch;
    const ridgeAlongX = width >= depth;
    mesh = new THREE.Mesh(gableRoofGeometry(spanW, spanD, rise, ridgeAlongX), material);
    mesh.position.set(centerX, topY, centerZ);
  } else {
    const rise = Math.min(spanW, spanD) * pitch;
    mesh = new THREE.Mesh(hipRoofGeometry(spanW, spanD, rise), material);
    mesh.position.set(centerX, topY, centerZ);
  }

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.group = 'roof';
  mesh.userData.room = null;
  mesh.userData.material = roofPart.material || 'metal';
  mesh.userData.originalPosition = mesh.position.clone();
  return mesh;
}

// Builds one building's full mesh list (walls w/ real cutouts, floors,
// roof, furniture) from its modelSpec.parts — shared by the single-building
// editor and the multi-building estate viewer so both produce identical
// geometry quality.
export function buildBuildingMeshes(parts) {
  const openingParts = parts.filter(p => p.group === 'door' || p.group === 'window');
  const structureParts = parts.filter(p => p.group === 'structure' || !p.group);
  const roofParts = parts.filter(p => p.group === 'roof');
  const otherParts = parts.filter(p => p.group && p.group !== 'structure' && p.group !== 'door' && p.group !== 'window' && p.group !== 'roof');

  const meshes = [];
  const floorNumbers = [...new Set(structureParts.map(p => p.floor ?? 1))].sort((a, b) => a - b);
  const isBuilding = openingParts.length > 0 && structureParts.length > 0;

  if (isBuilding) {
    floorNumbers.forEach(floorNum => {
      const floorStructure = structureParts.filter(p => (p.floor ?? 1) === floorNum);
      const floorOpenings = openingParts.filter(p => (p.floor ?? 1) === floorNum);
      const [envelope, ...extraStructure] = floorStructure;
      if (!envelope) return;
      // The envelope + its door/window cutouts are fused into one CSG
      // shell — there's no single independent "part" a moved shellMesh or
      // opening fill maps cleanly back onto, so these are left untagged
      // (not individually persistable — see ModelViewer's edit mode).
      const { shellMesh, fillMeshes } = buildHollowShell(envelope, floorOpenings);
      shellMesh.userData.floor = floorNum;
      fillMeshes.forEach(m => { m.userData.floor = floorNum; });
      meshes.push(shellMesh, ...fillMeshes);
      extraStructure.forEach(p => {
        const m = buildMesh(p);
        m.userData.floor = floorNum;
        m.userData.partId = parts.indexOf(p);
        meshes.push(m);
      });
    });
  } else {
    structureParts.forEach(p => {
      const m = buildMesh(p);
      m.userData.floor = p.floor ?? 1;
      m.userData.partId = parts.indexOf(p);
      meshes.push(m);
    });
  }

  const topFloor = floorNumbers[floorNumbers.length - 1] ?? 1;
  roofParts.forEach(p => {
    if (p.roofStyle) {
      const floorNum = p.floor ?? topFloor;
      const envelope = structureParts.find(sp => (sp.floor ?? 1) === floorNum) || structureParts[structureParts.length - 1];
      if (envelope && envelope.size) {
        const [w, h, d] = envelope.size;
        const [ex, ey, ez] = envelope.position || [0, h / 2, 0];
        const footprint = { width: w, depth: d, centerX: ex, centerZ: ez, topY: ey + h / 2 };
        const m = buildRoofMesh(p, footprint);
        m.userData.floor = floorNum;
        // A shaped roof (roofStyle) is generated procedurally from the
        // envelope footprint rather than drawn straight from p.position/
        // size, so a moved roof mesh can't be written back onto p as a
        // simple position/rotation — left untagged, same reasoning as the
        // wall shell above.
        meshes.push(m);
        return;
      }
    }
    const m = buildMesh(p);
    m.userData.floor = p.floor ?? topFloor;
    m.userData.partId = parts.indexOf(p);
    meshes.push(m);
  });

  otherParts.forEach(p => {
    const m = buildMesh(p);
    m.userData.floor = p.floor ?? 1;
    m.userData.room = p.room || null;
    m.userData.partId = parts.indexOf(p);
    meshes.push(m);
  });

  return meshes;
}
