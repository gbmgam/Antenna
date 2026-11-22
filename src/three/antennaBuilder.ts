import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { AntennaDesignParams, PredictionResult } from '../shared/antennaTypes.ts';
import { CONDUCTOR_CATALOG, SUBSTRATE_CATALOG, TOPOLOGY_LABELS } from '../shared/rfPhysics.ts';
import {
  createBrushedMetalTexture,
  createSubstrateTexture,
} from './proceduralTextures.ts';

export interface AntennaLayerRefs {
  root: THREE.Group;
  groundGroup: THREE.Group;
  substrateGroup: THREE.Group;
  patchGroup: THREE.Group;
  connectorGroup: THREE.Group;
  radiationGroup: THREE.Group;
  waveGroup: THREE.Group;
  dimensionGroup: THREE.Group;
  waveRings: Array<{ mesh: THREE.Mesh; phaseOffset: number }>;
  scaleFactor: number;
  boardThicknessScene: number;
}

/**
 * Builds a complete multi-part procedural 3D antenna assembly normalized to ~4.2 scene units wide.
 */
export function buildAntennaAssembly(
  params: AntennaDesignParams,
  prediction: PredictionResult | null,
  anisotropy = 4,
): AntennaLayerRefs {
  const root = new THREE.Group();
  root.name = 'ANTENNA_AI_Assembly';

  const groundGroup = new THREE.Group();
  groundGroup.name = 'GroundPlane';
  const substrateGroup = new THREE.Group();
  substrateGroup.name = 'DielectricSubstrate';
  const patchGroup = new THREE.Group();
  patchGroup.name = 'CopperPatchAndFeed';
  const connectorGroup = new THREE.Group();
  connectorGroup.name = 'SMAConnector';
  const radiationGroup = new THREE.Group();
  radiationGroup.name = 'RadiationLobe';
  const waveGroup = new THREE.Group();
  waveGroup.name = 'EMWaveSystem';
  const dimensionGroup = new THREE.Group();
  dimensionGroup.name = 'DimensionGuides';

  const isCircular = params.topology === 'circular_patch';
  const isArray = params.topology === 'array_2x2' || params.topology === 'multi_element_mimo';
  const patchL = isCircular
    ? Math.max(4, params.patchRadiusMm * 2)
    : Math.max(2, params.patchLengthMm);
  const patchW = isCircular
    ? Math.max(4, params.patchRadiusMm * 2)
    : Math.max(2, params.patchWidthMm);
  const boardSpanMm = Math.max(patchL, patchW) * (isArray ? 3.1 : 1.75);
  const scaleFactor = 4.2 / Math.max(10, boardSpanMm);

  const L = patchL * scaleFactor;
  const W = patchW * scaleFactor;
  const isLinearArray = params.topology === 'array_2x2' && params.arrayLayoutCode === 2;
  const boardL = isLinearArray ? L * 1.9 : L * (isArray ? 2.85 : 1.65);
  const boardW = isLinearArray ? W * 4.4 : W * (isArray ? 2.85 : 1.65);
  const subH = Math.max(0.08, Math.min(0.65, params.substrateHeightMm * scaleFactor * 2.2));
  const groundH = 0.065;
  const copperH = 0.032;

  // Materials
  const condSpec = CONDUCTOR_CATALOG[params.conductorMaterial] ?? CONDUCTOR_CATALOG.Copper;
  const { map: metalMap, roughnessMap: metalRough } = createBrushedMetalTexture(
    params.conductorMaterial,
    anisotropy,
  );
  const conductorMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(condSpec.colorHex),
    map: metalMap,
    roughnessMap: metalRough,
    metalness: 0.94,
    roughness: condSpec.roughness,
    clearcoat: 0.18,
    clearcoatRoughness: 0.25,
    anisotropy: 0.65,
  });

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xb87333,
    map: metalMap,
    roughnessMap: metalRough,
    metalness: 0.88,
    roughness: 0.34,
  });

  const subSpec = SUBSTRATE_CATALOG[params.substrateMaterial] ?? SUBSTRATE_CATALOG.Rogers_RO4003C;
  const { map: subMap, bumpMap: subBump } = createSubstrateTexture(
    params.substrateMaterial,
    anisotropy,
  );
  const substrateMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(subSpec.colorHex),
    map: subMap,
    bumpMap: subBump,
    bumpScale: 0.008,
    roughness: 0.48,
    metalness: 0.06,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
  });

  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xf4c44e,
    metalness: 0.96,
    roughness: 0.16,
  });
  const ptfeMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    metalness: 0.02,
    roughness: 0.38,
  });

  // 1. Ground Plane + Corner Standoffs
  const groundGeo = new THREE.BoxGeometry(boardW, groundH, boardL);
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.position.y = groundH / 2;
  groundMesh.castShadow = true;
  groundMesh.receiveShadow = true;
  groundGroup.add(groundMesh);

  const standoffGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.09, 12);
  const corners = [
    [-boardW * 0.44, -boardL * 0.44],
    [boardW * 0.44, -boardL * 0.44],
    [-boardW * 0.44, boardL * 0.44],
    [boardW * 0.44, boardL * 0.44],
  ];
  for (const [cx, cz] of corners) {
    const post = new THREE.Mesh(standoffGeo, goldMat);
    post.position.set(cx, groundH + 0.02, cz);
    groundGroup.add(post);
  }

  // 2. Dielectric Substrate
  const subShape = new THREE.Shape();
  const hw = boardW / 2;
  const hl = boardL / 2;
  const rCorner = Math.min(hw, hl) * 0.06;
  subShape.moveTo(-hw + rCorner, -hl);
  subShape.lineTo(hw - rCorner, -hl);
  subShape.quadraticCurveTo(hw, -hl, hw, -hl + rCorner);
  subShape.lineTo(hw, hl - rCorner);
  subShape.quadraticCurveTo(hw, hl, hw - rCorner, hl);
  subShape.lineTo(-hw + rCorner, hl);
  subShape.quadraticCurveTo(-hw, hl, -hw, hl - rCorner);
  subShape.lineTo(-hw, -hl + rCorner);
  subShape.quadraticCurveTo(-hw, -hl, -hw + rCorner, -hl);

  const subGeo = new THREE.ExtrudeGeometry(subShape, {
    depth: subH,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  subGeo.rotateX(-Math.PI / 2);
  const subMesh = new THREE.Mesh(subGeo, substrateMat);
  subMesh.position.y = groundH;
  subMesh.castShadow = true;
  subMesh.receiveShadow = true;
  substrateGroup.add(subMesh);

  const patchBaseY = groundH + subH + 0.014;

  // Helper to build beveled extruded patch
  const addExtrudedPatch = (w: number, l: number, xOffset = 0, zOffset = 0, withInset = false) => {
    const pShape = new THREE.Shape();
    const pw = w / 2;
    const pl = l / 2;
    if (withInset) {
      const targetInset = params.insetDepthMm > 0 ? params.insetDepthMm : params.feedXMm;
      const feedFrac = Math.min(0.45, Math.max(0.06, targetInset / Math.max(1, patchL)));
      const insetDepth = l * feedFrac;
      const notchHalfW = Math.max(
        0.05,
        params.notchWidthMm > 0
          ? (params.notchWidthMm * scaleFactor) / 2
          : w * 0.09,
      );
      const traceHalfW = Math.max(0.028, Math.min(notchHalfW * 0.65, w * 0.042));

      pShape.moveTo(-pw, -pl);
      pShape.lineTo(pw, -pl);
      pShape.lineTo(pw, pl);
      pShape.lineTo(notchHalfW, pl);
      pShape.lineTo(notchHalfW, pl - insetDepth);
      pShape.lineTo(traceHalfW, pl - insetDepth);
      pShape.lineTo(traceHalfW, boardL / 2 - zOffset);
      pShape.lineTo(-traceHalfW, boardL / 2 - zOffset);
      pShape.lineTo(-traceHalfW, pl - insetDepth);
      pShape.lineTo(-notchHalfW, pl - insetDepth);
      pShape.lineTo(-notchHalfW, pl);
      pShape.lineTo(-pw, pl);
      pShape.closePath();
    } else {
      pShape.moveTo(-pw, -pl);
      pShape.lineTo(pw, -pl);
      pShape.lineTo(pw, pl);
      pShape.lineTo(-pw, pl);
      pShape.closePath();
    }

    const pGeo = new THREE.ExtrudeGeometry(pShape, {
      depth: copperH,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 2,
    });
    pGeo.rotateX(-Math.PI / 2);
    const pMesh = new THREE.Mesh(pGeo, conductorMat);
    pMesh.position.set(xOffset, patchBaseY, zOffset);
    pMesh.castShadow = true;
    patchGroup.add(pMesh);
  };

  // 3. Topology-specific Copper Radiating Elements
  const feedXScene = Math.max(-W * 0.42, Math.min(W * 0.42, params.feedYMm * scaleFactor));
  const feedZScene = Math.max(-L * 0.44, Math.min(L * 0.44, (patchL / 2 - params.feedXMm) * scaleFactor));

  if (params.topology === 'microstrip_patch') {
    addExtrudedPatch(W, L, 0, 0, true);
  } else if (params.topology === 'rectangular_patch') {
    addExtrudedPatch(W, L, 0, 0, false);
    const probeR = Math.max(0.018, Math.min(0.085, ((params.probeDiameterMm || 1.27) * scaleFactor) / 2));
    // Coaxial probe pin + annular solder pad
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(probeR, probeR, subH + 0.08, 16), goldMat);
    pin.position.set(feedXScene, groundH + subH / 2, feedZScene);
    patchGroup.add(pin);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(probeR * 2.2, probeR * 2.2, 0.018, 18), goldMat);
    pad.position.set(feedXScene, patchBaseY + copperH + 0.006, feedZScene);
    patchGroup.add(pad);
  } else if (params.topology === 'circular_patch') {
    const radius = Math.max(0.35, params.patchRadiusMm * scaleFactor);
    const diskGeo = new THREE.CylinderGeometry(radius, radius * 1.01, copperH, 48);
    const diskMesh = new THREE.Mesh(diskGeo, conductorMat);
    diskMesh.position.set(0, patchBaseY + copperH / 2, 0);
    diskMesh.castShadow = true;
    patchGroup.add(diskMesh);
    // Microstrip feed trace to edge
    const traceLen = Math.max(0.2, boardL / 2 - radius * 0.85);
    const trace = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.06, radius * 0.14), copperH, traceLen),
      conductorMat,
    );
    trace.position.set(0, patchBaseY + copperH / 2, radius * 0.85 + traceLen / 2);
    patchGroup.add(trace);
  } else if (params.topology === 'array_2x2') {
    const pitchX = Math.max(W * 1.18, Math.min(boardW * 0.48, (params.elementSpacingXmm || patchW * 1.38) * scaleFactor));
    const pitchZ = Math.max(L * 1.18, Math.min(boardL * 0.48, (params.elementSpacingYmm || patchL * 1.38) * scaleFactor));
    if (isLinearArray) {
      const linPitch = Math.max(W * 1.12, Math.min(boardW * 0.24, (params.elementSpacingXmm || patchW * 1.2) * scaleFactor));
      const xs = [-1.5 * linPitch, -0.5 * linPitch, 0.5 * linPitch, 1.5 * linPitch];
      for (const ox of xs) {
        addExtrudedPatch(W * 0.86, L * 0.86, ox, 0, false);
      }
      const traceH = copperH * 0.9;
      const bus = new THREE.Mesh(new THREE.BoxGeometry(3 * linPitch + 0.08, traceH, 0.065), conductorMat);
      bus.position.set(0, patchBaseY + traceH / 2, L * 0.55);
      patchGroup.add(bus);
      for (const ox of xs) {
        const stub = new THREE.Mesh(new THREE.BoxGeometry(0.05, traceH, L * 0.55), conductorMat);
        stub.position.set(ox, patchBaseY + traceH / 2, L * 0.275);
        patchGroup.add(stub);
      }
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.085, traceH, boardL / 2 - L * 0.4), conductorMat);
      trunk.position.set(0, patchBaseY + traceH / 2, boardL / 4 + L * 0.3);
      patchGroup.add(trunk);
    } else {
      const offsets = [
        [-pitchX / 2, -pitchZ / 2],
        [pitchX / 2, -pitchZ / 2],
        [-pitchX / 2, pitchZ / 2],
        [pitchX / 2, pitchZ / 2],
      ];
      for (const [ox, oz] of offsets) {
        addExtrudedPatch(W * 0.92, L * 0.92, ox, oz, false);
      }
      // Corporate T-junction power-divider feed network
      const traceH = copperH * 0.9;
      const hBus = new THREE.Mesh(new THREE.BoxGeometry(pitchX + 0.08, traceH, 0.065), conductorMat);
      hBus.position.set(0, patchBaseY + traceH / 2, 0);
      patchGroup.add(hBus);

      for (const ox of [-pitchX / 2, pitchX / 2]) {
        const vBranch = new THREE.Mesh(new THREE.BoxGeometry(0.055, traceH, pitchZ), conductorMat);
        vBranch.position.set(ox, patchBaseY + traceH / 2, 0);
        patchGroup.add(vBranch);
      }
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.085, traceH, boardL / 2), conductorMat);
      trunk.position.set(0, patchBaseY + traceH / 2, boardL / 4);
      patchGroup.add(trunk);
    }
  } else {
    // 4-element MIMO with orthogonal isolation stubs
    const pitchX = Math.max(W * 1.15, Math.min(boardW * 0.48, (params.elementSpacingXmm || patchW * 1.32) * scaleFactor));
    const pitchZ = Math.max(L * 1.15, Math.min(boardL * 0.48, (params.elementSpacingYmm || patchL * 1.32) * scaleFactor));
    addExtrudedPatch(W * 0.88, L * 0.88, -pitchX / 2, -pitchZ / 2, false);
    addExtrudedPatch(L * 0.88, W * 0.88, pitchX / 2, -pitchZ / 2, false);
    addExtrudedPatch(L * 0.88, W * 0.88, -pitchX / 2, pitchZ / 2, false);
    addExtrudedPatch(W * 0.88, L * 0.88, pitchX / 2, pitchZ / 2, false);

    // Cross decoupling parasitic resonator
    const iso1 = new THREE.Mesh(new THREE.BoxGeometry(boardW * 0.72, copperH, 0.05), goldMat);
    iso1.position.set(0, patchBaseY + copperH / 2, 0);
    const iso2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, copperH, boardL * 0.72), goldMat);
    iso2.position.set(0, patchBaseY + copperH / 2, 0);
    patchGroup.add(iso1, iso2);

    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.075, copperH, boardL * 0.25), conductorMat);
    trunk.position.set(-pitchX / 2, patchBaseY + copperH / 2, boardL * 0.36);
    patchGroup.add(trunk);
  }

  // 4. Multi-part SMA Connector (Lathe + Hex Nut + PTFE + Center Pin)
  const buildSMAConnector = (x: number, y: number, z: number, vertical = false) => {
    const sma = new THREE.Group();
    const flange = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.08), goldMat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 20), goldMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.17;

    const hexNut = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 6), goldMat);
    hexNut.rotation.x = Math.PI / 2;
    hexNut.position.z = 0.09;

    const ptfe = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.28, 16), ptfeMat);
    ptfe.rotation.x = Math.PI / 2;
    ptfe.position.z = 0.16;

    const centerPin = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.42, 12), goldMat);
    centerPin.rotation.x = Math.PI / 2;
    centerPin.position.z = 0.12;

    sma.add(flange, barrel, hexNut, ptfe, centerPin);
    if (vertical) {
      sma.rotation.x = Math.PI / 2;
    }
    sma.position.set(x, y, z);
    return sma;
  };

  if (params.topology === 'rectangular_patch') {
    connectorGroup.add(buildSMAConnector(feedXScene, -0.04, feedZScene, true));
  } else if (params.topology === 'multi_element_mimo') {
    if (params.portConfigurationCode === 4) {
      connectorGroup.add(buildSMAConnector(-W * 0.66, patchBaseY, boardL / 2 + 0.02, false));
      connectorGroup.add(buildSMAConnector(W * 0.66, patchBaseY, boardL / 2 + 0.02, false));
      const backLeft = buildSMAConnector(-W * 0.66, patchBaseY, -boardL / 2 - 0.02, false);
      backLeft.rotation.y = Math.PI;
      const backRight = buildSMAConnector(W * 0.66, patchBaseY, -boardL / 2 - 0.02, false);
      backRight.rotation.y = Math.PI;
      connectorGroup.add(backLeft, backRight);
    } else {
      connectorGroup.add(buildSMAConnector(0, patchBaseY, boardL / 2 + 0.02, false));
    }
  } else {
    connectorGroup.add(buildSMAConnector(0, patchBaseY, boardL / 2 + 0.02, false));
  }

  // 5. 3D Radiation Pattern Lobe (Parametric Spherical Harmonics BufferGeometry)
  const gainDbi = prediction?.gainDbi ?? 7.0;
  const beamDeg = prediction?.beamwidthDeg ?? 70;
  const lobeSharpness = Math.max(1.2, Math.min(6.5, 160 / Math.max(22, beamDeg)));
  const lobeMaxR = 1.65 + Math.max(0, gainDbi - 3) * 0.16;

  const segPhi = 44;
  const segTheta = 32;
  const lobeGeo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const cLow = new THREE.Color(0x0ea5e9);
  const cMid = new THREE.Color(0x22d3ee);
  const cHigh = new THREE.Color(0xf59e0b);
  const cPeak = new THREE.Color(0xef4444);
  const tmpColor = new THREE.Color();

  for (let i = 0; i <= segTheta; i++) {
    const theta = (i / segTheta) * Math.PI; // 0 = +Y boresight
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    for (let j = 0; j <= segPhi; j++) {
      const phi = (j / segPhi) * Math.PI * 2;
      // Forward main lobe + realistic minor sidelobes + small backlobe
      const mainLobe = cosT > 0 ? Math.pow(cosT, lobeSharpness) : 0.12 * Math.pow(Math.abs(cosT), 2);
      const sideRipple =
        params.topology === 'array_2x2'
          ? 0.18 * Math.pow(Math.abs(Math.sin(theta * 3) * Math.cos(phi * 2)), 1.5)
          : 0.06 * Math.abs(Math.sin(theta * 2));
      const normGain = Math.min(1, Math.max(0.08, mainLobe + sideRipple));
      const r = normGain * lobeMaxR;

      const vx = r * sinT * Math.cos(phi);
      const vy = r * cosT;
      const vz = r * sinT * Math.sin(phi);
      positions.push(vx, vy, vz);

      if (normGain < 0.45) {
        tmpColor.copy(cLow).lerp(cMid, normGain / 0.45);
      } else if (normGain < 0.8) {
        tmpColor.copy(cMid).lerp(cHigh, (normGain - 0.45) / 0.35);
      } else {
        tmpColor.copy(cHigh).lerp(cPeak, (normGain - 0.8) / 0.2);
      }
      colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
  }

  for (let i = 0; i < segTheta; i++) {
    for (let j = 0; j < segPhi; j++) {
      const a = i * (segPhi + 1) + j;
      const b = a + segPhi + 1;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  lobeGeo.setIndex(indices);
  lobeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  lobeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  lobeGeo.computeVertexNormals();

  const lobeMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.32,
    roughness: 0.2,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const lobeMesh = new THREE.Mesh(lobeGeo, lobeMat);
  lobeMesh.position.y = patchBaseY + 0.08;
  lobeMesh.renderOrder = 4;

  const lobeWire = new THREE.Mesh(
    lobeGeo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      wireframe: true,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  );
  lobeWire.position.y = patchBaseY + 0.08;
  lobeWire.renderOrder = 5;
  radiationGroup.add(lobeMesh, lobeWire);

  // 6. Animated EM Wave Propagation Rings
  const waveRings: Array<{ mesh: THREE.Mesh; phaseOffset: number }> = [];
  const ringCount = 5;
  for (let k = 0; k < ringCount; k++) {
    const torusGeo = new THREE.TorusGeometry(0.65, 0.016, 10, 48);
    torusGeo.rotateX(Math.PI / 2);
    const torusMat = new THREE.MeshBasicMaterial({
      color: k % 2 === 0 ? 0x22d3ee : 0x3b82f6,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(torusGeo, torusMat);
    ring.position.y = patchBaseY + 0.25;
    ring.renderOrder = 6;
    waveGroup.add(ring);
    waveRings.push({ mesh: ring, phaseOffset: k / ringCount });
  }

  // 7. Dimension Guides (L, W, h lines)
  const dimY = patchBaseY + copperH + 0.05;
  const dimVerts = new Float32Array([
    // Width W indicator along front edge
    -W / 2, dimY, -L / 2 - 0.18, W / 2, dimY, -L / 2 - 0.18,
    -W / 2, dimY - 0.05, -L / 2 - 0.18, -W / 2, dimY + 0.05, -L / 2 - 0.18,
    W / 2, dimY - 0.05, -L / 2 - 0.18, W / 2, dimY + 0.05, -L / 2 - 0.18,
    // Length L indicator along side edge
    -W / 2 - 0.18, dimY, -L / 2, -W / 2 - 0.18, dimY, L / 2,
    -W / 2 - 0.18, dimY - 0.05, -L / 2, -W / 2 - 0.18, dimY + 0.05, -L / 2,
    -W / 2 - 0.18, dimY - 0.05, L / 2, -W / 2 - 0.18, dimY + 0.05, L / 2,
  ]);
  const dimGeo = new THREE.BufferGeometry();
  dimGeo.setAttribute('position', new THREE.BufferAttribute(dimVerts, 3));
  const dimLines = new THREE.LineSegments(
    dimGeo,
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 }),
  );
  dimensionGroup.add(dimLines);

  root.add(
    groundGroup,
    substrateGroup,
    patchGroup,
    connectorGroup,
    radiationGroup,
    waveGroup,
    dimensionGroup,
  );

  return {
    root,
    groundGroup,
    substrateGroup,
    patchGroup,
    connectorGroup,
    radiationGroup,
    waveGroup,
    dimensionGroup,
    waveRings,
    scaleFactor,
    boardThicknessScene: groundH + subH,
  };
}

/**
 * Exports the physical antenna layers (excluding non-physical radiation guides) as a real binary .glb file.
 */
export async function exportAntennaToGLB(
  refs: AntennaLayerRefs,
  filename = 'antenna_ai_model.glb',
): Promise<void> {
  const exporter = new GLTFExporter();
  const exportGroup = new THREE.Group();
  exportGroup.name = 'ANTENNA_AI_Blender_Export';
  exportGroup.add(
    refs.groundGroup.clone(),
    refs.substrateGroup.clone(),
    refs.patchGroup.clone(),
    refs.connectorGroup.clone(),
  );

  const glbBuffer = await exporter.parseAsync(exportGroup, { binary: true });
  const blob = new Blob([glbBuffer as ArrayBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generates an executable Blender 4.x Python (bpy) modeling, PBR material, and animation script.
 */
export function generateBlenderPythonScript(params: AntennaDesignParams): string {
  const sub = SUBSTRATE_CATALOG[params.substrateMaterial] ?? SUBSTRATE_CATALOG.Rogers_RO4003C;
  const cond = CONDUCTOR_CATALOG[params.conductorMaterial] ?? CONDUCTOR_CATALOG.Copper;
  const exportL = params.topology === 'circular_patch' ? params.patchRadiusMm * 2 : params.patchLengthMm;
  const exportW = params.topology === 'circular_patch' ? params.patchRadiusMm * 2 : params.patchWidthMm;
  return `# ANTENNA AI — Blender 4.x Procedural Modeling & PBR Script
# Run inside Blender -> Scripting workspace -> Run Script
# Exports optimized GLB with PBR materials and exploded-view keyframes.

import bpy
import math

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Design Parameters (converted mm -> meters for Blender scene scale)
L = ${exportL} / 1000.0
W = ${exportW} / 1000.0
R = ${params.patchRadiusMm} / 1000.0
h = ${params.substrateHeightMm} / 1000.0
feed_x = ${params.feedXMm} / 1000.0
board_L = L * 1.65
board_W = W * 1.65

def make_pbr_mat(name, rgba, metallic, roughness):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat

mat_copper = make_pbr_mat("${cond.name}", (0.85, 0.48, 0.26, 1.0), 0.95, ${cond.roughness})
mat_substrate = make_pbr_mat("${sub.name}", (0.08, 0.35, 0.25, 1.0), 0.05, 0.45)
mat_gold = make_pbr_mat("SMA_Gold", (0.96, 0.77, 0.30, 1.0), 0.98, 0.16)

# 1. Ground Plane
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.0005))
gnd = bpy.context.active_object
gnd.name = "GroundPlane"
gnd.scale = (board_W, board_L, 0.001)
gnd.data.materials.append(mat_copper)

# 2. Dielectric Substrate
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.001 + h / 2.0))
sub = bpy.context.active_object
sub.name = "DielectricSubstrate"
sub.scale = (board_W, board_L, h)
sub.data.materials.append(mat_substrate)

# 3. Radiating Copper Patch (${TOPOLOGY_LABELS[params.topology]})
${
  params.topology === 'circular_patch'
    ? `bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=max(0.002, R), depth=0.00035, location=(0, 0, 0.001 + h + 0.0002))
patch = bpy.context.active_object
patch.name = "CircularDiskPatch"`
    : `bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.001 + h + 0.0002))
patch = bpy.context.active_object
patch.name = "CopperPatch"
patch.scale = (W, L, 0.00035)`
}
patch.data.materials.append(mat_copper)

# 4. SMA Edge Connector
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.0022, depth=0.008, location=(0, -board_L / 2.0 - 0.004, 0.001 + h))
sma = bpy.context.active_object
sma.name = "SMAConnector"
sma.rotation_euler = (math.pi / 2.0, 0, 0)
sma.data.materials.append(mat_gold)

# Exploded-View Animation Keyframes (Frames 1 to 60)
for obj, z_offset in [(gnd, -0.015), (sub, 0.0), (patch, 0.020)]:
    obj.keyframe_insert(data_path="location", frame=1)
    obj.location.z += z_offset
    obj.keyframe_insert(data_path="location", frame=60)

print("ANTENNA AI Blender scene built for ${params.operatingFreqGHz} GHz")
`;
}
