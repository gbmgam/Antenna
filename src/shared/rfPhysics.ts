import type {
  AntennaDesignParams,
  AntennaTopology,
  ConductorMaterial,
  ConductorSpec,
  SubstrateMaterial,
  SubstrateSpec,
} from './antennaTypes.ts';

export const SPEED_OF_LIGHT_MM_GHZ = 299.792458; // c in mm * GHz

export const SUBSTRATE_CATALOG: Record<SubstrateMaterial, SubstrateSpec> = {
  FR4: {
    id: 'FR4',
    name: 'FR-4 Woven Epoxy',
    dielectricConstant: 4.4,
    lossTangent: 0.02,
    costPerCm2Usd: 0.04,
    maxRecommendedFreqGHz: 3.5,
    colorHex: '#0f5c43',
  },
  Rogers_RO4003C: {
    id: 'Rogers_RO4003C',
    name: 'Rogers RO4003C Hydrocarbon Ceramic',
    dielectricConstant: 3.55,
    lossTangent: 0.0027,
    costPerCm2Usd: 0.24,
    maxRecommendedFreqGHz: 20,
    colorHex: '#3e4756',
  },
  Rogers_RO4350B: {
    id: 'Rogers_RO4350B',
    name: 'Rogers RO4350B Woven Glass Hydrocarbon',
    dielectricConstant: 3.48,
    lossTangent: 0.0037,
    costPerCm2Usd: 0.28,
    maxRecommendedFreqGHz: 30,
    colorHex: '#354152',
  },
  Rogers_RT5880: {
    id: 'Rogers_RT5880',
    name: 'Rogers RT/duroid 5880 PTFE',
    dielectricConstant: 2.2,
    lossTangent: 0.0009,
    costPerCm2Usd: 0.42,
    maxRecommendedFreqGHz: 40,
    colorHex: '#1f2937',
  },
  Alumina: {
    id: 'Alumina',
    name: '99.5% Alumina Ceramic (Al2O3)',
    dielectricConstant: 9.8,
    lossTangent: 0.0002,
    costPerCm2Usd: 0.55,
    maxRecommendedFreqGHz: 60,
    colorHex: '#cbd5e1',
  },
};

export const CONDUCTOR_CATALOG: Record<ConductorMaterial, ConductorSpec> = {
  Copper: {
    id: 'Copper',
    name: 'Electrodeposited Copper (1 oz)',
    conductivitySPerM: 5.8e7,
    costMultiplier: 1.0,
    colorHex: '#d97b43',
    roughness: 0.22,
  },
  Gold_ENIG: {
    id: 'Gold_ENIG',
    name: 'ENIG Immersion Gold over Nickel',
    conductivitySPerM: 4.1e7,
    costMultiplier: 1.45,
    colorHex: '#e5b84b',
    roughness: 0.16,
  },
  Silver: {
    id: 'Silver',
    name: 'Plated Pure Silver',
    conductivitySPerM: 6.3e7,
    costMultiplier: 1.6,
    colorHex: '#e2e8f0',
    roughness: 0.14,
  },
  Aluminum: {
    id: 'Aluminum',
    name: '6061 Aerospace Aluminum',
    conductivitySPerM: 3.5e7,
    costMultiplier: 0.85,
    colorHex: '#94a3b8',
    roughness: 0.28,
  },
};

export const TOPOLOGY_LABELS: Record<AntennaTopology, string> = {
  microstrip_patch: 'Microstrip Inset Patch',
  rectangular_patch: 'Probe-Fed Rectangular Patch',
  circular_patch: 'Circular Disk Patch',
  array_2x2: '2x2 Phased Planar Array',
  multi_element_mimo: '4-Element MIMO Array',
};

export function synthesizeCircularRadiusMm(
  freqGHz: number,
  er: number,
  heightMm: number,
): number {
  const f = Math.max(0.3, Math.min(60, freqGHz));
  const h = Math.max(0.2, Math.min(12, heightMm));
  const eps = Math.max(1.5, Math.min(14, er));
  // Balanis circular disk TM110 mode: F = 8.791e9 / (f * sqrt(er)) in cm -> mm
  const F = (87.91 / (f * Math.sqrt(eps)));
  // Approximate fringing correction inverse
  const r = F / Math.sqrt(1 + (2 * h) / (Math.PI * eps * Math.max(1, F)) * (Math.log((Math.PI * F) / (2 * h)) + 1.7726));
  return Math.max(1.2, Number(r.toFixed(2)));
}

