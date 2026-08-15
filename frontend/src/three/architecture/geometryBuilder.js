// ---------------------------------------------------------------------------
// geometryBuilder.js
//
// The single entry point that turns a Building IR into a real Three.js
// scene graph. This is what Chat→3D, Blueprint→3D and Estate→3D should all
// call once they each produce a Building via their own path (design brief,
// vision pipeline, or site/estate layout) — one geometry engine behind all
// three routes, per the master spec.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { normalizeBuilding, topLevel } from './buildingModel.js';
import { validateBuilding, autoRepairBuilding } from './validation.js';
import { buildLevelWalls } from './wallSystem.js';
import { buildSlabMesh, buildRoomFloorAndCeiling } from './floorSystem.js';
import { buildStairGroup } from './stairSystem.js';
import { buildRoofGroup } from './roofSystem.js';

// Returns { group, report } — group is ready to add to a scene, report is
// the validation result (post-repair) so the caller/UI can surface
// warnings without blocking render.
export function buildBuildingGroup(rawBuilding) {
  let building = normalizeBuilding(rawBuilding);
  const preReport = validateBuilding(building);
  building = autoRepairBuilding(building);
  const report = validateBuilding(building); // re-check after repair

  const root = new THREE.Group();
  root.name = 'building';
  root.userData.buildingId = building.id;
  root.userData.isArchitecturalIR = true;

  building.levels.forEach((level, li) => {
    const levelGroup = new THREE.Group();
    levelGroup.name = `level_${level.index}`;
    levelGroup.userData.floorIndex = level.index;
    levelGroup.userData.floor = level.index;

    levelGroup.add(buildSlabMesh(level, { isGround: li === 0 }));
    levelGroup.add(buildLevelWalls(level));

    const interiorGroup = new THREE.Group();
    interiorGroup.name = `interior_floor_${level.index}`;
    for (const room of level.rooms) {
      interiorGroup.add(buildRoomFloorAndCeiling(room, level, room.floorFinish || 'tile'));
    }
    levelGroup.add(interiorGroup);

    root.add(levelGroup);
  });

  const stairsGroup = new THREE.Group();
  stairsGroup.name = 'stairs';
  for (const stair of building.stairs) {
    const from = building.levels.find((l) => l.index === stair.fromFloor);
    const to = building.levels.find((l) => l.index === stair.toFloor);
    if (from && to) {
      const stairGroup = buildStairGroup(stair, from, to);
      stairGroup.userData.floor = stair.fromFloor; // ties the stair flight to its lower floor for story-view separation
      stairsGroup.add(stairGroup);
    }
  }
  root.add(stairsGroup);

  const top = topLevel(building);
  if (top && building.roof) {
    const roofGroup = buildRoofGroup(top, building.roof, top.elevation + top.height);
    root.add(roofGroup);
  }

  // Safety net: any leaf mesh that wasn't explicitly tagged by its builder
  // inherits its nearest ancestor group's userData.group, so the viewer's
  // per-group recolor and "show interior" roof toggle (which key off each
  // mesh's own userData.group) never silently miss a mesh.
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (!obj.userData.group) {
      let ancestor = obj.parent;
      while (ancestor && !ancestor.userData.group) ancestor = ancestor.parent;
      if (ancestor) obj.userData.group = ancestor.userData.group;
    }
    // Same inheritance for floor number, so the "separate floors" story
    // view (which reads each mesh's own userData.floor) moves every mesh
    // on a level — walls, openings, stair flight, interior fittings — as
    // one unit, not just the ones a builder happened to tag directly.
    if (obj.userData.floor == null) {
      let ancestor = obj.parent;
      while (ancestor && ancestor.userData.floor == null) ancestor = ancestor.parent;
      if (ancestor) obj.userData.floor = ancestor.userData.floor;
    }
  });

  return {
    group: root,
    building,
    report: { ...report, warnings: [...new Set([...preReport.warnings, ...report.warnings])] },
  };
}

// Utility for the floor-isolation UI (section 28 of the spec): show only
// one level's walls/interior (plus ground-floor slabs of levels below it),
// or 'all', or 'roof'.
export function setFloorVisibility(buildingGroup, mode) {
  buildingGroup.children.forEach((child) => {
    if (child.name.startsWith('level_')) {
      const idx = child.userData.floorIndex;
      child.visible = mode === 'all' || mode === idx || mode === 'roof-hidden';
    } else if (child.name === 'roof') {
      child.visible = mode !== 'roof-hidden' && mode !== 'interior';
    } else if (child.name === 'stairs') {
      child.visible = true;
    }
  });
}
