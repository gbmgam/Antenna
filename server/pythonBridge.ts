import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import type {
  AntennaDesignParams,
  MLModelType,
  PredictionOutput4,
  SurrogateStatusResponse,
} from '../src/shared/antennaTypes.ts';
import {
  TOPOLOGY_CANONICAL_NAMES,
  buildFeatureRecord21,
} from '../src/shared/antennaSchema.ts';

export interface PythonPredictorInput {
  topologyName: string;
  operatingFreqGHz: number;
  substrateHeightMm: number;
  dielectricConstant: number;
  lossTangent: number;
  patchLengthMm?: number;
  patchWidthMm?: number;
  patchRadiusMm?: number;
  insetDepthMm?: number;
  notchWidthMm?: number;
  probeDiameterMm?: number;
  feedXMm?: number;
  feedYMm?: number;
  elementSpacingXmm?: number;
  elementSpacingYmm?: number;
  phaseXDeg?: number;
  phaseYDeg?: number;
  conductorSigmaNorm?: number;
  feedTypeCode?: number;
  arrayLayoutCode?: number;
  portConfigurationCode?: number;
}

/**
 * Converts ANTENNA AI's AntennaDesignParams into the canonical dictionary
 * expected by `AntennaSurrogatePredictor.predict(...)` in `predict.py`.
 */
export function mapDesignToPredictorInput(params: AntennaDesignParams): PythonPredictorInput {
  const rec = buildFeatureRecord21(params);
  const topologyName = TOPOLOGY_CANONICAL_NAMES[params.topology] ?? 'Microstrip_Inset_Patch';

  const base: PythonPredictorInput = {
    topologyName,
    operatingFreqGHz: rec.operatingFreqGHz,
    substrateHeightMm: rec.substrateHeightMm,
    dielectricConstant: rec.dielectricConstant,
    lossTangent: rec.lossTangent,
    conductorSigmaNorm: rec.conductorSigmaNorm,
  };

  if (params.topology === 'circular_patch') {
    base.patchRadiusMm = rec.patchRadiusMm;
    base.feedXMm = rec.feedXMm;
    base.feedYMm = rec.feedYMm;
    return base;
  }

  base.patchLengthMm = rec.patchLengthMm;
  base.patchWidthMm = rec.patchWidthMm;

  if (params.topology === 'microstrip_patch') {
    base.insetDepthMm = rec.insetDepthMm;
    base.notchWidthMm = rec.notchWidthMm;
    base.feedXMm = rec.feedXMm;
    base.feedYMm = rec.feedYMm;
  } else if (params.topology === 'rectangular_patch') {
    base.probeDiameterMm = rec.probeDiameterMm;
    base.feedTypeCode = rec.feedTypeCode;
    base.feedXMm = rec.feedXMm;
    base.feedYMm = rec.feedYMm;
  } else if (params.topology === 'array_2x2') {
    base.elementSpacingXmm = rec.elementSpacingXmm;
    base.elementSpacingYmm = rec.elementSpacingYmm;
    base.phaseXDeg = rec.phaseXDeg;
    base.phaseYDeg = rec.phaseYDeg;
    base.arrayLayoutCode = rec.arrayLayoutCode;
  } else if (params.topology === 'multi_element_mimo') {
    base.elementSpacingXmm = rec.elementSpacingXmm;
    base.elementSpacingYmm = rec.elementSpacingYmm;
    base.portConfigurationCode = rec.portConfigurationCode;
  }

  return base;
}

const REQUIRED_PYTHON_PACKAGES = [
  'joblib',
  'sklearn',
  'xgboost',
  'pandas',
  'numpy',
  'scipy',
] as const;

function findExistingFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function detectPythonBinary(): string | null {
  const root = process.cwd();
  const candidates = [
    path.join(root, '.venv', 'bin', 'python3'),
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    'python3',
    'python',
  ];
  for (const bin of candidates) {
    try {
      if (bin.includes(path.sep) && !fs.existsSync(bin)) continue;
      const res = spawnSync(bin, ['--version'], { encoding: 'utf-8', timeout: 1500 });
      if (res.status === 0) return bin;
    } catch {
      // try next
    }
  }
  return null;
}

function checkPythonPackages(pythonBin: string): string[] {
  try {
    const script =
      'import importlib.util; pkgs=' +
      JSON.stringify(REQUIRED_PYTHON_PACKAGES) +
      '; missing=[p for p in pkgs if importlib.util.find_spec(p) is None]; print(",".join(missing))';
    const res = spawnSync(pythonBin, ['-c', script], { encoding: 'utf-8', timeout: 5000 });
    if (res.status !== 0) return [...REQUIRED_PYTHON_PACKAGES];
    const out = (res.stdout ?? '').trim();
    return out ? out.split(',').filter(Boolean) : [];
  } catch {
    return [...REQUIRED_PYTHON_PACKAGES];
  }
}

