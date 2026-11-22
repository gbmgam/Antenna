export type AntennaTopology =
  | 'microstrip_patch'
  | 'rectangular_patch'
  | 'circular_patch'
  | 'array_2x2'
  | 'multi_element_mimo';

export type SubstrateMaterial =
  | 'FR4'
  | 'Rogers_RO4003C'
  | 'Rogers_RO4350B'
  | 'Rogers_RT5880'
  | 'Alumina';

export type ConductorMaterial = 'Copper' | 'Gold_ENIG' | 'Silver' | 'Aluminum';

export type MLModelType = 'ensemble' | 'random_forest' | 'xgboost' | 'mlp';

export type AppModuleId =
  | 'home'
  | 'assistant'
  | 'studio'
  | 'evaluate'
  | 'faults'
  | 'multifreq'
  | 'optimize'
  | 'compare'
  | 'history'
  | 'reports';

export interface SubstrateSpec {
  id: SubstrateMaterial;
  name: string;
  dielectricConstant: number;
  lossTangent: number;
  costPerCm2Usd: number;
  maxRecommendedFreqGHz: number;
  colorHex: string;
}

export interface ConductorSpec {
  id: ConductorMaterial;
  name: string;
  conductivitySPerM: number;
  costMultiplier: number;
  colorHex: string;
  roughness: number;
}

export interface AntennaDesignParams {
  id: string;
  name: string;
  topology: AntennaTopology;
  patchLengthMm: number;
  patchWidthMm: number;
  substrateHeightMm: number;
  dielectricConstant: number;
  lossTangent: number;
  feedXMm: number;
  feedYMm: number;
  operatingFreqGHz: number;
  substrateMaterial: SubstrateMaterial;
  conductorMaterial: ConductorMaterial;
  // Conditional topology-specific parameters
  insetDepthMm: number;
  notchWidthMm: number;
  probeDiameterMm: number;
  feedTypeCode: number; // 0=none, 1=Microstrip_Inset, 2=Coaxial_Probe
  patchRadiusMm: number;
  elementSpacingXmm: number;
  elementSpacingYmm: number;
  phaseXDeg: number;
  phaseYDeg: number;
  arrayLayoutCode: number; // 0=none, 1=2x2_Planar, 2=Linear_4_Element
  portConfigurationCode: number; // 0=none/single, 4=4_Port
  targetGainDbi?: number;
  targetBandwidthMHz?: number;
}

export interface PredictionOutput4 {
  gainDbi: number;
  bandwidthMHz: number;
  resonantFreqGHz: number;
  efficiencyPct: number;
}

export interface ShapFeatureContribution {
  featureKey: string;
  label: string;
  unit: string;
  value: number;
  baselineValue: number;
  gainImpactDbi: number;
  bandwidthImpactMHz: number;
  efficiencyImpactPct: number;
  importancePct: number;
}

export interface PredictionResult extends PredictionOutput4 {
  returnLossDb: number;
  vswr: number;
  inputImpedanceOhm: number;
  beamwidthDeg: number;
  areaMm2: number;
  estimatedCostUsd: number;
  modelUsed: MLModelType;
  provenance: string;
  isDemoEstimate: boolean;
  featureVector21: number[];
  baselineExpectation: {
    gainDbi: number;
    bandwidthMHz: number;
    efficiencyPct: number;
  };
  shapContributions: ShapFeatureContribution[];
  frequencySweep: Array<{
    freqGHz: number;
    s11Db: number;
    gainDbi: number;
    efficiencyPct: number;
  }>;
}

export interface FaultDiagnostic {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'advisory';
  category: 'gain' | 'bandwidth' | 'feed' | 'substrate' | 'resonance' | 'efficiency';
  cause: string;
  recommendation: string;
  parameterDelta: string;
}

export interface FaultAnalysisResponse {
  healthScore: number;
  faults: FaultDiagnostic[];
  originalParams: AntennaDesignParams;
  originalPrediction: PredictionResult;
  correctedParams: AntennaDesignParams;
  correctedPrediction: PredictionResult;
}


