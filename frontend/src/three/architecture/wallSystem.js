// ---------------------------------------------------------------------------
// wallSystem.js
//
// Builds one wall's mesh from its actual segment (start/end/thickness/
// height), extended slightly at endpoints that meet another wall on the
// same floor so corners close cleanly (no gap, no double-thickness gap),
// then CSG-subtracts every attached opening and adds that opening's frame/
// glazing/door fill. This replaces the old "whole building = one big box,
// hollow it out" approach — every wall here is its own real segment.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { wallLength, wallAngle, wallMidpoint } from './buildingModel.js';
import { exteriorMaterial, interiorMaterial } from './materialSystem.js';
import { buildOpeningCut, buildOpeningFill } from './openingSystem.js';

const EPS = 0.03;

function pointsClose(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS;
}

// Extend a wall's endpoints by half the thickness of whichever wall(s) they
// meet, so two walls that share a corner point overlap slightly instead of
// leaving a gap or a visible seam — the standard "butt corner" convention
// used in real construction drawings.
function extendedEndpoints(wall, allWallsOnFloor) {
  let [sx, sz] = wall.start;
  let [ex, ez] = wall.end;
  const len = wallLength(wall) || 1;
  const ux = (ex - sx) / len, uz = (ez - sz) / len;

  const meetsAtStart = allWallsOnFloor.some((w) => w !== wall && (pointsClose(w.start, wall.start) || pointsClose(w.end, wall.start)));
  const meetsAtEnd = allWallsOnFloor.some((w) => w !== wall && (pointsClose(w.start, wall.end) || pointsClose(w.end, wall.end)));

  if (meetsAtStart) { sx -= ux * (wall.thickness / 2); sz -= uz * (wall.thickness / 2); }
  if (meetsAtEnd) { ex += ux * (wall.thickness / 2); ez += uz * (wall.thickness / 2); }
  return { start: [sx, sz], end: [ex, ez] };
}

export function buildWallGroup(wall, allWallsOnFloor = []) {
  const { start, end } = extendedEndpoints(wall, allWallsOnFloor);
  const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const rotY = wallAngle(wall);
  const [mx, mz] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const midY = wall.baseElevation + wall.height / 2;

  const material = wall.type === 'interior'
    ? interiorMaterial('plaster', wall.color)
    : exteriorMaterial(wall.material || 'plaster', wall.color);
  const materialLabel = wall.type === 'interior' ? 'plaster' : (wall.material || 'plaster');

  const group = new THREE.Group();
  group.userData.group = 'structure';
  group.userData.wallId = wall.id;
  group.userData.wallType = wall.type;
  group.userData.floor = wall.floor;

  if (len < 0.02) return group; // degenerate wall, skip

  if (!wall.openings.length) {
    const solid = new THREE.Mesh(new THREE.BoxGeometry(len, wall.height, wall.thickness), material);
    solid.position.set(mx, midY, mz);
    solid.rotation.y = rotY;
    solid.castShadow = true; solid.receiveShadow = true;
    solid.userData.group = 'structure';
    solid.userData.wallId = wall.id;
    solid.userData.material = materialLabel;
    solid.userData.wallType = wall.type;
    solid.userData.originalPosition = solid.position.clone();
    solid.userData.originalRotationY = rotY;
    group.add(solid);
    return group;
  }

  // Real CSG subtraction — each opening is an actual hole through this
  // wall's solid, not a decal or a floating frame parented nearby.
  const wallBrush = new Brush(new THREE.BoxGeometry(len, wall.height, wall.thickness));
  wallBrush.position.set(mx, midY, mz);
  wallBrush.rotation.y = rotY;
  wallBrush.updateMatrixWorld();

  const evaluator = new Evaluator();
  let shell = wallBrush;
  for (const opening of wall.openings) {
    const cut = buildOpeningCut(wall, opening);
    const cutter = new Brush(new THREE.BoxGeometry(cut.size[0], cut.size[1], cut.size[2]));
    cutter.position.set(cut.position[0], cut.position[1], cut.position[2]);
    cutter.rotation.y = cut.rotY;
    cutter.updateMatrixWorld();
    shell = evaluator.evaluate(shell, cutter, SUBTRACTION);
  }
  shell.material = material;
  shell.castShadow = true; shell.receiveShadow = true;
  shell.userData.group = 'structure';
  shell.userData.wallId = wall.id;
  shell.userData.material = materialLabel;
  shell.userData.wallType = wall.type;
  shell.userData.originalPosition = shell.position.clone();
  shell.userData.originalRotationY = rotY;
  group.add(shell);

  for (const opening of wall.openings) {
    const fill = buildOpeningFill(wall, opening);
    group.add(fill);
  }

  return group;
}

// Builds every wall on one level, returning a single group. Openings are
// already embedded per-wall, so this is just "for each wall, build it".
export function buildLevelWalls(level) {
  const group = new THREE.Group();
  group.name = `walls_floor_${level.index}`;
  for (const wall of level.walls) {
    group.add(buildWallGroup(wall, level.walls));
  }
  return group;
}
