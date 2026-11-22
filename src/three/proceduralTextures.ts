import * as THREE from 'three';
import type { ConductorMaterial, SubstrateMaterial } from '../shared/antennaTypes.ts';
import { CONDUCTOR_CATALOG, SUBSTRATE_CATALOG } from '../shared/rfPhysics.ts';

export function createBrushedMetalTexture(
  conductor: ConductorMaterial,
  anisotropy = 4,
): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const spec = CONDUCTOR_CATALOG[conductor] ?? CONDUCTOR_CATALOG.Copper;
  const size = 256;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;
  cCtx.fillStyle = spec.colorHex;
  cCtx.fillRect(0, 0, size, size);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = '#555555';
  rCtx.fillRect(0, 0, size, size);

  // Subtle anisotropic brushed grain
  for (let y = 0; y < size; y++) {
    const delta = Math.sin(y * 0.7) * 8 + ((y * 37) % 13) - 6;
    cCtx.fillStyle = delta > 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
    cCtx.fillRect(0, y, size, 1);

    const rv = Math.max(40, Math.min(180, 90 + delta * 3));
    rCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
    rCtx.fillRect(0, y, size, 1);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = anisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = anisotropy;

  return { map, roughnessMap };
}

export function createSubstrateTexture(
  substrate: SubstrateMaterial,
  anisotropy = 4,
): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const spec = SUBSTRATE_CATALOG[substrate] ?? SUBSTRATE_CATALOG.Rogers_RO4003C;
  const size = 256;

  const cCanvas = document.createElement('canvas');
  cCanvas.width = size;
  cCanvas.height = size;
  const cCtx = cCanvas.getContext('2d')!;
  cCtx.fillStyle = spec.colorHex;
  cCtx.fillRect(0, 0, size, size);

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  // Woven fiberglass / ceramic micro-grid
  const step = 8;
  for (let i = 0; i < size; i += step) {
    cCtx.fillStyle = 'rgba(255,255,255,0.035)';
    cCtx.fillRect(i, 0, 2, size);
    cCtx.fillRect(0, i, size, 2);

    bCtx.fillStyle = 'rgba(255,255,255,0.16)';
    bCtx.fillRect(i, 0, 2, size);
    bCtx.fillRect(0, i, size, 2);
  }

  // Subtle PCB fiducial & silkscreen calibration marks on corners
  cCtx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
  cCtx.lineWidth = 1.5;
  cCtx.strokeRect(10, 10, size - 20, size - 20);

  const map = new THREE.CanvasTexture(cCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = anisotropy;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = anisotropy;

  return { map, bumpMap };
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    12,
    size / 2,
    size / 2,
    size / 2,
  );
  grad.addColorStop(0, 'rgba(2, 6, 23, 0.72)');
  grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.32)');
  grad.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
