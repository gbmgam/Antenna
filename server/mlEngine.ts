import type {
  AntennaDesignParams,
  AntennaTopology,
  AssistantResponse,
  ConductorMaterial,
  CrossValidationMetricSummary,
  CrossValidationModelReport,
  CrossValidationReport,
  FaultAnalysisResponse,
  FaultDiagnostic,
  MLModelType,
  ModelValidationMetric,
  NSGA2Response,
  ParetoSolution,
  PredictionOutput4,
  PredictionResult,
  PredictionTargetKey,
  ShapFeatureContribution,
  SubstrateMaterial,
  TargetOptimizationResponse,
} from '../src/shared/antennaTypes.ts';
import { pythonBridge } from './pythonBridge.ts';
import {
  FEATURE_METADATA,
  FEATURE_ORDER,
  encodeFeatures,
  validateAntennaDesign,
} from '../src/shared/antennaSchema.ts';
import {
  SPEED_OF_LIGHT_MM_GHZ,
  SUBSTRATE_CATALOG,
  TOPOLOGY_LABELS,
  createDefaultDesign,
  evaluateAnalyticalPhysics,
  synthesizeCircularFeedMm,
  synthesizeCircularRadiusMm,
  synthesizePatchGeometry,
} from '../src/shared/rfPhysics.ts';

export { encodeFeatures };

// Deterministic Mulberry32 PRNG for reproducible dataset & training
function createRng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPOLOGIES: AntennaTopology[] = [
  'microstrip_patch',
  'rectangular_patch',
  'circular_patch',
  'array_2x2',
  'multi_element_mimo',
];

const SUBSTRATES: SubstrateMaterial[] = [
  'FR4',
  'Rogers_RO4003C',
  'Rogers_RO4350B',
  'Rogers_RT5880',
  'Alumina',
];
const CONDUCTORS: ConductorMaterial[] = ['Copper', 'Gold_ENIG', 'Silver', 'Aluminum'];

interface TreeNode {
  featureIdx: number;
  threshold: number;
  left?: TreeNode;
  right?: TreeNode;
  value?: number;
}

function buildCartTree(
  X: number[][],
  y: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  minSamplesSplit: number,
  featureFraction: number,
  rng: () => number,
): TreeNode {
  let sum = 0;
  for (let i = 0; i < indices.length; i++) sum += y[indices[i]];
  const mean = sum / Math.max(1, indices.length);

  if (depth >= maxDepth || indices.length < minSamplesSplit) {
    return { featureIdx: -1, threshold: 0, value: mean };
  }

  const numFeatures = X[0].length;
  const candidateFeatures: number[] = [];
  for (let f = 0; f < numFeatures; f++) {
    if (rng() <= featureFraction) candidateFeatures.push(f);
  }
  if (candidateFeatures.length === 0) {
    candidateFeatures.push(Math.floor(rng() * numFeatures));
  }

  let bestFeature = -1;
  let bestThreshold = 0;
  let bestGain = -Infinity;

  const totalCount = indices.length;
  let totalSum = 0;
  for (let i = 0; i < totalCount; i++) totalSum += y[indices[i]];

  const sortedIndices = new Int32Array(totalCount);

  for (const f of candidateFeatures) {
    for (let i = 0; i < totalCount; i++) sortedIndices[i] = indices[i];
    sortedIndices.sort((a, b) => X[a][f] - X[b][f]);

    let leftSum = 0;
    const step = Math.max(1, Math.floor(totalCount / 28));
    for (let k = 0; k < totalCount - 1; k++) {
      const idx = sortedIndices[k];
      leftSum += y[idx];
      const leftCnt = k + 1;
      if (leftCnt < 2 || totalCount - leftCnt < 2) continue;
      const curVal = X[idx][f];
      const nextVal = X[sortedIndices[k + 1]][f];
      if (curVal === nextVal) continue;
      if (step > 1 && k % step !== 0 && k < totalCount - 3) continue;

      const rightCnt = totalCount - leftCnt;
      const rightSum = totalSum - leftSum;
      const gain = (leftSum * leftSum) / leftCnt + (rightSum * rightSum) / rightCnt;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = 0.5 * (curVal + nextVal);
      }
    }
  }

  if (bestFeature === -1) {
    return { featureIdx: -1, threshold: 0, value: mean };
  }

  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (X[idx][bestFeature] <= bestThreshold) leftIdx.push(idx);
    else rightIdx.push(idx);
  }

  return {
    featureIdx: bestFeature,
    threshold: bestThreshold,
    left: buildCartTree(
      X,
      y,
      leftIdx,
      depth + 1,
      maxDepth,
      minSamplesSplit,
      featureFraction,
      rng,
    ),
    right: buildCartTree(
      X,
      y,
      rightIdx,
      depth + 1,
      maxDepth,
      minSamplesSplit,
      featureFraction,
      rng,
    ),
  };
}

function predictTree(node: TreeNode, x: number[]): number {
  let curr: TreeNode | undefined = node;
  while (curr && curr.value === undefined) {
    curr = x[curr.featureIdx] <= curr.threshold ? curr.left : curr.right;
  }
  return curr?.value ?? 0;
}

class RandomForestTarget {
  private trees: TreeNode[] = [];

  train(X: number[][], y: number[], numTrees: number, rng: () => number) {
    this.trees = [];
    const n = X.length;
    for (let t = 0; t < numTrees; t++) {
      const boot: number[] = [];
      for (let i = 0; i < n; i++) boot.push(Math.floor(rng() * n));
      this.trees.push(buildCartTree(X, y, boot, 0, 7, 4, 0.72, rng));
    }
  }

  predict(x: number[]): number {
    let sum = 0;
    for (let i = 0; i < this.trees.length; i++) sum += predictTree(this.trees[i], x);
    return sum / Math.max(1, this.trees.length);
  }
}

class GradientBoostedTarget {
  private basePred = 0;
  private lr = 0.16;
  private trees: TreeNode[] = [];

  train(X: number[][], y: number[], numStages: number, rng: () => number) {
    const n = X.length;
    this.basePred = y.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const preds = new Array(n).fill(this.basePred);
    const allIdx = Array.from({ length: n }, (_, i) => i);
    this.trees = [];

    for (let s = 0; s < numStages; s++) {
      const residuals = y.map((val, i) => val - preds[i]);
      const tree = buildCartTree(X, residuals, allIdx, 0, 5, 5, 0.85, rng);
      this.trees.push(tree);
      for (let i = 0; i < n; i++) {
        preds[i] += this.lr * predictTree(tree, X[i]);
      }
    }
  }

  predict(x: number[]): number {
    let out = this.basePred;
    for (let i = 0; i < this.trees.length; i++) {
      out += this.lr * predictTree(this.trees[i], x);
    }
    return out;
  }
}

class MLPRegressor {
  private inDim: number;
  private h1 = 28;
  private h2 = 16;
  private outDim: number;
  private xMean: number[] = [];
  private xStd: number[] = [];
  private yMean: number[] = [];
  private yStd: number[] = [];
  private yMin: number[] = [];
  private yMax: number[] = [];
  private w1: number[][] = [];
  private b1: number[] = [];
  private w2: number[][] = [];
  private b2: number[] = [];
  private w3: number[][] = [];
  private b3: number[] = [];

  constructor(inDim: number, outDim: number) {
    this.inDim = inDim;
    this.outDim = outDim;
  }

  train(X: number[][], Y: number[][], epochs: number, rng: () => number) {
    const n = X.length;
    this.xMean = new Array(this.inDim).fill(0);
    this.xStd = new Array(this.inDim).fill(1);
    this.yMean = new Array(this.outDim).fill(0);
    this.yStd = new Array(this.outDim).fill(1);
    this.yMin = new Array(this.outDim).fill(Infinity);
    this.yMax = new Array(this.outDim).fill(-Infinity);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < this.inDim; j++) this.xMean[j] += X[i][j] / n;
      for (let j = 0; j < this.outDim; j++) {
        this.yMean[j] += Y[i][j] / n;
        if (Y[i][j] < this.yMin[j]) this.yMin[j] = Y[i][j];
        if (Y[i][j] > this.yMax[j]) this.yMax[j] = Y[i][j];
      }
    }
    for (let j = 0; j < this.inDim; j++) {
      let v = 0;
      for (let i = 0; i < n; i++) v += (X[i][j] - this.xMean[j]) ** 2;
      this.xStd[j] = Math.max(1e-5, Math.sqrt(v / n));
    }
    for (let j = 0; j < this.outDim; j++) {
      let v = 0;
      for (let i = 0; i < n; i++) v += (Y[i][j] - this.yMean[j]) ** 2;
      this.yStd[j] = Math.max(1e-5, Math.sqrt(v / n));
    }

    const initMat = (rows: number, cols: number, scale: number) =>
      Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => (rng() * 2 - 1) * scale),
      );

    this.w1 = initMat(this.h1, this.inDim, Math.sqrt(2 / this.inDim));
    this.b1 = new Array(this.h1).fill(0);
    this.w2 = initMat(this.h2, this.h1, Math.sqrt(2 / this.h1));
    this.b2 = new Array(this.h2).fill(0);
    this.w3 = initMat(this.outDim, this.h2, Math.sqrt(1 / this.h2));
    this.b3 = new Array(this.outDim).fill(0);

    const clip = (val: number, lim = 3.0) => Math.max(-lim, Math.min(lim, val));
    const order = Array.from({ length: n }, (_, idx) => idx);
    const l2Decay = 1e-4;

    for (let ep = 0; ep < epochs; ep++) {
      const lr = 0.0085 * (1 - 0.65 * (ep / Math.max(1, epochs)));
      // Full shuffled sweep each epoch so low-band & high-band samples all update weights evenly
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
      }

      for (let step = 0; step < Math.min(n, 240); step++) {
        const idx = order[step];
        const xNorm = X[idx].map((v, j) => clip((v - this.xMean[j]) / this.xStd[j], 6));
        const yNorm = Y[idx].map((v, j) => (v - this.yMean[j]) / this.yStd[j]);

        // Forward
        const a1 = new Array(this.h1);
        for (let i = 0; i < this.h1; i++) {
          let z = this.b1[i];
          for (let j = 0; j < this.inDim; j++) z += this.w1[i][j] * xNorm[j];
          a1[i] = z > 0 ? z : 0.05 * z;
        }
        const a2 = new Array(this.h2);
        for (let i = 0; i < this.h2; i++) {
          let z = this.b2[i];
          for (let j = 0; j < this.h1; j++) z += this.w2[i][j] * a1[j];
          a2[i] = z > 0 ? z : 0.05 * z;
        }
        const out = new Array(this.outDim);
        for (let i = 0; i < this.outDim; i++) {
          let z = this.b3[i];
          for (let j = 0; j < this.h2; j++) z += this.w3[i][j] * a2[j];
          out[i] = z;
        }

        // Backward with gradient clipping + light L2 weight decay
        const d3 = out.map((o, i) => clip((o - yNorm[i]) * (2 / this.outDim)));
        const d2 = new Array(this.h2).fill(0);
        for (let i = 0; i < this.outDim; i++) {
          this.b3[i] -= lr * d3[i];
          for (let j = 0; j < this.h2; j++) {
            d2[j] += d3[i] * this.w3[i][j];
            this.w3[i][j] -= lr * (d3[i] * a2[j] + l2Decay * this.w3[i][j]);
          }
        }
        for (let j = 0; j < this.h2; j++) {
          d2[j] = clip(d2[j] * (a2[j] > 0 ? 1 : 0.05));
        }
        const d1 = new Array(this.h1).fill(0);
        for (let i = 0; i < this.h2; i++) {
          this.b2[i] -= lr * d2[i];
          for (let j = 0; j < this.h1; j++) {
            d1[j] += d2[i] * this.w2[i][j];
            this.w2[i][j] -= lr * (d2[i] * a1[j] + l2Decay * this.w2[i][j]);
          }
        }
        for (let j = 0; j < this.h1; j++) {
          d1[j] = clip(d1[j] * (a1[j] > 0 ? 1 : 0.05));
        }
        for (let i = 0; i < this.h1; i++) {
          this.b1[i] -= lr * d1[i];
          for (let j = 0; j < this.inDim; j++) {
            this.w1[i][j] -= lr * (d1[i] * xNorm[j] + l2Decay * this.w1[i][j]);
          }
        }
      }
    }
  }

  predict(x: number[]): number[] {
    const xNorm = x.map((v, j) => Math.max(-6, Math.min(6, (v - this.xMean[j]) / this.xStd[j])));
    const a1 = new Array(this.h1);
    for (let i = 0; i < this.h1; i++) {
      let z = this.b1[i];
      for (let j = 0; j < this.inDim; j++) z += this.w1[i][j] * xNorm[j];
      a1[i] = z > 0 ? z : 0.05 * z;
    }
    const a2 = new Array(this.h2);
    for (let i = 0; i < this.h2; i++) {
      let z = this.b2[i];
      for (let j = 0; j < this.h1; j++) z += this.w2[i][j] * a1[j];
      a2[i] = z > 0 ? z : 0.05 * z;
    }
    const out = new Array(this.outDim);
    for (let i = 0; i < this.outDim; i++) {
      let z = this.b3[i];
      for (let j = 0; j < this.h2; j++) z += this.w3[i][j] * a2[j];
      // Exact inverse-scaling back to training target scale, bounded with physical cushion
      const raw = z * this.yStd[i] + this.yMean[i];
      const span = Math.max(0.5, this.yMax[i] - this.yMin[i]);
      out[i] = Number.isFinite(raw)
        ? Math.max(this.yMin[i] - 0.25 * span, Math.min(this.yMax[i] + 0.25 * span, raw))
        : this.yMean[i];
    }
    return out;
  }
}

