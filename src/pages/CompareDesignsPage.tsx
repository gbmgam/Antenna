import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, Award, FileUp, GitCompare } from 'lucide-react';
import type { HistoryRecord } from '../shared/antennaTypes.ts';
import { TOPOLOGY_LABELS } from '../shared/rfPhysics.ts';
import { predictAntenna } from '../utils/apiClient.ts';
import { parseUploadedDesignFile } from '../utils/designImport.ts';
import { AntennaViewport3D } from '../components/AntennaViewport3D.tsx';

interface CompareDesignsPageProps {
  history: HistoryRecord[];
  onRefreshHistory?: () => Promise<void>;
}

type ObjectiveFocus = 'balanced' | 'max_gain' | 'max_bw' | 'compact_low_cost';

export const CompareDesignsPage: React.FC<CompareDesignsPageProps> = ({
  history,
  onRefreshHistory,
}) => {
  const [uploadedRecords, setUploadedRecords] = useState<HistoryRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const available = useMemo(() => {
    const seenIds = new Set<string>();
    const combined: HistoryRecord[] = [];
    for (const rec of [...uploadedRecords, ...history]) {
      if (!seenIds.has(rec.id)) {
        seenIds.add(rec.id);
        combined.push(rec);
      }
    }
    return combined.slice(0, 12);
  }, [uploadedRecords, history]);

  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    available.slice(0, Math.min(3, available.length)).map((r) => r.id),
  );
  const [objective, setObjective] = useState<ObjectiveFocus>('balanced');

  const compared = useMemo(
    () => available.filter((r) => selectedIds.includes(r.id)),
    [available, selectedIds],
  );

  const handleUploadDesigns = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadNotice(null);
    try {
      const parsed = await parseUploadedDesignFile(file, 2.45);
      if (!parsed.ok || parsed.designs.length === 0) {
        setUploadError(parsed.errors[0] || parsed.notice);
        return;
      }

      const toEvaluate = parsed.designs.slice(0, 6);
      const createdRecords: HistoryRecord[] = [];
      for (const design of toEvaluate) {
        const pred = await predictAntenna(design, 'ensemble', true, 'evaluation');
        createdRecords.push({
          id: `cmp-up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date().toISOString(),
          type: 'evaluation',
          designName: design.name,
          params: design,
          prediction: pred,
        });
      }

      setUploadedRecords((prev) => [...createdRecords, ...prev]);
      setSelectedIds((prev) => {
        const newIds = createdRecords.map((r) => r.id);
        const merged = [...newIds, ...prev.filter((id) => !newIds.includes(id))];
        return merged.slice(0, 4);
      });
      setUploadNotice(
        `Evaluated and added ${createdRecords.length} uploaded design(s) from ${file.name} to the comparison matrix.`,
      );
      if (onRefreshHistory) {
        await onRefreshHistory();
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to evaluate uploaded design');
    } finally {
      setUploading(false);
    }
  };

  const toggleDesign = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.length > 2
          ? prev.filter((x) => x !== id)
          : prev
        : prev.length < 4
          ? [...prev, id]
          : [...prev.slice(1), id],
    );
  };

  const winner = useMemo(() => {
    if (compared.length === 0) return null;
    const maxGain = Math.max(...compared.map((c) => c.prediction.gainDbi), 1);
    const maxBw = Math.max(...compared.map((c) => c.prediction.bandwidthMHz), 1);
    const minArea = Math.min(...compared.map((c) => c.prediction.areaMm2), 1);
    const minCost = Math.min(...compared.map((c) => c.prediction.estimatedCostUsd), 1);

    let best = compared[0];
    let bestScore = -Infinity;

    for (const item of compared) {
      const p = item.prediction;
      let score = 0;
      if (objective === 'max_gain') {
        score = p.gainDbi * 0.7 + p.efficiencyPct * 0.3;
      } else if (objective === 'max_bw') {
        score = (p.bandwidthMHz / maxBw) * 80 + p.efficiencyPct * 0.2;
      } else if (objective === 'compact_low_cost') {
        score = (minArea / p.areaMm2) * 50 + (minCost / p.estimatedCostUsd) * 50;
      } else {
        score =
          (p.gainDbi / maxGain) * 35 +
          (p.bandwidthMHz / maxBw) * 25 +
          (p.efficiencyPct / 100) * 25 +
          (minArea / p.areaMm2) * 15;
      }
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }, [compared, objective]);

  const barData = compared.map((c) => ({
    name: c.designName.slice(0, 18),
    gainDbi: c.prediction.gainDbi,
    bandwidthMHz: c.prediction.bandwidthMHz,
    efficiencyPct: c.prediction.efficiencyPct,
  }));

  const radarData = useMemo(() => {
    if (compared.length === 0) return [];
    const maxGain = Math.max(...compared.map((c) => c.prediction.gainDbi), 12);
    const maxBw = Math.max(...compared.map((c) => c.prediction.bandwidthMHz), 150);
    const maxArea = Math.max(...compared.map((c) => c.prediction.areaMm2), 5000);
    const metrics = [
      { axis: 'Gain', fn: (r: HistoryRecord) => Math.round((r.prediction.gainDbi / maxGain) * 100) },
      {
        axis: 'Bandwidth',
        fn: (r: HistoryRecord) => Math.round((r.prediction.bandwidthMHz / maxBw) * 100),
      },
      { axis: 'Efficiency', fn: (r: HistoryRecord) => Math.round(r.prediction.efficiencyPct) },
      {
        axis: 'Compactness',
        fn: (r: HistoryRecord) => Math.round((1 - r.prediction.areaMm2 / (maxArea * 1.15)) * 100),
      },
      {
        axis: 'Impedance Match',
        fn: (r: HistoryRecord) => Math.min(100, Math.round(Math.abs(r.prediction.returnLossDb) * 3.5)),
      },
    ];
    return metrics.map((m) => {
      const row: Record<string, string | number> = { axis: m.axis };
      compared.forEach((c, idx) => {
        row[`d${idx}`] = Math.max(10, m.fn(c));
      });
      return row;
    });
  }, [compared]);

  const colors = ['#22d3ee', '#3b82f6', '#f59e0b', '#10b981'];
  const allTrained = compared.length > 0 && compared.every((c) => !c.prediction.isDemoEstimate);
  const engineLabel = allTrained ? 'Trained ML (.joblib)' : 'Demo estimate';

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-sky-400/15 pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs tracking-wider text-cyan-400">
            MODULE 08 · COMPARISON DASHBOARD
          </p>
          <h1 className="section-heading-italic text-3xl text-white">
            Multi-Design Electromagnetic & 3D Benchmark Matrix
          </h1>
        </div>

        <select
          aria-label="Recommendation Objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value as ObjectiveFocus)}
          className="rounded-lg border border-sky-400/25 bg-[#0b1633] px-3 py-2 text-xs font-semibold text-cyan-200"
        >
          <option value="balanced">Objective: Balanced Performance</option>
          <option value="max_gain">Objective: Maximum Gain (dBi)</option>
          <option value="max_bw">Objective: Widest Bandwidth (MHz)</option>
          <option value="compact_low_cost">Objective: Compact & Low Cost</option>
        </select>
      </div>

      {/* Upload Design to Compare */}
      <div className="glass-panel rounded-xl p-4 space-y-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-base font-bold italic text-white">
              Upload Antenna Design to Compare
            </h2>
            <p className="text-xs text-slate-400">
              Upload a design file (.csv, .xlsx, .json, .stl) to predict its RF metrics and add it directly to the comparison matrix.
            </p>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-cyan-400/50 bg-[#040814] px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:border-cyan-300 hover:bg-cyan-950/25 shrink-0">
            <FileUp className="h-4 w-4 text-cyan-400" />
            <span>
              {uploading ? 'Evaluating uploaded design...' : 'Upload Design (CSV / XLSX / JSON / STL)'}
            </span>
            <input
              type="file"
              disabled={uploading}
              accept=".csv,.xlsx,.xls,.json,.stl"
              onChange={(e) => {
                handleUploadDesigns(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>
        </div>

        {uploadNotice && (
          <div className="rounded-lg border border-emerald-400/35 bg-emerald-950/25 px-3 py-2 text-xs text-emerald-200">
            {uploadNotice}
          </div>
        )}
        {uploadError && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/35 px-3 py-2 text-xs text-rose-200">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* Candidate Selection Bar */}
      <div className="glass-panel flex flex-wrap items-center gap-2 rounded-xl p-4">
        <span className="mr-2 flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
          <GitCompare className="h-4 w-4" />
          <span>Compare (2–4 designs):</span>
        </span>
        {available.map((rec) => {
          const active = selectedIds.includes(rec.id);
          return (
            <button
              key={rec.id}
              type="button"
              onClick={() => toggleDesign(rec.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-cyan-400 bg-cyan-500/20 text-white'
                  : 'border-sky-400/20 bg-[#040814] text-slate-400 hover:text-white'
              }`}
            >
              {rec.designName}
            </button>
          );
        })}
      </div>

      {/* Recommended Winner Banner */}
      {winner && (
        <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-xl border-cyan-400/40 p-5">
          <div className="flex items-center gap-3">
            <Award className="h-8 w-8 text-cyan-400" />
            <div>
              <div className="font-mono text-xs text-cyan-300">
                RECOMMENDED WINNER ·{' '}
                {winner.prediction.isDemoEstimate ? 'DEMO ESTIMATE' : 'TRAINED ML (.JOBLIB)'}
              </div>
              <div className="font-display text-xl font-bold italic text-white">
                {winner.designName} ({TOPOLOGY_LABELS[winner.params.topology]})
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-6 font-mono text-xs tabular-nums">
            <div>
              <div className="text-slate-400">Gain</div>
              <div className="text-base font-bold text-cyan-300">{winner.prediction.gainDbi} dBi</div>
            </div>
            <div>
              <div className="text-slate-400">Bandwidth</div>
              <div className="text-base font-bold text-white">
                {winner.prediction.bandwidthMHz} MHz
              </div>
            </div>
            <div>
              <div className="text-slate-400">Efficiency</div>
              <div className="text-base font-bold text-white">
                {winner.prediction.efficiencyPct}%
              </div>
            </div>
            <div>
              <div className="text-slate-400">Footprint</div>
              <div className="text-base font-bold text-white">{winner.prediction.areaMm2} mm²</div>
            </div>
          </div>
        </div>
      )}

      {/* Bar & Radar Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="glass-panel rounded-xl p-5">
          <h3 className="mb-3 font-display text-base font-bold italic text-white">
            Gain & Efficiency Comparison · {engineLabel}
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid stroke="rgba(56,189,248,0.1)" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <YAxis stroke="#22d3ee" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#060d20',
                    border: '1px solid rgba(56,189,248,0.3)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend />
                <Bar dataKey="gainDbi" name="Gain (dBi)" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="efficiencyPct"
                  name="Efficiency (%)"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-panel rounded-xl p-5">
          <h3 className="mb-3 font-display text-base font-bold italic text-white">
            Normalized Multi-Metric Radar Calibration
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(56,189,248,0.2)" />
                <PolarAngleAxis dataKey="axis" stroke="#cbd5e1" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                {compared.map((c, idx) => (
                  <Radar
                    key={c.id}
                    name={c.designName}
                    dataKey={`d${idx}`}
                    stroke={colors[idx % colors.length]}
                    fill={colors[idx % colors.length]}
                    fillOpacity={0.18}
                  />
                ))}
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Side-by-Side 3D Antenna Viewers */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {compared.slice(0, 2).map((item) => (
          <div key={item.id} className="space-y-2">
            <div className="flex items-center justify-between font-mono text-xs text-cyan-300">
              <span>{item.designName}</span>
              <span>
                {item.prediction.gainDbi} dBi · {item.prediction.bandwidthMHz} MHz · $
                {item.prediction.estimatedCostUsd}
              </span>
            </div>
            <AntennaViewport3D
              params={item.params}
              prediction={item.prediction}
              heightClass="h-[320px]"
              compact
              titleBadge={item.designName}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
