// ---------------------------------------------------------------------------
// materialSystem.js
//
// Central material presets for the architecture engine. Reuses the existing
// canvas-texture helpers from buildParts.js (siding, roof, paint, floor)
// where they already exist, and adds the additional PBR presets the master
// spec calls for (stone, concrete, tile, marble, aluminium) so callers don't
// hand-roll MeshStandardMaterial params inline.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import {
  makeSidingMaterial, makeRoofMaterial, makeInteriorPaintMaterial,
  makeFloorMaterial, makeMaterial, getWoodTexture,
} from '../buildParts.js';

// [colour tint applied on top of caller-supplied hex when given, roughness, metalness]
const EXTERIOR_PRESETS = {
  plaster: { roughness: 0.85, metalness: 0.02, fallbackColor: '#e7e2d6' },
  'painted-plaster': { roughness: 0.75, metalness: 0.02, fallbackColor: '#e7e2d6' },
  concrete: { roughness: 0.9, metalness: 0.04, fallbackColor: '#b9b6ad' },
  'exposed-concrete': { roughness: 0.95, metalness: 0.02, fallbackColor: '#a7a49b' },
  brick: { roughness: 0.88, metalness: 0.0, fallbackColor: '#a85c45' },
  stone: { roughness: 0.92, metalness: 0.0, fallbackColor: '#8f887c' },
  wood: { roughness: 0.6, metalness: 0.0, fallbackColor: '#9a6b3f' },
  metal: { roughness: 0.35, metalness: 0.75, fallbackColor: '#aab2bd' },
  aluminium: { roughness: 0.3, metalness: 0.85, fallbackColor: '#c8ccd0' },
  glass: { roughness: 0.05, metalness: 0.1, fallbackColor: '#bfe3ee', transparent: true, opacity: 0.35 },
};

const INTERIOR_PRESETS = {
  plaster: { roughness: 0.9, metalness: 0.0, fallbackColor: '#f4f1ea' },
  tile: { roughness: 0.25, metalness: 0.0, fallbackColor: '#e4e0d6' },
  marble: { roughness: 0.15, metalness: 0.02, fallbackColor: '#efeae1' },
  'wood-flooring': { roughness: 0.45, metalness: 0.0, fallbackColor: '#b98a55' },
  ceramic: { roughness: 0.2, metalness: 0.0, fallbackColor: '#d9d5cb' },
  concrete: { roughness: 0.85, metalness: 0.02, fallbackColor: '#c9c6bd' },
  ceiling: { roughness: 0.95, metalness: 0.0, fallbackColor: '#f7f5ef' },
};

export function exteriorMaterial(kind = 'plaster', colorHex) {
  const preset = EXTERIOR_PRESETS[kind] || EXTERIOR_PRESETS.plaster;
  if (kind === 'wood') return makeSidingMaterial(colorHex || preset.fallbackColor);
  if (kind === 'plaster' || kind === 'painted-plaster') return makeSidingMaterial(colorHex || preset.fallbackColor);
  if (kind === 'metal' || kind === 'aluminium') return makeMaterial('metal', colorHex || preset.fallbackColor);
  if (kind === 'glass') return makeMaterial('glass', colorHex || preset.fallbackColor);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex || preset.fallbackColor),
    roughness: preset.roughness, metalness: preset.metalness,
    transparent: !!preset.transparent, opacity: preset.opacity ?? 1,
  });
}

export function interiorMaterial(kind = 'plaster', colorHex) {
  const preset = INTERIOR_PRESETS[kind] || INTERIOR_PRESETS.plaster;
  if (kind === 'plaster' || kind === 'ceiling') return makeInteriorPaintMaterial(colorHex || preset.fallbackColor);
  if (kind === 'wood-flooring') return makeFloorMaterial(colorHex || preset.fallbackColor);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex || preset.fallbackColor),
    roughness: preset.roughness, metalness: preset.metalness,
  });
}

export function roofMaterial(kind = 'metal', colorHex) {
  return makeRoofMaterial(colorHex || (kind === 'metal' ? '#7a5240' : '#8f887c'));
}

export function glazingMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xbfe3ee, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.32,
    transmission: 0.65, thickness: 0.02, ior: 1.5,
  });
}

export function frameMaterial(kind = 'aluminium', colorHex) {
  if (kind === 'wood') return new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex || '#6b4a2c'), roughness: 0.55, map: getWoodTexture() });
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex || '#5c5f63'), roughness: 0.35, metalness: 0.7 });
}

export function doorMaterial(kind = 'wood', colorHex) {
  if (kind === 'metal' || kind === 'garage') return new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex || '#d9d9d2'), roughness: 0.4, metalness: 0.6 });
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex || '#6b4426'), roughness: 0.5, map: getWoodTexture() });
}