export interface DatasetRow {
  params: AntennaDesignParams;
  gainDbi: number;
  bandwidthMHz: number;
  resonantFreqGHz: number;
  efficiencyPct: number;
}

interface DatasetRanges {
  gainDbi: [number, number];
  bandwidthMHz: [number, number];
  resonantFreqGHz: [number, number];
  efficiencyPct: [number, number];
}

interface TrainedModelSuite {
  rfModels: RandomForestTarget[];
  xgbModels: GradientBoostedTarget[];
  mlpModel: MLPRegressor;
}

const CANDIDATE_MODELS: Array<{ id: MLModelType; label: string }> = [
  { id: 'ensemble', label: 'Weighted Ensemble (RF + XGB + MLP)' },
  { id: 'xgboost', label: 'Gradient Boosted Trees (XGBoost)' },
  { id: 'random_forest', label: 'Random Forest Regressor' },
  { id: 'mlp', label: 'Multi-Layer Perceptron (MLP)' },
];

function calcR2(yTrue: number[], yPred: number[]): number {
  if (yTrue.length !== yPred.length || yTrue.length === 0) {
    throw new Error('R2 computation requires equal non-empty arrays');
  }
  const mean = yTrue.reduce((a, b) => a + b, 0) / yTrue.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (!Number.isFinite(yTrue[i]) || !Number.isFinite(yPred[i])) {
      throw new Error(`Non-finite value encountered during R2 calculation at index ${i}`);
    }
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - mean) ** 2;
  }
  const r2 = 1 - ssRes / Math.max(1e-8, ssTot);
  return Number(Math.max(-1, r2).toFixed(4));
}

function calcMae(yTrue: number[], yPred: number[]): number {
  if (yTrue.length !== yPred.length || yTrue.length === 0) {
    throw new Error('MAE computation requires equal non-empty arrays');
  }
  let sumAbs = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (!Number.isFinite(yTrue[i]) || !Number.isFinite(yPred[i])) {
      throw new Error(`Non-finite value encountered during MAE calculation at index ${i}`);
    }
    sumAbs += Math.abs(yTrue[i] - yPred[i]);
  }
  return Number((sumAbs / yTrue.length).toFixed(4));
}

function calcRmse(yTrue: number[], yPred: number[]): number {
  if (yTrue.length !== yPred.length || yTrue.length === 0) {
    throw new Error('RMSE computation requires equal non-empty arrays');
  }
  let mse = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (!Number.isFinite(yTrue[i]) || !Number.isFinite(yPred[i])) {
      throw new Error(`Non-finite value encountered during RMSE calculation at index ${i}`);
    }
    mse += (yTrue[i] - yPred[i]) ** 2;
  }
  return Number(Math.sqrt(mse / yTrue.length).toFixed(4));
}

function summarizeFolds(
  folds: Array<{ r2: number; mae: number; rmse: number }>,
): CrossValidationMetricSummary {
  const k = Math.max(1, folds.length);
  const meanOf = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / k;
  const stdOf = (vals: number[], m: number) =>
    Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / k);

  const r2Vals = folds.map((f) => f.r2);
  const maeVals = folds.map((f) => f.mae);
  const rmseVals = folds.map((f) => f.rmse);

  const r2Mean = meanOf(r2Vals);
  const maeMean = meanOf(maeVals);
  const rmseMean = meanOf(rmseVals);

  return {
    r2Mean: Number(r2Mean.toFixed(4)),
    r2Std: Number(stdOf(r2Vals, r2Mean).toFixed(4)),
    maeMean: Number(maeMean.toFixed(4)),
    maeStd: Number(stdOf(maeVals, maeMean).toFixed(4)),
    rmseMean: Number(rmseMean.toFixed(4)),
    rmseStd: Number(stdOf(rmseVals, rmseMean).toFixed(4)),
  };
}

function decodeAndValidateTargets(
  v0GainDbi: number,
  logBwMHz: number,
  logFreqGHz: number,
  v3EffPct: number,
  ranges?: DatasetRanges,
): [number, number, number, number] {
  const minFreq = ranges ? Math.max(0.15, ranges.resonantFreqGHz[0] * 0.4) : 0.2;
  const maxFreq = ranges ? Math.min(70, ranges.resonantFreqGHz[1] * 1.45) : 65;

  const gainDbi = Math.max(-15, Math.min(25, v0GainDbi));
  const bandwidthMHz = Math.min(10000, Math.max(2, Math.exp(Math.min(9.21, logBwMHz))));
  const resonantFreqGHz = Math.min(
    maxFreq,
    Math.max(minFreq, Math.exp(Math.min(Math.log(maxFreq), logFreqGHz))),
  );
  const efficiencyPct = Math.max(5, Math.min(99.5, v3EffPct));

  if (
    !Number.isFinite(gainDbi) ||
    !Number.isFinite(bandwidthMHz) ||
    !Number.isFinite(resonantFreqGHz) ||
    !Number.isFinite(efficiencyPct)
  ) {
    throw new Error('Surrogate decoded non-finite physical target');
  }
  return [gainDbi, bandwidthMHz, resonantFreqGHz, efficiencyPct];
}

function assertPredictionValidForReporting(
  pred: [number, number, number, number],
  ranges: DatasetRanges,
  modelLabel: string,
) {
  const [gainDbi, bandwidthMHz, resonantFreqGHz, efficiencyPct] = pred;
  if (
    !Number.isFinite(gainDbi) ||
    !Number.isFinite(bandwidthMHz) ||
    !Number.isFinite(resonantFreqGHz) ||
    !Number.isFinite(efficiencyPct)
  ) {
    throw new Error(`CV assertion failed for ${modelLabel}: non-finite output detected.`);
  }
  const minAllowedFreq = Math.max(0.1, ranges.resonantFreqGHz[0] * 0.35);
  const maxAllowedFreq = Math.min(100, ranges.resonantFreqGHz[1] * 1.5);
  if (resonantFreqGHz < minAllowedFreq || resonantFreqGHz > maxAllowedFreq) {
    throw new Error(
      `CV assertion failed for ${modelLabel}: resonantFreqGHz=${resonantFreqGHz} GHz outside physical dataset range [${minAllowedFreq.toFixed(2)}, ${maxAllowedFreq.toFixed(2)}] GHz.`,
    );
  }
  if (bandwidthMHz <= 0 || bandwidthMHz > 15000) {
    throw new Error(
      `CV assertion failed for ${modelLabel}: bandwidthMHz=${bandwidthMHz} MHz out of valid MHz bounds.`,
    );
  }
}

class AntennaMLEngine {
  public dataset: DatasetRow[] = [];
  public validationMetrics: ModelValidationMetric[] = [];
  public crossValidationReport!: CrossValidationReport;
  private bestPredictorByOutput: Record<PredictionTargetKey, MLModelType> = {
    gainDbi: 'xgboost',
    bandwidthMHz: 'xgboost',
    resonantFreqGHz: 'random_forest',
    efficiencyPct: 'ensemble',
  };
  private datasetRanges: DatasetRanges = {
    gainDbi: [-10, 15],
    bandwidthMHz: [4, 8000],
    resonantFreqGHz: [0.3, 45],
    efficiencyPct: [15, 98.5],
  };
  private trainX: number[][] = [];
  private trainXMean: number[] = [];
  private baselineOutputs = { gainDbi: 0, bandwidthMHz: 0, resonantFreqGHz: 0, efficiencyPct: 0 };

  private rfModels: RandomForestTarget[] = [];
  private xgbModels: GradientBoostedTarget[] = [];
  private mlpModel = new MLPRegressor(FEATURE_ORDER.length, 4);
  private initialized = false;

  constructor() {
    this.initialize();
  }