export function synthesizeCircularFeedMm(radiusMm: number, er: number): number {
  const r = Math.max(1.2, radiusMm);
  const eps = Math.max(1.5, Math.min(14, er));
  const rEdgeCirc = Math.max(130, 52 * ((eps * eps) / Math.max(0.4, eps - 1)));
  const sinArg = Math.min(0.92, Math.max(0.15, Math.sqrt(50 / rEdgeCirc)));
  const rOpt = r * (2 / Math.PI) * Math.asin(sinArg);
  return Number(Math.max(0.3, Math.min(r * 0.85, rOpt)).toFixed(2));
}

export function createDefaultDesign(
  freqGHz = 2.45,
  topology: AntennaTopology = 'microstrip_patch',
  substrate: SubstrateMaterial = 'Rogers_RO4003C',
): AntennaDesignParams {
  const sub = SUBSTRATE_CATALOG[substrate];
  const h = freqGHz < 1.3 ? 3.2 : 1.524;
  const synthesized = synthesizePatchGeometry(freqGHz, sub.dielectricConstant, h);
  const lambda0 = SPEED_OF_LIGHT_MM_GHZ / Math.max(0.3, freqGHz);
  const halfLambda = Number((lambda0 * 0.5).toFixed(2));
  const isCircular = topology === 'circular_patch';
  const radiusMm = synthesizeCircularRadiusMm(freqGHz, sub.dielectricConstant, h);
  const feedXMm = isCircular
    ? synthesizeCircularFeedMm(radiusMm, sub.dielectricConstant)
    : Number(synthesized.optimalFeedXMm.toFixed(2));

  return {
    id: `ant-${Date.now()}`,
    name: `${freqGHz.toFixed(2)} GHz ${TOPOLOGY_LABELS[topology]}`,
    topology,
    patchLengthMm: isCircular ? 0 : Number(synthesized.lengthMm.toFixed(2)),
    patchWidthMm: isCircular ? 0 : Number(synthesized.widthMm.toFixed(2)),
    substrateHeightMm: h,
    dielectricConstant: sub.dielectricConstant,
    lossTangent: sub.lossTangent,
    feedXMm,
    feedYMm: 0,
    operatingFreqGHz: freqGHz,
    substrateMaterial: substrate,
    conductorMaterial: 'Copper',
    insetDepthMm: topology === 'microstrip_patch' ? Number(synthesized.optimalFeedXMm.toFixed(2)) : 0,
    notchWidthMm: topology === 'microstrip_patch' ? Number(Math.max(0.6, synthesized.widthMm * 0.08).toFixed(2)) : 0,
    probeDiameterMm: topology === 'rectangular_patch' ? 1.27 : 0,
    feedTypeCode: topology === 'rectangular_patch' ? 2 : 0,
    patchRadiusMm: isCircular ? radiusMm : 0,
    elementSpacingXmm: topology === 'array_2x2' || topology === 'multi_element_mimo' ? halfLambda : 0,
    elementSpacingYmm: topology === 'array_2x2' || topology === 'multi_element_mimo' ? halfLambda : 0,
    phaseXDeg: 0,
    phaseYDeg: 0,
    arrayLayoutCode: topology === 'array_2x2' ? 1 : 0,
    portConfigurationCode: topology === 'multi_element_mimo' ? 4 : 0,
    targetGainDbi: topology === 'array_2x2' ? 11.5 : topology === 'multi_element_mimo' ? 9.5 : 7.0,
    targetBandwidthMHz: freqGHz > 10 ? 850 : 95,
  };
}

/**
 * Transitions an existing design cleanly to a new topology, populating sensible
 * defaults for active topology-specific fields and zeroing inactive ones.
 */