export interface ParetoSolution {
  id: string;
  params: AntennaDesignParams;
  prediction: PredictionResult;
  rank: number;
  crowdingDistance: number;
  isRecommendedKnee: boolean;
}

export interface NSGA2Response {
  paretoFront: ParetoSolution[];
  allEvaluatedCount: number;
  recommended: ParetoSolution;
  provenance: string;
}

export type PredictionTargetKey =
  | 'gainDbi'
  | 'bandwidthMHz'
  | 'resonantFreqGHz'
  | 'efficiencyPct';

export interface CrossValidationMetricSummary {
  r2Mean: number;
  r2Std: number;
  maeMean: number;
  maeStd: number;
  rmseMean: number;
  rmseStd: number;
}

export interface CrossValidationModelReport {
  model: MLModelType | 'best_per_output';
  label: string;
  gainDbi: CrossValidationMetricSummary;
  bandwidthMHz: CrossValidationMetricSummary;
  resonantFreqGHz: CrossValidationMetricSummary;
  efficiencyPct: CrossValidationMetricSummary;
}

export interface CrossValidationReport {
  folds: number;
  totalSamples: number;
  datasetRanges: {
    gainDbi: [number, number];
    bandwidthMHz: [number, number];
    resonantFreqGHz: [number, number];
    efficiencyPct: [number, number];
  };
  provenance: string;
  bandwidthValidated: boolean;
  bandwidthValidationNote: string;
  bestPredictorPerOutput: Record<
    PredictionTargetKey,
    {
      model: MLModelType;
      label: string;
      r2Mean: number;
      r2Std: number;
      maeMean: number;
      maeStd: number;
      rmseMean: number;
      rmseStd: number;
      unit: string;
      validated: boolean;
    }
  >;
  models: CrossValidationModelReport[];
}

export interface ModelValidationMetric {
  model: MLModelType;
  label: string;
  gainR2: number;
  gainMae: number;
  gainRmse: number;
  bandwidthR2: number;
  bandwidthMae: number;
  bandwidthRmse: number;
  freqR2: number;
  freqMae: number;
  freqRmse: number;
  efficiencyR2: number;
  efficiencyMae: number;
  efficiencyRmse: number;
  trainingSamples: number;
  testSamples: number;
}

export interface HistoryRecord {
  id: string;
  timestamp: string;
  type: 'prediction' | 'nsga2_optimization' | 'fault_fix' | 'assistant' | 'evaluation';
  designName: string;
  params: AntennaDesignParams;
  prediction: PredictionResult;
  notes?: string;
}

export interface AssistantResponse {
  reply: string;
  extractedSpecs: {
    operatingFreqGHz?: number;
    targetGainDbi?: number;
    targetBandwidthMHz?: number;
    topology: AntennaTopology;
    compact: boolean;
    bandLabel: string;
  };
  missingParameters: string[];
  recommendedImprovements: string[];
  generatedParams: AntennaDesignParams;
  prediction: PredictionResult;
  targetNotMet?: boolean;
  targetStatusMessage?: string;
}

export interface SurrogateStatusResponse {
  mode: 'trained_joblib' | 'demo_fallback';
  connected: boolean;
  bridgeUrl: string | null;
  modelFileFound: boolean;
  predictPyFound: boolean;
  schemaFileFound: boolean;
  pythonBinary: string | null;
  missingFiles: string[];
  missingPackages: string[];
  modelPath: string | null;
  predictorClass: string | null;
  lastError: string | null;
  checkedAt: string;
}

export interface TargetOptimizationResponse {
  optimizedParams: AntennaDesignParams;
  prediction: PredictionResult;
  originalPrediction: PredictionResult;
  targetGainDbi: number;
  targetMet: boolean;
  upgradedTopology: boolean;
  evaluatedCount: number;
  summaryMessage: string;
}
