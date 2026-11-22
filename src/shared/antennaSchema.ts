import type {
  AntennaDesignParams,
  AntennaTopology,
  ConductorMaterial,
  PredictionOutput4,
  SubstrateMaterial,
} from './antennaTypes.ts';

/**
 * Exact 21-feature input order shared across UI encoding, server ML models,
 * optimization, explainability, CSV import/export, and validation.
 */
export const FEATURE_ORDER = [
  'patchLengthMm',
  'patchWidthMm',
  'substrateHeightMm',
  'dielectricConstant',
  'lossTangent',
  'feedXMm',
  'feedYMm',
  'operatingFreqGHz',
  'topologyCode',
  'conductorSigmaNorm',
  'insetDepthMm',
  'notchWidthMm',
  'probeDiameterMm',
  'feedTypeCode',
  'patchRadiusMm',
  'elementSpacingXmm',
  'elementSpacingYmm',
  'phaseXDeg',
  'phaseYDeg',
  'arrayLayoutCode',
  'portConfigurationCode',
] as const;

export type FeatureKey = (typeof FEATURE_ORDER)[number];

export const LEGACY_10_FEATURE_ORDER = FEATURE_ORDER.slice(0, 10);
export const CONDITIONAL_11_FEATURE_ORDER = FEATURE_ORDER.slice(10);

export const OUTPUT_ORDER = [
  'gainDbi',
  'bandwidthMHz',
  'resonantFreqGHz',
  'efficiencyPct',
] as const;

export type OutputKey = (typeof OUTPUT_ORDER)[number];

export const TOPOLOGY_CODE_MAP: Record<AntennaTopology, number> = {
  microstrip_patch: 0,
  rectangular_patch: 1,
  circular_patch: 2,
  array_2x2: 3,
  multi_element_mimo: 4,
};

export const TOPOLOGY_BY_CODE: Record<number, AntennaTopology> = {
  0: 'microstrip_patch',
  1: 'rectangular_patch',
  2: 'circular_patch',
  3: 'array_2x2',
  4: 'multi_element_mimo',
};

export const TOPOLOGY_CANONICAL_NAMES: Record<AntennaTopology, string> = {
  microstrip_patch: 'Microstrip_Inset_Patch',
  rectangular_patch: 'Probe_Fed_Rectangular_Patch',
  circular_patch: 'Circular_Disk_Patch',
  array_2x2: '2x2_Phased_Planar_Array',
  multi_element_mimo: '4_Element_MIMO_Array',
};

export const FEED_TYPE_CODES = {
  none: 0,
  Microstrip_Inset: 1,
  Coaxial_Probe: 2,
} as const;

export const FEED_TYPE_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Microstrip Inset',
  2: 'Coaxial Probe',
};

export const ARRAY_LAYOUT_CODES = {
  none: 0,
  '2x2_Planar': 1,
  Linear_4_Element: 2,
} as const;

export const ARRAY_LAYOUT_LABELS: Record<number, string> = {
  0: 'None',
  1: '2x2 Planar',
  2: 'Linear 4-Element',
};

export const PORT_CONFIGURATION_CODES = {
  none_single: 0,
  '4_Port': 4,
} as const;

export const PORT_CONFIGURATION_LABELS: Record<number, string> = {
  0: 'None / Single',
  4: '4-Port MIMO',
};

export const FEATURE_METADATA: Record<
  FeatureKey,
  { label: string; unit: string; description: string }
