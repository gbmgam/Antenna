import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  Play,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import type {
  AntennaDesignParams,
  AntennaTopology,
  ConductorMaterial,
  FaultAnalysisResponse,
  PredictionResult,
  SubstrateMaterial,
} from '../shared/antennaTypes.ts';
import {
  CONDUCTOR_CATALOG,
  SUBSTRATE_CATALOG,
  TOPOLOGY_LABELS,
  createDefaultDesign,
  switchDesignTopology,
} from '../shared/rfPhysics.ts';
import { diagnoseAntennaFaults } from '../utils/apiClient.ts';
import { parseUploadedDesignFile } from '../utils/designImport.ts';
import { AntennaViewport3D } from '../components/AntennaViewport3D.tsx';

interface FaultDetectionPageProps {
  activeDesign: AntennaDesignParams;
  onApplyToStudio: (params: AntennaDesignParams, prediction: PredictionResult) => void;
}

const FAULTY_BENCHMARKS: Array<{ label: string; params: AntennaDesignParams }> = [
  {
    label: 'Faulty 5.8 GHz FR-4 Detuned Patch',
    params: {
      ...createDefaultDesign(5.8, 'microstrip_patch', 'FR4'),
      id: 'fault-bench-1',
      name: 'Detuned 5.8 GHz FR-4 Patch',
      patchLengthMm: 16.5,
      patchWidthMm: 15.0,
      substrateHeightMm: 0.6,
      feedXMm: 1.1,
      feedYMm: 4.2,
      insetDepthMm: 1.1,
      notchWidthMm: 1.0,
      conductorMaterial: 'Aluminum',
    },
  },
  {
    label: 'Mismatched 2.45 GHz Probe Patch',
    params: {
      ...createDefaultDesign(2.45, 'rectangular_patch', 'FR4'),
      id: 'fault-bench-2',
      name: 'Mismatched 2.45 GHz Probe Patch',
      patchLengthMm: 24.0,
      patchWidthMm: 30.0,
      substrateHeightMm: 0.8,
      feedXMm: 0.8,
      feedYMm: 5.5,
      probeDiameterMm: 2.2,
      feedTypeCode: 2,
    },
  },
];

