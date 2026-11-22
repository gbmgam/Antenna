import React, { useState } from 'react';
import { ArrowRight, Download, FileText, History, Trash2 } from 'lucide-react';
import type {
  AntennaDesignParams,
  HistoryRecord,
  PredictionResult,
} from '../shared/antennaTypes.ts';
import { TOPOLOGY_LABELS } from '../shared/rfPhysics.ts';
import {
  FEATURE_ORDER,
  OUTPUT_ORDER,
  buildFeatureRecord21,
} from '../shared/antennaSchema.ts';
import { downloadAntennaCSV, downloadAntennaPDF } from '../utils/reportGenerator.ts';
import { CrossValidationReportPanel } from '../components/CrossValidationReportPanel.tsx';

interface HistoryPageProps {
  history: HistoryRecord[];
  onLoadDesign: (params: AntennaDesignParams, prediction: PredictionResult) => void;
  onDeleteRecord: (id: string) => Promise<void>;
}

export const PredictionHistoryPage: React.FC<HistoryPageProps> = ({
  history,
  onLoadDesign,
  onDeleteRecord,
}) => {
  const [filterType, setFilterType] = useState<string>('all');

  const filtered =
    filterType === 'all' ? history : history.filter((r) => r.type === filterType);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-sky-400/15 pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs tracking-wider text-cyan-400">
            MODULE 11 · PREDICTION HISTORY · DEMO ESTIMATE ARCHIVE
          </p>
          <h1 className="section-heading-italic text-3xl text-white">
            Saved Antenna Designs, Predictions & Optimization Runs
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Stored surrogate predictions represent synthetic analytical Demo estimates calibrated across 21 features.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-lg bg-[#0b1633] p-1 border border-sky-400/20">
          {[
            ['all', 'All Runs'],
            ['prediction', 'Studio'],
            ['nsga2_optimization', 'NSGA-II'],
            ['assistant', 'Assistant'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterType(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filterType === key
                  ? 'bg-cyan-400 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel rounded-xl p-10 text-center text-sm text-slate-400">
          No recorded runs match this filter yet.
        </div>
      ) : (
        <div className="glass-panel overflow-x-auto rounded-xl p-5">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-sky-400/20 text-slate-400">
                <th className="py-2.5">Design Name</th>
                <th className="py-2.5">Type</th>
                <th className="py-2.5">Topology</th>
                <th className="py-2.5">Freq</th>
                <th className="py-2.5">Gain</th>
                <th className="py-2.5">Bandwidth</th>
                <th className="py-2.5">Eff</th>
                <th className="py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-400/10">
              {filtered.map((rec) => (
                <tr key={rec.id} className="hover:bg-[#0b1633]/70">
                  <td className="py-3 font-semibold text-white">
                    <div>{rec.designName}</div>
                    <div className="font-mono text-[11px] font-normal text-slate-400">
                      {new Date(rec.timestamp).toLocaleString()}
                    </div>
                  </td>
                  <td className="py-3 font-mono text-cyan-300">{rec.type}</td>
                  <td className="py-3 text-slate-300">
                    {TOPOLOGY_LABELS[rec.params.topology]}
                  </td>
                  <td className="py-3 font-mono tabular-nums text-white">
                    {rec.params.operatingFreqGHz} GHz
                  </td>
                  <td className="py-3 font-mono tabular-nums text-cyan-300">
                    {rec.prediction.gainDbi} dBi
                  </td>
                  <td className="py-3 font-mono tabular-nums text-white">
                    {rec.prediction.bandwidthMHz} MHz
                  </td>
                  <td className="py-3 font-mono tabular-nums text-white">
                    {rec.prediction.efficiencyPct}%
                  </td>
                  <td className="py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onLoadDesign(rec.params, rec.prediction)}
                        className="inline-flex items-center gap-1 rounded border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/25"
                      >
                        <span>Load</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="Delete record"
                        onClick={() => onDeleteRecord(rec.id)}
                        className="rounded border border-slate-700 p-1.5 text-slate-400 hover:border-rose-500/50 hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

interface ReportsPageProps {
  activeDesign: AntennaDesignParams;
  activePrediction: PredictionResult | null;
  history: HistoryRecord[];
}

export const DownloadReportsPage: React.FC<ReportsPageProps> = ({
  activeDesign,
  activePrediction,
  history,
}) => {

  const downloadTextFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllHistoryCSV = () => {
    const header = [
      'Timestamp',
      'designName',
      'Type',
      'Topology',
      ...FEATURE_ORDER,
      ...OUTPUT_ORDER,
      'Cost_USD',
      'EstimationLabel',
    ].join(',');
    const body = history
      .map((r) => {
        const vec = buildFeatureRecord21(r.params);
        return [
          r.timestamp,
          `"${r.designName.replace(/"/g, '""')}"`,
          r.type,
          r.params.topology,
          ...FEATURE_ORDER.map((k) => vec[k]),
          r.prediction.gainDbi,
          r.prediction.bandwidthMHz,
          r.prediction.resonantFreqGHz,
          r.prediction.efficiencyPct,
          r.prediction.estimatedCostUsd,
          `"Demo estimate"`,
        ].join(',');
      })
      .join('\n');
    downloadTextFile('antenna_ai_full_history.csv', `${header}\n${body}`);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-sky-400/15 pb-4">
        <p className="font-mono text-xs tracking-wider text-cyan-400">
          MODULE 10 · DOWNLOAD REPORTS
        </p>
        <h1 className="section-heading-italic text-3xl text-white">
          Engineering PDF & CSV Reports
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="glass-panel flex flex-col justify-between rounded-xl p-6">
          <div>
            <FileText className="h-6 w-6 text-cyan-400" />
            <h3 className="mt-3 font-display text-xl font-bold italic text-white">
              PDF Engineering Report
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              Comprehensive datasheet for <strong className="text-white">{activeDesign.name}</strong>{' '}
              including 21-feature stackup, Demo estimate ML predictions, and model provenance.
            </p>
          </div>
          <button
            type="button"
            disabled={!activePrediction}
            onClick={() => activePrediction && downloadAntennaPDF(activeDesign, activePrediction)}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span>Download PDF Report</span>
          </button>
        </div>

        <div className="glass-panel flex flex-col justify-between rounded-xl p-6">
          <div>
            <History className="h-6 w-6 text-cyan-400" />
            <h3 className="mt-3 font-display text-xl font-bold italic text-white">
              CSV Design & History Tables
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              Export the active antenna parameter sheet or all {history.length} saved runs with the
              complete 21-feature vector, 4 outputs, and Demo estimate provenance.
            </p>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              disabled={!activePrediction}
              onClick={() => activePrediction && downloadAntennaCSV(activeDesign, activePrediction)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Active Design CSV</span>
            </button>
            <button
              type="button"
              onClick={exportAllHistoryCSV}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-400/25 bg-[#0b1633] px-4 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-400"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Full History CSV</span>
            </button>
          </div>
        </div>
      </div>

      <CrossValidationReportPanel />
    </div>
  );
};