> = {
  patchLengthMm: { label: 'Patch Length (L)', unit: 'mm', description: 'Resonant patch length' },
  patchWidthMm: { label: 'Patch Width (W)', unit: 'mm', description: 'Radiating patch width' },
  substrateHeightMm: { label: 'Substrate Height (h)', unit: 'mm', description: 'Dielectric thickness' },
  dielectricConstant: { label: 'Dielectric Constant (er)', unit: '', description: 'Relative permittivity' },
  lossTangent: { label: 'Loss Tangent (tan d)', unit: '', description: 'Dielectric dissipation factor' },
  feedXMm: { label: 'Feed Position X', unit: 'mm', description: 'Longitudinal feed offset' },
  feedYMm: { label: 'Feed Position Y', unit: 'mm', description: 'Transverse feed offset' },
  operatingFreqGHz: { label: 'Operating Frequency', unit: 'GHz', description: 'Target center frequency' },
  topologyCode: { label: 'Topology Code', unit: 'code', description: '0..4 antenna architecture' },
  conductorSigmaNorm: { label: 'Conductor Conductivity', unit: 'rel', description: 'Relative to 5.8e7 S/m copper' },
  insetDepthMm: { label: 'Inset Depth', unit: 'mm', description: 'Microstrip inset notch depth' },
  notchWidthMm: { label: 'Notch Width', unit: 'mm', description: 'Microstrip inset gap width' },
  probeDiameterMm: { label: 'Probe Diameter', unit: 'mm', description: 'Coaxial feed pin diameter' },
  feedTypeCode: { label: 'Feed Type Code', unit: 'code', description: '0=none, 1=Inset, 2=Probe' },
  patchRadiusMm: { label: 'Patch Radius', unit: 'mm', description: 'Circular disk radius' },
  elementSpacingXmm: { label: 'Element Spacing X', unit: 'mm', description: 'Array X center-to-center pitch' },
  elementSpacingYmm: { label: 'Element Spacing Y', unit: 'mm', description: 'Array Y center-to-center pitch' },
  phaseXDeg: { label: 'Phase Shift X', unit: 'deg', description: 'Progressive X beam phase' },
  phaseYDeg: { label: 'Phase Shift Y', unit: 'deg', description: 'Progressive Y beam phase' },
  arrayLayoutCode: { label: 'Array Layout Code', unit: 'code', description: '0=none, 1=2x2 Planar, 2=Linear 4-El' },
  portConfigurationCode: { label: 'Port Config Code', unit: 'code', description: '0=none/single, 4=4-Port' },
};

export interface FeatureVector21Record {
  patchLengthMm: number;
  patchWidthMm: number;
  substrateHeightMm: number;
  dielectricConstant: number;
  lossTangent: number;
  feedXMm: number;
  feedYMm: number;
  operatingFreqGHz: number;
  topologyCode: number;
  conductorSigmaNorm: number;
  insetDepthMm: number;
  notchWidthMm: number;
  probeDiameterMm: number;
  feedTypeCode: number;
  patchRadiusMm: number;
  elementSpacingXmm: number;
  elementSpacingYmm: number;
  phaseXDeg: number;
  phaseYDeg: number;
  arrayLayoutCode: number;
  portConfigurationCode: number;
}

export const CONDUCTOR_SIGMA_MAP: Record<ConductorMaterial, number> = {
  Copper: 5.8e7,
  Gold_ENIG: 4.1e7,
  Silver: 6.3e7,
  Aluminum: 3.5e7,
};