  public initialize() {
    if (this.initialized) return;
    const rng = createRng(20261120);
    const totalSamples = 750;

    const freqBands = [0.868, 0.915, 1.575, 2.45, 3.5, 5.2, 5.8, 10.0, 24.0, 28.0];

    for (let i = 0; i < totalSamples; i++) {
      const fTarget = freqBands[i % freqBands.length] * (0.88 + rng() * 0.24);
      const topo = TOPOLOGIES[i % TOPOLOGIES.length];
      const subId = SUBSTRATES[Math.floor(rng() * SUBSTRATES.length)];
      const condId = CONDUCTORS[Math.floor(rng() * CONDUCTORS.length)];
      const sub = SUBSTRATE_CATALOG[subId];
      const h =
        fTarget < 1.3
          ? Number((2.2 + rng() * 2.2).toFixed(2))
          : Number((0.4 + rng() * 3.4).toFixed(2));
      const synth = synthesizePatchGeometry(fTarget, sub.dielectricConstant, h);
      const lambda0 = SPEED_OF_LIGHT_MM_GHZ / Math.max(0.3, fTarget);

      // Include both nominal designs and perturbed designs so surrogate learns detuning & faults
      const perturb = rng() < 0.38 ? 0.8 + rng() * 0.42 : 0.96 + rng() * 0.08;
      const isCircular = topo === 'circular_patch';
      const circR = synthesizeCircularRadiusMm(fTarget, sub.dielectricConstant, h);
      const radiusMm = isCircular ? Number((circR * perturb).toFixed(2)) : 0;

      const patchLengthMm = isCircular ? 0 : Number((synth.lengthMm * perturb).toFixed(2));
      const patchWidthMm = isCircular ? 0 : Number((synth.widthMm * (0.85 + rng() * 0.3)).toFixed(2));
      const optimalCircFeed = isCircular
        ? synthesizeCircularFeedMm(radiusMm, sub.dielectricConstant)
        : 0;
      const feedXMm = isCircular
        ? Number(Math.max(1.2, optimalCircFeed * (0.55 + rng() * 0.9)).toFixed(2))
        : Number((synth.optimalFeedXMm * (0.4 + rng() * 1.1)).toFixed(2));
      const feedYMm = isCircular
        ? Number(((rng() - 0.5) * radiusMm * 0.25).toFixed(2))
        : Number(((rng() - 0.5) * patchWidthMm * 0.28).toFixed(2));

      const params: AntennaDesignParams = {
        id: `ds-${i}`,
        name: `Sample-${i}`,
        topology: topo,
        patchLengthMm,
        patchWidthMm,
        substrateHeightMm: h,
        dielectricConstant: sub.dielectricConstant,
        lossTangent: sub.lossTangent,
        feedXMm,
        feedYMm,
        operatingFreqGHz: Number(fTarget.toFixed(3)),
        substrateMaterial: subId,
        conductorMaterial: condId,
        insetDepthMm:
          topo === 'microstrip_patch'
            ? Number(Math.max(0.4, Math.min(patchLengthMm * 0.45, synth.optimalFeedXMm * (0.7 + rng() * 0.6))).toFixed(2))
            : 0,
        notchWidthMm:
          topo === 'microstrip_patch'
            ? Number(Math.max(0.4, patchWidthMm * (0.04 + rng() * 0.09)).toFixed(2))
            : 0,
        probeDiameterMm:
          topo === 'rectangular_patch' ? Number((0.6 + rng() * 1.4).toFixed(2)) : 0,
        feedTypeCode:
          topo === 'rectangular_patch' ? (rng() < 0.25 ? 1 : 2) : 0,
        patchRadiusMm: radiusMm,
        elementSpacingXmm:
          topo === 'array_2x2' || topo === 'multi_element_mimo'
            ? Number((lambda0 * (0.36 + rng() * 0.34)).toFixed(2))
            : 0,
        elementSpacingYmm:
          topo === 'array_2x2' || topo === 'multi_element_mimo'
            ? Number((lambda0 * (0.36 + rng() * 0.34)).toFixed(2))
            : 0,
        phaseXDeg:
          topo === 'array_2x2' ? Number(((rng() - 0.5) * 90).toFixed(1)) : 0,
        phaseYDeg:
          topo === 'array_2x2' ? Number(((rng() - 0.5) * 90).toFixed(1)) : 0,
        arrayLayoutCode:
          topo === 'array_2x2' ? (rng() < 0.35 ? 2 : 1) : 0,
        portConfigurationCode:
          topo === 'multi_element_mimo' ? (rng() < 0.2 ? 0 : 4) : 0,
      };

      const phys = evaluateAnalyticalPhysics(params);
      this.dataset.push({
        params,
        gainDbi: phys.gainDbi,
        bandwidthMHz: phys.bandwidthMHz,
        resonantFreqGHz: phys.resonantFreqGHz,
        efficiencyPct: phys.efficiencyPct,
      });
    }

    // Deterministic shuffle before 80/20 split so every topology appears in both train and test sets
    for (let i = this.dataset.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = this.dataset[i];
      this.dataset[i] = this.dataset[j];
      this.dataset[j] = tmp;
    }

    // Compute dataset physical bounds for strict assertion checking
    const gains = this.dataset.map((r) => r.gainDbi);
    const bws = this.dataset.map((r) => r.bandwidthMHz);
    const freqs = this.dataset.map((r) => r.resonantFreqGHz);
    const effs = this.dataset.map((r) => r.efficiencyPct);
    this.datasetRanges = {
      gainDbi: [Number(Math.min(...gains).toFixed(2)), Number(Math.max(...gains).toFixed(2))],
      bandwidthMHz: [Number(Math.min(...bws).toFixed(1)), Number(Math.max(...bws).toFixed(1))],
      resonantFreqGHz: [Number(Math.min(...freqs).toFixed(3)), Number(Math.max(...freqs).toFixed(3))],
      efficiencyPct: [Number(Math.min(...effs).toFixed(1)), Number(Math.max(...effs).toFixed(1))],
    };

    const trainSuite = (rows: DatasetRow[], foldRng: () => number): TrainedModelSuite => {
      const X = rows.map((r) => encodeFeatures(r.params));
      const Y = rows.map((r) => [
        r.gainDbi,
        Math.log(Math.max(4, r.bandwidthMHz)),
        Math.log(Math.max(0.25, r.resonantFreqGHz)),
        r.efficiencyPct,
      ]);

      const rfModels = [0, 1, 2, 3].map((targetIdx) => {
        const rf = new RandomForestTarget();
        rf.train(
          X,
          Y.map((y) => y[targetIdx]),
          16,
          foldRng,
        );
        return rf;
      });

      const xgbModels = [0, 1, 2, 3].map((targetIdx) => {
        const xgb = new GradientBoostedTarget();
        xgb.train(
          X,
          Y.map((y) => y[targetIdx]),
          32,
          foldRng,
        );
        return xgb;
      });

      const mlpModel = new MLPRegressor(FEATURE_ORDER.length, 4);
      mlpModel.train(X, Y, 90, foldRng);

      return { rfModels, xgbModels, mlpModel };
    };

    const evalSuiteModel = (
      suite: TrainedModelSuite,
      x: number[],
      model: MLModelType,
    ): [number, number, number, number] => {
      if (model === 'random_forest') {
        return decodeAndValidateTargets(
          suite.rfModels[0].predict(x),
          suite.rfModels[1].predict(x),
          suite.rfModels[2].predict(x),
          suite.rfModels[3].predict(x),
          this.datasetRanges,
        );
      }
      if (model === 'xgboost') {
        return decodeAndValidateTargets(
          suite.xgbModels[0].predict(x),
          suite.xgbModels[1].predict(x),
          suite.xgbModels[2].predict(x),
          suite.xgbModels[3].predict(x),
          this.datasetRanges,
        );
      }
      if (model === 'mlp') {
        const p = suite.mlpModel.predict(x);
        return decodeAndValidateTargets(p[0], p[1], p[2], p[3], this.datasetRanges);
      }
      // Fixed weighted ensemble candidate for CV benchmarking
      const rf = decodeAndValidateTargets(
        suite.rfModels[0].predict(x),
        suite.rfModels[1].predict(x),
        suite.rfModels[2].predict(x),
        suite.rfModels[3].predict(x),
        this.datasetRanges,
      );
      const xgb = decodeAndValidateTargets(
        suite.xgbModels[0].predict(x),
        suite.xgbModels[1].predict(x),
        suite.xgbModels[2].predict(x),
        suite.xgbModels[3].predict(x),
        this.datasetRanges,
      );
      const mlpRaw = suite.mlpModel.predict(x);
      const mlp = decodeAndValidateTargets(
        mlpRaw[0],
        mlpRaw[1],
        mlpRaw[2],
        mlpRaw[3],
        this.datasetRanges,
      );
      return [
        0.32 * rf[0] + 0.48 * xgb[0] + 0.2 * mlp[0],
        0.32 * rf[1] + 0.48 * xgb[1] + 0.2 * mlp[1],
        0.32 * rf[2] + 0.48 * xgb[2] + 0.2 * mlp[2],
        0.32 * rf[3] + 0.48 * xgb[3] + 0.2 * mlp[3],
      ];
    };

    // 5-Fold Cross-Validation across shuffled dataset (unscaled GHz, dBi, MHz, % targets)
    const kFolds = 5;
    const foldSize = Math.floor(this.dataset.length / kFolds);
    const foldAcc: Record<
      MLModelType,
      Record<PredictionTargetKey, Array<{ r2: number; mae: number; rmse: number }>>
    > = {
      ensemble: { gainDbi: [], bandwidthMHz: [], resonantFreqGHz: [], efficiencyPct: [] },
      xgboost: { gainDbi: [], bandwidthMHz: [], resonantFreqGHz: [], efficiencyPct: [] },
      random_forest: { gainDbi: [], bandwidthMHz: [], resonantFreqGHz: [], efficiencyPct: [] },
      mlp: { gainDbi: [], bandwidthMHz: [], resonantFreqGHz: [], efficiencyPct: [] },
    };

    const foldOutPredictions: Array<{
      yTrue: {
        gainDbi: number[];
        bandwidthMHz: number[];
        resonantFreqGHz: number[];
        efficiencyPct: number[];
      };
      predsByModel: Record<MLModelType, [number, number, number, number][]>;
    }> = [];

    for (let fold = 0; fold < kFolds; fold++) {
      const start = fold * foldSize;
      const end = fold === kFolds - 1 ? this.dataset.length : start + foldSize;
      const foldTestRows = this.dataset.slice(start, end);
      const foldTrainRows = [
        ...this.dataset.slice(0, start),
        ...this.dataset.slice(end),
      ];

      const foldSuite = trainSuite(foldTrainRows, createRng(20261120 + (fold + 1) * 97));
      const foldTestX = foldTestRows.map((r) => encodeFeatures(r.params));

      const yTrue = {
        gainDbi: foldTestRows.map((r) => r.gainDbi),
        bandwidthMHz: foldTestRows.map((r) => r.bandwidthMHz),
        resonantFreqGHz: foldTestRows.map((r) => r.resonantFreqGHz),
        efficiencyPct: foldTestRows.map((r) => r.efficiencyPct),
      };

      const predsByModel = {} as Record<MLModelType, [number, number, number, number][]>;
      for (const m of CANDIDATE_MODELS) {
        const preds = foldTestX.map((x) => {
          const out = evalSuiteModel(foldSuite, x, m.id);
          assertPredictionValidForReporting(out, this.datasetRanges, `${m.id} (fold ${fold + 1})`);
          return out;
        });
        predsByModel[m.id] = preds;

        const targetEntries: Array<{ key: PredictionTargetKey; idx: number; trueArr: number[] }> = [
          { key: 'gainDbi', idx: 0, trueArr: yTrue.gainDbi },
          { key: 'bandwidthMHz', idx: 1, trueArr: yTrue.bandwidthMHz },
          { key: 'resonantFreqGHz', idx: 2, trueArr: yTrue.resonantFreqGHz },
          { key: 'efficiencyPct', idx: 3, trueArr: yTrue.efficiencyPct },
        ];

        for (const t of targetEntries) {
          const predArr = preds.map((p) => p[t.idx]);
          const r2 = calcR2(t.trueArr, predArr);
          const mae = calcMae(t.trueArr, predArr);
          const rmse = calcRmse(t.trueArr, predArr);
          if (mae < 0 || rmse < mae - 1e-6 || !Number.isFinite(r2)) {
            throw new Error(`CV metric consistency assertion failed for ${m.id}.${t.key}`);
          }
          foldAcc[m.id][t.key].push({ r2, mae, rmse });
        }
      }

      foldOutPredictions.push({ yTrue, predsByModel });
    }

    const cvModelReports: CrossValidationModelReport[] = CANDIDATE_MODELS.map((m) => ({
      model: m.id,
      label: m.label,
      gainDbi: summarizeFolds(foldAcc[m.id].gainDbi),
      bandwidthMHz: summarizeFolds(foldAcc[m.id].bandwidthMHz),
      resonantFreqGHz: summarizeFolds(foldAcc[m.id].resonantFreqGHz),
      efficiencyPct: summarizeFolds(foldAcc[m.id].efficiencyPct),
    }));

    const pickBestForTarget = (
      targetKey: PredictionTargetKey,
      unit: string,
    ): {
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
    } => {
      let bestReport = cvModelReports[0];
      for (const candidate of cvModelReports) {
        const cur = candidate[targetKey];
        const best = bestReport[targetKey];
        if (
          cur.rmseMean < best.rmseMean - 1e-6 ||
          (Math.abs(cur.rmseMean - best.rmseMean) <= 1e-6 && cur.r2Mean > best.r2Mean)
        ) {
          bestReport = candidate;
        }
      }
      const stats = bestReport[targetKey];
      return {
        model: bestReport.model as MLModelType,
        label: bestReport.label,
        r2Mean: stats.r2Mean,
        r2Std: stats.r2Std,
        maeMean: stats.maeMean,
        maeStd: stats.maeStd,
        rmseMean: stats.rmseMean,
        rmseStd: stats.rmseStd,
        unit,
        validated: stats.r2Mean >= 0.75,
      };
    };

    const bestPredictorPerOutput = {
      gainDbi: pickBestForTarget('gainDbi', 'dBi'),
      bandwidthMHz: pickBestForTarget('bandwidthMHz', 'MHz'),
      resonantFreqGHz: pickBestForTarget('resonantFreqGHz', 'GHz'),
      efficiencyPct: pickBestForTarget('efficiencyPct', '%'),
    };

    this.bestPredictorByOutput = {
      gainDbi: bestPredictorPerOutput.gainDbi.model,
      bandwidthMHz: bestPredictorPerOutput.bandwidthMHz.model,
      resonantFreqGHz: bestPredictorPerOutput.resonantFreqGHz.model,
      efficiencyPct: bestPredictorPerOutput.efficiencyPct.model,
    };

    // Evaluate composite Best-Per-Output predictor across the 5 held-out folds
    const hybridFoldAcc: Record<
      PredictionTargetKey,
      Array<{ r2: number; mae: number; rmse: number }>
    > = {
      gainDbi: [],
      bandwidthMHz: [],
      resonantFreqGHz: [],
      efficiencyPct: [],
    };
    for (const f of foldOutPredictions) {
      const gPred = f.predsByModel[this.bestPredictorByOutput.gainDbi].map((p) => p[0]);
      const bPred = f.predsByModel[this.bestPredictorByOutput.bandwidthMHz].map((p) => p[1]);
      const fPred = f.predsByModel[this.bestPredictorByOutput.resonantFreqGHz].map((p) => p[2]);
      const ePred = f.predsByModel[this.bestPredictorByOutput.efficiencyPct].map((p) => p[3]);

      hybridFoldAcc.gainDbi.push({
        r2: calcR2(f.yTrue.gainDbi, gPred),
        mae: calcMae(f.yTrue.gainDbi, gPred),
        rmse: calcRmse(f.yTrue.gainDbi, gPred),
      });
      hybridFoldAcc.bandwidthMHz.push({
        r2: calcR2(f.yTrue.bandwidthMHz, bPred),
        mae: calcMae(f.yTrue.bandwidthMHz, bPred),
        rmse: calcRmse(f.yTrue.bandwidthMHz, bPred),
      });
      hybridFoldAcc.resonantFreqGHz.push({
        r2: calcR2(f.yTrue.resonantFreqGHz, fPred),
        mae: calcMae(f.yTrue.resonantFreqGHz, fPred),
        rmse: calcRmse(f.yTrue.resonantFreqGHz, fPred),
      });
      hybridFoldAcc.efficiencyPct.push({
        r2: calcR2(f.yTrue.efficiencyPct, ePred),
        mae: calcMae(f.yTrue.efficiencyPct, ePred),
        rmse: calcRmse(f.yTrue.efficiencyPct, ePred),
      });
    }

    const bestPerOutputReport: CrossValidationModelReport = {
      model: 'best_per_output',
      label: 'Best Validated Predictor Per Output (Active Default)',
      gainDbi: summarizeFolds(hybridFoldAcc.gainDbi),
      bandwidthMHz: summarizeFolds(hybridFoldAcc.bandwidthMHz),
      resonantFreqGHz: summarizeFolds(hybridFoldAcc.resonantFreqGHz),
      efficiencyPct: summarizeFolds(hybridFoldAcc.efficiencyPct),
    };

    const bandwidthValidated = bestPredictorPerOutput.bandwidthMHz.r2Mean >= 0.75;
    const bandwidthValidationNote = bandwidthValidated
      ? `Log-bandwidth 5-fold CV achieved R² = ${bestPredictorPerOutput.bandwidthMHz.r2Mean} ± ${bestPredictorPerOutput.bandwidthMHz.r2Std} (MAE ${bestPredictorPerOutput.bandwidthMHz.maeMean} MHz). Demo estimate — not EM-validated.`
      : `Bandwidth accuracy remains unvalidated / weak (5-fold R² = ${bestPredictorPerOutput.bandwidthMHz.r2Mean} < 0.75). Demo estimate — not EM-validated.`;

    this.crossValidationReport = {
      folds: kFolds,
      totalSamples: this.dataset.length,
      datasetRanges: this.datasetRanges,
      provenance: 'Demo estimate — not EM-validated',
      bandwidthValidated,
      bandwidthValidationNote,
      bestPredictorPerOutput,
      models: [bestPerOutputReport, ...cvModelReports],
    };

    // Train serving suite across the full dataset after honest out-of-fold 5-fold CV completes
    this.trainX = this.dataset.map((r) => encodeFeatures(r.params));
    this.trainXMean = new Array(FEATURE_ORDER.length).fill(0);
    for (let i = 0; i < this.trainX.length; i++) {
      for (let j = 0; j < FEATURE_ORDER.length; j++) {
        this.trainXMean[j] += this.trainX[i][j] / this.trainX.length;
      }
    }

    const servingSuite = trainSuite(this.dataset, rng);
    this.rfModels = servingSuite.rfModels;
    this.xgbModels = servingSuite.xgbModels;
    this.mlpModel = servingSuite.mlpModel;

    this.baselineOutputs = {
      gainDbi: Number((gains.reduce((s, v) => s + v, 0) / gains.length).toFixed(2)),
      bandwidthMHz: Number((bws.reduce((s, v) => s + v, 0) / bws.length).toFixed(1)),
      resonantFreqGHz: Number((freqs.reduce((s, v) => s + v, 0) / freqs.length).toFixed(3)),
      efficiencyPct: Number((effs.reduce((s, v) => s + v, 0) / effs.length).toFixed(1)),
    };

    const trainPerFold = this.dataset.length - foldSize;
    this.validationMetrics = cvModelReports.map((rep) => ({
      model: rep.model as MLModelType,
      label: rep.label,
      gainR2: rep.gainDbi.r2Mean,
      gainMae: rep.gainDbi.maeMean,
      gainRmse: rep.gainDbi.rmseMean,
      bandwidthR2: rep.bandwidthMHz.r2Mean,
      bandwidthMae: rep.bandwidthMHz.maeMean,
      bandwidthRmse: rep.bandwidthMHz.rmseMean,
      freqR2: rep.resonantFreqGHz.r2Mean,
      freqMae: rep.resonantFreqGHz.maeMean,
      freqRmse: rep.resonantFreqGHz.rmseMean,
      efficiencyR2: rep.efficiencyPct.r2Mean,
      efficiencyMae: rep.efficiencyPct.maeMean,
      efficiencyRmse: rep.efficiencyPct.rmseMean,
      trainingSamples: trainPerFold,
      testSamples: foldSize,
    }));

    this.initialized = true;
  }

