import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, FileUp, Radar } from 'lucide-react';
import type {
  AntennaDesignParams,
  HistoryRecord,
  PredictionResult,
} from '../shared/antennaTypes.ts';
import {
  SPEED_OF_LIGHT_MM_GHZ,
  SUBSTRATE_CATALOG,
  TOPOLOGY_LABELS,
  synthesizeCircularRadiusMm,
  synthesizePatchGeometry,
} from '../shared/rfPhysics.ts';
import { evaluateMultiFrequency, predictAntenna } from '../utils/apiClient.ts';
import { parseUploadedDesignFile } from '../utils/designImport.ts';
import { AntennaViewport3D } from '../components/AntennaViewport3D.tsx';

interface MultiFrequencyPageProps {
  activeDesign: AntennaDesignParams;
  history?: HistoryRecord[];
}

const STANDARD_BANDS = [
  { id: 'iot_868', label: 'IoT EU (868 MHz)', freq: 0.868, group: 'IoT' },
  { id: 'iot_915', label: 'IoT ISM (915 MHz)', freq: 0.915, group: 'IoT' },
  { id: 'ble_240', label: 'Bluetooth BLE (2.40 GHz)', freq: 2.402, group: 'Bluetooth' },
  { id: 'wifi_245', label: 'Wi-Fi 2.45 GHz', freq: 2.45, group: 'Wi-Fi' },
  { id: '5g_350', label: '5G Sub-6 (3.50 GHz)', freq: 3.5, group: '5G' },
  { id: 'wifi_580', label: 'Wi-Fi 5.80 GHz', freq: 5.8, group: 'Wi-Fi' },
  { id: '5g_240', label: '5G mmWave (24.0 GHz)', freq: 24.0, group: '5G' },
  { id: '5g_280', label: '5G mmWave (28.0 GHz)', freq: 28.0, group: '5G' },
];

