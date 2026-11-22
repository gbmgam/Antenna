import React, { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  BookmarkPlus,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  RefreshCw,
  RotateCcw,
  Server,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import type {
  AntennaDesignParams,
  AntennaTopology,
  ConductorMaterial,
  MLModelType,
  PredictionResult,
  SubstrateMaterial,
  SurrogateStatusResponse,
} from '../shared/antennaTypes.ts';
import {
  ARRAY_LAYOUT_CODES,
  FEED_TYPE_CODES,
  PORT_CONFIGURATION_CODES,
  TOPOLOGY_CANONICAL_NAMES,
  buildFeatureRecord21,
  validateAntennaDesign,
} from '../shared/antennaSchema.ts';
import {
  CONDUCTOR_CATALOG,
  SUBSTRATE_CATALOG,
  TOPOLOGY_LABELS,
  createDefaultDesign,
  hasAchievedTenDbBandwidth,
  switchDesignTopology,
  synthesizeCircularFeedMm,
  synthesizeCircularRadiusMm,
  synthesizePatchGeometry,
} from '../shared/rfPhysics.ts';
import {
  fetchSurrogateStatus,
  optimizeDesignForTarget,
  refreshSurrogateStatus,
  uploadSurrogateArtifact,
} from '../utils/apiClient.ts';
import { downloadAntennaCSV, downloadAntennaPDF } from '../utils/reportGenerator.ts';
import { AntennaViewport3D } from '../components/AntennaViewport3D.tsx';
import { CrossValidationReportPanel } from '../components/CrossValidationReportPanel.tsx';

interface DesignStudioPageProps {
  design: AntennaDesignParams;
  prediction: PredictionResult | null;
  loading: boolean;
  error: string | null;
  selectedModel: MLModelType;
  onModelChange: (model: MLModelType) => void;
  onUpdateDesign: (next: AntennaDesignParams) => void;
  onRunPredict: (params: AntennaDesignParams, saveToHistory?: boolean) => Promise<void>;
  onApplyOptimized?: (params: AntennaDesignParams, prediction: PredictionResult) => void;
}

export const DesignStudioPage: React.FC<DesignStudioPageProps> = ({
  design,
  prediction,
  loading,
  error,
  selectedModel,
  onModelChange,
  onUpdateDesign,
  onRunPredict,
  onApplyOptimized,
}) => {
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [allowTopologyUpgrade, setAllowTopologyUpgrade] = useState(true);
  const [optError, setOptError] = useState<string | null>(null);
  const [showCvModal, setShowCvModal] = useState(false);
  const [showBridgeModal, setShowBridgeModal] = useState(false);
  const [surrogateStatus, setSurrogateStatus] = useState<SurrogateStatusResponse | null>(null);
  const [refreshingBridge, setRefreshingBridge] = useState(false);
  const [uploadingArtifacts, setUploadingArtifacts] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    filename: string;
    pct: number;
    uploadedMb: string;
    totalMb: string;
  } | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchSurrogateStatus()
      .then((st) => {
        if (active) setSurrogateStatus(st);
      })
      .catch(() => {
        // Non-blocking
      });
    return () => {
      active = false;
    };
  }, []);

  const handleRefreshBridge = async () => {
    setRefreshingBridge(true);
    try {
      const st = await refreshSurrogateStatus();
      setSurrogateStatus(st);
      if (st.mode === 'trained_joblib') {
        await onRunPredict(design, false);
      }
    } finally {
      setRefreshingBridge(false);
    }
  };

  const handleArtifactUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingArtifacts(true);
    setUploadError(null);
    setUploadMessage(null);
    setUploadProgress(null);
    try {
      const savedNames: string[] = [];
      let latestStatus: SurrogateStatusResponse | null = null;
      for (const file of Array.from(files)) {
        const res = await uploadSurrogateArtifact(file, (pct, uploadedBytes, totalBytes) => {
          setUploadProgress({
            filename: file.name,
            pct,
            uploadedMb: (uploadedBytes / (1024 * 1024)).toFixed(1),
            totalMb: (totalBytes / (1024 * 1024)).toFixed(1),
          });
        });
        savedNames.push(res.saved);
        latestStatus = res.status;
      }
      if (latestStatus) {
        setSurrogateStatus(latestStatus);
      }
      setUploadMessage(
        `Uploaded ${savedNames.join(', ')}${
          latestStatus?.mode === 'trained_joblib'
            ? ' — Trained .joblib surrogate is now LIVE!'
            : ' — waiting for remaining file(s).'
        }`,
      );
      if (latestStatus?.mode === 'trained_joblib') {
        await onRunPredict(design, false);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Artifact upload failed');
    } finally {
      setUploadingArtifacts(false);
      setUploadProgress(null);
    }
  };

  const fieldErrors = useMemo(() => validateAntennaDesign(design), [design]);
  const hasErrors = Object.keys(fieldErrors).length > 0;
  const featureRecord21 = useMemo(() => buildFeatureRecord21(design), [design]);
  const tenDbAchieved = useMemo(() => hasAchievedTenDbBandwidth(prediction), [prediction]);

  const handleTopologyChange = (nextTopology: AntennaTopology) => {
    const transitioned = switchDesignTopology(design, nextTopology);
    onUpdateDesign(transitioned);
  };

  const handleField = <K extends keyof AntennaDesignParams>(
    key: K,
    val: AntennaDesignParams[K],
  ) => {
    if (key === 'topology') {
      handleTopologyChange(val as AntennaTopology);
      return;
    }
    const next = { ...design, [key]: val };
    if (key === 'substrateMaterial') {
      const sub = SUBSTRATE_CATALOG[val as SubstrateMaterial];
      next.dielectricConstant = sub.dielectricConstant;
      next.lossTangent = sub.lossTangent;
    }
    onUpdateDesign(next);
  };

  const parseNumInput = (raw: string, fallback = 0): number => {
    if (raw.trim() === '') return NaN;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const handleGenerateAntenna = async () => {
    const synth = synthesizePatchGeometry(
      design.operatingFreqGHz,
      design.dielectricConstant,
      design.substrateHeightMm,
    );
    const isCircular = design.topology === 'circular_patch';
    const circR = synthesizeCircularRadiusMm(
      design.operatingFreqGHz,
      design.dielectricConstant,
      design.substrateHeightMm,
    );
    const next: AntennaDesignParams = {
      ...design,
      name: `${design.operatingFreqGHz.toFixed(2)} GHz ${TOPOLOGY_LABELS[design.topology]}`,
      patchLengthMm: isCircular ? 0 : Number(synth.lengthMm.toFixed(2)),
      patchWidthMm: isCircular ? 0 : Number(synth.widthMm.toFixed(2)),
      patchRadiusMm: isCircular ? circR : 0,
      feedXMm: isCircular
        ? synthesizeCircularFeedMm(circR, design.dielectricConstant)
        : Number(synth.optimalFeedXMm.toFixed(2)),
      feedYMm: 0,
      insetDepthMm:
        design.topology === 'microstrip_patch'
          ? Number(synth.optimalFeedXMm.toFixed(2))
          : 0,
      notchWidthMm:
        design.topology === 'microstrip_patch'
          ? Number(Math.max(0.6, synth.widthMm * 0.08).toFixed(2))
          : 0,
    };
    onUpdateDesign(next);
    await onRunPredict(next, false);
  };

  const handleOptimizeDesign = async () => {
    setOptimizing(true);
    setOptError(null);
    setSavedNotice(null);
    try {
      const result = await optimizeDesignForTarget(
        design,
        selectedModel,
        allowTopologyUpgrade,
        true,
      );
      if (onApplyOptimized) {
        onApplyOptimized(result.optimizedParams, result.prediction);
      } else {
        onUpdateDesign(result.optimizedParams);
      }
      setSavedNotice(
        `${result.summaryMessage} (Evaluated ${result.evaluatedCount} candidates via active ML engine.)`,
      );
    } catch (err) {
      setOptError(err instanceof Error ? err.message : 'Optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  const handleReset = async () => {
    const def = createDefaultDesign(2.45, 'microstrip_patch', 'Rogers_RO4003C');
    onUpdateDesign(def);
    await onRunPredict(def, false);
  };

  const handleSaveHistory = async () => {
    if (hasErrors) return;
    await onRunPredict(design, true);
    setSavedNotice('Design snapshot saved to prediction history.');
    setTimeout(() => setSavedNotice(null), 3000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-sky-400/15 pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs tracking-wider text-cyan-400">
            MODULE 03 · AI DESIGN STUDIO
          </p>
          <h1 className="section-heading-italic text-3xl text-white">
            Parametric 2D/3D Antenna & ML Surrogate Workspace
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBridgeModal(true)}
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-[11px] font-medium whitespace-nowrap transition-colors ${
              surrogateStatus?.mode === 'trained_joblib'
                ? 'border-emerald-400/45 bg-emerald-950/35 text-emerald-200 hover:border-emerald-300'
                : 'border-amber-400/35 bg-amber-950/30 text-amber-200 hover:border-amber-300'
            }`}
          >
            <Server className="h-3.5 w-3.5" />
            <span>
              {surrogateStatus?.mode === 'trained_joblib'
                ? 'Trained ML (.joblib Active)'
                : 'Demo estimate — Fallback'}
            </span>
          </button>
          <select
            aria-label="ML Surrogate Model"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value as MLModelType)}
            className="rounded-lg border border-sky-400/25 bg-[#0b1633] px-3 py-2 text-xs font-medium text-slate-100 outline-none focus:border-cyan-400"
          >
            <option value="ensemble">Model: Best-Per-Output (CV Auto)</option>
            <option value="xgboost">Model: XGBoost GBDT</option>
            <option value="random_forest">Model: Random Forest</option>
            <option value="mlp">Model: Neural MLP (21→4)</option>
          </select>

          <button
            type="button"
            onClick={() => setShowCvModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-[#0b1633] px-3 py-2 text-xs font-semibold text-cyan-200 hover:border-cyan-400 whitespace-nowrap"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>5-Fold CV Report</span>
          </button>

          <button
            type="button"
            disabled={hasErrors || loading}
            onClick={handleSaveHistory}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-[#0b1633] px-3 py-2 text-xs font-semibold text-sky-200 hover:border-cyan-400 disabled:opacity-50 whitespace-nowrap"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            <span>Save Snapshot</span>
          </button>
        </div>
      </div>

      {showBridgeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020612]/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-xl rounded-xl border border-sky-400/30 bg-[#060d20] p-5 text-xs text-slate-200 shadow-2xl">
            <button
              type="button"
              aria-label="Close surrogate bridge status"
              onClick={() => setShowBridgeModal(false)}
              className="absolute right-4 top-4 rounded-lg border border-sky-400/25 bg-[#0b1633] p-1.5 text-slate-300 hover:border-cyan-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 font-mono text-xs text-cyan-400">
              {surrogateStatus?.mode === 'trained_joblib' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <Server className="h-4 w-4" />
              )}
              <span>TRAINED SURROGATE (.JOBLIB) BRIDGE STATUS</span>
            </div>
            <h3 className="mt-1 font-display text-lg font-bold italic text-white">
              {surrogateStatus?.mode === 'trained_joblib'
                ? 'Connected to AntennaSurrogatePredictor'
                : 'Using Built-in Demo Fallback Surrogate'}
            </h3>

            <div className="mt-4 space-y-2 rounded-lg border border-sky-400/20 bg-[#040814] p-3.5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Active Inference Mode</span>
                <span
                  className={
                    surrogateStatus?.mode === 'trained_joblib'
                      ? 'text-emerald-300'
                      : 'text-amber-300'
                  }
                >
                  {surrogateStatus?.mode ?? 'checking...'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">antenna_surrogate_ensemble.joblib</span>
                <span className={surrogateStatus?.modelFileFound ? 'text-emerald-300' : 'text-rose-300'}>
                  {surrogateStatus?.modelFileFound ? 'Found' : 'Not in workspace'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">predict.py (AntennaSurrogatePredictor)</span>
                <span className={surrogateStatus?.predictPyFound ? 'text-emerald-300' : 'text-rose-300'}>
                  {surrogateStatus?.predictPyFound ? 'Found' : 'Not in workspace'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">antenna_feature_schema.json</span>
                <span className={surrogateStatus?.schemaFileFound ? 'text-emerald-300' : 'text-amber-300'}>
                  {surrogateStatus?.schemaFileFound ? 'Found' : 'Optional'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Python 3 & ML Packages</span>
                <span
                  className={
                    surrogateStatus?.pythonBinary && surrogateStatus.missingPackages.length === 0
                      ? 'text-emerald-300'
                      : 'text-amber-300'
                  }
                >
                  {!surrogateStatus?.pythonBinary
                    ? 'Python missing'
                    : surrogateStatus.missingPackages.length === 0
                      ? `${surrogateStatus.pythonBinary} (Ready)`
                      : `Missing: ${surrogateStatus.missingPackages.join(', ')}`}
                </span>
              </div>
              {surrogateStatus?.bridgeUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Bridge Endpoint</span>
                  <span className="text-cyan-300">{surrogateStatus.bridgeUrl}</span>
                </div>
              )}
            </div>

            {surrogateStatus?.lastError && (
              <div className="mt-3 rounded-lg border border-amber-400/35 bg-amber-950/30 p-3 text-[11px] text-amber-200">
                {surrogateStatus.lastError}
              </div>
            )}

            <div className="mt-3 rounded-lg border border-sky-400/25 bg-[#0b1633]/80 p-3.5 text-[11px] text-slate-300 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-white">
                  {surrogateStatus?.predictPyFound && !surrogateStatus?.modelFileFound
                    ? 'Upload Your Trained .joblib Weights'
                    : 'Upload Your Trained Model Files Directly'}
                </div>
                <span className="font-mono text-[10px] text-cyan-300">
                  → ml/
                </span>
              </div>
              <p className="text-slate-300">
                {surrogateStatus?.predictPyFound && !surrogateStatus?.modelFileFound ? (
                  <>
                    <code className="text-emerald-300">predict.py</code> and{' '}
                    <code className="text-emerald-300">antenna_feature_schema.json</code> are already installed. Select{' '}
                    <code className="text-cyan-300">antenna_surrogate_ensemble.joblib</code> from your computer to activate live inference immediately.
                  </>
                ) : (
                  <>
                    Select <code className="text-cyan-300">antenna_surrogate_ensemble.joblib</code> and{' '}
                    <code className="text-cyan-300">predict.py</code> (and optionally{' '}
                    <code className="text-cyan-300">antenna_feature_schema.json</code>) to activate live inference immediately.
                  </>
                )}
              </p>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-cyan-400/45 bg-[#040814] px-3 py-3 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-300 hover:bg-cyan-950/20">
                <Upload className="h-4 w-4 shrink-0 text-cyan-400" />
                <span>
                  {uploadingArtifacts
                    ? uploadProgress
                      ? `Uploading ${uploadProgress.filename} (${uploadProgress.pct}% · ${uploadProgress.uploadedMb}/${uploadProgress.totalMb} MB)...`
                      : 'Starting Python bridge...'
                    : surrogateStatus?.predictPyFound && !surrogateStatus?.modelFileFound
                      ? 'Choose antenna_surrogate_ensemble.joblib'
                      : 'Choose .joblib / predict.py / schema.json'}
                </span>
                <input
                  type="file"
                  multiple
                  accept=".joblib,.py,.json"
                  disabled={uploadingArtifacts}
                  onChange={(e) => {
                    handleArtifactUpload(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
              {uploadProgress && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-cyan-400 transition-all duration-150"
                      style={{ width: `${uploadProgress.pct}%` }}
                    />
                  </div>
                </div>
              )}
              {uploadMessage && (
                <div className="rounded border border-emerald-400/40 bg-emerald-950/35 px-2.5 py-1.5 text-[11px] text-emerald-200">
                  {uploadMessage}
                </div>
              )}
              {uploadError && (
                <div className="rounded border border-rose-400/40 bg-rose-950/35 px-2.5 py-1.5 text-[11px] text-rose-200">
                  {uploadError}
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={refreshingBridge || uploadingArtifacts}
                onClick={handleRefreshBridge}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingBridge ? 'animate-spin' : ''}`} />
                <span>{refreshingBridge ? 'Checking...' : 'Re-check Bridge'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showCvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020612]/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-sky-400/30 bg-[#040814] p-2">
            <button
              type="button"
              aria-label="Close cross-validation report"
              onClick={() => setShowCvModal(false)}
              className="absolute right-4 top-4 z-10 rounded-lg border border-sky-400/25 bg-[#0b1633] p-1.5 text-slate-300 hover:border-cyan-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            <CrossValidationReportPanel />
          </div>
        </div>
      )}

      {(error || optError) && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/40 px-4 py-2.5 text-xs text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{optError || error}</span>
        </div>
      )}
      {savedNotice && (
        <div className="rounded-lg border border-cyan-400/40 bg-cyan-950/40 px-4 py-2.5 text-xs text-cyan-200">
          {savedNotice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left Parameter Console */}
        <div className="glass-panel space-y-4 rounded-xl p-5 xl:col-span-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Design Name</label>
              <input
                type="text"
                value={design.name}
                onChange={(e) => handleField('name', e.target.value)}
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <label htmlFor="studio-topology-select" className="font-medium text-slate-300">
                  Antenna Topology
                </label>
                <span className="font-mono text-[11px] text-cyan-300">
                  code={featureRecord21.topologyCode} · {TOPOLOGY_CANONICAL_NAMES[design.topology]}
                </span>
              </div>
              <select
                id="studio-topology-select"
                value={design.topology}
                onChange={(e) => handleTopologyChange(e.target.value as AntennaTopology)}
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
              >
                {Object.entries(TOPOLOGY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Common RF & Stackup Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Operating Freq (GHz)
              </label>
              <input
                type="number"
                step={0.05}
                min={0.3}
                max={60}
                value={Number.isNaN(design.operatingFreqGHz) ? '' : design.operatingFreqGHz}
                onChange={(e) => handleField('operatingFreqGHz', parseNumInput(e.target.value))}
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-sm tabular-nums text-white outline-none focus:border-cyan-400"
              />
              {fieldErrors.operatingFreqGHz && (
                <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.operatingFreqGHz}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Substrate Height h (mm)
              </label>
              <input
                type="number"
                step={0.05}
                min={0.15}
                max={12}
                value={Number.isNaN(design.substrateHeightMm) ? '' : design.substrateHeightMm}
                onChange={(e) => handleField('substrateHeightMm', parseNumInput(e.target.value))}
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-sm tabular-nums text-white outline-none focus:border-cyan-400"
              />
              {fieldErrors.substrateHeightMm && (
                <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.substrateHeightMm}</p>
              )}
            </div>
          </div>

          {/* Geometry: Rectangular/Array L & W vs Circular Disk Radius */}
          <div className="space-y-3 border-t border-sky-400/15 pt-3">
            {design.topology === 'circular_patch' ? (
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Circular Patch Radius (mm)</span>
                  <span className="font-mono tabular-nums text-cyan-300">
                    {Number.isFinite(design.patchRadiusMm) ? design.patchRadiusMm : '--'} mm
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="range"
                    min={1.5}
                    max={95}
                    step={0.1}
                    value={Number.isFinite(design.patchRadiusMm) ? design.patchRadiusMm : 10}
                    onChange={(e) => handleField('patchRadiusMm', parseFloat(e.target.value))}
                    className="h-1.5 flex-1 accent-cyan-400"
                  />
                  <input
                    aria-label="Patch Radius (mm)"
                    type="number"
                    step={0.1}
                    value={Number.isNaN(design.patchRadiusMm) ? '' : design.patchRadiusMm}
                    onChange={(e) => handleField('patchRadiusMm', parseNumInput(e.target.value))}
                    className="w-20 rounded border border-sky-400/25 bg-[#040814] px-2 py-1 font-mono text-xs text-white"
                  />
                </div>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  Circular mode encodes patchLengthMm = 0, patchWidthMm = 0 in ML vector.
                </p>
                {fieldErrors.patchRadiusMm && (
                  <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.patchRadiusMm}</p>
                )}
              </div>
            ) : (
              <>
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Patch Length L (mm)</span>
                    <span className="font-mono tabular-nums text-cyan-300">
                      {Number.isFinite(design.patchLengthMm) ? design.patchLengthMm : '--'} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={140}
                    step={0.2}
                    value={Number.isFinite(design.patchLengthMm) ? design.patchLengthMm : 28}
                    onChange={(e) => handleField('patchLengthMm', parseFloat(e.target.value))}
                    className="mt-1 h-1.5 w-full accent-cyan-400"
                  />
                  {fieldErrors.patchLengthMm && (
                    <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.patchLengthMm}</p>
                  )}
                </div>

                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Patch Width W (mm)</span>
                    <span className="font-mono tabular-nums text-cyan-300">
                      {Number.isFinite(design.patchWidthMm) ? design.patchWidthMm : '--'} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={160}
                    step={0.2}
                    value={Number.isFinite(design.patchWidthMm) ? design.patchWidthMm : 36}
                    onChange={(e) => handleField('patchWidthMm', parseFloat(e.target.value))}
                    className="mt-1 h-1.5 w-full accent-cyan-400"
                  />
                  {fieldErrors.patchWidthMm && (
                    <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.patchWidthMm}</p>
                  )}
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Feed X (mm)</span>
                  <span className="font-mono tabular-nums text-cyan-300">{design.feedXMm} mm</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={
                    design.topology === 'circular_patch'
                      ? Math.max(2, (design.patchRadiusMm || 15) * 0.9)
                      : Math.max(5, (design.patchLengthMm || 28) * 0.48)
                  }
                  step={0.1}
                  value={Number.isFinite(design.feedXMm) ? design.feedXMm : 5}
                  onChange={(e) => handleField('feedXMm', parseFloat(e.target.value))}
                  className="mt-1 h-1.5 w-full accent-cyan-400"
                />
                {fieldErrors.feedXMm && (
                  <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.feedXMm}</p>
                )}
              </div>
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Feed Y (mm)</span>
                  <span className="font-mono tabular-nums text-cyan-300">{design.feedYMm} mm</span>
                </div>
                <input
                  type="range"
                  min={
                    design.topology === 'circular_patch'
                      ? -Math.max(1, Math.round((design.patchRadiusMm || 15) * 0.7))
                      : -Math.max(1, Math.round((design.patchWidthMm || 30) * 0.35))
                  }
                  max={
                    design.topology === 'circular_patch'
                      ? Math.max(1, Math.round((design.patchRadiusMm || 15) * 0.7))
                      : Math.max(1, Math.round((design.patchWidthMm || 30) * 0.35))
                  }
                  step={0.1}
                  value={Number.isFinite(design.feedYMm) ? design.feedYMm : 0}
                  onChange={(e) => handleField('feedYMm', parseFloat(e.target.value))}
                  className="mt-1 h-1.5 w-full accent-cyan-400"
                />
                {fieldErrors.feedYMm && (
                  <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.feedYMm}</p>
                )}
              </div>
            </div>
          </div>

          {/* Conditional Topology-Specific Parameters */}
          {design.topology !== 'circular_patch' && (
            <div className="space-y-3 border-t border-cyan-400/20 pt-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider text-cyan-300">
                  Topology-Specific Parameters
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  Inactive fields = 0
                </span>
              </div>

              {design.topology === 'microstrip_patch' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Inset Depth (mm)
                    </label>
                    <input
                      type="number"
                      step={0.1}
                      value={Number.isNaN(design.insetDepthMm) ? '' : design.insetDepthMm}
                      onChange={(e) => handleField('insetDepthMm', parseNumInput(e.target.value))}
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 font-mono text-xs tabular-nums text-white"
                    />
                    {fieldErrors.insetDepthMm && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.insetDepthMm}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Notch Width (mm)
                    </label>
                    <input
                      type="number"
                      step={0.1}
                      value={Number.isNaN(design.notchWidthMm) ? '' : design.notchWidthMm}
                      onChange={(e) => handleField('notchWidthMm', parseNumInput(e.target.value))}
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 font-mono text-xs tabular-nums text-white"
                    />
                    {fieldErrors.notchWidthMm && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.notchWidthMm}</p>
                    )}
                  </div>
                </div>
              )}

              {design.topology === 'rectangular_patch' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Probe Diameter (mm)
                    </label>
                    <input
                      type="number"
                      step={0.05}
                      value={Number.isNaN(design.probeDiameterMm) ? '' : design.probeDiameterMm}
                      onChange={(e) => handleField('probeDiameterMm', parseNumInput(e.target.value))}
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 font-mono text-xs tabular-nums text-white"
                    />
                    {fieldErrors.probeDiameterMm && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.probeDiameterMm}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Feed Type
                    </label>
                    <select
                      value={design.feedTypeCode}
                      onChange={(e) => handleField('feedTypeCode', Number(e.target.value))}
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value={FEED_TYPE_CODES.Coaxial_Probe}>Coaxial Probe (2)</option>
                      <option value={FEED_TYPE_CODES.Microstrip_Inset}>Microstrip Inset (1)</option>
                    </select>
                    {fieldErrors.feedTypeCode && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.feedTypeCode}</p>
                    )}
                  </div>
                </div>
              )}

              {design.topology === 'array_2x2' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Element Spacing X (mm)
                      </label>
                      <input
                        type="number"
                        step={0.5}
                        value={Number.isNaN(design.elementSpacingXmm) ? '' : design.elementSpacingXmm}
                        onChange={(e) => handleField('elementSpacingXmm', parseNumInput(e.target.value))}
                        className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 font-mono text-xs tabular-nums text-white"
                      />
                      {fieldErrors.elementSpacingXmm && (
                        <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.elementSpacingXmm}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Element Spacing Y (mm)
                      </label>
                      <input
                        type="number"
                        step={0.5}
                        value={Number.isNaN(design.elementSpacingYmm) ? '' : design.elementSpacingYmm}
                        onChange={(e) => handleField('elementSpacingYmm', parseNumInput(e.target.value))}
                        className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 font-mono text-xs tabular-nums text-white"
                      />
                      {fieldErrors.elementSpacingYmm && (
                        <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.elementSpacingYmm}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Phase Shift X (deg)
                      </label>
                      <input
                        type="number"
                        step={5}
                        min={-180}
                        max={180}
                        value={Number.isNaN(design.phaseXDeg) ? '' : design.phaseXDeg}
                        onChange={(e) => handleField('phaseXDeg', parseNumInput(e.target.value))}
                        className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 font-mono text-xs tabular-nums text-white"
                      />
                      {fieldErrors.phaseXDeg && (
                        <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.phaseXDeg}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Phase Shift Y (deg)
                      </label>
                      <input
                        type="number"
                        step={5}
                        min={-180}
                        max={180}
                        value={Number.isNaN(design.phaseYDeg) ? '' : design.phaseYDeg}
                        onChange={(e) => handleField('phaseYDeg', parseNumInput(e.target.value))}
                        className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 font-mono text-xs tabular-nums text-white"
                      />
                      {fieldErrors.phaseYDeg && (
                        <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.phaseYDeg}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Array Layout
                    </label>
                    <select
                      value={design.arrayLayoutCode}
                      onChange={(e) => handleField('arrayLayoutCode', Number(e.target.value))}
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value={ARRAY_LAYOUT_CODES['2x2_Planar']}>2×2 Planar Array (1)</option>
                      <option value={ARRAY_LAYOUT_CODES.Linear_4_Element}>Linear 4-Element Array (2)</option>
                    </select>
                    {fieldErrors.arrayLayoutCode && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.arrayLayoutCode}</p>
                    )}
                  </div>
                </div>
              )}

              {design.topology === 'multi_element_mimo' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Element Spacing X (mm)
                      </label>
                      <input
                        type="number"
                        step={0.5}
                        value={Number.isNaN(design.elementSpacingXmm) ? '' : design.elementSpacingXmm}
                        onChange={(e) => handleField('elementSpacingXmm', parseNumInput(e.target.value))}
                        className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 font-mono text-xs tabular-nums text-white"
                      />
                      {fieldErrors.elementSpacingXmm && (
                        <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.elementSpacingXmm}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Element Spacing Y (mm)
                      </label>
                      <input
                        type="number"
                        step={0.5}
                        value={Number.isNaN(design.elementSpacingYmm) ? '' : design.elementSpacingYmm}
                        onChange={(e) => handleField('elementSpacingYmm', parseNumInput(e.target.value))}
                        className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 font-mono text-xs tabular-nums text-white"
                      />
                      {fieldErrors.elementSpacingYmm && (
                        <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.elementSpacingYmm}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Port Configuration
                    </label>
                    <select
                      value={design.portConfigurationCode}
                      onChange={(e) => handleField('portConfigurationCode', Number(e.target.value))}
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value={PORT_CONFIGURATION_CODES['4_Port']}>4-Port Independent MIMO (4)</option>
                      <option value={PORT_CONFIGURATION_CODES.none_single}>Single / Combined Feed (0)</option>
                    </select>
                    {fieldErrors.portConfigurationCode && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.portConfigurationCode}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-t border-sky-400/15 pt-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Substrate Material
              </label>
              <select
                value={design.substrateMaterial}
                onChange={(e) =>
                  handleField('substrateMaterial', e.target.value as SubstrateMaterial)
                }
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400"
              >
                {Object.values(SUBSTRATE_CATALOG).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (εr={s.dielectricConstant})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Conductor Metal
              </label>
              <select
                value={design.conductorMaterial}
                onChange={(e) =>
                  handleField('conductorMaterial', e.target.value as ConductorMaterial)
                }
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400"
              >
                {Object.values(CONDUCTOR_CATALOG).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                εr
              </label>
              <input
                type="number"
                step={0.05}
                min={1.2}
                max={15}
                value={Number.isNaN(design.dielectricConstant) ? '' : design.dielectricConstant}
                onChange={(e) => handleField('dielectricConstant', parseNumInput(e.target.value))}
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs tabular-nums text-white"
              />
              {fieldErrors.dielectricConstant && (
                <p className="mt-1 text-[10px] text-rose-400">{fieldErrors.dielectricConstant}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                tan δ
              </label>
              <input
                type="number"
                step={0.0005}
                min={0.0001}
                max={0.15}
                value={Number.isNaN(design.lossTangent) ? '' : design.lossTangent}
                onChange={(e) => handleField('lossTangent', parseNumInput(e.target.value))}
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs tabular-nums text-white"
              />
              {fieldErrors.lossTangent && (
                <p className="mt-1 text-[10px] text-rose-400">{fieldErrors.lossTangent}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Target (dBi)
              </label>
              <input
                type="number"
                step={0.2}
                value={design.targetGainDbi ?? 7.0}
                onChange={(e) => handleField('targetGainDbi', parseFloat(e.target.value) || 7.0)}
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs tabular-nums text-white"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-sky-400/20 bg-[#040814]/80 px-3 py-2 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={allowTopologyUpgrade}
              onChange={(e) => setAllowTopologyUpgrade(e.target.checked)}
              className="accent-cyan-400"
            />
            <span>Allow 2×2 array / MIMO upgrade when target gain exceeds single-patch physics</span>
          </label>

          {/* 4 Action Buttons */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              disabled={loading || optimizing || hasErrors}
              onClick={() => onRunPredict(design, false)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-2.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-50"
            >
              <Cpu className="h-3.5 w-3.5" />
              <span>{loading ? 'Predicting...' : 'Predict Performance'}</span>
            </button>
            <button
              type="button"
              disabled={loading || optimizing}
              onClick={handleGenerateAntenna}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-400/45 bg-cyan-500/15 px-3 py-2.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>Generate Antenna</span>
            </button>
            <button
              type="button"
              disabled={loading || optimizing || hasErrors}
              onClick={handleOptimizeDesign}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-sky-400/35 bg-[#0b1633] px-3 py-2.5 text-xs font-semibold text-sky-200 hover:border-cyan-400 disabled:opacity-50"
            >
              <Sparkles className={`h-3.5 w-3.5 text-cyan-400 ${optimizing ? 'animate-spin' : ''}`} />
              <span>{optimizing ? 'Optimizing Target...' : 'Optimize Design'}</span>
            </button>
            <button
              type="button"
              disabled={loading || optimizing}
              onClick={handleReset}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#040814] px-3 py-2.5 text-xs font-medium text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset Parameters</span>
            </button>
          </div>
        </div>

        {/* Right 2D/3D Live Viewport + Telemetry + Full-Width S11/Gain Sweep */}
        <div className="space-y-5 xl:col-span-8">
          <AntennaViewport3D
            params={design}
            prediction={prediction}
            heightClass="h-[460px]"
            onTopologyChange={handleTopologyChange}
            titleBadge="Live Studio Geometry"
          />

          {/* Predicted RF Metrics Strip */}
          {prediction && (
            <>
              {design.targetGainDbi !== undefined &&
                prediction.gainDbi < design.targetGainDbi - 0.15 && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-400/45 bg-amber-950/35 px-4 py-2.5 text-xs text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <span>
                      <strong className="text-amber-300">Target not met:</strong> Predicted gain (
                      {prediction.gainDbi} dBi) is below target ({design.targetGainDbi} dBi) for the
                      current {TOPOLOGY_LABELS[design.topology]} on{' '}
                      {SUBSTRATE_CATALOG[design.substrateMaterial].name}.
                    </span>
                  </div>
                )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <div className="glass-panel rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">Realized Gain</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                    {prediction.gainDbi}
                    <span className="ml-1 text-xs font-normal text-cyan-300">dBi</span>
                  </div>
                  <div
                    className={`mt-0.5 font-mono text-[10px] ${
                      prediction.isDemoEstimate ? 'text-amber-300' : 'text-emerald-300'
                    }`}
                  >
                    {prediction.isDemoEstimate ? 'Demo estimate' : 'Trained ML (.joblib)'}
                    {design.targetGainDbi !== undefined &&
                      prediction.gainDbi < design.targetGainDbi - 0.15 && (
                        <span className="ml-1 text-rose-300">
                          · Target not met ({design.targetGainDbi} dBi)
                        </span>
                      )}
                  </div>
                </div>
                <div className="glass-panel rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">Bandwidth (−10 dB)</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                    {tenDbAchieved ? prediction.bandwidthMHz : 0}
                    <span className="ml-1 text-xs font-normal text-cyan-300">MHz</span>
                  </div>
                  <div
                    className={`mt-0.5 font-mono text-[10px] ${
                      !tenDbAchieved
                        ? 'text-rose-300'
                        : prediction.isDemoEstimate
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                    }`}
                  >
                    {tenDbAchieved
                      ? prediction.isDemoEstimate
                        ? 'Demo estimate'
                        : 'Trained ML (.joblib)'
                      : 'No −10 dB bandwidth achieved'}
                  </div>
                </div>
                <div className="glass-panel rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">Resonant Freq</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                    {prediction.resonantFreqGHz}
                    <span className="ml-1 text-xs font-normal text-cyan-300">GHz</span>
                  </div>
                  <div
                    className={`mt-0.5 font-mono text-[10px] ${
                      prediction.isDemoEstimate ? 'text-amber-300' : 'text-emerald-300'
                    }`}
                  >
                    {prediction.isDemoEstimate ? 'Demo estimate' : 'Trained ML (.joblib)'}
                  </div>
                </div>
                <div className="glass-panel rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">Efficiency</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                    {prediction.efficiencyPct}
                    <span className="ml-1 text-xs font-normal text-cyan-300">%</span>
                  </div>
                  <div
                    className={`mt-0.5 font-mono text-[10px] ${
                      prediction.isDemoEstimate ? 'text-amber-300' : 'text-emerald-300'
                    }`}
                  >
                    {prediction.isDemoEstimate ? 'Demo estimate' : 'Trained ML (.joblib)'}
                  </div>
                </div>
                <div className="glass-panel rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">Return Loss S11</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                    {prediction.returnLossDb}
                    <span className="ml-1 text-xs font-normal text-cyan-300">dB</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400">Analytical RF</div>
                </div>
                <div className="glass-panel rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">Input Z / VSWR</div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-white">
                    {prediction.inputImpedanceOhm}Ω · {prediction.vswr}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400">Analytical RF</div>
                </div>
              </div>

              {/* Full-Width Frequency Sweep S11 & Gain Chart */}
              <div className="glass-panel rounded-xl p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base font-bold italic text-white">
                      Predicted S11 Return Loss & Gain Response
                    </h3>
                    <p
                      className={`text-xs ${
                        prediction.isDemoEstimate ? 'text-amber-200/90' : 'text-emerald-300/90'
                      }`}
                    >
                      {prediction.provenance}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-cyan-300 mr-2">
                      Area {prediction.areaMm2} mm² · Est. ${prediction.estimatedCostUsd}
                    </span>
                    <button
                      type="button"
                      onClick={() => downloadAntennaCSV(design, prediction)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-[#0b1633] px-3 py-1.5 text-xs font-medium text-sky-200 transition-colors hover:border-cyan-400 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Export CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadAntennaPDF(design, prediction)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/25 whitespace-nowrap"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>Export PDF</span>
                    </button>
                  </div>
                </div>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={prediction.frequencySweep}>
                      <CartesianGrid stroke="rgba(56,189,248,0.1)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="freqGHz"
                        stroke="#94a3b8"
                        tick={{ fontSize: 11 }}
                        unit=" GHz"
                      />
                      <YAxis yAxisId="left" stroke="#22d3ee" tick={{ fontSize: 11 }} unit=" dB" />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="#60a5fa"
                        tick={{ fontSize: 11 }}
                        unit=" dBi"
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#060d20',
                          border: '1px solid rgba(56,189,248,0.3)',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                      <ReferenceLine
                        yAxisId="left"
                        y={-10}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        label={{
                          value: '-10 dB',
                          position: 'insideTopRight',
                          fill: '#fbbf24',
                          fontSize: 10,
                        }}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="s11Db"
                        name="S11 Return Loss (dB)"
                        stroke="#22d3ee"
                        strokeWidth={2.5}
                        dot={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="gainDbi"
                        name="Realized Gain (dBi)"
                        stroke="#60a5fa"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
