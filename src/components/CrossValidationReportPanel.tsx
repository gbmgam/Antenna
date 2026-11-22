import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import type {
  CrossValidationMetricSummary,
  CrossValidationReport,
  PredictionTargetKey,
} from '../shared/antennaTypes.ts';
import { fetchModelMetrics } from '../utils/apiClient.ts';

interface CrossValidationReportPanelProps {
  compact?: boolean;
}

const TARGET_META: Array<{
  key: PredictionTargetKey;
  title: string;
  unit: string;
  decimals: number;
}> = [
  { key: 'gainDbi', title: 'Realized Gain', unit: 'dBi', decimals: 3 },
  { key: 'bandwidthMHz', title: 'Bandwidth (−10 dB)', unit: 'MHz', decimals: 1 },
  { key: 'resonantFreqGHz', title: 'Resonant Frequency', unit: 'GHz', decimals: 3 },
  { key: 'efficiencyPct', title: 'Efficiency', unit: '%', decimals: 2 },
];

function fmtStat(val: number, decimals: number): string {
  return val.toFixed(decimals);
}

function renderCell(summary: CrossValidationMetricSummary, unit: string, decimals: number) {
  return (
    <div className="space-y-0.5 font-mono text-[11px] tabular-nums">
      <div className="text-white">
        R² {summary.r2Mean.toFixed(3)} <span className="text-slate-400">± {summary.r2Std.toFixed(3)}</span>
      </div>
      <div className="text-cyan-300">
        MAE {fmtStat(summary.maeMean, decimals)} ± {fmtStat(summary.maeStd, decimals)} {unit}
      </div>
      <div className="text-slate-400">
        RMSE {fmtStat(summary.rmseMean, decimals)} ± {fmtStat(summary.rmseStd, decimals)} {unit}
      </div>
    </div>
  );
}

export const CrossValidationReportPanel: React.FC<CrossValidationReportPanelProps> = ({
  compact = false,
}) => {
  const [report, setReport] = useState<CrossValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchModelMetrics()
      .then((res) => {
        if (active && res.crossValidationReport) {
          setReport(res.crossValidationReport);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load CV report');
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/35 bg-rose-950/30 p-4 text-xs text-rose-200">
        {error}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="glass-panel rounded-xl p-5 text-xs text-slate-400">
        Loading 5-fold cross-validation report...
      </div>
    );
  }

  return (
    <div className="glass-panel space-y-5 rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sky-400/15 pb-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs text-cyan-400">
            <ShieldCheck className="h-4 w-4" />
            <span>
              {report.folds}-FOLD CROSS-VALIDATION REPORT · N={report.totalSamples} SAMPLES
            </span>
          </div>
          <h3 className="mt-1 font-display text-lg font-bold italic text-white">
            Per-Output Model Selection & Unscaled Error Metrics (Mean ± SD)
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Active default predictor routes each physical output to its lowest-RMSE validated model across all {report.folds} out-of-fold splits.
          </p>
        </div>
        <span className="rounded border border-amber-400/40 bg-amber-950/35 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-200">
          {report.provenance}
        </span>
      </div>

      {/* Bandwidth validation honesty notice */}
      <div
        className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
          report.bandwidthValidated
            ? 'border-emerald-400/35 bg-emerald-950/25 text-emerald-200'
            : 'border-amber-400/45 bg-amber-950/35 text-amber-200'
        }`}
      >
        {report.bandwidthValidated ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        )}
        <span>{report.bandwidthValidationNote}</span>
      </div>

      {/* Best Predictor Per Output Grid */}
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${compact ? 'lg:grid-cols-2' : 'lg:grid-cols-4'}`}>
        {TARGET_META.map((meta) => {
          const best = report.bestPredictorPerOutput[meta.key];
          return (
            <div
              key={meta.key}
              className="rounded-xl border border-sky-400/20 bg-[#0b1633]/85 p-3.5"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">{meta.title}</span>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                    best.validated
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {best.validated ? 'Validated' : 'Weak'}
                </span>
              </div>
              <div className="mt-1 text-xs font-semibold text-cyan-300">{best.label}</div>
              <div className="mt-2 space-y-0.5 font-mono text-[11px] tabular-nums">
                <div className="text-white">
                  R² {best.r2Mean.toFixed(3)} ± {best.r2Std.toFixed(3)}
                </div>
                <div className="text-slate-300">
                  MAE {fmtStat(best.maeMean, meta.decimals)} ± {fmtStat(best.maeStd, meta.decimals)}{' '}
                  {meta.unit}
                </div>
                <div className="text-slate-400">
                  RMSE {fmtStat(best.rmseMean, meta.decimals)} ±{' '}
                  {fmtStat(best.rmseStd, meta.decimals)} {meta.unit}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Full 5-Fold CV Comparison Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="border-b border-sky-400/20 text-slate-400">
              <th className="py-2 pr-3">Model</th>
              {TARGET_META.map((m) => (
                <th key={m.key} className="py-2 px-2">
                  {m.title} ({m.unit})
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-sky-400/10">
            {report.models.map((row) => (
              <tr
                key={row.model}
                className={
                  row.model === 'best_per_output'
                    ? 'bg-cyan-950/25'
                    : 'hover:bg-[#0b1633]/60'
                }
              >
                <td className="py-2.5 pr-3 align-top">
                  <div className="font-semibold text-white">{row.label}</div>
                  <div className="font-mono text-[10px] text-slate-400">{row.model}</div>
                </td>
                {TARGET_META.map((m) => (
                  <td key={m.key} className="py-2.5 px-2 align-top">
                    {renderCell(row[m.key], m.unit, m.decimals)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-400/15 pt-2.5 font-mono text-[10px] text-slate-400">
        <span>
          Dataset Physical Ranges: Gain [{report.datasetRanges.gainDbi[0]}, {report.datasetRanges.gainDbi[1]}] dBi ·
          BW [{report.datasetRanges.bandwidthMHz[0]}, {report.datasetRanges.bandwidthMHz[1]}] MHz ·
          Freq [{report.datasetRanges.resonantFreqGHz[0]}, {report.datasetRanges.resonantFreqGHz[1]}] GHz ·
          Eff [{report.datasetRanges.efficiencyPct[0]}, {report.datasetRanges.efficiencyPct[1]}]%
        </span>
        <span className="text-amber-300">{report.provenance}</span>
      </div>
    </div>
  );
};