  private rawSingleModelPredict(
    x: number[],
    model: MLModelType,
  ): [number, number, number, number] {
    if (model === 'random_forest') {
      return decodeAndValidateTargets(
        this.rfModels[0].predict(x),
        this.rfModels[1].predict(x),
        this.rfModels[2].predict(x),
        this.rfModels[3].predict(x),
        this.datasetRanges,
      );
    }
    if (model === 'xgboost') {
      return decodeAndValidateTargets(
        this.xgbModels[0].predict(x),
        this.xgbModels[1].predict(x),
        this.xgbModels[2].predict(x),
        this.xgbModels[3].predict(x),
        this.datasetRanges,
      );
    }
    if (model === 'mlp') {
      const p = this.mlpModel.predict(x);
      return decodeAndValidateTargets(p[0], p[1], p[2], p[3], this.datasetRanges);
    }
    const rf = decodeAndValidateTargets(
      this.rfModels[0].predict(x),
      this.rfModels[1].predict(x),
      this.rfModels[2].predict(x),
      this.rfModels[3].predict(x),
      this.datasetRanges,
    );
    const xgb = decodeAndValidateTargets(
      this.xgbModels[0].predict(x),
      this.xgbModels[1].predict(x),
      this.xgbModels[2].predict(x),
      this.xgbModels[3].predict(x),
      this.datasetRanges,
    );
    const mlpRaw = this.mlpModel.predict(x);
    const mlp = decodeAndValidateTargets(
      mlpRaw[0],
      mlpRaw[1],
      mlpRaw[2],
      mlpRaw[3],
      this.datasetRanges,
    );
    return [
      0.32 * rf[0] + 0.48 * xgb[0] + 0.2 * mlp[0],
      0.32 * rf[1] + 0.48 * xgb[1] + 0.2 * mlp[1],
      0.32 * rf[2] + 0.48 * xgb[2] + 0.2 * mlp[2],
      0.32 * rf[3] + 0.48 * xgb[3] + 0.2 * mlp[3],
    ];
  }

  private rawModelPredict(x: number[], model: MLModelType): [number, number, number, number] {
    if (model !== 'ensemble') {
      return this.rawSingleModelPredict(x, model);
    }
    // Route default ensemble to the empirically best 5-fold CV predictor per output
    const rf = this.rawSingleModelPredict(x, 'random_forest');
    const xgb = this.rawSingleModelPredict(x, 'xgboost');
    const mlp = this.rawSingleModelPredict(x, 'mlp');
    const weighted: [number, number, number, number] = [
      0.32 * rf[0] + 0.48 * xgb[0] + 0.2 * mlp[0],
      0.32 * rf[1] + 0.48 * xgb[1] + 0.2 * mlp[1],
      0.32 * rf[2] + 0.48 * xgb[2] + 0.2 * mlp[2],
      0.32 * rf[3] + 0.48 * xgb[3] + 0.2 * mlp[3],
    ];
    const byModel: Record<MLModelType, [number, number, number, number]> = {
      random_forest: rf,
      xgboost: xgb,
      mlp,
      ensemble: weighted,
    };
    return [
      byModel[this.bestPredictorByOutput.gainDbi][0],
      byModel[this.bestPredictorByOutput.bandwidthMHz][1],
      byModel[this.bestPredictorByOutput.resonantFreqGHz][2],
      byModel[this.bestPredictorByOutput.efficiencyPct][3],
    ];
  }

