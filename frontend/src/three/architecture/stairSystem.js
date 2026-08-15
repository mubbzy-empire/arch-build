// ---------------------------------------------------------------------------
// stairSystem.js
//
// Generates an actual stepped staircase connecting two floor elevations —
// not a decorative mesh dropped near the stair hall. Step count and riser
// height are derived from the real vertical rise between the two levels,
// so the top step always lands exactly at the upper floor's finished level.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { interiorMaterial } from './materialSystem.js';
import { frameMaterial } from './materialSystem.js';

export function buildStairGroup(stair, fromLevel, toLevel) {
  const group = new THREE.Group();
  group.name = `stair_${stair.id}`;
  group.userData.group = 'stair';
  group.userData.stairId = stair.id;

  const rise = toLevel.elevation - fromLevel.elevation;
  if (rise <= 0) return group;

  const riserH = stair.riserHeight || 0.18;
  const stepCount = Math.max(3, Math.round(rise / riserH));
  const actualRiser = rise / stepCount;
  const treadD = stair.treadDepth || 0.28;
  const width = stair.width || 1.0;
  const treadMat = interiorMaterial('marble', '#e5e0d4');
  const railMat = frameMaterial('aluminium');

  const runSteps = (count, startIndex, rotationOffset = 0) => {
    const runGroup = new THREE.Group();
    runGroup.rotation.y = rotationOffset;
    for (let i = 0; i < count; i++) {
      const stepIndex = startIndex + i;
      const y = fromLevel.elevation + actualRiser * (stepIndex + 1);
      const z = -treadD * (stepIndex + 0.5);
      const tread = new THREE.Mesh(new THREE.BoxGeometry(width, actualRiser, treadD), treadMat);
      tread.position.set(0, y - actualRiser / 2, z);
      tread.castShadow = true; tread.receiveShadow = true;
      tread.userData.group = 'stair';
      runGroup.add(tread);
    }
    return runGroup;
  };

  if (stair.type === 'l-shaped' || stair.type === 'u-shaped') {
    const firstRunSteps = Math.ceil(stepCount / 2);
    const secondRunSteps = stepCount - firstRunSteps;
    const firstRun = runSteps(firstRunSteps, 0);
    group.add(firstRun);

    const landingY = fromLevel.elevation + actualRiser * firstRunSteps;
    const landingZ = -treadD * firstRunSteps;
    const landing = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, width), treadMat);
    landing.position.set(width / 2 - width / 2, landingY, landingZ - width / 2 + treadD / 2);
    landing.userData.group = 'stair';
    group.add(landing);

    const secondRun = runSteps(secondRunSteps, 0, stair.type === 'u-shaped' ? Math.PI : Math.PI / 2);
    secondRun.position.set(width, landingY, landingZ);
    if (stair.type === 'u-shaped') secondRun.position.set(0, landingY, landingZ);
    group.add(secondRun);
  } else {
    group.add(runSteps(stepCount, 0));
  }

  // Railing — posts + top rail along the outer edge of the run, standard
  // safety detail so the stair reads as finished rather than a raw stepped
  // ramp.
  const postCount = Math.max(2, Math.round(stepCount / 3));
  const railGroup = new THREE.Group();
  for (let i = 0; i <= postCount; i++) {
    const t = i / postCount;
    const stepIdx = Math.round(t * (stepCount - 1));
    const y = fromLevel.elevation + actualRiser * (stepIdx + 1);
    const z = -treadD * (stepIdx + 0.5);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8), railMat);
    post.position.set(width / 2 - 0.05, y + 0.45, z);
    post.userData.group = 'stair';
    railGroup.add(post);
  }
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, treadD * stepCount, 8), railMat);
  rail.rotation.x = Math.PI / 2;
  rail.rotation.z = Math.atan2(rise, treadD * stepCount);
  rail.position.set(width / 2 - 0.05, fromLevel.elevation + 0.9 + rise / 2, -treadD * stepCount / 2);
  rail.userData.group = 'stair';
  railGroup.add(rail);
  group.add(railGroup);

  group.position.set(stair.position[0], 0, stair.position[1]);
  group.rotation.y = (group.rotation.y || 0) + (stair.rotation || 0);
  return group;
}
