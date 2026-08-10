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
    const [ow, oh, od] = part.size || [0.9, 1.2, 0.05];
    const dims = [ow, oh, od];
    const thinIdx = dims.indexOf(Math.min(...dims));
    const cutDims = [...dims];
    cutDims[thinIdx] = thickness * 4;

    const cutter = new Brush(new THREE.BoxGeometry(cutDims[0], cutDims[1], cutDims[2]));
    const [x, y, z] = part.position || [0, 0, 0];
    cutter.position.set(x, y, z);
    cutter.updateMatrixWorld();
    shellBrush = evaluator.evaluate(shellBrush, cutter, SUBTRACTION);

    const fillDims = [...dims];
    fillDims[thinIdx] = thickness * 0.9;
    const isDoor = part.group === 'door';
    const fillGeo = isDoor
      ? new RoundedBoxGeometry(fillDims[0], fillDims[1], fillDims[2], 1, Math.min(0.02, fillDims[0] * 0.05))
      : new THREE.BoxGeometry(fillDims[0], fillDims[1], fillDims[2]);
    const fillMesh = new THREE.Mesh(fillGeo, makeMaterial(part.material || (isDoor ? 'wood' : 'glass'), part.color));
    fillMesh.position.set(x, y, z);
    fillMesh.castShadow = isDoor;
    fillMesh.receiveShadow = true;
    fillMesh.userData.group = part.group || 'window';
    fillMesh.userData.room = part.room || null;
    fillMesh.userData.material = part.material || (isDoor ? 'wood' : 'glass');
    fillMesh.userData.originalPosition = fillMesh.position.clone();
    fillMeshes.push(fillMesh);
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
    return { wallMesh: solid, fillMeshes: [] };
  }

  const evaluator = new Evaluator();
  let shellBrush = wallBrush;
  const fillMeshes = [];

  for (const part of openingParts) {
    const [ow, oh, od] = part.size || [0.9, 1.2, 0.2];
    const [ox, oy, oz] = part.position || [wx, oh / 2, wz];
    const isDoor = part.group === 'door';

    const cutter = new Brush(new THREE.BoxGeometry(ow, oh, Math.max(od, d * 3)));
    cutter.position.set(ox, oy, oz);
    cutter.rotation.y = rotY;
    cutter.updateMatrixWorld();
    shellBrush = evaluator.evaluate(shellBrush, cutter, SUBTRACTION);

    const fillMesh = new THREE.Mesh(
      new THREE.BoxGeometry(ow * 0.94, oh, Math.max(d * 0.85, 0.04)),
      makeMaterial(part.material || (isDoor ? 'wood' : 'glass'), part.color)
    );
    fillMesh.position.set(ox, oy, oz);
    fillMesh.rotation.y = rotY;
    fillMesh.castShadow = isDoor;
    fillMesh.receiveShadow = true;
    fillMesh.userData.group = part.group;
    fillMesh.userData.room = part.room || null;
    fillMesh.userData.material = part.material || (isDoor ? 'wood' : 'glass');
    fillMesh.userData.originalPosition = fillMesh.position.clone();
    fillMeshes.push(fillMesh);
  }

  shellBrush.material = makeMaterial(wallPart.material || 'wood', wallPart.color);
  shellBrush.castShadow = true;
  shellBrush.receiveShadow = true;
  shellBrush.userData.group = 'structure';
  shellBrush.userData.room = null;
  shellBrush.userData.material = wallPart.material || 'wood';
  shellBrush.userData.originalPosition = shellBrush.position.clone();

  return { wallMesh: shellBrush, fillMeshes };
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
    const { wallMesh, fillMeshes } = buildWallWithOpenings(wall, wallOpenings);
    wallMesh.userData.partId = wall.id;
    wallMesh.userData.floor = wall.floor ?? 1;
    meshes.push(wallMesh);
    idToMeshes[wall.id] = [wallMesh];
    wallOpenings.forEach((o, i) => {
      const fm = fillMeshes[i];
      if (!fm) return;
      fm.userData.partId = o.id;
      fm.userData.floor = wall.floor ?? 1;
      meshes.push(fm);
      idToMeshes[o.id] = [fm];
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

// Builds one building's full mesh list (walls w/ real cutouts, floors,
// roof, furniture) from its modelSpec.parts — shared by the single-building
// editor and the multi-building estate viewer so both produce identical
// geometry quality.
export function buildBuildingMeshes(parts) {
  const openingParts = parts.filter(p => p.group === 'door' || p.group === 'window');
  const structureParts = parts.filter(p => p.group === 'structure' || !p.group);
  const otherParts = parts.filter(p => p.group && p.group !== 'structure' && p.group !== 'door' && p.group !== 'window');

  const meshes = [];
  const floorNumbers = [...new Set(structureParts.map(p => p.floor ?? 1))].sort((a, b) => a - b);
  const isBuilding = openingParts.length > 0 && structureParts.length > 0;

  if (isBuilding) {
    floorNumbers.forEach(floorNum => {
      const floorStructure = structureParts.filter(p => (p.floor ?? 1) === floorNum);
      const floorOpenings = openingParts.filter(p => (p.floor ?? 1) === floorNum);
      const [envelope, ...extraStructure] = floorStructure;
      if (!envelope) return;
      const { shellMesh, fillMeshes } = buildHollowShell(envelope, floorOpenings);
      shellMesh.userData.floor = floorNum;
      fillMeshes.forEach(m => { m.userData.floor = floorNum; });
      meshes.push(shellMesh, ...fillMeshes);
      extraStructure.forEach(p => {
        const m = buildMesh(p);
        m.userData.floor = floorNum;
        meshes.push(m);
      });
    });
  } else {
    structureParts.forEach(p => {
      const m = buildMesh(p);
      m.userData.floor = p.floor ?? 1;
      meshes.push(m);
    });
  }
  otherParts.forEach(p => {
    const m = buildMesh(p);
    m.userData.floor = p.floor ?? 1;
    m.userData.room = p.room || null;
    meshes.push(m);
  });

  return meshes;
}
