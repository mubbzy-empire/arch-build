// ---------------------------------------------------------------------------
// roofSystem.js
//
// Real roof planes generated from the actual top-floor footprint, instead
// of a generic cone/cylinder fallback. Supports the rectangular case
// (by far the most common for residential footprints, including setback
// upper floors) with hip, gable, flat/parapet, and mono-pitch forms.
// Non-rectangular footprints fall back to a flat parapet roof, which is
// always geometrically valid even if less decorative — a known Phase-1
// limitation called out in the delivery notes, not silently patched over.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { roofMaterial, exteriorMaterial } from './materialSystem.js';

function footprintBounds(footprint) {
  const xs = footprint.map((p) => p[0]);
  const zs = footprint.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

function isRectangular(footprint) {
  return footprint.length === 4;
}

export function buildRoofGroup(topLevel, roof, baseY) {
  const group = new THREE.Group();
  group.name = 'roof';
  group.userData.group = 'roof';

  const b = footprintBounds(topLevel.footprint);
  const { width, depth } = b;
  const overhang = roof.overhang ?? 0.5;

  if (roof.type === 'flat' || roof.type === 'parapet' || !isRectangular(topLevel.footprint)) {
    group.add(buildFlatRoof(b, baseY, roof));
    return group;
  }
  if (roof.type === 'gable') {
    group.add(buildGableRoof(b, baseY, roof));
    return group;
  }
  if (roof.type === 'mono') {
    group.add(buildMonoRoof(b, baseY, roof));
    return group;
  }
  // default: hip
  group.add(buildHipRoof(b, baseY, roof));
  return group;
}

function buildFlatRoof(b, baseY, roof) {
  const group = new THREE.Group();
  const slabT = 0.2;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(b.width + roof.overhang * 2, slabT, b.depth + roof.overhang * 2),
    roofMaterial(roof.material, roof.color || '#c9c6bd'),
  );
  slab.position.set(b.cx, baseY + slabT / 2, b.cz);
  slab.castShadow = true; slab.receiveShadow = true;
  slab.userData.group = 'roof';
  group.add(slab);

  const parapetH = roof.parapetHeight ?? 0.9;
  if (parapetH > 0) {
    const wallT = 0.15;
    const parapetMat = exteriorMaterial('plaster', roof.color);
    const mk = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, parapetH, d), parapetMat);
      m.position.set(x, baseY + slabT + parapetH / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.group = 'roof';
      return m;
    };
    group.add(mk(b.width + wallT, wallT, b.cx, b.minZ - wallT / 2));
    group.add(mk(b.width + wallT, wallT, b.cx, b.maxZ + wallT / 2));
    group.add(mk(wallT, b.depth + wallT, b.minX - wallT / 2, b.cz));
    group.add(mk(wallT, b.depth + wallT, b.maxX + wallT / 2, b.cz));
  }
  return group;
}

function buildHipRoof(b, baseY, roof) {
  const group = new THREE.Group();
  const ridgeHeight = Math.max(0.6, (Math.min(b.width, b.depth) / 2) * Math.tan((roof.pitchDeg * Math.PI) / 180));
  const ow = b.width + roof.overhang * 2, od = b.depth + roof.overhang * 2;
  const ridgeFrac = 0.35; // ridge line runs this fraction of the shorter footprint dimension
  const shape = ow >= od;
  const ridgeLen = (shape ? ow : od) * ridgeFrac;

  const geometry = new THREE.BufferGeometry();
  const hw = ow / 2, hd = od / 2;
  const rh = ridgeLen / 2;
  let verts, idx;
  if (shape) {
    // ridge runs along X
    verts = new Float32Array([
      -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, // eave corners 0-3
      -rh, ridgeHeight, 0, rh, ridgeHeight, 0, // ridge 4-5
    ]);
    idx = [0, 1, 5, 0, 5, 4, 1, 2, 5, 2, 3, 4, 3, 0, 4, 5, 3, 4, 5, 2, 3];
  } else {
    verts = new Float32Array([
      -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
      0, ridgeHeight, -rh, 0, ridgeHeight, rh,
    ]);
    idx = [0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 3, 5, 4, 3, 4, 0];
  }
  geometry.setIndex(idx);
  geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, roofMaterial(roof.material, roof.color));
  mesh.position.set(b.cx, baseY, b.cz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.group = 'roof';
  group.add(mesh);

  // Fascia board around the eave line for a finished edge.
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(ow, 0.15, od), exteriorMaterial('wood', '#5a4530'));
  fascia.position.set(b.cx, baseY - 0.02, b.cz);
  fascia.userData.group = 'roof';
  group.add(fascia);
  return group;
}

function buildGableRoof(b, baseY, roof) {
  const group = new THREE.Group();
  const ridgeHeight = Math.max(0.6, (b.depth / 2) * Math.tan((roof.pitchDeg * Math.PI) / 180));
  const ow = b.width + roof.overhang * 2;
  const hw = ow / 2, hd = b.depth / 2 + roof.overhang;

  const shape2d = new THREE.Shape();
  shape2d.moveTo(-hd, 0);
  shape2d.lineTo(0, ridgeHeight);
  shape2d.lineTo(hd, 0);
  shape2d.lineTo(-hd, 0);
  const extrude = new THREE.ExtrudeGeometry(shape2d, { depth: ow, bevelEnabled: false, steps: 1 });
  extrude.rotateY(Math.PI / 2);
  extrude.translate(-hw, 0, 0);
  const mesh = new THREE.Mesh(extrude, roofMaterial(roof.material, roof.color));
  mesh.position.set(b.cx, baseY, b.cz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.group = 'roof';
  group.add(mesh);

  // Gable end walls (triangular infill under the two roof ends) in the
  // exterior facade material so the pitched ends read as finished walls.
  const gableMat = exteriorMaterial('plaster', roof.color);
  for (const side of [-1, 1]) {
    const gShape = new THREE.Shape();
    gShape.moveTo(-hd + roof.overhang, 0);
    gShape.lineTo(0, ridgeHeight);
    gShape.lineTo(hd - roof.overhang, 0);
    gShape.lineTo(-hd + roof.overhang, 0);
    const gGeo = new THREE.ShapeGeometry(gShape);
    const gMesh = new THREE.Mesh(gGeo, gableMat);
    gMesh.rotation.y = Math.PI / 2;
    gMesh.position.set(b.cx + side * (b.width / 2 - 0.02), baseY, b.cz);
    gMesh.userData.group = 'roof';
    group.add(gMesh);
  }
  return group;
}

function buildMonoRoof(b, baseY, roof) {
  const group = new THREE.Group();
  const rise = Math.max(0.4, b.depth * Math.tan((roof.pitchDeg * Math.PI) / 180));
  const ow = b.width + roof.overhang * 2, od = b.depth + roof.overhang * 2;
  const geo = new THREE.PlaneGeometry(ow, Math.hypot(od, rise));
  const angle = Math.atan2(rise, od);
  geo.rotateX(-Math.PI / 2 + angle);
  const mesh = new THREE.Mesh(geo, roofMaterial(roof.material, roof.color));
  mesh.position.set(b.cx, baseY + rise / 2, b.cz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.group = 'roof';
  group.add(mesh);
  return group;
}