function safeNum(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function getActiveConditionalFields(topology: AntennaTopology): FeatureKey[] {
  switch (topology) {
    case 'microstrip_patch':
      return ['insetDepthMm', 'notchWidthMm'];
    case 'rectangular_patch':
      return ['probeDiameterMm', 'feedTypeCode'];
    case 'circular_patch':
      return ['patchRadiusMm'];
    case 'array_2x2':
      return ['elementSpacingXmm', 'elementSpacingYmm', 'phaseXDeg', 'phaseYDeg', 'arrayLayoutCode'];
    case 'multi_element_mimo':
      return ['elementSpacingXmm', 'elementSpacingYmm', 'portConfigurationCode'];
  }
}

/**
 * Produces the typed 21-feature object with inactive topology-specific fields
 * strictly zeroed (and patchLengthMm/patchWidthMm zeroed for circular_patch).
 */
export function buildFeatureRecord21(params: AntennaDesignParams): FeatureVector21Record {
  const topo = params.topology in TOPOLOGY_CODE_MAP ? params.topology : 'microstrip_patch';
  const isCircular = topo === 'circular_patch';
  const sigma = CONDUCTOR_SIGMA_MAP[params.conductorMaterial] ?? 5.8e7;

  return {
    patchLengthMm: isCircular ? 0 : safeNum(params.patchLengthMm, 0),
    patchWidthMm: isCircular ? 0 : safeNum(params.patchWidthMm, 0),
    substrateHeightMm: safeNum(params.substrateHeightMm, 0),
    dielectricConstant: safeNum(params.dielectricConstant, 0),
    lossTangent: safeNum(params.lossTangent, 0),
    feedXMm: safeNum(params.feedXMm, 0),
    feedYMm: safeNum(params.feedYMm, 0),
    operatingFreqGHz: safeNum(params.operatingFreqGHz, 0),
    topologyCode: TOPOLOGY_CODE_MAP[topo],
    conductorSigmaNorm: Number((sigma / 5.8e7).toFixed(4)),
    insetDepthMm: topo === 'microstrip_patch' ? safeNum(params.insetDepthMm, 0) : 0,
    notchWidthMm: topo === 'microstrip_patch' ? safeNum(params.notchWidthMm, 0) : 0,
    probeDiameterMm: topo === 'rectangular_patch' ? safeNum(params.probeDiameterMm, 0) : 0,
    feedTypeCode: topo === 'rectangular_patch' ? safeNum(params.feedTypeCode, 2) : 0,
    patchRadiusMm: topo === 'circular_patch' ? safeNum(params.patchRadiusMm, 0) : 0,
    elementSpacingXmm:
      topo === 'array_2x2' || topo === 'multi_element_mimo'
        ? safeNum(params.elementSpacingXmm, 0)
        : 0,
    elementSpacingYmm:
      topo === 'array_2x2' || topo === 'multi_element_mimo'
        ? safeNum(params.elementSpacingYmm, 0)
        : 0,
    phaseXDeg: topo === 'array_2x2' ? safeNum(params.phaseXDeg, 0) : 0,
    phaseYDeg: topo === 'array_2x2' ? safeNum(params.phaseYDeg, 0) : 0,
    arrayLayoutCode: topo === 'array_2x2' ? safeNum(params.arrayLayoutCode, 1) : 0,
    portConfigurationCode:
      topo === 'multi_element_mimo' ? safeNum(params.portConfigurationCode, 4) : 0,
  };
}

/**
 * Single-source-of-truth 21-feature vector encoder in exact FEATURE_ORDER.
 * Every inactive field is guaranteed to be numeric 0 (never NaN/null/undefined).
 */
export function encodeFeatures(params: AntennaDesignParams): number[] {
  const rec = buildFeatureRecord21(params);
  return FEATURE_ORDER.map((key) => {
    const val = rec[key];
    return Number.isFinite(val) ? val : 0;
  });
}

export type ValidationErrors = Partial<Record<keyof AntennaDesignParams, string>>;

/**
 * Validates common and topology-specific inputs before running prediction.
 */
export function validateAntennaDesign(params: AntennaDesignParams): ValidationErrors {
  const errors: ValidationErrors = {};
  const isPosFinite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const isFiniteNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

  if (!isFiniteNum(params.operatingFreqGHz) || params.operatingFreqGHz < 0.3 || params.operatingFreqGHz > 60) {
    errors.operatingFreqGHz = 'Frequency must be between 0.3 and 60 GHz.';
  }
  if (!isFiniteNum(params.substrateHeightMm) || params.substrateHeightMm < 0.15 || params.substrateHeightMm > 12) {
    errors.substrateHeightMm = 'Substrate height h must be between 0.15 and 12 mm.';
  }
  if (!isFiniteNum(params.dielectricConstant) || params.dielectricConstant < 1.2 || params.dielectricConstant > 15) {
    errors.dielectricConstant = 'Dielectric constant (εr) must be between 1.2 and 15.';
  }
  if (!isFiniteNum(params.lossTangent) || params.lossTangent < 0.0001 || params.lossTangent > 0.15) {
    errors.lossTangent = 'Loss tangent must be between 0.0001 and 0.15.';
  }

  if (params.topology === 'circular_patch') {
    if (!isPosFinite(params.patchRadiusMm) || params.patchRadiusMm < 1 || params.patchRadiusMm > 150) {
      errors.patchRadiusMm = 'Patch radius must be between 1 and 150 mm.';
    }
    if (!isFiniteNum(params.feedXMm) || params.feedXMm < 0 || params.feedXMm > Math.max(1, params.patchRadiusMm)) {
      errors.feedXMm = 'Feed X must be within 0 to patch radius (mm).';
    }
    if (!isFiniteNum(params.feedYMm) || Math.abs(params.feedYMm) > Math.max(1, params.patchRadiusMm)) {
      errors.feedYMm = 'Feed Y must stay within circular disk radius (mm).';
    }
  } else {
    if (!isPosFinite(params.patchLengthMm) || params.patchLengthMm < 1.5 || params.patchLengthMm > 250) {
      errors.patchLengthMm = 'Patch length L must be between 1.5 and 250 mm.';
    }
    if (!isPosFinite(params.patchWidthMm) || params.patchWidthMm < 1.5 || params.patchWidthMm > 250) {
      errors.patchWidthMm = 'Patch width W must be between 1.5 and 250 mm.';
    }
    if (!isFiniteNum(params.feedXMm) || params.feedXMm < 0 || params.feedXMm > Math.max(1, params.patchLengthMm * 0.49)) {
      errors.feedXMm = 'Feed X must be between 0 and 49% of patch length L.';
    }
    if (!isFiniteNum(params.feedYMm) || Math.abs(params.feedYMm) > Math.max(1, params.patchWidthMm * 0.45)) {
      errors.feedYMm = 'Feed Y must stay within ±45% of patch width W.';
    }
  }

  if (params.topology === 'microstrip_patch') {
    if (!isFiniteNum(params.insetDepthMm) || params.insetDepthMm <= 0 || params.insetDepthMm >= params.patchLengthMm * 0.49) {
      errors.insetDepthMm = 'Inset depth must be > 0 mm and < 49% of patch length L.';
    }
    if (!isFiniteNum(params.notchWidthMm) || params.notchWidthMm <= 0 || params.notchWidthMm >= params.patchWidthMm * 0.45) {
      errors.notchWidthMm = 'Notch width must be > 0 mm and < 45% of patch width W.';
    }
  }

  if (params.topology === 'rectangular_patch') {
    if (!isFiniteNum(params.probeDiameterMm) || params.probeDiameterMm < 0.1 || params.probeDiameterMm > 6) {
      errors.probeDiameterMm = 'Probe diameter must be between 0.1 and 6.0 mm.';
    }
    if (params.feedTypeCode !== 1 && params.feedTypeCode !== 2) {
      errors.feedTypeCode = 'Feed type must be Microstrip_Inset (1) or Coaxial_Probe (2).';
    }
  }

  if (params.topology === 'array_2x2') {
    if (!isFiniteNum(params.elementSpacingXmm) || params.elementSpacingXmm < 1 || params.elementSpacingXmm > 300) {
      errors.elementSpacingXmm = 'Element spacing X must be between 1 and 300 mm.';
    }
    if (!isFiniteNum(params.elementSpacingYmm) || params.elementSpacingYmm < 1 || params.elementSpacingYmm > 300) {
      errors.elementSpacingYmm = 'Element spacing Y must be between 1 and 300 mm.';
    }
    if (!isFiniteNum(params.phaseXDeg) || params.phaseXDeg < -180 || params.phaseXDeg > 180) {
      errors.phaseXDeg = 'Phase X must be between -180° and +180°.';
    }
    if (!isFiniteNum(params.phaseYDeg) || params.phaseYDeg < -180 || params.phaseYDeg > 180) {
      errors.phaseYDeg = 'Phase Y must be between -180° and +180°.';
    }
    if (params.arrayLayoutCode !== 1 && params.arrayLayoutCode !== 2) {
      errors.arrayLayoutCode = 'Array layout must be 2x2_Planar (1) or Linear_4_Element (2).';
    }
  }

  if (params.topology === 'multi_element_mimo') {
    if (!isFiniteNum(params.elementSpacingXmm) || params.elementSpacingXmm < 1 || params.elementSpacingXmm > 300) {
      errors.elementSpacingXmm = 'Element spacing X must be between 1 and 300 mm.';
    }
    if (!isFiniteNum(params.elementSpacingYmm) || params.elementSpacingYmm < 1 || params.elementSpacingYmm > 300) {
      errors.elementSpacingYmm = 'Element spacing Y must be between 1 and 300 mm.';
    }
    if (params.portConfigurationCode !== 0 && params.portConfigurationCode !== 4) {
      errors.portConfigurationCode = 'Port configuration must be single (0) or 4_Port (4).';
    }
  }

  return errors;
}

export interface CsvImportValidationResult {
  valid: boolean;
  isLegacy10Feature: boolean;
  hasOutputs: boolean;
  errors: string[];
  warnings: string[];
  missingFeatureColumns: FeatureKey[];
  missingOutputColumns: OutputKey[];
  rows: Array<{
    params: AntennaDesignParams;
    featureVector: number[];
    outputs?: PredictionOutput4;
  }>;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  patchLengthMm: ['patchlengthmm', 'patch_length_mm', 'length_mm', 'l_mm', 'length'],
  patchWidthMm: ['patchwidthmm', 'patch_width_mm', 'width_mm', 'w_mm', 'width'],
  substrateHeightMm: ['substrateheightmm', 'substrate_height_mm', 'height_mm', 'h_mm', 'height', 'thickness'],
  dielectricConstant: ['dielectricconstant', 'dielectric_constant', 'er', 'epsilon_r', 'permittivity'],
  lossTangent: ['losstangent', 'loss_tangent', 'tand', 'tan_d'],
  feedXMm: ['feedxmm', 'feed_x_mm', 'feedx', 'feed_x'],
  feedYMm: ['feedymm', 'feed_y_mm', 'feedy', 'feed_y'],
  operatingFreqGHz: ['operatingfreqghz', 'operating_freq_ghz', 'freq_ghz', 'frequency_ghz', 'freq'],
  topologyCode: ['topologycode', 'topology_code', 'topology'],
  conductorSigmaNorm: ['conductorsigmanorm', 'conductor_sigma_norm', 'sigma_norm', 'conductivity_norm'],
  insetDepthMm: ['insetdepthmm', 'inset_depth_mm', 'inset_depth'],
  notchWidthMm: ['notchwidthmm', 'notch_width_mm', 'notch_width'],
  probeDiameterMm: ['probediametermm', 'probe_diameter_mm', 'probe_diameter'],
  feedTypeCode: ['feedtypecode', 'feed_type_code', 'feed_type'],
  patchRadiusMm: ['patchradiusmm', 'patch_radius_mm', 'radius_mm', 'radius'],
  elementSpacingXmm: ['elementspacingxmm', 'element_spacing_x_mm', 'spacing_x_mm', 'spacing_x'],
  elementSpacingYmm: ['elementspacingymm', 'element_spacing_y_mm', 'spacing_y_mm', 'spacing_y'],
  phaseXDeg: ['phasexdeg', 'phase_x_deg', 'phase_x'],
  phaseYDeg: ['phaseydeg', 'phase_y_deg', 'phase_y'],
  arrayLayoutCode: ['arraylayoutcode', 'array_layout_code', 'array_layout'],
  portConfigurationCode: ['portconfigurationcode', 'port_configuration_code', 'port_config'],
  gainDbi: ['gaindbi', 'gain_dbi', 'gain'],
  bandwidthMHz: ['bandwidthmhz', 'bandwidth_mhz', 'bw_mhz', 'bandwidth'],
  resonantFreqGHz: ['resonantfreqghz', 'resonant_freq_ghz', 'f_res_ghz', 'resonant_freq'],
  efficiencyPct: ['efficiencypct', 'efficiency_pct', 'efficiency'],
};

function findHeaderMatch(headers: string[], key: string): string | undefined {
  const normalizedMap = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));
  if (normalizedMap.has(key.toLowerCase())) return normalizedMap.get(key.toLowerCase());
  const aliases = COLUMN_ALIASES[key] ?? [];
  for (const alias of aliases) {
    if (normalizedMap.has(alias)) return normalizedMap.get(alias);
  }
  return undefined;
}