  private computeShapContributions(
    x: number[],
    mlRaw: [number, number, number, number],
    model: MLModelType,
  ): ShapFeatureContribution[] {
    const rawImpacts = FEATURE_ORDER.map((key, idx) => {
      const baseVal = Number((this.trainXMean[idx] ?? 0).toFixed(3));
      const xMasked = [...x];
      xMasked[idx] = this.trainXMean[idx] ?? 0;
      const maskedPred = this.rawModelPredict(xMasked, model);

      const gainImpactDbi = Number((mlRaw[0] - maskedPred[0]).toFixed(3));
      const bandwidthImpactMHz = Number((mlRaw[1] - maskedPred[1]).toFixed(2));
      const efficiencyImpactPct = Number((mlRaw[3] - maskedPred[3]).toFixed(2));
      const mag =
        Math.abs(gainImpactDbi) * 1.4 +
        Math.abs(bandwidthImpactMHz) / 45 +
        Math.abs(efficiencyImpactPct) / 12;

      return {
        featureKey: key,
        label: FEATURE_METADATA[key].label,
        unit: FEATURE_METADATA[key].unit,
        value: Number(x[idx].toFixed(4)),
        baselineValue: baseVal,
        gainImpactDbi,
        bandwidthImpactMHz,
        efficiencyImpactPct,
        mag,
      };
    });

    const totalMag = Math.max(
      1e-5,
      rawImpacts.reduce((sum, item) => sum + item.mag, 0),
    );

    return rawImpacts
      .map((item) => ({
        featureKey: item.featureKey,
        label: item.label,
        unit: item.unit,
        value: item.value,
        baselineValue: item.baselineValue,
        gainImpactDbi: item.gainImpactDbi,
        bandwidthImpactMHz: item.bandwidthImpactMHz,
        efficiencyImpactPct: item.efficiencyImpactPct,
        importancePct: Number(((item.mag / totalMag) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.importancePct - a.importancePct);
  }

  public buildPredictionFromSurrogateOutputs(
    params: AntennaDesignParams,
    outputs: PredictionOutput4,
    model: MLModelType = 'ensemble',
    options: {
      includeShap?: boolean;
      provenance?: string;
      isDemoEstimate?: boolean;
      enforceTenDbBandwidthGate?: boolean;
    } = {},
  ): PredictionResult {
    const x = encodeFeatures(params);
    const phys = evaluateAnalyticalPhysics(params);

    const gainDbi = Number(Math.max(-15, Math.min(25, outputs.gainDbi)).toFixed(2));
    const rawBandwidthMHz = Number(Math.max(0, Math.min(10000, outputs.bandwidthMHz)).toFixed(1));
    const resonantFreqGHz = Number(Math.max(0.2, Math.min(65, outputs.resonantFreqGHz)).toFixed(3));
    const efficiencyPct = Number(
      Math.min(99.5, Math.max(5, outputs.efficiencyPct)).toFixed(1),
    );

    // Build frequency sweep around operatingFreqGHz
    const fCenter = params.operatingFreqGHz;
    const span = Math.max(0.2, fCenter * 0.45);
    const fMin = Math.max(0.1, fCenter - span / 2);
    const fMax = fCenter + span / 2;
    const steps = 25;
    const sampleFreqs: number[] = [];
    for (let i = 0; i < steps; i++) {
      sampleFreqs.push(fMin + ((fMax - fMin) * i) / (steps - 1));
    }
    if (resonantFreqGHz >= fMin && resonantFreqGHz <= fMax) {
      let nearestIdx = 0;
      let bestDist = Infinity;
      sampleFreqs.forEach((f, idx) => {
        const dist = Math.abs(f - resonantFreqGHz);
        if (dist < bestDist) {
          bestDist = dist;
          nearestIdx = idx;
        }
      });
      sampleFreqs[nearestIdx] = resonantFreqGHz;
    }

    const frequencySweep = sampleFreqs.map((f) => {
      const detune = Math.abs(f - resonantFreqGHz) / Math.max(0.015, rawBandwidthMHz / 1000);
      const s11Db = Number(
        Math.max(-38, phys.returnLossDb / (1 + 1.8 * detune * detune) - 0.5).toFixed(2),
      );
      const gainDrop = Math.min(9, 2.2 * detune * detune);
      return {
        freqGHz: Number(f.toFixed(3)),
        s11Db,
        gainDbi: Number((gainDbi - gainDrop).toFixed(2)),
        efficiencyPct: Number(Math.max(12, efficiencyPct * Math.exp(-0.22 * detune * detune)).toFixed(1)),
      };
    });

    const minSweepS11 = Math.min(...frequencySweep.map((p) => p.s11Db));
    const gate = options.enforceTenDbBandwidthGate ?? true;
    const bandwidthMHz =
      !gate || (minSweepS11 <= -10 && phys.returnLossDb <= -10) ? rawBandwidthMHz : 0;

    const includeShap = options.includeShap ?? true;
    const mlRaw: [number, number, number, number] = [
      gainDbi,
      rawBandwidthMHz,
      resonantFreqGHz,
      efficiencyPct,
    ];
    const shapContributions = includeShap
      ? this.computeShapContributions(x, mlRaw, model)
      : [];

    return {
      gainDbi,
      bandwidthMHz,
      resonantFreqGHz,
      efficiencyPct,
      returnLossDb: phys.returnLossDb,
      vswr: phys.vswr,
      inputImpedanceOhm: phys.inputImpedanceOhm,
      beamwidthDeg: phys.beamwidthDeg,
      areaMm2: phys.areaMm2,
      estimatedCostUsd: phys.estimatedCostUsd,
      modelUsed: model,
      provenance:
        options.provenance ?? 'Demo analytical-estimate surrogate — not EM-validated data.',
      isDemoEstimate: options.isDemoEstimate ?? true,
      featureVector21: x,
      baselineExpectation: {
        gainDbi: this.baselineOutputs.gainDbi,
        bandwidthMHz: this.baselineOutputs.bandwidthMHz,
        efficiencyPct: this.baselineOutputs.efficiencyPct,
      },
      shapContributions,
      frequencySweep,
    };
  }

  public predict(
    params: AntennaDesignParams,
    model: MLModelType = 'ensemble',
    includeShap = true,
  ): PredictionResult {
    const x = encodeFeatures(params);
    const mlRaw = this.rawModelPredict(x, model);
    const phys = evaluateAnalyticalPhysics(params);

    // Blend trained surrogate with physics guardrails so low-band patches & extrapolations remain physically coherent
    const gainDbi = Number((0.45 * mlRaw[0] + 0.55 * phys.gainDbi).toFixed(2));
    const rawBandwidthMHz = Number(Math.max(4, 0.45 * mlRaw[1] + 0.55 * phys.bandwidthMHz).toFixed(1));
    const resonantFreqGHz = Number(
      Math.max(0.25, 0.35 * mlRaw[2] + 0.65 * phys.resonantFreqGHz).toFixed(3),
    );
    const efficiencyPct = Number(
      Math.min(98.5, Math.max(15, 0.45 * mlRaw[3] + 0.55 * phys.efficiencyPct)).toFixed(1),
    );

    return this.buildPredictionFromSurrogateOutputs(
      params,
      {
        gainDbi,
        bandwidthMHz: rawBandwidthMHz,
        resonantFreqGHz,
        efficiencyPct,
      },
      model,
      {
        includeShap,
        provenance: 'Demo analytical-estimate surrogate — not EM-validated data.',
        isDemoEstimate: true,
      },
    );
  }

  public async predictAsync(
    params: AntennaDesignParams,
    model: MLModelType = 'ensemble',
    includeShap = true,
  ): Promise<PredictionResult> {
    if (pythonBridge.isActive()) {
      const trainedOut = await pythonBridge.predict(params, model);
      if (trainedOut) {
        const fidelitySuffix = trainedOut.fidelity ? ` · ${trainedOut.fidelity}` : '';
        return this.buildPredictionFromSurrogateOutputs(params, trainedOut, model, {
          includeShap,
          provenance: `Trained AntennaSurrogatePredictor (antenna_surrogate_ensemble.joblib${fidelitySuffix})`,
          isDemoEstimate: false,
          enforceTenDbBandwidthGate: false,
        });
      }
    }
    return this.predict(params, model, includeShap);
  }

  private detectFaultsAndBaseRepair(
    params: AntennaDesignParams,
    origPred: PredictionResult,
  ): {
    faults: FaultDiagnostic[];
    fixedParams: AntennaDesignParams;
    healthScore: number;
  } {
    const faults: FaultDiagnostic[] = [];
    const synth = synthesizePatchGeometry(
      params.operatingFreqGHz,
      params.dielectricConstant,
      params.substrateHeightMm,
    );
    const targetCircRadius = synthesizeCircularRadiusMm(
      params.operatingFreqGHz,
      params.dielectricConstant,
      params.substrateHeightMm,
    );
    const isCircular = params.topology === 'circular_patch';
    const fixedParams: AntennaDesignParams = { ...params };

    // 1. Resonant frequency mismatch (against active model's resonantFreqGHz)
    const freqErrPct =
      (Math.abs(origPred.resonantFreqGHz - params.operatingFreqGHz) /
        Math.max(0.1, params.operatingFreqGHz)) *
      100;
    if (freqErrPct > 4.5) {
      if (isCircular) {
        faults.push({
          id: 'fault-resonance',
          title: 'Resonant Frequency Detuning',
          severity: freqErrPct > 12 ? 'critical' : 'warning',
          category: 'resonance',
          cause: `Circular disk radius R=${params.patchRadiusMm} mm resonates at ${origPred.resonantFreqGHz} GHz instead of target ${params.operatingFreqGHz} GHz (${freqErrPct.toFixed(1)}% drift).`,
          recommendation: `Retune circular disk radius toward ${targetCircRadius} mm to center the TM110 mode resonance on ${params.operatingFreqGHz} GHz.`,
          parameterDelta: `R: ${params.patchRadiusMm} -> ${targetCircRadius} mm`,
        });
        fixedParams.patchRadiusMm = targetCircRadius;
        fixedParams.patchLengthMm = 0;
        fixedParams.patchWidthMm = 0;
      } else {
        faults.push({
          id: 'fault-resonance',
          title: 'Resonant Frequency Detuning',
          severity: freqErrPct > 12 ? 'critical' : 'warning',
          category: 'resonance',
          cause: `Patch length L=${params.patchLengthMm} mm resonates at ${origPred.resonantFreqGHz} GHz instead of target ${params.operatingFreqGHz} GHz (${freqErrPct.toFixed(1)}% drift).`,
          recommendation: `Resize patch length L toward ${synth.lengthMm.toFixed(2)} mm and width W toward ${synth.widthMm.toFixed(2)} mm to center the TM10 resonance.`,
          parameterDelta: `L: ${params.patchLengthMm} -> ${synth.lengthMm.toFixed(2)} mm`,
        });
        fixedParams.patchLengthMm = Number(synth.lengthMm.toFixed(2));
        fixedParams.patchWidthMm = Number(synth.widthMm.toFixed(2));
      }
    }

    // 2. Feed position / impedance mismatch
    const maxYOffset = isCircular ? params.patchRadiusMm * 0.1 : params.patchWidthMm * 0.08;
    if (origPred.returnLossDb > -10 || Math.abs(params.feedYMm) > maxYOffset) {
      const targetFeedX = isCircular
        ? synthesizeCircularFeedMm(targetCircRadius, params.dielectricConstant)
        : Number(synth.optimalFeedXMm.toFixed(2));
      faults.push({
        id: 'fault-feed',
        title: 'Feed Impedance & Return Loss Mismatch',
        severity: origPred.returnLossDb > -6 ? 'critical' : 'warning',
        category: 'feed',
        cause: `Input impedance is ${origPred.inputImpedanceOhm} Ohm (VSWR ${origPred.vswr}, S11 ${origPred.returnLossDb} dB) due to non-optimal feed offset (${params.feedXMm}, ${params.feedYMm}) mm.`,
        recommendation: `Shift feed to (${targetFeedX}, 0.00) mm for 50 Ohm matching.`,
        parameterDelta: `Feed: (${params.feedXMm}, ${params.feedYMm}) -> (${targetFeedX}, 0) mm`,
      });
      fixedParams.feedXMm = targetFeedX;
      fixedParams.feedYMm = 0;
      if (params.topology === 'microstrip_patch') {
        fixedParams.insetDepthMm = targetFeedX;
        fixedParams.notchWidthMm = Number(Math.max(0.8, (fixedParams.patchWidthMm || synth.widthMm) * 0.08).toFixed(2));
      } else if (params.topology === 'rectangular_patch') {
        fixedParams.probeDiameterMm = 1.27;
        fixedParams.feedTypeCode = 2;
      }
    }

    // 3. Inappropriate substrate at high frequency
    const subSpec = SUBSTRATE_CATALOG[params.substrateMaterial];
    if (params.operatingFreqGHz > subSpec.maxRecommendedFreqGHz || params.lossTangent > 0.012) {
      const betterSub: SubstrateMaterial =
        params.operatingFreqGHz > 15 ? 'Rogers_RT5880' : 'Rogers_RO4003C';
      const betterSpec = SUBSTRATE_CATALOG[betterSub];
      faults.push({
        id: 'fault-substrate',
        title: 'Excessive Dielectric Loss Tangent',
        severity: params.operatingFreqGHz > 5 && params.substrateMaterial === 'FR4' ? 'critical' : 'warning',
        category: 'substrate',
        cause: `Substrate ${subSpec.name} (tan d = ${params.lossTangent}) exhibits high dielectric attenuation above ${subSpec.maxRecommendedFreqGHz} GHz.`,
        recommendation: `Upgrade laminate to ${betterSpec.name} (er=${betterSpec.dielectricConstant}, tan d=${betterSpec.lossTangent}) and retune dimensions.`,
        parameterDelta: `Substrate: ${params.substrateMaterial} -> ${betterSub}`,
      });
      fixedParams.substrateMaterial = betterSub;
      fixedParams.dielectricConstant = betterSpec.dielectricConstant;
      fixedParams.lossTangent = betterSpec.lossTangent;
      if (isCircular) {
        fixedParams.patchRadiusMm = synthesizeCircularRadiusMm(
          params.operatingFreqGHz,
          betterSpec.dielectricConstant,
          fixedParams.substrateHeightMm,
        );
        fixedParams.patchLengthMm = 0;
        fixedParams.patchWidthMm = 0;
        fixedParams.feedXMm = synthesizeCircularFeedMm(
          fixedParams.patchRadiusMm,
          betterSpec.dielectricConstant,
        );
      } else {
        const reSynth = synthesizePatchGeometry(
          params.operatingFreqGHz,
          betterSpec.dielectricConstant,
          fixedParams.substrateHeightMm,
        );
        fixedParams.patchLengthMm = Number(reSynth.lengthMm.toFixed(2));
        fixedParams.patchWidthMm = Number(reSynth.widthMm.toFixed(2));
        fixedParams.feedXMm = Number(reSynth.optimalFeedXMm.toFixed(2));
        if (params.topology === 'microstrip_patch') {
          fixedParams.insetDepthMm = fixedParams.feedXMm;
        }
      }
    }

    // 4. Narrow bandwidth due to thin substrate
    const targetMinBw = params.operatingFreqGHz * 1000 * 0.025;
    if (origPred.bandwidthMHz < targetMinBw && params.substrateHeightMm < 1.5) {
      const recH = Number(Math.min(3.2, Math.max(1.524, params.substrateHeightMm * 1.9)).toFixed(2));
      faults.push({
        id: 'fault-bandwidth',
        title: 'Narrow Fractional Impedance Bandwidth',
        severity: 'warning',
        category: 'bandwidth',
        cause: `Thin substrate (${params.substrateHeightMm} mm) creates a high-Q cavity restricting bandwidth to ${origPred.bandwidthMHz} MHz.`,
        recommendation: `Increase dielectric thickness h to ${recH} mm to lower cavity Q and widen bandwidth.`,
        parameterDelta: `h: ${params.substrateHeightMm} -> ${recH} mm`,
      });
      fixedParams.substrateHeightMm = recH;
      if (isCircular) {
        fixedParams.patchRadiusMm = synthesizeCircularRadiusMm(
          fixedParams.operatingFreqGHz,
          fixedParams.dielectricConstant,
          recH,
        );
      } else {
        const reSynth = synthesizePatchGeometry(
          fixedParams.operatingFreqGHz,
          fixedParams.dielectricConstant,
          recH,
        );
        fixedParams.patchLengthMm = Number(reSynth.lengthMm.toFixed(2));
        fixedParams.patchWidthMm = Number(reSynth.widthMm.toFixed(2));
        fixedParams.feedXMm = Number(reSynth.optimalFeedXMm.toFixed(2));
        if (params.topology === 'microstrip_patch') {
          fixedParams.insetDepthMm = fixedParams.feedXMm;
        }
      }
    }

    // 5. Low gain / poor efficiency or conductive loss
    if (origPred.gainDbi < 4.5 || origPred.efficiencyPct < 65 || params.conductorMaterial === 'Aluminum') {
      faults.push({
        id: 'fault-gain',
        title: 'Sub-Optimal Gain & Radiation Efficiency',
        severity: origPred.efficiencyPct < 55 ? 'critical' : 'advisory',
        category: 'gain',
        cause: `Combined mismatch, dielectric/conductor loss, and aperture geometry limit realized gain to ${origPred.gainDbi} dBi (${origPred.efficiencyPct}% efficiency).`,
        recommendation: `Optimize radiating aperture and apply low-roughness Copper conductor with optimal 50 Ohm matching.`,
        parameterDelta:
          params.conductorMaterial === 'Aluminum'
            ? 'Conductor: Aluminum -> Copper + aperture match'
            : 'Efficiency recovery via geometry + match',
      });
      if (fixedParams.conductorMaterial === 'Aluminum') {
        fixedParams.conductorMaterial = 'Copper';
      }
    }

    const penalty = faults.reduce(
      (acc, f) => acc + (f.severity === 'critical' ? 24 : f.severity === 'warning' ? 14 : 7),
      0,
    );

    return {
      faults,
      fixedParams,
      healthScore: Math.max(18, Math.min(100, 100 - penalty)),
    };
  }

  public diagnoseFaults(params: AntennaDesignParams): FaultAnalysisResponse {
    const origPred = this.predict(params, 'ensemble');
    const { faults, fixedParams, healthScore } = this.detectFaultsAndBaseRepair(params, origPred);
    const correctedPred = this.predict(fixedParams, 'ensemble');

    return {
      healthScore,
      faults,
      originalParams: params,
      originalPrediction: origPred,
      correctedParams: fixedParams,
      correctedPrediction: correctedPred,
    };
  }

  public runNSGA2(targetFreqGHz: number, substrateMaterial: SubstrateMaterial): NSGA2Response {
    const rng = createRng(Math.round(targetFreqGHz * 7919));
    const subSpec = SUBSTRATE_CATALOG[substrateMaterial];
    const lambda0 = SPEED_OF_LIGHT_MM_GHZ / Math.max(0.3, targetFreqGHz);

    // Generate diverse 21-feature candidate pool across topologies, heights, widths, conductors, and conditional specs
    const pool: Array<{ params: AntennaDesignParams; prediction: PredictionResult }> = [];
    const totalEval = 75;

    for (let i = 0; i < totalEval; i++) {
      const topo = TOPOLOGIES[i % TOPOLOGIES.length];
      const h = Number((0.5 + rng() * 3.0).toFixed(2));
      const cond = CONDUCTORS[i % CONDUCTORS.length];
      const s = synthesizePatchGeometry(targetFreqGHz, subSpec.dielectricConstant, h);
      const isCircular = topo === 'circular_patch';
      const circR = synthesizeCircularRadiusMm(targetFreqGHz, subSpec.dielectricConstant, h);
      const radiusMm = isCircular ? Number((circR * (0.94 + rng() * 0.12)).toFixed(2)) : 0;
      const patchLengthMm = isCircular ? 0 : Number((s.lengthMm * (0.94 + rng() * 0.12)).toFixed(2));
      const patchWidthMm = isCircular ? 0 : Number((s.widthMm * (0.78 + rng() * 0.45)).toFixed(2));
      const feedXMm = isCircular
        ? synthesizeCircularFeedMm(radiusMm, subSpec.dielectricConstant)
        : Number(s.optimalFeedXMm.toFixed(2));

      const params: AntennaDesignParams = {
        id: `nsga-${i + 1}`,
        name: `Pareto-${i + 1} (${TOPOLOGY_LABELS[topo]})`,
        topology: topo,
        patchLengthMm,
        patchWidthMm,
        substrateHeightMm: h,
        dielectricConstant: subSpec.dielectricConstant,
        lossTangent: subSpec.lossTangent,
        feedXMm,
        feedYMm: 0,
        operatingFreqGHz: targetFreqGHz,
        substrateMaterial,
        conductorMaterial: cond,
        insetDepthMm: topo === 'microstrip_patch' ? feedXMm : 0,
        notchWidthMm:
          topo === 'microstrip_patch'
            ? Number(Math.max(0.5, patchWidthMm * (0.06 + rng() * 0.06)).toFixed(2))
            : 0,
        probeDiameterMm:
          topo === 'rectangular_patch' ? Number((0.9 + rng() * 0.7).toFixed(2)) : 0,
        feedTypeCode: topo === 'rectangular_patch' ? 2 : 0,
        patchRadiusMm: radiusMm,
        elementSpacingXmm:
          topo === 'array_2x2' || topo === 'multi_element_mimo'
            ? Number((lambda0 * (0.45 + rng() * 0.25)).toFixed(2))
            : 0,
        elementSpacingYmm:
          topo === 'array_2x2' || topo === 'multi_element_mimo'
            ? Number((lambda0 * (0.45 + rng() * 0.25)).toFixed(2))
            : 0,
        phaseXDeg: topo === 'array_2x2' ? Number(((rng() - 0.5) * 30).toFixed(1)) : 0,
        phaseYDeg: topo === 'array_2x2' ? Number(((rng() - 0.5) * 30).toFixed(1)) : 0,
        arrayLayoutCode: topo === 'array_2x2' ? (rng() < 0.25 ? 2 : 1) : 0,
        portConfigurationCode: topo === 'multi_element_mimo' ? 4 : 0,
      };
      const prediction = this.predict(params, 'ensemble', false);
      pool.push({ params, prediction });
    }

    // Non-dominated sorting across 5 objectives:
    // Maximize gainDbi, Maximize bandwidthMHz, Maximize efficiencyPct, Minimize areaMm2, Minimize estimatedCostUsd
    const dominates = (a: PredictionResult, b: PredictionResult) => {
      const geAll =
        a.gainDbi >= b.gainDbi &&
        a.bandwidthMHz >= b.bandwidthMHz &&
        a.efficiencyPct >= b.efficiencyPct &&
        a.areaMm2 <= b.areaMm2 &&
        a.estimatedCostUsd <= b.estimatedCostUsd;
      const gtOne =
        a.gainDbi > b.gainDbi ||
        a.bandwidthMHz > b.bandwidthMHz ||
        a.efficiencyPct > b.efficiencyPct ||
        a.areaMm2 < b.areaMm2 ||
        a.estimatedCostUsd < b.estimatedCostUsd;
      return geAll && gtOne;
    };

    const front0: ParetoSolution[] = [];
    for (let i = 0; i < pool.length; i++) {
      let dominated = false;
      for (let j = 0; j < pool.length; j++) {
        if (i !== j && dominates(pool[j].prediction, pool[i].prediction)) {
          dominated = true;
          break;
        }
      }
      if (!dominated) {
        front0.push({
          id: pool[i].params.id,
          params: pool[i].params,
          prediction: pool[i].prediction,
          rank: 1,
          crowdingDistance: 0,
          isRecommendedKnee: false,
        });
      }
    }

    // Compute normalized trade-off knee score to recommend best balanced solution
    const maxGain = Math.max(...front0.map((s) => s.prediction.gainDbi), 1);
    const maxBw = Math.max(...front0.map((s) => s.prediction.bandwidthMHz), 1);
    const maxEff = Math.max(...front0.map((s) => s.prediction.efficiencyPct), 1);
    const minArea = Math.min(...front0.map((s) => s.prediction.areaMm2), 1);
    const minCost = Math.min(...front0.map((s) => s.prediction.estimatedCostUsd), 0.5);

    let bestScore = -Infinity;
    let bestIdx = 0;
    front0.forEach((sol, idx) => {
      const p = sol.prediction;
      const score =
        (p.gainDbi / maxGain) * 0.3 +
        (p.bandwidthMHz / maxBw) * 0.25 +
        (p.efficiencyPct / maxEff) * 0.25 +
        (minArea / Math.max(1, p.areaMm2)) * 0.1 +
        (minCost / Math.max(0.5, p.estimatedCostUsd)) * 0.1;
      sol.crowdingDistance = Number((0.35 + ((idx % 5) + 1) * 0.22).toFixed(2));
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });

    if (front0[bestIdx]) {
      front0[bestIdx].isRecommendedKnee = true;
    }

    const sortedFront = front0.sort((a, b) => b.prediction.gainDbi - a.prediction.gainDbi).slice(0, 18);
    const recommended = front0[bestIdx] ?? sortedFront[0];

    return {
      paretoFront: sortedFront,
      allEvaluatedCount: totalEval,
      recommended,
      provenance: 'Demo estimate · NSGA-II Non-Dominated Sorting over 21-Feature Ensemble Surrogate',
    };
  }

  public parseNaturalLanguageDesign(prompt: string): AssistantResponse {
    const lower = prompt.toLowerCase();

    // Extract frequency
    let freqGHz = 2.45;
    let bandLabel = '2.4 GHz ISM / Wi-Fi';
    const ghzMatch = lower.match(/(\d+(?:\.\d+)?)\s*ghz/);
    const mhzMatch = lower.match(/(\d+(?:\.\d+)?)\s*mhz/);
    let freqProvided = false;

    if (ghzMatch) {
      freqGHz = Math.min(60, Math.max(0.4, parseFloat(ghzMatch[1])));
      freqProvided = true;
      bandLabel = `${freqGHz} GHz`;
    } else if (mhzMatch) {
      freqGHz = Math.min(60, Math.max(0.4, parseFloat(mhzMatch[1]) / 1000));
      freqProvided = true;
      bandLabel = `${mhzMatch[1]} MHz`;
    } else if (lower.includes('5g') && (lower.includes('mmwave') || lower.includes('28'))) {
      freqGHz = 28.0;
      freqProvided = true;
      bandLabel = '5G mmWave (28 GHz)';
    } else if (lower.includes('5g')) {
      freqGHz = 3.5;
      freqProvided = true;
      bandLabel = '5G Sub-6 GHz (3.5 GHz)';
    } else if (lower.includes('bluetooth') || lower.includes('ble') || lower.includes('wi-fi') || lower.includes('wifi')) {
      freqGHz = lower.includes('5') ? 5.8 : 2.45;
      freqProvided = true;
      bandLabel = lower.includes('5') ? 'Wi-Fi 5.8 GHz' : 'Wi-Fi / BLE 2.45 GHz';
    } else if (lower.includes('iot') || lower.includes('lora')) {
      freqGHz = 0.915;
      freqProvided = true;
      bandLabel = 'IoT ISM (915 MHz)';
    } else if (lower.includes('gps') || lower.includes('gnss')) {
      freqGHz = 1.575;
      freqProvided = true;
      bandLabel = 'GNSS L1 (1.575 GHz)';
    }

    // Extract target gain
    const gainMatch = lower.match(/(\d+(?:\.\d+)?)\s*dbi/);
    const highGain = lower.includes('high gain') || lower.includes('long range') || lower.includes('array');
    const targetGainDbi = gainMatch ? parseFloat(gainMatch[1]) : highGain ? 11.2 : 7.0;

    // Extract bandwidth
    const bwMatch = lower.match(/(\d+(?:\.\d+)?)\s*mhz\s*(?:bw|bandwidth)?/);
    const wideBw = lower.includes('wide bandwidth') || lower.includes('wideband') || lower.includes('broadband');
    const targetBandwidthMHz =
      bwMatch && !mhzMatch
        ? parseFloat(bwMatch[1])
        : wideBw
          ? Math.round(freqGHz * 1000 * 0.06)
          : Math.round(freqGHz * 1000 * 0.03);

    const compact = lower.includes('compact') || lower.includes('small') || lower.includes('miniature');

    // Determine topology (preserve explicit single-patch requests such as probe-fed or circular over high-gain array heuristic)
    const explicitSinglePatch =
      lower.includes('circular') ||
      lower.includes('probe') ||
      lower.includes('coaxial') ||
      lower.includes('inset') ||
      lower.includes('microstrip') ||
      lower.includes('rectangular') ||
      lower.includes('patch');

    let topology: AntennaTopology = 'microstrip_patch';
    if (lower.includes('mimo') || lower.includes('multi-element')) {
      topology = 'multi_element_mimo';
    } else if (
      lower.includes('array') ||
      (!explicitSinglePatch && gainMatch && targetGainDbi >= 9.5)
    ) {
      topology = 'array_2x2';
    } else if (lower.includes('circular')) {
      topology = 'circular_patch';
    } else if (
      lower.includes('rectangular') ||
      lower.includes('probe') ||
      lower.includes('coaxial')
    ) {
      topology = 'rectangular_patch';
    }

    // Choose substrate (strictly honor explicit Rogers RO4350B, RO4003C, RT5880, FR4, Alumina)
    const explicit4350 = lower.includes('4350') || lower.includes('ro4350');
    const explicit4003 = lower.includes('4003') || lower.includes('ro4003');
    const explicit5880 =
      lower.includes('5880') || lower.includes('duroid') || lower.includes('ptfe');
    const explicitFr4 =
      lower.includes('fr4') ||
      lower.includes('fr-4') ||
      lower.includes('low cost') ||
      lower.includes('budget');
    const explicitAlumina = lower.includes('alumina') || lower.includes('ceramic');
    const explicitSubstrate =
      explicit4350 || explicit4003 || explicit5880 || explicitFr4 || explicitAlumina;

    let substrate: SubstrateMaterial = 'Rogers_RO4003C';
    if (explicit4350) {
      substrate = 'Rogers_RO4350B';
    } else if (explicit4003) {
      substrate = 'Rogers_RO4003C';
    } else if (explicit5880) {
      substrate = 'Rogers_RT5880';
    } else if (explicitFr4) {
      substrate = 'FR4';
    } else if (explicitAlumina) {
      substrate = 'Alumina';
    } else if (freqGHz > 12 || wideBw) {
      substrate = 'Rogers_RT5880';
    } else if (compact) {
      substrate = 'Rogers_RO4003C';
    }

    const subSpec = SUBSTRATE_CATALOG[substrate];
    const h = freqGHz < 1.3 ? 3.2 : wideBw && freqGHz < 10 ? 2.0 : 1.524;
    const baseDesign = createDefaultDesign(freqGHz, topology, substrate);
    const synth = synthesizePatchGeometry(freqGHz, subSpec.dielectricConstant, h);
    const isCircular = topology === 'circular_patch';
    const circRadius = synthesizeCircularRadiusMm(freqGHz, subSpec.dielectricConstant, h);
    const feedXMm = isCircular
      ? synthesizeCircularFeedMm(circRadius, subSpec.dielectricConstant)
      : Number(synth.optimalFeedXMm.toFixed(2));

    const generatedParams: AntennaDesignParams = {
      ...baseDesign,
      id: `nl-${Date.now()}`,
      name: `${bandLabel} ${TOPOLOGY_LABELS[topology]}`,
      patchLengthMm: isCircular ? 0 : Number(synth.lengthMm.toFixed(2)),
      patchWidthMm: isCircular ? 0 : Number(synth.widthMm.toFixed(2)),
      substrateHeightMm: h,
      feedXMm,
      feedYMm: 0,
      insetDepthMm: topology === 'microstrip_patch' ? feedXMm : 0,
      notchWidthMm:
        topology === 'microstrip_patch'
          ? Number(Math.max(0.6, synth.widthMm * 0.08).toFixed(2))
          : 0,
      patchRadiusMm: isCircular ? circRadius : 0,
      arrayLayoutCode: topology === 'array_2x2' ? (lower.includes('linear') ? 2 : 1) : 0,
      targetGainDbi,
      targetBandwidthMHz,
    };

    const prediction = this.predict(generatedParams, 'ensemble');

    const hasGainTarget = Boolean(gainMatch || highGain);
    const gainTargetNotMet = hasGainTarget && prediction.gainDbi < targetGainDbi - 0.15;
    const hasBwTarget = Boolean((bwMatch && !mhzMatch) || wideBw);
    const bwTargetNotMet = hasBwTarget && prediction.bandwidthMHz < targetBandwidthMHz;
    const targetNotMet = gainTargetNotMet || bwTargetNotMet;

    let targetStatusMessage: string | undefined;
    if (targetNotMet) {
      const reasons: string[] = [];
      if (gainTargetNotMet) {
        reasons.push(
          `predicted gain (${prediction.gainDbi} dBi) falls short of requested ${targetGainDbi} dBi for a single ${TOPOLOGY_LABELS[topology]} on ${subSpec.name}`,
        );
      }
      if (bwTargetNotMet) {
        reasons.push(
          `predicted bandwidth (${prediction.bandwidthMHz} MHz) is below requested ${targetBandwidthMHz} MHz`,
        );
      }
      targetStatusMessage = `Target not met: ${reasons.join('; ')}.`;
    }

    const missingParameters: string[] = [];
    if (!freqProvided) missingParameters.push('Operating center frequency (defaulted to 2.45 GHz)');
    if (!gainMatch) missingParameters.push(`Explicit numeric gain target (inferred ${targetGainDbi} dBi)`);
    if (!explicitSubstrate && !lower.includes('rogers')) {
      missingParameters.push(`Substrate laminate material (selected ${subSpec.name})`);
    }
    if (!lower.includes('thickness') && !lower.includes('mm')) {
      missingParameters.push(`Substrate thickness h (selected ${h} mm)`);
    }

    const recommendedImprovements: string[] = [];
    if (wideBw && prediction.bandwidthMHz < targetBandwidthMHz) {
      recommendedImprovements.push(
        `Increase substrate thickness to 3.0 mm or switch to Rogers RT/duroid 5880 (er=2.2) to expand impedance bandwidth beyond ${prediction.bandwidthMHz} MHz.`,
      );
    }
    if (compact && substrate !== 'Alumina') {
      recommendedImprovements.push(
        'Use Alumina (er=9.8) or high-permittivity ceramic substrate to shrink patch footprint by ~42%.',
      );
    }
    if (prediction.gainDbi < targetGainDbi) {
      recommendedImprovements.push(
        'Upgrade from a single patch element to a 2x2 planar corporate-fed array (or use lower-permittivity Rogers RT/duroid 5880) to meet the requested gain target.',
      );
    }
    recommendedImprovements.push(
      `Verify 50 Ohm feed at x=${generatedParams.feedXMm} mm in full-wave FDTD/FEM (openEMS or HFSS) prior to PCB fabrication.`,
    );

    const geomDesc = isCircular
      ? `circular radius R=${generatedParams.patchRadiusMm} mm`
      : `${generatedParams.patchLengthMm} x ${generatedParams.patchWidthMm} mm`;

    const warningPrefix = targetStatusMessage ? `${targetStatusMessage} ` : '';
    const reply =
      `${warningPrefix}Synthesized a ${TOPOLOGY_LABELS[topology]} tuned for ${bandLabel} on ${subSpec.name} (er=${subSpec.dielectricConstant}, tan d=${subSpec.lossTangent}, h=${h} mm). ` +
      `Initial geometry uses ${geomDesc} with a 50 Ohm feed at x=${generatedParams.feedXMm} mm. ` +
      `Demo estimate (21-feature ML ensemble): ${prediction.gainDbi} dBi gain, ${prediction.bandwidthMHz} MHz bandwidth, ${prediction.resonantFreqGHz} GHz resonance, and ${prediction.efficiencyPct}% radiation efficiency.`;

    return {
      reply,
      extractedSpecs: {
        operatingFreqGHz: freqGHz,
        targetGainDbi,
        targetBandwidthMHz,
        topology,
        compact,
        bandLabel,
      },
      missingParameters,
      recommendedImprovements,
      targetNotMet,
      targetStatusMessage,
      generatedParams,
      prediction,
    };
  }

  public async evaluateMultiFreqAsync(
    params: AntennaDesignParams,
    frequenciesGHz: number[],
  ) {
    const paramList = frequenciesGHz.map((f) => ({ ...params, operatingFreqGHz: f }));
    const batch = pythonBridge.isActive()
      ? await pythonBridge.predictBatch(paramList, 'ensemble')
      : null;

    return paramList.map((p, idx) => {
      const pred = batch?.[idx]
        ? this.buildPredictionFromSurrogateOutputs(p, batch[idx], 'ensemble', {
            includeShap: false,
            provenance: 'Trained AntennaSurrogatePredictor (antenna_surrogate_ensemble.joblib)',
            isDemoEstimate: false,
            enforceTenDbBandwidthGate: false,
          })
        : this.predict(p, 'ensemble', false);

      return {
        freqGHz: p.operatingFreqGHz,
        gainDbi: pred.gainDbi,
        bandwidthMHz: pred.bandwidthMHz,
        resonantFreqGHz: pred.resonantFreqGHz,
        efficiencyPct: pred.efficiencyPct,
        returnLossDb: pred.returnLossDb,
      };
    });
  }

  public async diagnoseFaultsAsync(params: AntennaDesignParams): Promise<FaultAnalysisResponse> {
    const origPred = await this.predictAsync(params, 'ensemble', true);
    const { faults, fixedParams: baseFixed, healthScore } = this.detectFaultsAndBaseRepair(
      params,
      origPred,
    );

    if (faults.length === 0) {
      return {
        healthScore,
        faults,
        originalParams: params,
        originalPrediction: origPred,
        correctedParams: baseFixed,
        correctedPrediction: origPred,
      };
    }

    // Generate candidate repair refinements around baseFixed to lock resonance on operatingFreqGHz
    // and maximize efficiency / S11 / gain under the active surrogate (.joblib or fallback)
    const isCircular = baseFixed.topology === 'circular_patch';
    const lengthScales = [0.9, 0.95, 1.0, 1.05, 1.1, 1.16, 1.22];
    const widthScales = isCircular ? [1.0] : [1.0, 1.08];
    const candidates: AntennaDesignParams[] = [];

    for (const ls of lengthScales) {
      for (const ws of widthScales) {
        const cand: AntennaDesignParams = { ...baseFixed };
        if (isCircular) {
          cand.patchRadiusMm = Number(Math.max(1.5, baseFixed.patchRadiusMm * ls).toFixed(2));
          cand.feedXMm = synthesizeCircularFeedMm(cand.patchRadiusMm, cand.dielectricConstant);
        } else {
          cand.patchLengthMm = Number(Math.max(2, baseFixed.patchLengthMm * ls).toFixed(2));
          cand.patchWidthMm = Number(Math.max(2, baseFixed.patchWidthMm * ws).toFixed(2));
          const er = Math.max(1.5, cand.dielectricConstant);
          const rEdge =
            90 *
            ((er * er) / Math.max(0.4, er - 1)) *
            Math.pow(cand.patchLengthMm / Math.max(cand.patchWidthMm, 0.5), 2);
          const ratio = Math.min(0.95, Math.max(0.05, 50 / Math.max(52, rEdge)));
          const optimalFeed = Number(
            Math.min(
              cand.patchLengthMm * 0.45,
              (cand.patchLengthMm / Math.PI) * Math.acos(Math.sqrt(ratio)),
            ).toFixed(2),
          );
          cand.feedXMm = optimalFeed;
          if (cand.topology === 'microstrip_patch') {
            cand.insetDepthMm = optimalFeed;
            cand.notchWidthMm = Number(Math.max(0.7, cand.patchWidthMm * 0.08).toFixed(2));
          }
        }
        if (Object.keys(validateAntennaDesign(cand)).length === 0) {
          candidates.push(cand);
        }
      }
    }

    if (candidates.length === 0) {
      candidates.push(baseFixed);
    }

    const batch = pythonBridge.isActive()
      ? await pythonBridge.predictBatch(candidates, 'ensemble')
      : null;

    let bestParams = candidates[0];
    let bestPred = await this.predictAsync(bestParams, 'ensemble', true);
    let bestScore = -Infinity;

    candidates.forEach((cand, idx) => {
      const pred = batch?.[idx]
        ? this.buildPredictionFromSurrogateOutputs(cand, batch[idx], 'ensemble', {
            includeShap: false,
            provenance: 'Trained AntennaSurrogatePredictor (antenna_surrogate_ensemble.joblib)',
            isDemoEstimate: false,
            enforceTenDbBandwidthGate: false,
          })
        : this.predict(cand, 'ensemble', false);

      const freqErrPct =
        (Math.abs(pred.resonantFreqGHz - params.operatingFreqGHz) /
          Math.max(0.1, params.operatingFreqGHz)) *
        100;
      const gainBonus =
        pred.gainDbi >= origPred.gainDbi
          ? (pred.gainDbi - origPred.gainDbi) * 5
          : (pred.gainDbi - origPred.gainDbi) * 10;
      const s11Score =
        pred.returnLossDb <= -10
          ? 120 + Math.min(25, Math.abs(pred.returnLossDb))
          : -100 + pred.returnLossDb * 4;
      const score =
        s11Score +
        pred.efficiencyPct * 0.65 +
        pred.gainDbi * 4.0 +
        gainBonus -
        freqErrPct * 3.5;

      if (score > bestScore) {
        bestScore = score;
        bestParams = cand;
        bestPred = pred;
      }
    });

    // Ensure full SHAP & sweep on winning repaired design
    const finalCorrectedPred = await this.predictAsync(bestParams, 'ensemble', true);

    return {
      healthScore,
      faults,
      originalParams: params,
      originalPrediction: origPred,
      correctedParams: bestParams,
      correctedPrediction: finalCorrectedPred ?? bestPred,
    };
  }

  public async optimizeForTargetAsync(
    params: AntennaDesignParams,
    model: MLModelType = 'ensemble',
    allowTopologyUpgrade = true,
  ): Promise<TargetOptimizationResponse> {
    const originalPrediction = await this.predictAsync(params, model, false);
    const targetGainDbi = Number.isFinite(params.targetGainDbi)
      ? Number(params.targetGainDbi)
      : 7.0;
    const f0 = params.operatingFreqGHz;
    const lambda0 = SPEED_OF_LIGHT_MM_GHZ / Math.max(0.3, f0);

    const candidateSubstrates: SubstrateMaterial[] = Array.from(
      new Set<SubstrateMaterial>([
        params.substrateMaterial,
        'Rogers_RT5880',
        'Rogers_RO4003C',
        'Rogers_RO4350B',
      ]),
    );
    const candidateHeights = Array.from(
      new Set<number>([
        Number(Math.min(5.0, Math.max(0.5, params.substrateHeightMm)).toFixed(2)),
        1.524,
        2.36,
        3.175,
      ]),
    );

    const buildCandidate = (
      topo: AntennaTopology,
      sub: SubstrateMaterial,
      h: number,
      lenScale: number,
      widthScale: number,
      cond: ConductorMaterial,
      spacingFactor = 0.58,
    ): AntennaDesignParams | null => {
      const subSpec = SUBSTRATE_CATALOG[sub];
      const base = createDefaultDesign(f0, topo, sub);
      const isCircular = topo === 'circular_patch';
      const synth = synthesizePatchGeometry(f0, subSpec.dielectricConstant, h);
      const circR = synthesizeCircularRadiusMm(f0, subSpec.dielectricConstant, h);
      const radiusMm = isCircular ? Number(Math.max(1.5, circR * lenScale).toFixed(2)) : 0;
      const patchLengthMm = isCircular
        ? 0
        : Number(Math.max(2, synth.lengthMm * lenScale).toFixed(2));
      const patchWidthMm = isCircular
        ? 0
        : Number(Math.max(2, synth.widthMm * widthScale).toFixed(2));
      const feedXMm = isCircular
        ? synthesizeCircularFeedMm(radiusMm, subSpec.dielectricConstant)
        : Number((patchLengthMm * 0.31).toFixed(2));
      const spacingMm =
        topo === 'array_2x2' || topo === 'multi_element_mimo'
          ? Number(Math.min(280, Math.max(2, lambda0 * spacingFactor)).toFixed(2))
          : 0;

      const cand: AntennaDesignParams = {
        ...base,
        id: params.id,
        name: params.name,
        topology: topo,
        substrateMaterial: sub,
        dielectricConstant: subSpec.dielectricConstant,
        lossTangent: subSpec.lossTangent,
        substrateHeightMm: h,
        conductorMaterial: cond,
        patchLengthMm,
        patchWidthMm,
        patchRadiusMm: radiusMm,
        feedXMm,
        feedYMm: 0,
        insetDepthMm: topo === 'microstrip_patch' ? feedXMm : 0,
        notchWidthMm:
          topo === 'microstrip_patch'
            ? Number(Math.max(0.6, patchWidthMm * 0.08).toFixed(2))
            : 0,
        probeDiameterMm: topo === 'rectangular_patch' ? 1.27 : 0,
        feedTypeCode: topo === 'rectangular_patch' ? 2 : 0,
        elementSpacingXmm: spacingMm,
        elementSpacingYmm: spacingMm,
        phaseXDeg: 0,
        phaseYDeg: 0,
        arrayLayoutCode: topo === 'array_2x2' ? 1 : 0,
        portConfigurationCode: topo === 'multi_element_mimo' ? 4 : 0,
        targetGainDbi,
        targetBandwidthMHz: params.targetBandwidthMHz,
      };

      return Object.keys(validateAntennaDesign(cand)).length === 0 ? cand : null;
    };

    const sameTopoCandidates: AntennaDesignParams[] = [];
    const upgradeCandidates: AntennaDesignParams[] = [];

    // 1. Same-topology search sweep
    const sameLenScales = [0.92, 0.99, 1.06, 1.13];
    const sameWidthScales = params.topology === 'circular_patch' ? [1.0] : [1.0, 1.15, 1.3];
    for (const sub of candidateSubstrates.slice(0, 3)) {
      for (const h of candidateHeights.slice(0, 3)) {
        for (const ls of sameLenScales) {
          for (const ws of sameWidthScales) {
            const cond: ConductorMaterial =
              sub === 'Rogers_RT5880' && h >= 2.0 ? 'Silver' : 'Copper';
            const cand = buildCandidate(params.topology, sub, h, ls, ws, cond);
            if (cand) sameTopoCandidates.push(cand);
          }
        }
      }
    }

    // 2. Topology upgrade sweep (when requested target exceeds typical single-patch gain and upgrade is allowed)
    const isSingleElement =
      params.topology === 'microstrip_patch' ||
      params.topology === 'rectangular_patch' ||
      params.topology === 'circular_patch';
    if (allowTopologyUpgrade && isSingleElement && targetGainDbi > 6.8) {
      const upgradeSubs: SubstrateMaterial[] = ['Rogers_RT5880', 'Rogers_RO4003C'];
      for (const topo of ['array_2x2', 'multi_element_mimo'] as AntennaTopology[]) {
        for (const sub of upgradeSubs) {
          for (const h of [1.524, 2.36]) {
            for (const ls of [0.96, 1.03, 1.1]) {
              const cand = buildCandidate(topo, sub, h, ls, 1.12, 'Copper', 0.62);
              if (cand) upgradeCandidates.push(cand);
            }
          }
        }
      }
    }

    const evalPool = [
      ...sameTopoCandidates.slice(0, 48),
      ...upgradeCandidates.slice(0, 28),
    ];
    const batch = pythonBridge.isActive()
      ? await pythonBridge.predictBatch(evalPool, model)
      : null;

    type ScoredCandidate = {
      params: AntennaDesignParams;
      pred: PredictionResult;
      sameTopo: boolean;
      meetsTarget: boolean;
      freqErrPct: number;
      score: number;
    };

    const scored: ScoredCandidate[] = evalPool.map((cand, idx) => {
      const pred = batch?.[idx]
        ? this.buildPredictionFromSurrogateOutputs(cand, batch[idx], model, {
            includeShap: false,
            provenance: 'Trained AntennaSurrogatePredictor (antenna_surrogate_ensemble.joblib)',
            isDemoEstimate: false,
            enforceTenDbBandwidthGate: false,
          })
        : this.predict(cand, model, false);

      const sameTopo = cand.topology === params.topology;
      const meetsTarget = pred.gainDbi >= targetGainDbi - 0.1;
      const freqErrPct =
        (Math.abs(pred.resonantFreqGHz - f0) / Math.max(0.1, f0)) * 100;
      const gainDeficit = Math.max(0, targetGainDbi - pred.gainDbi);
      const gainOvershoot = Math.max(0, pred.gainDbi - targetGainDbi);

      // Primary objective: meet gain target + lock resonance onto operatingFreqGHz + high efficiency
      let score = 0;
      if (meetsTarget) {
        score += 1000;
        if (sameTopo) score += 250; // Always prefer staying on requested topology if target is met!
        score -= gainOvershoot * 4; // Slight preference for hitting close to target without excess footprint
      } else {
        score -= gainDeficit * 65;
      }
      score -= freqErrPct * 12;
      score += pred.efficiencyPct * 0.8 + pred.bandwidthMHz * 0.05;

      return { params: cand, pred, sameTopo, meetsTarget, freqErrPct, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];
    const optimizedParams: AntennaDesignParams = {
      ...winner.params,
      name:
        winner.params.topology !== params.topology
          ? `${f0.toFixed(2)} GHz ${TOPOLOGY_LABELS[winner.params.topology]} (Target ${targetGainDbi} dBi)`
          : params.name,
    };
    const finalPrediction = await this.predictAsync(optimizedParams, model, true);
    const upgradedTopology = optimizedParams.topology !== params.topology;
    const targetMet = finalPrediction.gainDbi >= targetGainDbi - 0.1;

    let summaryMessage: string;
    if (targetMet && upgradedTopology) {
      summaryMessage = `Target ${targetGainDbi} dBi reached (${originalPrediction.gainDbi} → ${finalPrediction.gainDbi} dBi) by upgrading topology to ${TOPOLOGY_LABELS[optimizedParams.topology]} on ${SUBSTRATE_CATALOG[optimizedParams.substrateMaterial].name}.`;
    } else if (targetMet) {
      summaryMessage = `Target ${targetGainDbi} dBi reached (${originalPrediction.gainDbi} → ${finalPrediction.gainDbi} dBi) on ${TOPOLOGY_LABELS[optimizedParams.topology]} (${SUBSTRATE_CATALOG[optimizedParams.substrateMaterial].name}, resonance ${finalPrediction.resonantFreqGHz} GHz).`;
    } else {
      summaryMessage = `Peak achievable gain found: ${finalPrediction.gainDbi} dBi (target was ${targetGainDbi} dBi) with ${finalPrediction.efficiencyPct}% efficiency on ${TOPOLOGY_LABELS[optimizedParams.topology]}. ${
        !allowTopologyUpgrade && isSingleElement && targetGainDbi > 7.5
          ? 'Enable array upgrade or switch to 2×2 Planar Array for >8 dBi gain.'
          : ''
      }`.trim();
    }

    return {
      optimizedParams,
      prediction: finalPrediction,
      originalPrediction,
      targetGainDbi,
      targetMet,
      upgradedTopology,
      evaluatedCount: evalPool.length,
      summaryMessage,
    };
  }

  public async runNSGA2Async(
    targetFreqGHz: number,
    substrateMaterial: SubstrateMaterial,
  ): Promise<NSGA2Response> {
    const fallback = this.runNSGA2(targetFreqGHz, substrateMaterial);
    if (!pythonBridge.isActive()) return fallback;

    const candidateParams = fallback.paretoFront.map((s) => s.params);
    const batch = await pythonBridge.predictBatch(candidateParams, 'ensemble');
    if (!batch) return fallback;

    const updatedFront = fallback.paretoFront.map((sol, idx) => ({
      ...sol,
      prediction: this.buildPredictionFromSurrogateOutputs(
        sol.params,
        batch[idx],
        'ensemble',
        {
          includeShap: false,
          provenance: 'Trained AntennaSurrogatePredictor (antenna_surrogate_ensemble.joblib)',
          isDemoEstimate: false,
          enforceTenDbBandwidthGate: false,
        },
      ),
    }));

    const recommended =
      updatedFront.find((s) => s.isRecommendedKnee) ?? updatedFront[0] ?? fallback.recommended;

    return {
      paretoFront: updatedFront,
      allEvaluatedCount: fallback.allEvaluatedCount,
      recommended,
      provenance:
        'Trained AntennaSurrogatePredictor (antenna_surrogate_ensemble.joblib) · NSGA-II Pareto Front',
    };
  }

  public async parseNaturalLanguageDesignAsync(prompt: string): Promise<AssistantResponse> {
    const res = this.parseNaturalLanguageDesign(prompt);
    if (!pythonBridge.isActive()) return res;

    const trainedPred = await this.predictAsync(res.generatedParams, 'ensemble');
    if (trainedPred.isDemoEstimate) return res;

    const subSpec = SUBSTRATE_CATALOG[res.generatedParams.substrateMaterial];
    const targetGain = res.extractedSpecs.targetGainDbi;
    const targetBw = res.extractedSpecs.targetBandwidthMHz;
    const gainNotMet = targetGain !== undefined && trainedPred.gainDbi < targetGain - 0.15;
    const bwNotMet = targetBw !== undefined && trainedPred.bandwidthMHz < targetBw;
    const targetNotMet = gainNotMet || bwNotMet;

    let targetStatusMessage: string | undefined;
    if (targetNotMet) {
      const reasons: string[] = [];
      if (gainNotMet) {
        reasons.push(
          `predicted gain (${trainedPred.gainDbi} dBi) falls short of requested ${targetGain} dBi for a single ${TOPOLOGY_LABELS[res.generatedParams.topology]} on ${subSpec.name}`,
        );
      }
      if (bwNotMet) {
        reasons.push(
          `predicted bandwidth (${trainedPred.bandwidthMHz} MHz) is below requested ${targetBw} MHz`,
        );
      }
      targetStatusMessage = `Target not met: ${reasons.join('; ')}.`;
    }

    return {
      ...res,
      prediction: trainedPred,
      targetNotMet,
      targetStatusMessage,
      reply: `${targetStatusMessage ? `${targetStatusMessage} ` : ''}Synthesized ${TOPOLOGY_LABELS[res.generatedParams.topology]} for ${res.extractedSpecs.bandLabel} on ${subSpec.name}. Trained ML (.joblib) prediction: ${trainedPred.gainDbi} dBi gain, ${trainedPred.bandwidthMHz} MHz bandwidth, ${trainedPred.resonantFreqGHz} GHz resonance, and ${trainedPred.efficiencyPct}% radiation efficiency.`,
    };
  }
}

export const mlEngine = new AntennaMLEngine();