export const MultiFrequencyPage: React.FC<MultiFrequencyPageProps> = ({
  activeDesign,
  history = [],
}) => {
  const [targetDesign, setTargetDesign] = useState<AntennaDesignParams>(activeDesign);
  const [sourceLabel, setSourceLabel] = useState<'studio' | 'history' | 'upload'>('studio');
  const [uploadedDesigns, setUploadedDesigns] = useState<AntennaDesignParams[]>([]);
  const [selectedUploadIdx, setSelectedUploadIdx] = useState(0);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [selectedFreqs, setSelectedFreqs] = useState<number[]>([0.915, 2.402, 2.45, 3.5, 5.8, 28.0]);
  const [scaleToBand, setScaleToBand] = useState(true);
  const [sweepRows, setSweepRows] = useState<
    Array<{
      freqGHz: number;
      gainDbi: number;
      bandwidthMHz: number;
      resonantFreqGHz: number;
      efficiencyPct: number;
      returnLossDb: number;
    }>
  >([]);
  const [sweepIsDemo, setSweepIsDemo] = useState<boolean>(true);
  const [inspectedFreq, setInspectedFreq] = useState<number>(2.45);
  const [inspectedParams, setInspectedParams] = useState<AntennaDesignParams>(activeDesign);
  const [inspectedPred, setInspectedPred] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Sync studio design updates if user hasn't explicitly switched to an uploaded/history item
  useEffect(() => {
    if (sourceLabel === 'studio') {
      setTargetDesign(activeDesign);
    }
  }, [activeDesign, sourceLabel]);

  const handleUploadFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploadNotice(null);
    const parsed = await parseUploadedDesignFile(file, targetDesign.operatingFreqGHz);
    if (!parsed.ok || parsed.designs.length === 0) {
      setUploadError(parsed.errors[0] || parsed.notice);
      return;
    }
    setUploadedDesigns(parsed.designs);
    setSelectedUploadIdx(0);
    setSourceLabel('upload');
    setTargetDesign(parsed.designs[0]);
    setUploadNotice(parsed.notice);
  };

  const buildScaledBandDesign = (base: AntennaDesignParams, f: number): AntennaDesignParams => {
    const synth = synthesizePatchGeometry(
      f,
      base.dielectricConstant,
      base.substrateHeightMm,
    );
    const isCircular = base.topology === 'circular_patch';
    const circR = synthesizeCircularRadiusMm(
      f,
      base.dielectricConstant,
      base.substrateHeightMm,
    );
    const halfLambda = Number(((SPEED_OF_LIGHT_MM_GHZ / Math.max(0.3, f)) * 0.5).toFixed(2));
    return {
      ...base,
      operatingFreqGHz: f,
      patchLengthMm: isCircular ? 0 : Number(synth.lengthMm.toFixed(2)),
      patchWidthMm: isCircular ? 0 : Number(synth.widthMm.toFixed(2)),
      patchRadiusMm: isCircular ? circR : 0,
      feedXMm: isCircular
        ? Number((circR * 0.35).toFixed(2))
        : Number(synth.optimalFeedXMm.toFixed(2)),
      feedYMm: 0,
      insetDepthMm:
        base.topology === 'microstrip_patch'
          ? Number(synth.optimalFeedXMm.toFixed(2))
          : 0,
      notchWidthMm:
        base.topology === 'microstrip_patch'
          ? Number(Math.max(0.6, synth.widthMm * 0.08).toFixed(2))
          : 0,
      elementSpacingXmm:
        base.topology === 'array_2x2' || base.topology === 'multi_element_mimo'
          ? halfLambda
          : 0,
      elementSpacingYmm:
        base.topology === 'array_2x2' || base.topology === 'multi_element_mimo'
          ? halfLambda
          : 0,
    };
  };

  const runSweep = async () => {
    setLoading(true);
    try {
      const sorted = [...selectedFreqs].sort((a, b) => a - b);
      if (scaleToBand) {
        const preds = await Promise.all(
          sorted.map(async (f) => {
            const bandDesign = buildScaledBandDesign(targetDesign, f);
            const pred = await predictAntenna(bandDesign, 'ensemble', false);
            return { f, pred };
          }),
        );
        if (preds.length > 0) {
          setSweepIsDemo(preds[0].pred.isDemoEstimate);
        }
        setSweepRows(
          preds.map(({ f, pred }) => ({
            freqGHz: f,
            gainDbi: pred.gainDbi,
            bandwidthMHz: pred.bandwidthMHz,
            resonantFreqGHz: pred.resonantFreqGHz,
            efficiencyPct: pred.efficiencyPct,
            returnLossDb: pred.returnLossDb,
          })),
        );
      } else {
        const res = await evaluateMultiFrequency(targetDesign, sorted);
        setSweepRows(res.results);
        if (typeof res.isDemoEstimate === 'boolean') {
          setSweepIsDemo(res.isDemoEstimate);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSweep();
  }, [selectedFreqs, scaleToBand, targetDesign]);

  useEffect(() => {
    const updateInspected = async () => {
      const p: AntennaDesignParams = scaleToBand
        ? buildScaledBandDesign(targetDesign, inspectedFreq)
        : { ...targetDesign, operatingFreqGHz: inspectedFreq };
      setInspectedParams(p);
      const pred = await predictAntenna(p, 'ensemble', false);
      setInspectedPred(pred);
    };
    updateInspected();
  }, [inspectedFreq, scaleToBand, targetDesign]);

  const toggleFreq = (f: number) => {
    setSelectedFreqs((prev) =>
      prev.includes(f) ? (prev.length > 2 ? prev.filter((v) => v !== f) : prev) : [...prev, f],
    );
  };

  const shortDesignTitle = targetDesign.name || `${targetDesign.operatingFreqGHz} GHz ${TOPOLOGY_LABELS[targetDesign.topology]}`;
  const geomSummary =
    targetDesign.topology === 'circular_patch'
      ? `R=${targetDesign.patchRadiusMm} mm`
      : `${targetDesign.patchLengthMm}×${targetDesign.patchWidthMm} mm`;
  const activeEngineLabel = (inspectedPred ? inspectedPred.isDemoEstimate : sweepIsDemo)
    ? 'Demo estimate'
    : 'Trained ML (.joblib)';
  const isDemoActive = inspectedPred ? inspectedPred.isDemoEstimate : sweepIsDemo;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-sky-400/15 pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs tracking-wider text-cyan-400">
            MODULE 06 · MULTI-FREQUENCY PREDICTION
          </p>
          <h1 className="section-heading-italic text-3xl text-white">
            Wi-Fi · Bluetooth · IoT · 5G Frequency-Dependent Performance
          </h1>
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-sky-400/25 bg-[#0b1633] px-3 py-2 text-xs text-slate-200">
          <input
            type="checkbox"
            checked={scaleToBand}
            onChange={(e) => setScaleToBand(e.target.checked)}
            className="accent-cyan-400"
          />
          <span>Auto-tune geometry per band (compare ideal band capability)</span>
        </label>
      </div>

      {/* Design Selector & Upload Bar */}
      <div className="glass-panel rounded-xl p-4 space-y-3">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-semibold text-cyan-300">Checked Antenna Design:</span>
            <button
              type="button"
              onClick={() => {
                setSourceLabel('studio');
                setTargetDesign(activeDesign);
                setUploadNotice(null);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                sourceLabel === 'studio'
                  ? 'border-cyan-400 bg-cyan-500/20 text-white'
                  : 'border-sky-400/20 bg-[#040814] text-slate-300 hover:border-cyan-400/50'
              }`}
            >
              Active Studio ({activeDesign.name})
            </button>

            {history.length > 0 && (
              <select
                aria-label="Choose saved antenna design"
                value={sourceLabel === 'history' ? targetDesign.id : ''}
                onChange={(e) => {
                  const rec = history.find((h) => h.id === e.target.value);
                  if (rec) {
                    setSourceLabel('history');
                    setTargetDesign(rec.params);
                    setUploadNotice(null);
                  }
                }}
                className="rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-1.5 text-xs text-slate-200"
              >
                <option value="">Load from Saved History...</option>
                {history.slice(0, 10).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.designName} ({TOPOLOGY_LABELS[h.params.topology]} · {h.params.operatingFreqGHz} GHz)
                  </option>
                ))}
              </select>
            )}
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
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-400/35 bg-emerald-950/25 px-3 py-2 text-xs text-emerald-200">
            <span>{uploadNotice}</span>
            {uploadedDesigns.length > 1 && (
              <select
                aria-label="Select uploaded antenna row"
                value={selectedUploadIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setSelectedUploadIdx(idx);
                  if (uploadedDesigns[idx]) {
                    setTargetDesign(uploadedDesigns[idx]);
                  }
                }}
                className="rounded border border-emerald-400/35 bg-[#040814] px-2.5 py-1 text-xs text-white"
              >
                {uploadedDesigns.map((d, idx) => (
                  <option key={d.id} value={idx}>
                    Row #{idx + 1}: {d.name} ({TOPOLOGY_LABELS[d.topology]})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {uploadError && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/35 px-3 py-2 text-xs text-rose-200">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* Band Selector Buttons */}
      <div className="glass-panel flex flex-wrap items-center gap-2 rounded-xl p-4">
        <span className="mr-2 flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
          <Radar className="h-4 w-4" />
          <span>Active Bands:</span>
        </span>
        {STANDARD_BANDS.map((band) => {
          const active = selectedFreqs.includes(band.freq);
          return (
            <button
              key={band.id}
              type="button"
              onClick={() => toggleFreq(band.freq)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                  : 'border-sky-400/20 bg-[#040814] text-slate-400 hover:text-white'
              }`}
            >
              {band.label}
            </button>
          );
        })}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="glass-panel rounded-xl p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold italic text-white">
                Gain (dBi) & Efficiency (%) vs. Frequency
              </h3>
              <p className="mt-0.5 font-mono text-[11px] text-cyan-300">
                Design: {shortDesignTitle} · {TOPOLOGY_LABELS[targetDesign.topology]} ·{' '}
                {SUBSTRATE_CATALOG[targetDesign.substrateMaterial].name} ({geomSummary}, h=
                {targetDesign.substrateHeightMm} mm)
              </p>
            </div>
            <span
              className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                isDemoActive
                  ? 'border-amber-400/40 bg-amber-950/35 text-amber-200'
                  : 'border-emerald-400/40 bg-emerald-950/35 text-emerald-200'
              }`}
            >
              {activeEngineLabel} · {scaleToBand ? 'Band-Tuned' : 'Fixed Geometry'}
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sweepRows}>
                <CartesianGrid stroke="rgba(56,189,248,0.1)" strokeDasharray="3 3" />
                <XAxis dataKey="freqGHz" stroke="#94a3b8" tick={{ fontSize: 11 }} unit=" GHz" />
                <YAxis yAxisId="g" stroke="#22d3ee" tick={{ fontSize: 11 }} unit=" dBi" />
                <YAxis
                  yAxisId="e"
                  orientation="right"
                  stroke="#60a5fa"
                  tick={{ fontSize: 11 }}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#060d20',
                    border: '1px solid rgba(56,189,248,0.3)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line
                  yAxisId="g"
                  type="monotone"
                  dataKey="gainDbi"
                  name={`Gain (dBi) — ${shortDesignTitle.slice(0, 24)}`}
                  stroke="#22d3ee"
                  strokeWidth={2.5}
                />
                <Line
                  yAxisId="e"
                  type="monotone"
                  dataKey="efficiencyPct"
                  name={`Efficiency (%) — ${shortDesignTitle.slice(0, 24)}`}
                  stroke="#60a5fa"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-panel rounded-xl p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold italic text-white">
                Bandwidth (MHz) vs. Frequency Band
              </h3>
              <p className="mt-0.5 font-mono text-[11px] text-cyan-300">
                Model: {TOPOLOGY_LABELS[targetDesign.topology]} ({shortDesignTitle})
              </p>
            </div>
            <span className="font-mono text-[10px] text-slate-400">
              {scaleToBand ? 'Auto-tuned per band' : 'Fixed physical dims'}
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sweepRows}>
                <CartesianGrid stroke="rgba(56,189,248,0.1)" strokeDasharray="3 3" />
                <XAxis dataKey="freqGHz" stroke="#94a3b8" tick={{ fontSize: 11 }} unit=" GHz" />
                <YAxis stroke="#38bdf8" tick={{ fontSize: 11 }} unit=" MHz" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#060d20',
                    border: '1px solid rgba(56,189,248,0.3)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar
                  dataKey="bandwidthMHz"
                  name={`Bandwidth (MHz) — ${shortDesignTitle.slice(0, 24)}`}
                  fill="#06b6d4"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Frequency-Specific 3D Radiation Pattern + Table */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="glass-panel rounded-xl p-5 xl:col-span-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-base font-bold italic text-white">
              Multi-Frequency Response Table
            </h3>
            <span className="text-xs text-slate-400">
              <span
                className={`font-mono ${isDemoActive ? 'text-amber-300' : 'text-emerald-300'}`}
              >
                {activeEngineLabel}
              </span>{' '}
              · {loading ? 'Evaluating...' : 'Click a row to inspect 3D radiation lobe'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-sky-400/20 text-slate-400">
                  <th className="py-2">Freq (GHz)</th>
                  <th className="py-2">Gain (dBi)</th>
                  <th className="py-2">BW (MHz)</th>
                  <th className="py-2">Resonance</th>
                  <th className="py-2">Efficiency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-400/10 font-mono tabular-nums">
                {sweepRows.map((row) => (
                  <tr
                    key={row.freqGHz}
                    onClick={() => setInspectedFreq(row.freqGHz)}
                    className={`cursor-pointer transition-colors ${
                      inspectedFreq === row.freqGHz
                        ? 'bg-cyan-500/15 text-cyan-200'
                        : 'hover:bg-[#0b1633]'
                    }`}
                  >
                    <td className="py-2.5 font-semibold">{row.freqGHz} GHz</td>
                    <td className="py-2.5">{row.gainDbi} dBi</td>
                    <td className="py-2.5">{row.bandwidthMHz} MHz</td>
                    <td className="py-2.5">{row.resonantFreqGHz} GHz</td>
                    <td className="py-2.5">{row.efficiencyPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="xl:col-span-6">
          <AntennaViewport3D
            params={inspectedParams}
            prediction={inspectedPred}
            heightClass="h-[360px]"
            titleBadge={`${shortDesignTitle} @ ${inspectedFreq} GHz`}
          />
        </div>
      </div>
    </div>
  );
};