class PythonSurrogateBridge {
  private child: ChildProcess | null = null;
  private bridgeUrl: string | null = null;
  private status: SurrogateStatusResponse = {
    mode: 'demo_fallback',
    connected: false,
    bridgeUrl: null,
    modelFileFound: false,
    predictPyFound: false,
    schemaFileFound: false,
    pythonBinary: null,
    missingFiles: ['ml/antenna_surrogate_ensemble.joblib', 'ml/predict.py'],
    missingPackages: [],
    modelPath: null,
    predictorClass: null,
    lastError: null,
    checkedAt: new Date().toISOString(),
  };

  private resolveLocalArtifacts() {
    const root = process.cwd();
    const envModel = process.env.ANTENNA_MODEL_PATH?.trim();
    const envPredictDir = process.env.ANTENNA_PREDICT_DIR?.trim();

    const modelPath = findExistingFile([
      ...(envModel ? [envModel] : []),
      path.join(root, 'ml', 'antenna_surrogate_ensemble.joblib'),
      path.join(root, 'antenna_surrogate_ensemble.joblib'),
    ]);

    const predictPath = findExistingFile([
      ...(envPredictDir ? [path.join(envPredictDir, 'predict.py')] : []),
      path.join(root, 'ml', 'predict.py'),
      path.join(root, 'predict.py'),
    ]);

    const schemaPath = findExistingFile([
      path.join(root, 'ml', 'antenna_feature_schema.json'),
      path.join(root, 'antenna_feature_schema.json'),
    ]);

    const missingFiles: string[] = [];
    if (!modelPath) missingFiles.push('ml/antenna_surrogate_ensemble.joblib');
    if (!predictPath) missingFiles.push('ml/predict.py');

    return { modelPath, predictPath, schemaPath, missingFiles };
  }