/**
 * Validates tabular CSV/XLSX rows against the 21-feature schema + 4 outputs,
 * supporting backward-compatible 10-feature datasets by filling the 11 new fields with 0.
 */
export function validateAndParseImportedRows(
  rawRows: Record<string, unknown>[],
  options: { requireOutputColumns?: boolean; filename?: string } = {},
): CsvImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rawRows || rawRows.length === 0) {
    return {
      valid: false,
      isLegacy10Feature: false,
      hasOutputs: false,
      errors: ['Uploaded file contains no data rows.'],
      warnings: [],
      missingFeatureColumns: [...FEATURE_ORDER],
      missingOutputColumns: [...OUTPUT_ORDER],
      rows: [],
    };
  }

  const headers = Object.keys(rawRows[0]);
  const featureColMap: Partial<Record<FeatureKey, string>> = {};
  const missingLegacy10: FeatureKey[] = [];
  const missingConditional11: FeatureKey[] = [];

  for (const key of LEGACY_10_FEATURE_ORDER) {
    const matched = findHeaderMatch(headers, key);
    if (matched) featureColMap[key] = matched;
    else missingLegacy10.push(key);
  }

  for (const key of CONDITIONAL_11_FEATURE_ORDER) {
    const matched = findHeaderMatch(headers, key);
    if (matched) featureColMap[key] = matched;
    else missingConditional11.push(key);
  }

  const outputColMap: Partial<Record<OutputKey, string>> = {};
  const missingOutputColumns: OutputKey[] = [];
  for (const key of OUTPUT_ORDER) {
    const matched = findHeaderMatch(headers, key);
    if (matched) outputColMap[key] = matched;
    else missingOutputColumns.push(key);
  }

  const isLegacy10Feature = missingLegacy10.length === 0 && missingConditional11.length === 11;
  const hasAll21 = missingLegacy10.length === 0 && missingConditional11.length === 0;
  const hasOutputs = missingOutputColumns.length === 0;

  if (missingLegacy10.length > 0) {
    errors.push(
      `Missing required core feature column(s): ${missingLegacy10.join(', ')}`,
    );
  }

  if (!isLegacy10Feature && missingConditional11.length > 0) {
    errors.push(
      `Missing topology-specific 21-feature column(s): ${missingConditional11.join(', ')} (provide all 21 feature columns or use a legacy 10-feature sheet).`,
    );
  }

  if (options.requireOutputColumns && missingOutputColumns.length > 0) {
    errors.push(
      `Missing required output column(s): ${missingOutputColumns.join(', ')}`,
    );
  } else if (!hasOutputs && missingOutputColumns.length > 0 && missingOutputColumns.length < 4) {
    errors.push(
      `Incomplete output columns detected. Missing: ${missingOutputColumns.join(', ')} (expected all 4: ${OUTPUT_ORDER.join(', ')}).`,
    );
  }

  if (isLegacy10Feature && errors.length === 0) {
    warnings.push(
      'Legacy 10-feature schema detected: the 11 topology-specific columns were backward-compatibly filled with 0.',
    );
  }
  if (!hasOutputs && !options.requireOutputColumns && missingOutputColumns.length === 4) {
    warnings.push(
      `Output columns (${OUTPUT_ORDER.join(', ')}) are absent — rows will be evaluated using the Demo estimate ML surrogate.`,
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      isLegacy10Feature,
      hasOutputs,
      errors,
      warnings,
      missingFeatureColumns: [...missingLegacy10, ...(isLegacy10Feature ? [] : missingConditional11)],
      missingOutputColumns,
      rows: [],
    };
  }

  const parsedRows: CsvImportValidationResult['rows'] = [];

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 1;
    const readCell = (key: FeatureKey, defaultZero = false): number => {
      const col = featureColMap[key];
      if (!col) return defaultZero ? 0 : NaN;
      const val = raw[col];
      if (val === undefined || val === null || val === '') return defaultZero ? 0 : NaN;
      const num = Number(val);
      return Number.isFinite(num) ? num : NaN;
    };

    const rawTopo = readCell('topologyCode');
    const topoIdx = Number.isInteger(rawTopo) && rawTopo >= 0 && rawTopo <= 4 ? rawTopo : 0;
    if (Number.isNaN(rawTopo) || rawTopo < 0 || rawTopo > 4) {
      errors.push(`Row ${rowNum}: invalid topologyCode "${String(raw[featureColMap.topologyCode!])}". Expected 0..4.`);
      return;
    }

    const topology = TOPOLOGY_BY_CODE[topoIdx] ?? 'microstrip_patch';
    const sigmaNorm = readCell('conductorSigmaNorm');
    let conductorMaterial: ConductorMaterial = 'Copper';
    if (sigmaNorm > 1.04) conductorMaterial = 'Silver';
    else if (sigmaNorm < 0.68) conductorMaterial = 'Aluminum';
    else if (sigmaNorm < 0.85) conductorMaterial = 'Gold_ENIG';

    const er = readCell('dielectricConstant');
    let substrateMaterial: SubstrateMaterial = 'Rogers_RO4003C';
    if (Math.abs(er - 4.4) < 0.35) substrateMaterial = 'FR4';
    else if (Math.abs(er - 3.48) <= 0.04) substrateMaterial = 'Rogers_RO4350B';
    else if (Math.abs(er - 2.2) < 0.3) substrateMaterial = 'Rogers_RT5880';
    else if (er > 7.5) substrateMaterial = 'Alumina';

    const params: AntennaDesignParams = {
      id: `csv-row-${rowNum}-${Date.now()}`,
      name:
        typeof raw['designName'] === 'string'
          ? raw['designName']
          : typeof raw['design_name'] === 'string'
            ? raw['design_name']
            : `${options.filename ?? 'Imported'} #${rowNum}`,
      topology,
      patchLengthMm: topology === 'circular_patch' ? 0 : readCell('patchLengthMm'),
      patchWidthMm: topology === 'circular_patch' ? 0 : readCell('patchWidthMm'),
      substrateHeightMm: readCell('substrateHeightMm'),
      dielectricConstant: er,
      lossTangent: readCell('lossTangent'),
      feedXMm: readCell('feedXMm'),
      feedYMm: readCell('feedYMm'),
      operatingFreqGHz: readCell('operatingFreqGHz'),
      substrateMaterial,
      conductorMaterial,
      insetDepthMm: readCell('insetDepthMm', isLegacy10Feature),
      notchWidthMm: readCell('notchWidthMm', isLegacy10Feature),
      probeDiameterMm: readCell('probeDiameterMm', isLegacy10Feature),
      feedTypeCode: readCell('feedTypeCode', isLegacy10Feature),
      patchRadiusMm: readCell('patchRadiusMm', isLegacy10Feature),
      elementSpacingXmm: readCell('elementSpacingXmm', isLegacy10Feature),
      elementSpacingYmm: readCell('elementSpacingYmm', isLegacy10Feature),
      phaseXDeg: readCell('phaseXDeg', isLegacy10Feature),
      phaseYDeg: readCell('phaseYDeg', isLegacy10Feature),
      arrayLayoutCode: readCell('arrayLayoutCode', isLegacy10Feature),
      portConfigurationCode: readCell('portConfigurationCode', isLegacy10Feature),
    };

    const featureVector = encodeFeatures(params);
    if (featureVector.length !== 21 || featureVector.some((v) => !Number.isFinite(v))) {
      errors.push(`Row ${rowNum}: failed to construct a valid 21-feature numeric vector.`);
      return;
    }

    let outputs: PredictionOutput4 | undefined;
    if (hasOutputs) {
      const g = Number(raw[outputColMap.gainDbi!]);
      const bw = Number(raw[outputColMap.bandwidthMHz!]);
      const fr = Number(raw[outputColMap.resonantFreqGHz!]);
      const eff = Number(raw[outputColMap.efficiencyPct!]);
      if ([g, bw, fr, eff].some((n) => !Number.isFinite(n))) {
        errors.push(`Row ${rowNum}: non-numeric value in output columns (${OUTPUT_ORDER.join(', ')}).`);
        return;
      }
      outputs = {
        gainDbi: g,
        bandwidthMHz: bw,
        resonantFreqGHz: fr,
        efficiencyPct: eff,
      };
    }

    parsedRows.push({ params, featureVector, outputs });
  });

  return {
    valid: errors.length === 0 && parsedRows.length > 0 && (hasAll21 || isLegacy10Feature),
    isLegacy10Feature,
    hasOutputs,
    errors,
    warnings,
    missingFeatureColumns: isLegacy10Feature ? [] : missingConditional11,
    missingOutputColumns,
    rows: parsedRows,
  };
}
