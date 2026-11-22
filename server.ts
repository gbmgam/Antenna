import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import type {
  AntennaDesignParams,
  MLModelType,
  SubstrateMaterial,
} from './src/shared/antennaTypes.ts';
import {
  FEATURE_ORDER,
  OUTPUT_ORDER,
  validateAntennaDesign,
} from './src/shared/antennaSchema.ts';
import { SUBSTRATE_CATALOG, TOPOLOGY_LABELS } from './src/shared/rfPhysics.ts';
import { mlEngine } from './server/mlEngine.ts';
import { pythonBridge } from './server/pythonBridge.ts';
import { historyStore } from './server/store.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  await pythonBridge.initialize();

  app.use(express.json({ limit: '10mb' }));

  // Live Python .joblib surrogate bridge status & refresh
  app.get('/api/ml/status', (_req, res) => {
    res.json(pythonBridge.getStatus());
  });

  app.post('/api/ml/status/refresh', async (_req, res) => {
    const status = await pythonBridge.refreshStatus();
    res.json(status);
  });

  // Upload trained surrogate artifacts (.joblib, predict.py, schema json) into ml/
  const ALLOWED_ML_ARTIFACTS = new Set([
    'antenna_surrogate_ensemble.joblib',
    'predict.py',
    'antenna_feature_schema.json',
  ]);
  // Chunked upload for large trained surrogate weights (bypasses proxy 1MB/32MB HTTP 413 limits)
  app.post(
    '/api/ml/upload-chunk',
    express.raw({ type: 'application/octet-stream', limit: '2mb' }),
    async (req, res) => {
      try {
        const rawName = String(req.headers['x-artifact-filename'] ?? '').trim();
        const baseName = path.basename(rawName);
        if (!ALLOWED_ML_ARTIFACTS.has(baseName)) {
          res.status(400).json({
            error: `Unsupported filename "${baseName}". Allowed files: antenna_surrogate_ensemble.joblib, predict.py, antenna_feature_schema.json.`,
          });
          return;
        }
        const uploadId = String(req.headers['x-upload-id'] ?? '').trim();
        if (!/^[a-zA-Z0-9_-]{4,64}$/.test(uploadId)) {
          res.status(400).json({ error: 'Invalid upload session ID.' });
          return;
        }
        const chunkIndex = Number(req.headers['x-chunk-index']);
        const totalChunks = Number(req.headers['x-total-chunks']);
        if (
          !Number.isInteger(chunkIndex) ||
          !Number.isInteger(totalChunks) ||
          chunkIndex < 0 ||
          totalChunks <= 0 ||
          chunkIndex >= totalChunks
        ) {
          res.status(400).json({ error: 'Invalid chunk index or total chunks.' });
          return;
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: 'Empty chunk payload.' });
          return;
        }

        const mlDir = path.resolve(process.cwd(), 'ml');
        if (!fs.existsSync(mlDir)) {
          fs.mkdirSync(mlDir, { recursive: true });
        }
        const tmpPath = path.join(mlDir, `.tmp_${uploadId}_${baseName}`);
        if (chunkIndex === 0) {
          fs.writeFileSync(tmpPath, req.body);
        } else {
          fs.appendFileSync(tmpPath, req.body);
        }

        if (chunkIndex === totalChunks - 1) {
          const destPath = path.join(mlDir, baseName);
          const totalBytes = fs.statSync(tmpPath).size;
          fs.renameSync(tmpPath, destPath);
          const status = await pythonBridge.refreshStatus();
          res.json({ completed: true, saved: baseName, bytes: totalBytes, status });
          return;
        }

        res.json({ completed: false, chunkIndex, totalChunks });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Chunk upload failed',
        });
      }
    },
  );

  app.post(
    '/api/ml/upload-artifact',
    express.raw({ type: 'application/octet-stream', limit: '100mb' }),
    async (req, res) => {
      try {
        const rawName = String(req.headers['x-artifact-filename'] ?? req.query.filename ?? '').trim();
        const baseName = path.basename(rawName);
        if (!ALLOWED_ML_ARTIFACTS.has(baseName)) {
          res.status(400).json({
            error: `Unsupported filename "${baseName}". Allowed files: antenna_surrogate_ensemble.joblib, predict.py, antenna_feature_schema.json.`,
          });
          return;
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: 'Empty file upload.' });
          return;
        }
        const mlDir = path.resolve(process.cwd(), 'ml');
        if (!fs.existsSync(mlDir)) {
          fs.mkdirSync(mlDir, { recursive: true });
        }
        const destPath = path.join(mlDir, baseName);
        fs.writeFileSync(destPath, req.body);
        const status = await pythonBridge.refreshStatus();
        res.json({ saved: baseName, bytes: req.body.length, status });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to save ML artifact',
        });
      }
    },
  );

  // Model validation metrics, 5-fold CV report & 21-feature schema summary
  app.get('/api/ml/metrics', (_req, res) => {
    const surrogateStatus = pythonBridge.getStatus();
    res.json({
      featureOrder: FEATURE_ORDER,
      outputOrder: OUTPUT_ORDER,
      metrics: mlEngine.validationMetrics,
      crossValidationReport: mlEngine.crossValidationReport,
      surrogateStatus,
      isDemoEstimate: surrogateStatus.mode !== 'trained_joblib',
    });
  });

  // Predict antenna performance
  app.post('/api/ml/predict', async (req, res) => {
    try {
      const { params, model = 'ensemble', saveToHistory = false, historyType = 'prediction' } =
        req.body as {
          params: AntennaDesignParams;
          model?: MLModelType;
          saveToHistory?: boolean;
          historyType?: 'prediction' | 'evaluation' | 'assistant';
        };
      if (!params) {
        res.status(400).json({ error: 'Invalid antenna geometry parameters.' });
        return;
      }
      const fieldErrors = validateAntennaDesign(params);
      const errorKeys = Object.keys(fieldErrors);
      if (errorKeys.length > 0) {
        res.status(400).json({
          error: `Validation failed: ${fieldErrors[errorKeys[0] as keyof AntennaDesignParams]}`,
          fieldErrors,
        });
        return;
      }
      const prediction = await mlEngine.predictAsync(params, model);
      if (saveToHistory) {
        historyStore.add({
          type: historyType,
          designName: params.name || `${params.operatingFreqGHz} GHz Design`,
          params,
          prediction,
        });
      }
      res.json(prediction);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Prediction failed' });
    }
  });

  // Multi-frequency sweep across Wi-Fi / BLE / IoT / 5G bands
  app.post('/api/ml/multifreq', async (req, res) => {
    try {
      const { params, frequenciesGHz } = req.body as {
        params: AntennaDesignParams;
        frequenciesGHz: number[];
      };
      const freqs =
        Array.isArray(frequenciesGHz) && frequenciesGHz.length > 0
          ? frequenciesGHz
          : [0.868, 0.915, 2.45, 3.5, 5.8, 24.0, 28.0];
      const results = await mlEngine.evaluateMultiFreqAsync(params, freqs);
      const isDemoEstimate = !pythonBridge.isActive();
      const provenance = isDemoEstimate
        ? 'Demo analytical-estimate surrogate — not EM-validated data.'
        : 'Trained AntennaSurrogatePredictor (antenna_surrogate_ensemble.joblib)';
      res.json({ results, isDemoEstimate, provenance });
    } catch (err) {
      res.status(500).json({ error: 'Multi-frequency evaluation failed' });
    }
  });

  // Target-seeking design optimization against active ML surrogate (.joblib or fallback)
  app.post('/api/ml/optimize-target', async (req, res) => {
    try {
      const {
        params,
        model = 'ensemble',
        allowTopologyUpgrade = true,
        saveToHistory = true,
      } = req.body as {
        params: AntennaDesignParams;
        model?: MLModelType;
        allowTopologyUpgrade?: boolean;
        saveToHistory?: boolean;
      };
      if (!params) {
        res.status(400).json({ error: 'Missing antenna parameters for optimization.' });
        return;
      }
      const fieldErrors = validateAntennaDesign(params);
      const errorKeys = Object.keys(fieldErrors);
      if (errorKeys.length > 0) {
        res.status(400).json({
          error: `Validation failed: ${fieldErrors[errorKeys[0] as keyof AntennaDesignParams]}`,
          fieldErrors,
        });
        return;
      }
      const result = await mlEngine.optimizeForTargetAsync(params, model, allowTopologyUpgrade);
      if (saveToHistory) {
        historyStore.add({
          type: 'nsga2_optimization',
          designName: result.optimizedParams.name || `${params.operatingFreqGHz} GHz Optimized`,
          params: result.optimizedParams,
          prediction: result.prediction,
          notes: result.summaryMessage,
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Target optimization failed',
      });
    }
  });

  // Fault detection & auto-repair
  app.post('/api/diagnose', async (req, res) => {
    try {
      const { params } = req.body as { params: AntennaDesignParams };
      if (!params) {
        res.status(400).json({ error: 'Missing antenna parameters' });
        return;
      }
      const analysis = await mlEngine.diagnoseFaultsAsync(params);
      res.json(analysis);
    } catch (err) {
      res.status(500).json({ error: 'Fault diagnosis failed' });
    }
  });


  // Multi-Objective NSGA-II Optimization
  app.post('/api/optimize/nsga2', async (req, res) => {
    try {
      const { targetFreqGHz = 2.45, substrateMaterial = 'Rogers_RO4003C' } = req.body as {
        targetFreqGHz: number;
        substrateMaterial: SubstrateMaterial;
      };
      const result = await mlEngine.runNSGA2Async(targetFreqGHz, substrateMaterial);
      if (result.recommended) {
        historyStore.add({
          type: 'nsga2_optimization',
          designName: result.recommended.params.name,
          params: result.recommended.params,
          prediction: result.recommended.prediction,
          notes: `NSGA-II knee-point selection (${result.paretoFront.length} Pareto solutions)`,
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'NSGA-II optimization failed' });
    }
  });

  // Natural Language Engineering Assistant
  app.post('/api/assistant/parse', async (req, res) => {
    try {
      const { prompt } = req.body as { prompt: string };
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Prompt string required' });
        return;
      }
      const response = await mlEngine.parseNaturalLanguageDesignAsync(prompt);
      historyStore.add({
        type: 'assistant',
        designName: response.generatedParams.name,
        params: response.generatedParams,
        prediction: response.prediction,
        notes: `NL Prompt: "${prompt.slice(0, 90)}"`,
      });
      res.json(response);
    } catch (err) {
      res.status(500).json({ error: 'Assistant synthesis failed' });
    }
  });

  // History CRUD
  app.get('/api/history', (_req, res) => {
    res.json({ records: historyStore.list() });
  });

  app.post('/api/history', (req, res) => {
    const { type = 'prediction', designName, params, prediction, notes } = req.body;
    const saved = historyStore.add({ type, designName, params, prediction, notes });
    res.json({ record: saved });
  });

  app.delete('/api/history/:id', (req, res) => {
    const removed = historyStore.remove(req.params.id);
    res.json({ removed });
  });

  // External EM Solver Interface (CST / HFSS / openEMS integration bridge)
  app.post('/api/solver/export-script', (req, res) => {
    const { params, solver = 'openems' } = req.body as {
      params: AntennaDesignParams;
      solver: 'openems' | 'hfss' | 'cst';
    };
    const sub = SUBSTRATE_CATALOG[params.substrateMaterial];
    const exportL =
      params.topology === 'circular_patch'
        ? Number((params.patchRadiusMm * 2).toFixed(2))
        : params.patchLengthMm;
    const exportW =
      params.topology === 'circular_patch'
        ? Number((params.patchRadiusMm * 2).toFixed(2))
        : params.patchWidthMm;

    if (solver === 'openems') {
      const script = `# ANTENNA AI — openEMS FDTD Simulation Bridge Script
# Note: Execute in an environment with openEMS + CSXCAD Python bindings installed.
import os
import numpy as np
from CSXCAD import ContinuousStructure
from openEMS import openEMS

f0 = ${params.operatingFreqGHz}e9
fc = ${Math.max(0.2, params.operatingFreqGHz * 0.4).toFixed(3)}e9
patch_L = ${exportL}
patch_W = ${exportW}
patch_R = ${params.patchRadiusMm}
sub_h = ${params.substrateHeightMm}
sub_er = ${params.dielectricConstant}
sub_tand = ${params.lossTangent}
feed_x = ${params.feedXMm}

FDTD = openEMS(NrTS=30000, EndCriteria=1e-4)
FDTD.SetGaussExcite(f0, fc)
FDTD.SetBoundaryCond(['MUR', 'MUR', 'MUR', 'MUR', 'MUR', 'PML_8'])

CSX = ContinuousStructure()
FDTD.SetCSX(CSX)
mesh = CSX.GetGrid()
mesh.SetDeltaUnit(1e-3)

substrate = CSX.AddMaterial('${params.substrateMaterial}', epsilon=sub_er, kappa=2*np.pi*f0*8.854e-12*sub_er*sub_tand)
substrate.AddBox([-patch_L, -patch_W, 0], [patch_L, patch_W, sub_h])

patch = CSX.AddMetal('${params.conductorMaterial}_Patch')
${
  params.topology === 'circular_patch'
    ? `patch.AddCylinder([0, 0, sub_h], [0, 0, sub_h + 0.035], patch_R)`
    : `patch.AddBox([-patch_L/2, -patch_W/2, sub_h], [patch_L/2, patch_W/2, sub_h])`
}

gnd = CSX.AddMetal('GroundPlane')
gnd.AddBox([-patch_L, -patch_W, 0], [patch_L, patch_W, 0])

port = FDTD.AddLumpedPort(1, 50, [feed_x - patch_L/2, ${params.feedYMm}, 0], [feed_x - patch_L/2, ${params.feedYMm}, sub_h], 'z', excite=1.0)
print("openEMS geometry ready for ${TOPOLOGY_LABELS[params.topology]} (${sub.name})")
`;
      res.json({ filename: `antenna_ai_openems_${params.operatingFreqGHz}ghz.py`, content: script });
      return;
    }

    if (solver === 'hfss') {
      const script = `' ANTENNA AI — Ansys HFSS VBScript Macro Bridge
' Run inside Ansys Electronics Desktop -> Tools -> Run Script
Dim oAnsoftApp, oDesktop, oProject, oDesign, oEditor
Set oAnsoftApp = CreateObject("AnsoftHfss.HfssScriptInterface")
Set oDesktop = oAnsoftApp.GetAppDesktop()
Set oProject = oDesktop.NewProject()
oProject.InsertDesign "HFSS", "ANTENNA_AI_${params.topology}", "DrivenModal", ""
Set oDesign = oProject.SetActiveDesign("ANTENNA_AI_${params.topology}")
Set oEditor = oDesign.SetActiveEditor("3D Modeler")

' Create Substrate (${sub.name}, er=${params.dielectricConstant}, tanD=${params.lossTangent})
oEditor.CreateBox Array("NAME:BoxParameters", "XPosition:=", "-${exportL}mm", "YPosition:=", "-${exportW}mm", "ZPosition:=", "0mm", "XSize:=", "${(exportL * 2).toFixed(2)}mm", "YSize:=", "${(exportW * 2).toFixed(2)}mm", "ZSize:=", "${params.substrateHeightMm}mm"), Array("NAME:Attributes", "Name:=", "Substrate", "MaterialValue:=", Chr(34) & "${params.substrateMaterial}" & Chr(34))
' Create Radiating Patch
oEditor.CreateRectangle Array("NAME:RectangleParameters", "IsCovered:=", true, "XStart:=", "-${(exportL / 2).toFixed(2)}mm", "YStart:=", "-${(exportW / 2).toFixed(2)}mm", "ZStart:=", "${params.substrateHeightMm}mm", "Width:=", "${exportL}mm", "Height:=", "${exportW}mm", "WhichAxis:=", "Z"), Array("NAME:Attributes", "Name:=", "CopperPatch")
`;
      res.json({ filename: `antenna_ai_hfss_${params.operatingFreqGHz}ghz.vbs`, content: script });
      return;
    }

    const cstScript = `' ANTENNA AI — CST Studio Suite VBA Macro Bridge
Option Explicit
Sub Main
  With Units
    .Geometry "mm"
    .Frequency "GHz"
  End With
  Solver.FrequencyRange "${(params.operatingFreqGHz * 0.7).toFixed(2)}", "${(params.operatingFreqGHz * 1.3).toFixed(2)}"
  ' Substrate: ${sub.name} (er=${params.dielectricConstant})
  With Brick
    .Reset
    .Name "Substrate"
    .Component "Antenna_AI"
    .Material "${params.substrateMaterial}"
    .Xrange "-${exportL}", "${exportL}"
    .Yrange "-${exportW}", "${exportW}"
    .Zrange "0", "${params.substrateHeightMm}"
    .Create
  End With
End Sub
`;
    res.json({ filename: `antenna_ai_cst_${params.operatingFreqGHz}ghz.bas`, content: cstScript });
  });

  // Vite Dev Middleware or Static Production Serve
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));
  if (isProd) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ANTENNA AI server listening on http://localhost:${PORT}`);
  });
}

startServer();