export const FaultDetectionPage: React.FC<FaultDetectionPageProps> = ({
  activeDesign,
  onApplyToStudio,
}) => {
  const [targetDesign, setTargetDesign] = useState<AntennaDesignParams>(activeDesign);
  const [uploadedRows, setUploadedRows] = useState<AntennaDesignParams[]>([]);
  const [selectedUploadIdx, setSelectedUploadIdx] = useState(0);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FaultAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);

  const runDiagnosis = async (p: AntennaDesignParams) => {
    setLoading(true);
    setDiagError(null);
    try {
      const res = await diagnoseAntennaFaults(p);
      setAnalysis(res);
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : 'Fault diagnosis request failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTargetDesign(activeDesign);
    runDiagnosis(activeDesign);
  }, [activeDesign]);

  const handleUploadFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploadNotice(null);
    const parsed = await parseUploadedDesignFile(file, targetDesign.operatingFreqGHz);
    if (!parsed.ok || parsed.designs.length === 0) {
      setUploadError(parsed.errors[0] || parsed.notice);
      return;
    }
    setUploadedRows(parsed.designs);
    setSelectedUploadIdx(0);
    setUploadNotice(parsed.notice);
    setTargetDesign(parsed.designs[0]);
    await runDiagnosis(parsed.designs[0]);
  };

  const updateNumField = (key: keyof AntennaDesignParams, raw: string) => {
    const val = parseFloat(raw);
    if (!Number.isFinite(val)) return;
    setTargetDesign((prev) => ({ ...prev, [key]: val }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-sky-400/15 pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs tracking-wider text-cyan-400">
            MODULE 05 · FAULT DETECTION & REPAIR
          </p>
          <h1 className="section-heading-italic text-3xl text-white">
            Intelligent Electromagnetic Diagnostics & Before/After 3D Repair
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setTargetDesign(activeDesign);
              setUploadedRows([]);
              setUploadNotice(null);
              runDiagnosis(activeDesign);
            }}
            className="rounded-lg border border-sky-400/35 bg-[#0b1633] px-3 py-2 text-xs font-medium text-cyan-200 hover:border-cyan-400"
          >
            Load Studio Design
          </button>
          {FAULTY_BENCHMARKS.map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={() => {
                setTargetDesign(b.params);
                setUploadedRows([]);
                setUploadNotice(null);
                runDiagnosis(b.params);
              }}
              className="rounded-lg border border-amber-400/35 bg-amber-950/30 px-3 py-2 text-xs font-medium text-amber-200 hover:border-amber-300"
            >
              Test: {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Design Input & File Upload Panel */}
      <div className="glass-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold italic text-white">
              Target Antenna Input or Upload for Fault Check
            </h2>
            <p className="text-xs text-slate-400">
              Upload an antenna design file (.csv, .xlsx, .json, .stl) or enter/edit geometry & stackup parameters directly.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-cyan-400/50 bg-[#040814] px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:border-cyan-300 hover:bg-cyan-950/25 shrink-0">
            <FileUp className="h-4 w-4 text-cyan-400" />
            <span>Upload Antenna Design (CSV / XLSX / JSON / STL)</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.json,.stl"
              onChange={(e) => {
                handleUploadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>
        </div>

        {uploadNotice && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-400/35 bg-emerald-950/25 px-3.5 py-2 text-xs text-emerald-200">
            <span>{uploadNotice}</span>
            {uploadedRows.length > 1 && (
              <select
                aria-label="Select uploaded antenna row"
                value={selectedUploadIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setSelectedUploadIdx(idx);
                  const chosen = uploadedRows[idx];
                  if (chosen) {
                    setTargetDesign(chosen);
                    runDiagnosis(chosen);
                  }
                }}
                className="rounded border border-emerald-400/35 bg-[#040814] px-2.5 py-1 text-xs text-white"
              >
                {uploadedRows.map((row, idx) => (
                  <option key={row.id} value={idx}>
                    Row #{idx + 1}: {row.name} ({row.operatingFreqGHz} GHz)
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {uploadError && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/35 px-3.5 py-2 text-xs text-rose-200">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{uploadError}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1 block text-[11px] text-slate-400">Topology</label>
            <select
              value={targetDesign.topology}
              onChange={(e) =>
                setTargetDesign((prev) =>
                  switchDesignTopology(prev, e.target.value as AntennaTopology),
                )
              }
              className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 text-xs text-white"
            >
              {Object.entries(TOPOLOGY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Freq (GHz)</label>
            <input
              type="number"
              step={0.05}
              value={targetDesign.operatingFreqGHz}
              onChange={(e) => updateNumField('operatingFreqGHz', e.target.value)}
              className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Substrate</label>
            <select
              value={targetDesign.substrateMaterial}
              onChange={(e) => {
                const sub = e.target.value as SubstrateMaterial;
                const spec = SUBSTRATE_CATALOG[sub];
                setTargetDesign((prev) => ({
                  ...prev,
                  substrateMaterial: sub,
                  dielectricConstant: spec.dielectricConstant,
                  lossTangent: spec.lossTangent,
                }));
              }}
              className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 text-xs text-white"
            >
              {Object.values(SUBSTRATE_CATALOG).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Height h (mm)</label>
            <input
              type="number"
              step={0.1}
              value={targetDesign.substrateHeightMm}
              onChange={(e) => updateNumField('substrateHeightMm', e.target.value)}
              className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs text-white"
            />
          </div>

          {targetDesign.topology === 'circular_patch' ? (
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">Radius R (mm)</label>
              <input
                type="number"
                step={0.1}
                value={targetDesign.patchRadiusMm}
                onChange={(e) => updateNumField('patchRadiusMm', e.target.value)}
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs text-white"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Length L (mm)</label>
                <input
                  type="number"
                  step={0.2}
                  value={targetDesign.patchLengthMm}
                  onChange={(e) => updateNumField('patchLengthMm', e.target.value)}
                  className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Width W (mm)</label>
                <input
                  type="number"
                  step={0.2}
                  value={targetDesign.patchWidthMm}
                  onChange={(e) => updateNumField('patchWidthMm', e.target.value)}
                  className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs text-white"
                />
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Feed X (mm)</label>
            <input
              type="number"
              step={0.2}
              value={targetDesign.feedXMm}
              onChange={(e) => updateNumField('feedXMm', e.target.value)}
              className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Feed Y (mm)</label>
            <input
              type="number"
              step={0.2}
              value={targetDesign.feedYMm}
              onChange={(e) => updateNumField('feedYMm', e.target.value)}
              className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 font-mono text-xs text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Conductor</label>
            <select
              value={targetDesign.conductorMaterial}
              onChange={(e) =>
                setTargetDesign((prev) => ({
                  ...prev,
                  conductorMaterial: e.target.value as ConductorMaterial,
                }))
              }
              className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 text-xs text-white"
            >
              {Object.values(CONDUCTOR_CATALOG).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2 sm:col-span-1 flex items-end">
            <button
              type="button"
              disabled={loading}
              onClick={() => runDiagnosis(targetDesign)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{loading ? 'Diagnosing...' : 'Run Fault Check'}</span>
            </button>
          </div>
        </div>
      </div>

      {diagError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/40 px-4 py-2.5 text-xs text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{diagError}</span>
        </div>
      )}

      {loading && !analysis && (
        <div className="glass-panel rounded-xl p-8 text-center text-sm text-slate-300">
          Running electromagnetic fault diagnostics...
        </div>
      )}

      {analysis && (
        <>
          {/* Health & Before/After Metrics */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="glass-panel rounded-xl p-4">
              <div className="text-xs text-slate-400">Design Health Score</div>
              <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-white">
                {analysis.healthScore}
                <span className="text-sm font-normal text-slate-400">/100</span>
              </div>
              <div className="mt-1 text-xs text-cyan-300">
                {analysis.faults.length} issue(s) ·{' '}
                <span
                  className={
                    analysis.originalPrediction.isDemoEstimate
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                  }
                >
                  {analysis.originalPrediction.isDemoEstimate
                    ? 'Demo estimate'
                    : 'Trained ML (.joblib)'}
                </span>
              </div>
            </div>

            <div className="glass-panel rounded-xl p-4">
              <div className="text-xs text-slate-400">Gain (Before → After)</div>
              <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                {analysis.originalPrediction.gainDbi} →{' '}
                <span className="text-cyan-300">{analysis.correctedPrediction.gainDbi} dBi</span>
              </div>
            </div>

            <div className="glass-panel rounded-xl p-4">
              <div className="text-xs text-slate-400">Bandwidth (Before → After)</div>
              <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                {analysis.originalPrediction.bandwidthMHz} →{' '}
                <span className="text-cyan-300">
                  {analysis.correctedPrediction.bandwidthMHz} MHz
                </span>
              </div>
            </div>

            <div className="glass-panel rounded-xl p-4">
              <div className="text-xs text-slate-400">Efficiency (Before → After)</div>
              <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                {analysis.originalPrediction.efficiencyPct}% →{' '}
                <span className="text-cyan-300">
                  {analysis.correctedPrediction.efficiencyPct}%
                </span>
              </div>
            </div>

            <div className="glass-panel flex flex-col justify-between rounded-xl p-4">
              <div>
                <div className="text-xs text-slate-400">S11 Return Loss</div>
                <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                  {analysis.originalPrediction.returnLossDb} →{' '}
                  <span className="text-cyan-300">
                    {analysis.correctedPrediction.returnLossDb} dB
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onApplyToStudio(analysis.correctedParams, analysis.correctedPrediction)
                }
                className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-md bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                <Wrench className="h-3.5 w-3.5" />
                <span>Apply Corrected Design</span>
              </button>
            </div>
          </div>

          {/* Detected Faults List */}
          <div className="glass-panel rounded-xl p-5">
            <h2 className="mb-4 font-display text-xl font-bold italic text-white">
              Diagnostic Findings & Recommended Corrections ({analysis.originalParams.name})
            </h2>
            {analysis.faults.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/25 p-4 text-sm text-emerald-200">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <span>
                  Nominal impedance matching, resonance alignment, and dielectric efficiency
                  verified for {analysis.originalParams.operatingFreqGHz} GHz.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {analysis.faults.map((fault) => (
                  <div
                    key={fault.id}
                    className="rounded-xl border border-sky-400/20 bg-[#040814]/85 p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-semibold text-white">
                        {fault.severity === 'critical' ? (
                          <AlertCircle className="h-4 w-4 text-rose-400" />
                        ) : (
                          <ShieldAlert className="h-4 w-4 text-amber-400" />
                        )}
                        <span>{fault.title}</span>
                      </div>
                      <span
                        className={`font-mono text-xs uppercase ${
                          fault.severity === 'critical'
                            ? 'text-rose-400'
                            : fault.severity === 'warning'
                              ? 'text-amber-300'
                              : 'text-sky-300'
                        }`}
                      >
                        {fault.severity}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-300">
                      <strong className="text-slate-100">Cause:</strong> {fault.cause}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-cyan-200">
                      <strong className="text-cyan-300">Correction:</strong> {fault.recommendation}
                    </p>
                    <div className="mt-2 font-mono text-[11px] text-sky-300">
                      Delta: {fault.parameterDelta}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Before & After 3D Comparison */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-amber-300">
                <span>BEFORE CORRECTION ({analysis.originalParams.name})</span>
                <span>
                  {analysis.originalPrediction.gainDbi} dBi · {analysis.originalPrediction.returnLossDb} dB
                </span>
              </div>
              <AntennaViewport3D
                params={analysis.originalParams}
                prediction={analysis.originalPrediction}
                heightClass="h-[340px]"
                compact
                titleBadge="Original (Diagnosed)"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-cyan-300">
                <span>AFTER CORRECTION (AUTO-REPAIRED)</span>
                <span>
                  {analysis.correctedPrediction.gainDbi} dBi · {analysis.correctedPrediction.returnLossDb} dB
                </span>
              </div>
              <AntennaViewport3D
                params={analysis.correctedParams}
                prediction={analysis.correctedPrediction}
                heightClass="h-[340px]"
                compact
                titleBadge="Corrected 3D Model"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
