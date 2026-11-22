import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  FileSpreadsheet,
  FileUp,
  Image as ImageIcon,
  ShieldAlert,
} from 'lucide-react';
import type {
  AntennaDesignParams,
  AntennaTopology,
  FaultAnalysisResponse,
  PredictionOutput4,
  PredictionResult,
} from '../shared/antennaTypes.ts';
import {
  ARRAY_LAYOUT_CODES,
  FEATURE_ORDER,
  FEED_TYPE_CODES,
  OUTPUT_ORDER,
  PORT_CONFIGURATION_CODES,
  buildFeatureRecord21,
  validateAndParseImportedRows,
  validateAntennaDesign,
} from '../shared/antennaSchema.ts';
import {
  SUBSTRATE_CATALOG,
  TOPOLOGY_LABELS,
  createDefaultDesign,
  evaluateAnalyticalPhysics,
  switchDesignTopology,
} from '../shared/rfPhysics.ts';
import { diagnoseAntennaFaults, predictAntenna } from '../utils/apiClient.ts';
import { downloadAntennaCSV, downloadAntennaPDF } from '../utils/reportGenerator.ts';
import { AntennaViewport3D } from '../components/AntennaViewport3D.tsx';
import { STLPreview3D } from '../components/STLPreview3D.tsx';

interface EvaluateExistingPageProps {
  onApplyToStudio: (params: AntennaDesignParams, prediction: PredictionResult) => void;
}