export function switchDesignTopology(
  current: AntennaDesignParams,
  nextTopology: AntennaTopology,
): AntennaDesignParams {
  const synth = synthesizePatchGeometry(
    current.operatingFreqGHz,
    current.dielectricConstant,
    current.substrateHeightMm,
  );
  const lambda0 = SPEED_OF_LIGHT_MM_GHZ / Math.max(0.3, current.operatingFreqGHz);
  const defaultSpacing = Number((lambda0 * 0.5).toFixed(2));
  const isCircular = nextTopology === 'circular_patch';
  const prevLength = current.patchLengthMm > 1 ? current.patchLengthMm : Number(synth.lengthMm.toFixed(2));
  const prevWidth = current.patchWidthMm > 1 ? current.patchWidthMm : Number(synth.widthMm.toFixed(2));
  const circularRadius =
    current.patchRadiusMm > 1
      ? current.patchRadiusMm
      : synthesizeCircularRadiusMm(
          current.operatingFreqGHz,
          current.dielectricConstant,
          current.substrateHeightMm,
        );

  return {
    ...current,
    topology: nextTopology,
    name: `${current.operatingFreqGHz.toFixed(2)} GHz ${TOPOLOGY_LABELS[nextTopology]}`,
    patchLengthMm: isCircular ? 0 : prevLength,
    patchWidthMm: isCircular ? 0 : prevWidth,
    feedXMm: isCircular
      ? synthesizeCircularFeedMm(circularRadius, current.dielectricConstant)
      : current.feedXMm > 0 && current.feedXMm < prevLength * 0.48
        ? current.feedXMm
        : Number(synth.optimalFeedXMm.toFixed(2)),
    insetDepthMm:
      nextTopology === 'microstrip_patch'
        ? current.insetDepthMm > 0
          ? current.insetDepthMm
          : Number(synth.optimalFeedXMm.toFixed(2))
        : 0,
    notchWidthMm:
      nextTopology === 'microstrip_patch'
        ? current.notchWidthMm > 0
          ? current.notchWidthMm
          : Number(Math.max(0.6, prevWidth * 0.08).toFixed(2))
        : 0,
    probeDiameterMm:
      nextTopology === 'rectangular_patch'
        ? current.probeDiameterMm > 0
          ? current.probeDiameterMm
          : 1.27
        : 0,
    feedTypeCode:
      nextTopology === 'rectangular_patch'
        ? current.feedTypeCode === 1 || current.feedTypeCode === 2
          ? current.feedTypeCode
          : 2
        : 0,
    patchRadiusMm: isCircular ? circularRadius : 0,
    elementSpacingXmm:
      nextTopology === 'array_2x2' || nextTopology === 'multi_element_mimo'
        ? current.elementSpacingXmm > 1
          ? current.elementSpacingXmm
          : defaultSpacing
        : 0,
    elementSpacingYmm:
      nextTopology === 'array_2x2' || nextTopology === 'multi_element_mimo'
        ? current.elementSpacingYmm > 1
          ? current.elementSpacingYmm
          : defaultSpacing
        : 0,
    phaseXDeg: nextTopology === 'array_2x2' ? current.phaseXDeg || 0 : 0,
    phaseYDeg: nextTopology === 'array_2x2' ? current.phaseYDeg || 0 : 0,
    arrayLayoutCode:
      nextTopology === 'array_2x2'
        ? current.arrayLayoutCode === 1 || current.arrayLayoutCode === 2
          ? current.arrayLayoutCode
          : 1
        : 0,
    portConfigurationCode:
      nextTopology === 'multi_element_mimo'
        ? current.portConfigurationCode === 0 || current.portConfigurationCode === 4
          ? current.portConfigurationCode
          : 4
        : 0,
  };
}

/**
 * Balanis Transmission Line Cavity Model synthesis for initial dimensions.
 */
export function synthesizePatchGeometry(
  freqGHz: number,
  er: number,
  heightMm: number,
): {
  widthMm: number;
  lengthMm: number;
  effectiveEr: number;
  deltaLMm: number;
  optimalFeedXMm: number;
} {
  const f = Math.max(0.3, Math.min(60, freqGHz));
  const h = Math.max(0.2, Math.min(12, heightMm));
  const eps = Math.max(1.5, Math.min(14, er));

  const W = (SPEED_OF_LIGHT_MM_GHZ / (2 * f)) * Math.sqrt(2 / (eps + 1));
  const epsEff =
    (eps + 1) / 2 + ((eps - 1) / 2) * Math.pow(1 + (12 * h) / Math.max(W, 0.5), -0.5);

  const wOverH = W / h;
  const deltaL =
    0.412 *
    h *
    (((epsEff + 0.3) * (wOverH + 0.264)) / ((epsEff - 0.258) * (wOverH + 0.8)));

  const lEff = SPEED_OF_LIGHT_MM_GHZ / (2 * f * Math.sqrt(epsEff));
  const L = Math.max(1.5, lEff - 2 * deltaL);

  // Edge radiation resistance ~ 90 * er^2 / (er - 1) * (L/W)^2; inset feed x0 matches 50 Ohm
  const rEdge = 90 * ((eps * eps) / Math.max(0.4, eps - 1)) * Math.pow(L / Math.max(W, 0.5), 2);
  const ratio = Math.min(0.95, Math.max(0.05, 50 / Math.max(52, rEdge)));
  const optimalFeedX = (L / Math.PI) * Math.acos(Math.sqrt(ratio));

  return {
    widthMm: W,
    lengthMm: L,
    effectiveEr: epsEff,
    deltaLMm: deltaL,
    optimalFeedXMm: optimalFeedX,
  };
}