  private async pingHealth(url: string, timeoutMs = 1500): Promise<{
    ok: boolean;
    modelPath: string | null;
    predictorClass: string | null;
    error: string | null;
  } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        modelLoaded?: boolean;
        modelPath?: string | null;
        predictorClass?: string | null;
        error?: string | null;
      } | null;
      if (!data) return null;
      return {
        ok: Boolean(res.ok && data.ok && data.modelLoaded),
        modelPath: data.modelPath ?? null,
        predictorClass: data.predictorClass ?? null,
        error: data.error ?? null,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async spawnLocalBridge(pythonBin: string): Promise<string | null> {
    const scriptPath = path.join(process.cwd(), 'ml', 'bridge_server.py');
    if (!fs.existsSync(scriptPath)) return null;

    if (this.child && !this.child.killed) {
      this.child.kill();
      this.child = null;
    }

    const port = Number(process.env.PYTHON_SURROGATE_PORT || 5055);
    const url = `http://127.0.0.1:${port}`;

    this.child = spawn(pythonBin, [scriptPath, '--host', '127.0.0.1', '--port', String(port)], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child.on('exit', () => {
      this.child = null;
      if (this.bridgeUrl === url) {
        this.status.connected = false;
        this.status.mode = 'demo_fallback';
      }
    });

    const cleanup = () => {
      if (this.child && !this.child.killed) {
        this.child.kill();
      }
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    // Poll for startup (up to 18s to allow joblib + xgboost/sklearn model loading)
    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const health = await this.pingHealth(url, 800);
      if (health?.ok) {
        return url;
      }
    }
    return null;
  }

  public async initialize(): Promise<SurrogateStatusResponse> {
    return this.refreshStatus();
  }

  public async refreshStatus(): Promise<SurrogateStatusResponse> {
    const artifacts = this.resolveLocalArtifacts();
    const pythonBinary = detectPythonBinary();
    const missingPackages = pythonBinary ? checkPythonPackages(pythonBinary) : [...REQUIRED_PYTHON_PACKAGES];

    const envUrl = process.env.PYTHON_SURROGATE_URL?.trim();
    if (envUrl) {
      const health = await this.pingHealth(envUrl, 2000);
      if (health?.ok) {
        this.bridgeUrl = envUrl.replace(/\/$/, '');
        this.status = {
          mode: 'trained_joblib',
          connected: true,
          bridgeUrl: this.bridgeUrl,
          modelFileFound: true,
          predictPyFound: true,
          schemaFileFound: Boolean(artifacts.schemaPath),
          pythonBinary,
          missingFiles: [],
          missingPackages: [],
          modelPath: health.modelPath,
          predictorClass: health.predictorClass ?? 'AntennaSurrogatePredictor',
          lastError: null,
          checkedAt: new Date().toISOString(),
        };
        return this.status;
      }
    }

    // If local bridge is already running on default port
    const localPort = Number(process.env.PYTHON_SURROGATE_PORT || 5055);
    const localUrl = `http://127.0.0.1:${localPort}`;
    const existingHealth = await this.pingHealth(localUrl, 700);
    if (existingHealth?.ok) {
      this.bridgeUrl = localUrl;
      this.status = {
        mode: 'trained_joblib',
        connected: true,
        bridgeUrl: localUrl,
        modelFileFound: Boolean(artifacts.modelPath),
        predictPyFound: Boolean(artifacts.predictPath),
        schemaFileFound: Boolean(artifacts.schemaPath),
        pythonBinary,
        missingFiles: artifacts.missingFiles,
        missingPackages,
        modelPath: existingHealth.modelPath ?? artifacts.modelPath,
        predictorClass: existingHealth.predictorClass ?? 'AntennaSurrogatePredictor',
        lastError: null,
        checkedAt: new Date().toISOString(),
      };
      return this.status;
    }

    // Auto-spawn local Python bridge if artifacts + Python packages are present
    let lastError: string | null = null;
    if (artifacts.modelPath && artifacts.predictPath && pythonBinary && missingPackages.length === 0) {
      const spawnedUrl = await this.spawnLocalBridge(pythonBinary);
      if (spawnedUrl) {
        const health = await this.pingHealth(spawnedUrl, 1200);
        if (health?.ok) {
          this.bridgeUrl = spawnedUrl;
          this.status = {
            mode: 'trained_joblib',
            connected: true,
            bridgeUrl: spawnedUrl,
            modelFileFound: true,
            predictPyFound: true,
            schemaFileFound: Boolean(artifacts.schemaPath),
            pythonBinary,
            missingFiles: [],
            missingPackages: [],
            modelPath: health.modelPath ?? artifacts.modelPath,
            predictorClass: health.predictorClass ?? 'AntennaSurrogatePredictor',
            lastError: null,
            checkedAt: new Date().toISOString(),
          };
          return this.status;
        }
        lastError = health?.error ?? 'Python bridge process failed health check.';
      } else {
        lastError = 'Failed to start ml/bridge_server.py on local port.';
      }
    } else if (artifacts.missingFiles.length > 0) {
      lastError = `Missing trained model artifact(s): ${artifacts.missingFiles.join(', ')}. Using built-in Node.js demo surrogate fallback.`;
    } else if (!pythonBinary) {
      lastError = 'Python 3 executable not found in PATH. Using built-in Node.js demo surrogate fallback.';
    } else if (missingPackages.length > 0) {
      lastError = `Missing Python packages (${missingPackages.join(', ')}). Run: pip install -r ml/requirements.txt`;
    }

    this.bridgeUrl = null;
    this.status = {
      mode: 'demo_fallback',
      connected: false,
      bridgeUrl: null,
      modelFileFound: Boolean(artifacts.modelPath),
      predictPyFound: Boolean(artifacts.predictPath),
      schemaFileFound: Boolean(artifacts.schemaPath),
      pythonBinary,
      missingFiles: artifacts.missingFiles,
      missingPackages,
      modelPath: artifacts.modelPath,
      predictorClass: null,
      lastError,
      checkedAt: new Date().toISOString(),
    };
    return this.status;
  }

  public getStatus(): SurrogateStatusResponse {
    return this.status;
  }

  public isActive(): boolean {
    return this.status.connected && Boolean(this.bridgeUrl);
  }

  public async predict(
    params: AntennaDesignParams,
    model: MLModelType = 'ensemble',
  ): Promise<(PredictionOutput4 & { fidelity?: string | null }) | null> {
    if (!this.isActive() || !this.bridgeUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const design = mapDesignToPredictorInput(params);
      const res = await fetch(`${this.bridgeUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design, model }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        predictions?: PredictionOutput4;
        fidelity?: string | null;
      };
      const p = data.predictions;
      if (
        !p ||
        !Number.isFinite(p.gainDbi) ||
        !Number.isFinite(p.bandwidthMHz) ||
        !Number.isFinite(p.resonantFreqGHz) ||
        !Number.isFinite(p.efficiencyPct)
      ) {
        return null;
      }
      return { ...p, fidelity: data.fidelity ?? null };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  public async predictBatch(
    paramsList: AntennaDesignParams[],
    model: MLModelType = 'ensemble',
  ): Promise<PredictionOutput4[] | null> {
    if (!this.isActive() || !this.bridgeUrl || paramsList.length === 0) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const items = paramsList.map((p) => mapDesignToPredictorInput(p));
      const res = await fetch(`${this.bridgeUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, model }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { predictionsList?: PredictionOutput4[] };
      if (!Array.isArray(data.predictionsList) || data.predictionsList.length !== paramsList.length) {
        return null;
      }
      return data.predictionsList;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const pythonBridge = new PythonSurrogateBridge();
