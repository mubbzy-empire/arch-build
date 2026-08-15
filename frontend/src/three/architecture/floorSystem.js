// ---------------------------------------------------------------------------
// floorSystem.js
//
// Real slabs generated from a level's footprint polygon, plus interior
// floor finish and ceiling planes per room so "show interior" reveals an
// actual finished room rather than the inside of a hollow box.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { interiorMaterial, exteriorMaterial } from './materialSystem.js';

function footprintShape(footprint) {
  const shape = new THREE.Shape();
  footprint.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
  shape.closePath();
  return shape;
}

export function buildSlabMesh(level, { thickness = 0.2, isGround = false } = {}) {
  const shape = footprintShape(level.footprint);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, level.elevation - thickness, 0);
  const mat = isGround ? exteriorMaterial('concrete', '#b9b6ad') : interiorMaterial('concrete', '#c9c6bd');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.group = 'slab';
  mesh.userData.floor = level.index;
  return mesh;
}

export function buildRoomFloorAndCeiling(room, level, floorFinish = 'tile') {
  const group = new THREE.Group();
  group.userData.group = 'interior';
  group.userData.room = room.name;
  if (!room.polygon || room.polygon.length < 3) return group;

  const shape = footprintShape(room.polygon);
  const floorGeo = new THREE.ShapeGeometry(shape);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMesh = new THREE.Mesh(floorGeo, interiorMaterial(floorFinish, undefined));
  floorMesh.position.y = level.elevation + 0.01;
  floorMesh.receiveShadow = true;
  floorMesh.userData.group = 'interior';
  floorMesh.userData.room = room.name;
  group.add(floorMesh);

  const ceilH = room.ceilingHeight || level.height - 0.05;
  const ceilGeo = new THREE.ShapeGeometry(shape);
  ceilGeo.rotateX(Math.PI / 2);
  const ceilMesh = new THREE.Mesh(ceilGeo, interiorMaterial('ceiling'));
  ceilMesh.position.y = level.elevation + ceilH;
  ceilMesh.userData.group = 'interior';
  ceilMesh.userData.room = room.name;
  group.add(ceilMesh);

  // Skirting board around the room perimeter — small but it's the detail
  // that stops a finished floor from reading as a raw box interior.
  const skirtMat = interiorMaterial('plaster', '#ffffff');
  for (let i = 0; i < room.polygon.length; i++) {
    const [x1, z1] = room.polygon[i];
    const [x2, z2] = room.polygon[(i + 1) % room.polygon.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.05) continue;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.015), skirtMat);
    skirt.position.set((x1 + x2) / 2, level.elevation + 0.04, (z1 + z2) / 2);
    skirt.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    group.add(skirt);
  }
  return group;
}