/**
 * Evaluates full analytical electromagnetic performance using Cavity + Transmission Line models.
 * Used for reproducible synthetic dataset generation (Demo estimate) and physical guardrails.
 */
export function evaluateAnalyticalPhysics(params: AntennaDesignParams): {
  gainDbi: number;
  bandwidthMHz: number;
  resonantFreqGHz: number;
  efficiencyPct: number;
  returnLossDb: number;
  vswr: number;
  inputImpedanceOhm: number;
  beamwidthDeg: number;
  areaMm2: number;
  estimatedCostUsd: number;
} {
  const h = Math.max(0.15, params.substrateHeightMm);
  const er = Math.max(1.2, params.dielectricConstant);
  const tanD = Math.max(0.0001, params.lossTangent);
  const fTarget = Math.max(0.3, params.operatingFreqGHz);

  // Support circular_patch using patchRadiusMm even when patchLengthMm/patchWidthMm are 0
  const isCircular = params.topology === 'circular_patch';
  const radiusMm = Math.max(1.2, params.patchRadiusMm > 0 ? params.patchRadiusMm : params.patchLengthMm * 0.55);
  const L = isCircular ? radiusMm * 1.72 : Math.max(1.2, params.patchLengthMm);
  const W = isCircular ? radiusMm * 2.05 : Math.max(1.2, params.patchWidthMm);

  const epsEff =
    (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + (12 * h) / Math.max(W, 0.5), -0.5);
  const wOverH = W / h;
  const deltaL =
    0.412 *
    h *
    (((epsEff + 0.3) * (wOverH + 0.264)) / ((epsEff - 0.258) * (wOverH + 0.8)));

  let resonantFreqGHz: number;
  if (isCircular) {
    const rEffCm =
      (radiusMm / 10) *
      Math.sqrt(
        1 +
          ((2 * (h / 10)) / (Math.PI * er * Math.max(0.12, radiusMm / 10))) *
            (Math.log((Math.PI * (radiusMm / 10)) / (2 * (h / 10))) + 1.7726),
      );
    resonantFreqGHz = Math.max(0.25, 8.791 / (Math.max(0.1, rEffCm) * Math.sqrt(er)));
  } else {
    resonantFreqGHz =
      SPEED_OF_LIGHT_MM_GHZ / (2 * (L + 2 * deltaL) * Math.sqrt(epsEff));
  }

  const lambda0 = SPEED_OF_LIGHT_MM_GHZ / resonantFreqGHz;

  // Input impedance matching via feed offset & topology-specific parameters
  let rInAtResonance: number;
  if (isCircular) {
    // TM110 circular disk radial impedance law: Rin(r0) ~ R_edge * sin^2((pi/2)*(r0/R))
    const rEdgeCirc = Math.max(130, 52 * ((er * er) / Math.max(0.4, er - 1)));
    const rFrac = Math.min(1, Math.max(0, Math.abs(params.feedXMm) / Math.max(1, radiusMm)));
    const sinTerm = Math.sin(Math.PI * 0.5 * rFrac);
    rInAtResonance = Math.max(6, rEdgeCirc * sinTerm * sinTerm);
  } else {
    const rEdge =
      90 * ((er * er) / Math.max(0.4, er - 1)) * Math.pow(L / Math.max(W, 0.5), 2);
    const effectiveFeedX =
      params.topology === 'microstrip_patch' && params.insetDepthMm > 0
        ? 0.55 * params.insetDepthMm + 0.45 * params.feedXMm
        : params.feedXMm;
    const clampedFeedX = Math.min(L * 0.48, Math.max(0, Math.abs(effectiveFeedX)));
    const cosTerm = Math.cos((Math.PI * clampedFeedX) / L);
    rInAtResonance = Math.max(6, rEdge * cosTerm * cosTerm);
  }

  // Transverse offset y introduces reactive/asymmetric mode degradation
  const yMismatchPenalty = Math.pow(Math.abs(params.feedYMm) / Math.max(1, W * 0.5), 2) * 35;

  // Probe-fed reactance penalty if probe diameter deviates from ~1.27 mm SMA standard
  const probePenalty =
    params.topology === 'rectangular_patch' && params.probeDiameterMm > 0
      ? Math.abs(params.probeDiameterMm - 1.27) * 4.5 + (params.feedTypeCode === 1 ? 2.5 : 0)
      : 0;

  // Frequency detuning between operatingFreqGHz and resonantFreqGHz
  const freqMismatchFrac = Math.abs(fTarget - resonantFreqGHz) / Math.max(0.1, resonantFreqGHz);

  // Quality factors (Radiation, Dielectric, Conductor, Surface Wave)
  const hOverLambda = h / lambda0;
  const circQFactor = isCircular ? 0.65 : 1.0;
  const Qrad = Math.max(4, ((3 * er) / (16 * Math.max(0.003, hOverLambda) * (W / L))) * circQFactor);
  const Qdiel = 1 / tanD;
  const conductor = CONDUCTOR_CATALOG[params.conductorMaterial] ?? CONDUCTOR_CATALOG.Copper;
  const skinDepthMm =
    Math.sqrt(1 / (Math.PI * resonantFreqGHz * 1e9 * 4e-7 * Math.PI * conductor.conductivitySPerM)) *
    1000;
  const Qcond = Math.max(20, h / Math.max(1e-5, skinDepthMm));
  const Qsw = 1 / Math.max(0.0005, 0.08 * hOverLambda * (er - 1));

  const totalInvQ = 1 / Qrad + 1 / Qdiel + 1 / Qcond + 1 / Qsw;
  const Qtot = 1 / totalInvQ;

  // Radiation efficiency with MIMO mutual coupling factor based on spacing
  let radEfficiency = Math.min(0.985, Math.max(0.18, Qtot / Qrad));
  if (params.topology === 'multi_element_mimo') {
    const spacingRatio = Math.min(1, Math.max(0.25, Math.min(params.elementSpacingXmm, params.elementSpacingYmm) / (lambda0 * 0.5)));
    const portFactor = params.portConfigurationCode === 4 ? 1.0 : 0.92;
    radEfficiency *= (0.78 + 0.22 * spacingRatio) * portFactor;
  }

  // Bandwidth for VSWR <= 2 (S11 <= -10 dB)
  const vswrTarget = 2.0;
  const fracBw = (vswrTarget - 1) / (Qtot * Math.sqrt(vswrTarget));
  let notchBwBoost = 1.0;
  if (params.topology === 'microstrip_patch' && params.notchWidthMm > 0) {
    notchBwBoost = 1.0 + Math.min(0.12, (params.notchWidthMm / Math.max(1, W)) * 0.35);
  }
  const bandwidthMHz = Math.max(4, resonantFreqGHz * 1000 * fracBw * notchBwBoost);

  // Input reflection at target operating frequency
  const bandwidthFrac = Math.max(0.005, fracBw);
  const detuneRatio = freqMismatchFrac / bandwidthFrac;
  const rEff = rInAtResonance + yMismatchPenalty + probePenalty;
  const reactiveTerm = detuneRatio * 50 * 1.15;
  const gammaRealNum = rEff - 50;
  const gammaMagSq =
    (gammaRealNum * gammaRealNum + reactiveTerm * reactiveTerm) /
    ((rEff + 50) * (rEff + 50) + reactiveTerm * reactiveTerm);
  const gammaMag = Math.min(0.98, Math.max(0.02, Math.sqrt(gammaMagSq)));
  const returnLossDb = Math.max(-42, Math.min(-0.4, 20 * Math.log10(gammaMag)));
  const vswr = Math.min(25, (1 + gammaMag) / Math.max(0.02, 1 - gammaMag));

  // Directivity & Gain based on topology + aperture width + spacing + progressive phase
  const widthRatio = Math.min(1.6, Math.max(0.48, W / (lambda0 * 0.5)));
  const baseDirectivityLinear =
    Math.max(3.15, 4.4 * Math.pow(widthRatio, 0.5)) *
    (1 - (0.09 * Math.max(0, er - 4.4)) / 5);
  let arrayGainBoostDb = 0;
  let beamwidthDeg = 74 / Math.pow(widthRatio, 0.45);
  let areaMultiplier = 1.0;

  if (params.topology === 'array_2x2') {
    const avgSpacing = 0.5 * (Math.max(2, params.elementSpacingXmm) + Math.max(2, params.elementSpacingYmm));
    const spacingLambda = avgSpacing / Math.max(1, lambda0);
    const spacingFactorDb = spacingLambda < 0.35 ? -1.4 : spacingLambda > 0.85 ? -0.9 : 0.3;
    const phaseRadX = (Math.abs(params.phaseXDeg) * Math.PI) / 180;
    const phaseRadY = (Math.abs(params.phaseYDeg) * Math.PI) / 180;
    const scanLossDb = 10 * Math.log10(Math.max(0.35, Math.cos(phaseRadX * 0.35) * Math.cos(phaseRadY * 0.35)));
    const layoutBoost = params.arrayLayoutCode === 2 ? -0.6 : 0;
    arrayGainBoostDb = 5.4 + spacingFactorDb + scanLossDb + layoutBoost;
    beamwidthDeg = params.arrayLayoutCode === 2 ? 42 : 36;
    areaMultiplier = Math.max(3.6, Math.min(8.5, 4.8 * Math.max(0.6, spacingLambda / 0.5)));
  } else if (params.topology === 'multi_element_mimo') {
    const avgSpacing = 0.5 * (Math.max(2, params.elementSpacingXmm) + Math.max(2, params.elementSpacingYmm));
    const spacingLambda = avgSpacing / Math.max(1, lambda0);
    arrayGainBoostDb = 3.2 + (spacingLambda >= 0.45 ? 0.35 : -0.65);
    beamwidthDeg = 48;
    areaMultiplier = Math.max(3.4, Math.min(7.5, 4.2 * Math.max(0.6, spacingLambda / 0.5)));
  } else if (params.topology === 'circular_patch') {
    arrayGainBoostDb = 0.15;
    beamwidthDeg = 76;
  }

  const mismatchLossDb = 10 * Math.log10(Math.max(0.15, 1 - gammaMag * gammaMag));
  const directivityDb = 10 * Math.log10(Math.max(1.5, baseDirectivityLinear)) + arrayGainBoostDb;
  const gainDbi = directivityDb + 10 * Math.log10(radEfficiency) + mismatchLossDb * 0.55;

  // Board area (includes ground margin around patch)
  const boardW = (W + 12) * Math.sqrt(areaMultiplier);
  const boardL = (L + 12) * Math.sqrt(areaMultiplier);
  const areaMm2 = boardW * boardL;

  const subSpec = SUBSTRATE_CATALOG[params.substrateMaterial] ?? SUBSTRATE_CATALOG.FR4;
  const areaCm2 = areaMm2 / 100;
  const thicknessFactor = 0.75 + 0.25 * (h / 1.6);
  const connectorCost =
    params.topology === 'multi_element_mimo'
      ? params.portConfigurationCode === 4
        ? 8.4
        : 2.4
      : 2.1;
  const estimatedCostUsd =
    areaCm2 * subSpec.costPerCm2Usd * thicknessFactor * conductor.costMultiplier + connectorCost;

  return {
    gainDbi: Number(gainDbi.toFixed(2)),
    bandwidthMHz: Number(bandwidthMHz.toFixed(1)),
    resonantFreqGHz: Number(resonantFreqGHz.toFixed(3)),
    efficiencyPct: Number((radEfficiency * 100 * (1 - 0.15 * gammaMag * gammaMag)).toFixed(1)),
    returnLossDb: Number(returnLossDb.toFixed(2)),
    vswr: Number(vswr.toFixed(2)),
    inputImpedanceOhm: Number(rEff.toFixed(1)),
    beamwidthDeg: Number(Math.max(18, Math.min(115, beamwidthDeg)).toFixed(1)),
    areaMm2: Number(areaMm2.toFixed(0)),
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(2)),
  };
}

export function hasAchievedTenDbBandwidth(
  prediction:
    | {
        bandwidthMHz: number;
        returnLossDb: number;
        frequencySweep?: Array<{ s11Db: number }>;
      }
    | null
    | undefined,
): boolean {
  if (!prediction) return false;
  if (prediction.bandwidthMHz <= 0 || prediction.returnLossDb > -10) return false;
  if (Array.isArray(prediction.frequencySweep) && prediction.frequencySweep.length > 0) {
    const minSweepS11 = Math.min(...prediction.frequencySweep.map((p) => p.s11Db));
    if (minSweepS11 > -10) return false;
  }
  return true;
}