export const EvaluateExistingPage: React.FC<EvaluateExistingPageProps> = ({
  onApplyToStudio,
}) => {
  const [params, setParams] = useState<AntennaDesignParams>(() =>
    createDefaultDesign(2.45, 'microstrip_patch', 'FR4'),
  );
  const [fileInfo, setFileInfo] = useState<{
    name: string;
    ext: string;
    status: string;
    isError?: boolean;
    warnings?: string[];
    errors?: string[];
    rowCount?: number;
    requiresConversionNote?: string;
  } | null>(null);
  const [importedDatasetRows, setImportedDatasetRows] = useState<
    Array<{
      params: AntennaDesignParams;
      featureVector: number[];
      outputs?: PredictionOutput4;
    }>
  >([]);
  const [selectedRowIdx, setSelectedRowIdx] = useState(0);
  const [stlBuffer, setStlBuffer] = useState<ArrayBuffer | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [faults, setFaults] = useState<FaultAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fieldErrors = useMemo(() => validateAntennaDesign(params), [params]);
  const hasErrors = Object.keys(fieldErrors).length > 0;

  const handleFileUpload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    setStlBuffer(null);
    setImagePreviewUrl(null);
    setPrediction(null);
    setFaults(null);
    setImportedDatasetRows([]);

    if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const parsed = validateAndParseImportedRows(rawRows, {
        filename: file.name,
        requireOutputColumns: false,
      });

      if (!parsed.valid) {
        setFileInfo({
          name: file.name,
          ext: ext.toUpperCase(),
          isError: true,
          status: `Validation failed (${parsed.errors.length} error${parsed.errors.length > 1 ? 's' : ''}). Check required 21-feature or legacy 10-feature columns.`,
          errors: parsed.errors,
          warnings: parsed.warnings,
        });
        return;
      }

      setImportedDatasetRows(parsed.rows);
      setSelectedRowIdx(0);
      setParams(parsed.rows[0].params);
      setFileInfo({
        name: file.name,
        ext: ext.toUpperCase(),
        rowCount: parsed.rows.length,
        warnings: parsed.warnings,
        status: `Validated ${parsed.rows.length} row(s) (${
          parsed.isLegacy10Feature ? 'Legacy 10-feature zero-filled to 21' : 'Full 21-feature schema'
        }${parsed.hasOutputs ? ' + 4 output columns' : ''}).`,
      });
      return;
    }

    if (ext === 'stl') {
      const buf = await file.arrayBuffer();
      setStlBuffer(buf);
      try {
        const loader = new STLLoader();
        const geo = loader.parse(buf);
        geo.computeBoundingBox();
        const box = geo.boundingBox;
        if (box) {
          const sx = Number((box.max.x - box.min.x).toFixed(2));
          const sy = Number((box.max.y - box.min.y).toFixed(2));
          const sz = Number((box.max.z - box.min.z).toFixed(2));
          const dims = [sx, sy, sz].sort((a, b) => b - a);
          setParams((prev) => ({
            ...prev,
            name: `STL: ${file.name}`,
            patchWidthMm: Math.max(2, Number((dims[0] * 0.62).toFixed(2))),
            patchLengthMm: Math.max(2, Number((dims[1] * 0.62).toFixed(2))),
            substrateHeightMm: Math.max(0.3, Math.min(8, Number(dims[2].toFixed(2)))),
          }));
        }
        geo.dispose();
        setFileInfo({
          name: file.name,
          ext: 'STL',
          status: 'STL mesh loaded in 3D viewer and bounding-box dimensions extracted.',
        });
      } catch {
        setFileInfo({
          name: file.name,
          ext: 'STL',
          isError: true,
          status: 'Could not parse STL geometry header. Enter dimensions manually.',
        });
      }
      return;
    }

    if (ext === 'step' || ext === 'stp' || ext === 'dxf') {
      const text = await file.text();
      const isStep = ext === 'step' || ext === 'stp';
      setFileInfo({
        name: file.name,
        ext: ext.toUpperCase(),
        status: `Uploaded ${ext.toUpperCase()} CAD file (${(file.size / 1024).toFixed(1)} KB, ${text.split('\n').length} lines).`,
        requiresConversionNote: isStep
          ? 'STEP B-Rep NURBS solids require an external CAD kernel (OpenCASCADE / FreeCAD / Blender CAD import) to tessellate into triangle meshes before browser 3D rendering. Convert to .STL or .GLB for direct mesh preview, or calibrate extracted dimensions below.'
          : 'DXF 2D planar trace profiles can be mapped directly via manual L/W/h calibration below; full layer extrusion requires a DXF-to-STL geometry backend.',
      });
      setParams((prev) => ({ ...prev, name: `CAD: ${file.name}` }));
      return;
    }

    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      const url = URL.createObjectURL(file);
      setImagePreviewUrl(url);
      setFileInfo({
        name: file.name,
        ext: ext.toUpperCase(),
        status: 'Reference layout image loaded. Enter or calibrate physical dimensions in millimeters below.',
      });
      setParams((prev) => ({ ...prev, name: `Image Ref: ${file.name}` }));
      return;
    }

    setFileInfo({
      name: file.name,
      ext: ext.toUpperCase(),
      isError: true,
      status: 'Unsupported file extension. Please upload CSV, XLSX, STL, STEP, DXF, or PNG/JPG.',
    });
  };

  const loadSample21FeatureCSV = () => {
    const samples: AntennaDesignParams[] = [
      { ...createDefaultDesign(2.45, 'microstrip_patch', 'Rogers_RO4003C'), insetDepthMm: 9.1, notchWidthMm: 2.6 },
      { ...createDefaultDesign(5.8, 'rectangular_patch', 'Rogers_RO4003C'), probeDiameterMm: 1.27, feedTypeCode: 2 },
      { ...createDefaultDesign(0.915, 'circular_patch', 'FR4'), patchRadiusMm: 44.2 },
      { ...createDefaultDesign(28.0, 'array_2x2', 'Rogers_RT5880'), elementSpacingXmm: 5.4, elementSpacingYmm: 5.4, phaseXDeg: 15, phaseYDeg: 0, arrayLayoutCode: 1 },
      { ...createDefaultDesign(3.5, 'multi_element_mimo', 'Rogers_RO4003C'), elementSpacingXmm: 42.8, elementSpacingYmm: 42.8, portConfigurationCode: 4 },
    ];
    const header = ['designName', ...FEATURE_ORDER, ...OUTPUT_ORDER].join(',');
    const lines = samples.map((s) => {
      const rec = buildFeatureRecord21(s);
      const phys = evaluateAnalyticalPhysics(s);
      return [
        `"${s.name}"`,
        ...FEATURE_ORDER.map((k) => rec[k]),
        phys.gainDbi,
        phys.bandwidthMHz,
        phys.resonantFreqGHz,
        phys.efficiencyPct,
      ].join(',');
    });
    const csv = `${header}\n${lines.join('\n')}\n`;
    const file = new File([csv], 'sample_5_topology_21features.csv', { type: 'text/csv' });
    handleFileUpload(file);
  };

  const loadLegacy10FeatureCSV = () => {
    const legacyHeader = [
      'designName',
      ...FEATURE_ORDER.slice(0, 10),
      ...OUTPUT_ORDER,
    ].join(',');
    const csv =
      `${legacyHeader}\n` +
      'Legacy_2450MHz_FR4,28.8,37.2,1.6,4.4,0.02,7.2,0.5,2.45,0,1.0,6.2,52.0,2.438,68.5\n';
    const file = new File([csv], 'legacy_10features.csv', { type: 'text/csv' });
    handleFileUpload(file);
  };

  const handleEvaluate = async () => {
    if (hasErrors) return;
    setLoading(true);
    try {
      const [pred, diag] = await Promise.all([
        predictAntenna(params, 'ensemble', true, 'evaluation'),
        diagnoseAntennaFaults(params),
      ]);
      setPrediction(pred);
      setFaults(diag);
    } finally {
      setLoading(false);
    }
  };

  const parseNum = (v: string) => (v.trim() === '' ? NaN : Number(v));

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 border-b border-sky-400/15 pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs tracking-wider text-cyan-400">
            MODULE 04 · EXISTING ANTENNA EVALUATION
          </p>
          <h1 className="section-heading-italic text-3xl text-white">
            Upload, Calibrate & Evaluate Existing Antenna Designs
          </h1>
        </div>
        <span className="rounded border border-amber-400/35 bg-amber-950/30 px-2.5 py-1.5 font-mono text-[11px] font-medium text-amber-200 whitespace-nowrap">
          Demo estimate · 21-Feature + 4-Output Schema
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Upload & Manual Correction Column */}
        <div className="glass-panel space-y-5 rounded-xl p-5 xl:col-span-5">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-sky-400/30 bg-[#040814]/70 p-6 text-center transition-colors hover:border-cyan-400">
            <FileUp className="h-8 w-8 text-cyan-400" />
            <span className="mt-2 text-sm font-semibold text-white">
              Drop or Select Existing Antenna File
            </span>
            <span className="mt-1 font-mono text-xs text-slate-400">
              CSV (21-feature or legacy 10-feature) · Excel (.xlsx) · STL · STEP · DXF · PNG/JPG
            </span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.stl,.step,.stp,.dxf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
              }}
              className="hidden"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">Test sample datasets:</span>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={loadSample21FeatureCSV}
                className="inline-flex items-center gap-1.5 font-semibold text-cyan-300 hover:text-cyan-200"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>Load 5-Topology 21-Feature CSV</span>
              </button>
              <button
                type="button"
                onClick={loadLegacy10FeatureCSV}
                className="inline-flex items-center gap-1.5 font-medium text-sky-300 hover:text-sky-200"
              >
                <span>Load Legacy 10-Feature CSV</span>
              </button>
            </div>
          </div>

          {fileInfo && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                fileInfo.isError
                  ? 'border-rose-500/40 bg-rose-950/35'
                  : 'border-sky-400/25 bg-[#0b1633]'
              }`}
            >
              <div
                className={`flex items-center gap-2 font-semibold ${
                  fileInfo.isError ? 'text-rose-300' : 'text-cyan-300'
                }`}
              >
                {fileInfo.isError ? (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                )}
                <span>
                  {fileInfo.name} ({fileInfo.ext})
                </span>
              </div>
              <p className="mt-1 text-slate-300">{fileInfo.status}</p>
              {fileInfo.errors && fileInfo.errors.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-rose-200">
                  {fileInfo.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
              {fileInfo.warnings && fileInfo.warnings.length > 0 && (
                <ul className="mt-2 space-y-1 text-amber-200">
                  {fileInfo.warnings.map((w, i) => (
                    <li key={i}>Note: {w}</li>
                  ))}
                </ul>
              )}
              {importedDatasetRows.length > 1 && (
                <div className="mt-3">
                  <label className="mb-1 block text-[11px] text-slate-400">
                    Select Imported Row ({importedDatasetRows.length} loaded)
                  </label>
                  <select
                    value={selectedRowIdx}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setSelectedRowIdx(idx);
                      setParams(importedDatasetRows[idx].params);
                      setPrediction(null);
                      setFaults(null);
                    }}
                    className="w-full rounded border border-sky-400/25 bg-[#040814] px-2.5 py-1.5 text-xs text-white"
                  >
                    {importedDatasetRows.map((row, idx) => (
                      <option key={idx} value={idx}>
                        #{idx + 1}: {row.params.name} ({TOPOLOGY_LABELS[row.params.topology]} ·{' '}
                        {row.params.operatingFreqGHz} GHz)
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {fileInfo.requiresConversionNote && (
                <div className="mt-2 flex items-start gap-2 rounded border border-amber-400/35 bg-amber-950/35 p-2.5 text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <span>{fileInfo.requiresConversionNote}</span>
                </div>
              )}
            </div>
          )}

          {/* Manual Calibration Form */}
          <div className="space-y-3 border-t border-sky-400/15 pt-4">
            <h3 className="font-display text-sm font-bold italic text-white">
              Extracted / Manual Geometry Parameters
            </h3>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Antenna Topology</label>
              <select
                value={params.topology}
                onChange={(e) =>
                  setParams(switchDesignTopology(params, e.target.value as AntennaTopology))
                }
                className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 text-xs text-white"
              >
                {Object.entries(TOPOLOGY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {params.topology === 'circular_patch' ? (
                <div className="col-span-2">
                  <label className="mb-1 block text-slate-400">Patch Radius (mm)</label>
                  <input
                    type="number"
                    step={0.1}
                    value={Number.isNaN(params.patchRadiusMm) ? '' : params.patchRadiusMm}
                    onChange={(e) => setParams({ ...params, patchRadiusMm: parseNum(e.target.value) })}
                    className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                  />
                  {fieldErrors.patchRadiusMm && (
                    <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.patchRadiusMm}</p>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-slate-400">Patch Length L (mm)</label>
                    <input
                      type="number"
                      step={0.1}
                      value={Number.isNaN(params.patchLengthMm) ? '' : params.patchLengthMm}
                      onChange={(e) =>
                        setParams({ ...params, patchLengthMm: parseNum(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                    />
                    {fieldErrors.patchLengthMm && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.patchLengthMm}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-slate-400">Patch Width W (mm)</label>
                    <input
                      type="number"
                      step={0.1}
                      value={Number.isNaN(params.patchWidthMm) ? '' : params.patchWidthMm}
                      onChange={(e) =>
                        setParams({ ...params, patchWidthMm: parseNum(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                    />
                    {fieldErrors.patchWidthMm && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.patchWidthMm}</p>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-slate-400">Substrate h (mm)</label>
                <input
                  type="number"
                  step={0.05}
                  value={Number.isNaN(params.substrateHeightMm) ? '' : params.substrateHeightMm}
                  onChange={(e) =>
                    setParams({ ...params, substrateHeightMm: parseNum(e.target.value) })
                  }
                  className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                />
                {fieldErrors.substrateHeightMm && (
                  <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.substrateHeightMm}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-slate-400">Dielectric εr</label>
                <input
                  type="number"
                  step={0.05}
                  value={Number.isNaN(params.dielectricConstant) ? '' : params.dielectricConstant}
                  onChange={(e) =>
                    setParams({ ...params, dielectricConstant: parseNum(e.target.value) })
                  }
                  className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                />
                {fieldErrors.dielectricConstant && (
                  <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.dielectricConstant}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-slate-400">Target Freq (GHz)</label>
                <input
                  type="number"
                  step={0.05}
                  value={Number.isNaN(params.operatingFreqGHz) ? '' : params.operatingFreqGHz}
                  onChange={(e) =>
                    setParams({ ...params, operatingFreqGHz: parseNum(e.target.value) })
                  }
                  className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                />
                {fieldErrors.operatingFreqGHz && (
                  <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.operatingFreqGHz}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-slate-400">Substrate Preset</label>
                <select
                  value={params.substrateMaterial}
                  onChange={(e) => {
                    const sub = SUBSTRATE_CATALOG[e.target.value as keyof typeof SUBSTRATE_CATALOG];
                    setParams({
                      ...params,
                      substrateMaterial: sub.id,
                      dielectricConstant: sub.dielectricConstant,
                      lossTangent: sub.lossTangent,
                    });
                  }}
                  className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-2 text-white"
                >
                  {Object.values(SUBSTRATE_CATALOG).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Conditional Topology Inputs */}
              {params.topology === 'microstrip_patch' && (
                <>
                  <div>
                    <label className="mb-1 block text-slate-400">Inset Depth (mm)</label>
                    <input
                      type="number"
                      step={0.1}
                      value={Number.isNaN(params.insetDepthMm) ? '' : params.insetDepthMm}
                      onChange={(e) =>
                        setParams({ ...params, insetDepthMm: parseNum(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                    />
                    {fieldErrors.insetDepthMm && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.insetDepthMm}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-slate-400">Notch Width (mm)</label>
                    <input
                      type="number"
                      step={0.1}
                      value={Number.isNaN(params.notchWidthMm) ? '' : params.notchWidthMm}
                      onChange={(e) =>
                        setParams({ ...params, notchWidthMm: parseNum(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                    />
                    {fieldErrors.notchWidthMm && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.notchWidthMm}</p>
                    )}
                  </div>
                </>
              )}

              {params.topology === 'rectangular_patch' && (
                <>
                  <div>
                    <label className="mb-1 block text-slate-400">Probe Diameter (mm)</label>
                    <input
                      type="number"
                      step={0.05}
                      value={Number.isNaN(params.probeDiameterMm) ? '' : params.probeDiameterMm}
                      onChange={(e) =>
                        setParams({ ...params, probeDiameterMm: parseNum(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                    />
                    {fieldErrors.probeDiameterMm && (
                      <p className="mt-1 text-[11px] text-rose-400">{fieldErrors.probeDiameterMm}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-slate-400">Feed Type</label>
                    <select
                      value={params.feedTypeCode}
                      onChange={(e) =>
                        setParams({ ...params, feedTypeCode: Number(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-2 text-white"
                    >
                      <option value={FEED_TYPE_CODES.Coaxial_Probe}>Coaxial Probe (2)</option>
                      <option value={FEED_TYPE_CODES.Microstrip_Inset}>Microstrip Inset (1)</option>
                    </select>
                  </div>
                </>
              )}

              {(params.topology === 'array_2x2' || params.topology === 'multi_element_mimo') && (
                <>
                  <div>
                    <label className="mb-1 block text-slate-400">Element Spacing X (mm)</label>
                    <input
                      type="number"
                      step={0.5}
                      value={Number.isNaN(params.elementSpacingXmm) ? '' : params.elementSpacingXmm}
                      onChange={(e) =>
                        setParams({ ...params, elementSpacingXmm: parseNum(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-slate-400">Element Spacing Y (mm)</label>
                    <input
                      type="number"
                      step={0.5}
                      value={Number.isNaN(params.elementSpacingYmm) ? '' : params.elementSpacingYmm}
                      onChange={(e) =>
                        setParams({ ...params, elementSpacingYmm: parseNum(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                    />
                  </div>
                </>
              )}

              {params.topology === 'array_2x2' && (
                <>
                  <div>
                    <label className="mb-1 block text-slate-400">Phase X (deg)</label>
                    <input
                      type="number"
                      step={5}
                      value={Number.isNaN(params.phaseXDeg) ? '' : params.phaseXDeg}
                      onChange={(e) =>
                        setParams({ ...params, phaseXDeg: parseNum(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-slate-400">Array Layout</label>
                    <select
                      value={params.arrayLayoutCode}
                      onChange={(e) =>
                        setParams({ ...params, arrayLayoutCode: Number(e.target.value) })
                      }
                      className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-2 text-white"
                    >
                      <option value={ARRAY_LAYOUT_CODES['2x2_Planar']}>2×2 Planar (1)</option>
                      <option value={ARRAY_LAYOUT_CODES.Linear_4_Element}>Linear 4-El (2)</option>
                    </select>
                  </div>
                </>
              )}

              {params.topology === 'multi_element_mimo' && (
                <div className="col-span-2">
                  <label className="mb-1 block text-slate-400">Port Configuration</label>
                  <select
                    value={params.portConfigurationCode}
                    onChange={(e) =>
                      setParams({ ...params, portConfigurationCode: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-2 text-white"
                  >
                    <option value={PORT_CONFIGURATION_CODES['4_Port']}>4-Port MIMO (4)</option>
                    <option value={PORT_CONFIGURATION_CODES.none_single}>Single / Combined (0)</option>
                  </select>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={loading || hasErrors}
              onClick={handleEvaluate}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
            >
              <Cpu className="h-4 w-4" />
              <span>{loading ? 'Evaluating Design...' : 'Predict, Diagnose & Optimize'}</span>
            </button>
          </div>
        </div>

        {/* Right Preview & Evaluation Output */}
        <div className="space-y-5 xl:col-span-7">
          {stlBuffer ? (
            <STLPreview3D buffer={stlBuffer} fileName={fileInfo?.name} />
          ) : imagePreviewUrl ? (
            <div className="glass-panel overflow-hidden rounded-xl p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-mono text-cyan-300">
                <ImageIcon className="h-4 w-4" />
                <span>Uploaded Antenna Layout Image</span>
              </div>
              <img
                src={imagePreviewUrl}
                alt="Uploaded antenna reference"
                referrerPolicy="no-referrer"
                className="max-h-72 w-full rounded-lg object-contain bg-[#040814]"
              />
            </div>
          ) : (
            <AntennaViewport3D
              params={params}
              prediction={prediction}
              heightClass="h-[340px]"
              titleBadge="Parametric 3D Reconstruction"
            />
          )}

          {prediction && faults && (
            <div className="glass-panel space-y-4 rounded-xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl font-bold italic text-white">
                    Evaluation & Optimization Comparison
                  </h3>
                  <p className="text-xs text-slate-400">
                    <span className="font-mono text-amber-300">Demo estimate</span> · Health Score:{' '}
                    <span className="font-mono text-cyan-300">{faults.healthScore}/100</span> ·{' '}
                    {faults.faults.length} diagnostic item(s) detected
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => downloadAntennaPDF(params, prediction)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-[#0b1633] px-3 py-1.5 text-xs font-semibold text-sky-200 hover:border-cyan-400"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>PDF Report</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadAntennaCSV(params, prediction)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-[#0b1633] px-3 py-1.5 text-xs font-semibold text-sky-200 hover:border-cyan-400"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>CSV (21-Feat)</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono tabular-nums">
                <div className="rounded-lg bg-[#040814] p-3">
                  <div className="font-sans text-[11px] text-slate-400">Uploaded Gain</div>
                  <div className="text-lg font-bold text-white">{prediction.gainDbi} dBi</div>
                  <div className="text-[11px] text-cyan-300">
                    Optimized: {faults.correctedPrediction.gainDbi} dBi
                  </div>
                </div>
                <div className="rounded-lg bg-[#040814] p-3">
                  <div className="font-sans text-[11px] text-slate-400">Bandwidth (−10 dB)</div>
                  <div className="text-lg font-bold text-white">
                    {prediction.bandwidthMHz > 0 ? `${prediction.bandwidthMHz} MHz` : '0 MHz'}
                  </div>
                  {prediction.bandwidthMHz <= 0 ? (
                    <div className="text-[11px] text-rose-300">
                      No −10 dB bandwidth achieved
                    </div>
                  ) : null}
                  <div className="text-[11px] text-cyan-300">
                    Optimized: {faults.correctedPrediction.bandwidthMHz} MHz
                  </div>
                </div>
                <div className="rounded-lg bg-[#040814] p-3">
                  <div className="font-sans text-[11px] text-slate-400">Efficiency</div>
                  <div className="text-lg font-bold text-white">{prediction.efficiencyPct}%</div>
                  <div className="text-[11px] text-cyan-300">
                    Optimized: {faults.correctedPrediction.efficiencyPct}%
                  </div>
                </div>
                <div className="rounded-lg bg-[#040814] p-3">
                  <div className="font-sans text-[11px] text-slate-400">Return Loss S11</div>
                  <div className="text-lg font-bold text-white">{prediction.returnLossDb} dB</div>
                  <div className="text-[11px] text-cyan-300">
                    Optimized: {faults.correctedPrediction.returnLossDb} dB
                  </div>
                </div>
              </div>

              {faults.faults.length > 0 && (
                <div className="space-y-2">
                  {faults.faults.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-start gap-2.5 rounded-lg border border-sky-400/15 bg-[#040814]/80 p-3 text-xs"
                    >
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      <div>
                        <span className="font-semibold text-white">{f.title}: </span>
                        <span className="text-slate-300">{f.recommendation}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  onApplyToStudio(faults.correctedParams, faults.correctedPrediction)
                }
                className="rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Apply Optimized Parameters to Studio
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
