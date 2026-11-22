import React, { useEffect, useState } from 'react';
import { ArrowRight, Download, Play } from 'lucide-react';
import type {
  AntennaDesignParams,
  NSGA2Response,
  ParetoSolution,
  PredictionResult,
  SubstrateMaterial,
} from '../shared/antennaTypes.ts';
import {
  FEATURE_ORDER,
  OUTPUT_ORDER,
  buildFeatureRecord21,
} from '../shared/antennaSchema.ts';
import { SUBSTRATE_CATALOG, TOPOLOGY_LABELS } from '../shared/rfPhysics.ts';
import { runNSGA2Optimization } from '../utils/apiClient.ts';
import { AntennaViewport3D } from '../components/AntennaViewport3D.tsx';

interface OptimizationPageProps {
  activeDesign: AntennaDesignParams;
  activePrediction: PredictionResult | null;
  onApplyToStudio: (params: AntennaDesignParams, prediction: PredictionResult) => void;
}

export const OptimizationPage: React.FC<OptimizationPageProps> = ({
  activeDesign,
  activePrediction,
  onApplyToStudio,
}) => {
  const [targetFreq, setTargetFreq] = useState(activeDesign.operatingFreqGHz);
  const [substrate, setSubstrate] = useState<SubstrateMaterial>(activeDesign.substrateMaterial);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NSGA2Response | null>(null);
  const [selectedSol, setSelectedSol] = useState<ParetoSolution | null>(null);

  const executeNSGA2 = async () => {
    setLoading(true);
    try {
      const res = await runNSGA2Optimization(targetFreq, substrate);
      setResult(res);
      setSelectedSol(res.recommended);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    executeNSGA2();
  }, []);

  const downloadParetoCSV = () => {
    if (!result) return;
    const header =
      [
        'SolutionID',
        'TopologyLabel',
        ...FEATURE_ORDER,
        ...OUTPUT_ORDER,
        'Area_mm2',
        'Cost_USD',
        'Recommended',
        'EstimationLabel',
      ].join(',') + '\n';
    const body = result.paretoFront
      .map((s) => {
        const rec = buildFeatureRecord21(s.params);
        return [
          s.id,
          `"${TOPOLOGY_LABELS[s.params.topology]}"`,
          ...FEATURE_ORDER.map((k) => rec[k]),
          s.prediction.gainDbi,
          s.prediction.bandwidthMHz,
          s.prediction.resonantFreqGHz,
          s.prediction.efficiencyPct,
          s.prediction.areaMm2,
          s.prediction.estimatedCostUsd,
          s.isRecommendedKnee ? 'YES' : 'NO',
          '"Demo estimate"',
        ].join(',');
      })
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `antenna_ai_nsga2_pareto_${targetFreq}ghz.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-sky-400/15 pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs tracking-wider text-cyan-400">
            MODULE 08 · MULTI-OBJECTIVE OPTIMIZATION (NSGA-II)
          </p>
          <h1 className="section-heading-italic text-3xl text-white">
            Pareto Trade-Off Frontier: Gain · Bandwidth · Efficiency · Size · Cost
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            step={0.1}
            min={0.4}
            max={60}
            value={targetFreq}
            onChange={(e) => setTargetFreq(parseFloat(e.target.value) || 2.45)}
            className="w-24 rounded-lg border border-sky-400/25 bg-[#040814] px-2.5 py-2 font-mono text-xs text-white"
          />
          <select
            value={substrate}
            onChange={(e) => setSubstrate(e.target.value as SubstrateMaterial)}
            className="rounded-lg border border-sky-400/25 bg-[#040814] px-3 py-2 text-xs text-white"
          >
            {Object.values(SUBSTRATE_CATALOG).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={loading}
            onClick={executeNSGA2}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{loading ? 'Running NSGA-II...' : 'Run NSGA-II'}</span>
          </button>
          {result && (
            <button
              type="button"
              onClick={downloadParetoCSV}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-[#0b1633] px-3 py-2 text-xs font-semibold text-sky-200 hover:border-cyan-400"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Pareto CSV</span>
            </button>
          )}
        </div>
      </div>

      {result && (
        <>
          {selectedSol && (
            <div className="glass-panel flex flex-col justify-between gap-4 rounded-xl p-5 lg:flex-row lg:items-center">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-cyan-300">
                  <span>
                    {selectedSol.isRecommendedKnee
                      ? 'RECOMMENDED KNEE-POINT OPTIMUM'
                      : `PARETO CANDIDATE ${selectedSol.id.toUpperCase()}`}
                  </span>
                  <span className="text-amber-300">
                    Demo estimate · Crowding {selectedSol.crowdingDistance}
                  </span>
                  <span className="text-slate-400">
                    {result.provenance} · {result.allEvaluatedCount} candidate topologies evaluated
                  </span>
                </div>
                <h3 className="mt-1 font-display text-xl font-bold italic text-white">
                  {TOPOLOGY_LABELS[selectedSol.params.topology]}
                </h3>

                <div className="mt-4 grid grid-cols-2 gap-3 font-mono tabular-nums sm:grid-cols-4">
                  <div className="rounded-lg bg-[#040814] p-3">
                    <div className="font-sans text-[11px] text-slate-400">Gain</div>
                    <div className="text-lg font-bold text-cyan-300">
                      {selectedSol.prediction.gainDbi} dBi
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#040814] p-3">
                    <div className="font-sans text-[11px] text-slate-400">Bandwidth</div>
                    <div className="text-lg font-bold text-white">
                      {selectedSol.prediction.bandwidthMHz} MHz
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#040814] p-3">
                    <div className="font-sans text-[11px] text-slate-400">Efficiency</div>
                    <div className="text-lg font-bold text-white">
                      {selectedSol.prediction.efficiencyPct}%
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#040814] p-3">
                    <div className="font-sans text-[11px] text-slate-400">Size · Cost</div>
                    <div className="text-sm font-bold text-white">
                      {selectedSol.prediction.areaMm2} mm² · $
                      {selectedSol.prediction.estimatedCostUsd}
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onApplyToStudio(selectedSol.params, selectedSol.prediction)
                }
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-400 px-5 py-3 text-xs font-semibold text-slate-950 hover:bg-cyan-300 whitespace-nowrap"
              >
                <span>Load Selected Pareto Design to Studio</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Pareto Table + Side-by-Side 3D Comparison */}
          <div className="glass-panel overflow-x-auto rounded-xl p-5">
            <h3 className="mb-3 font-display text-base font-bold italic text-white">
              Pareto Trade-Off Matrix (Click any row to inspect 3D comparison)
            </h3>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-sky-400/20 text-slate-400">
                  <th className="py-2">Candidate</th>
                  <th className="py-2">Topology</th>
                  <th className="py-2">Gain (dBi)</th>
                  <th className="py-2">BW (MHz)</th>
                  <th className="py-2">Eff (%)</th>
                  <th className="py-2">Area (mm²)</th>
                  <th className="py-2">Cost ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-400/10 font-mono tabular-nums">
                {result.paretoFront.map((sol) => (
                  <tr
                    key={sol.id}
                    onClick={() => setSelectedSol(sol)}
                    className={`cursor-pointer transition-colors ${
                      selectedSol?.id === sol.id
                        ? 'bg-cyan-500/15 text-cyan-200'
                        : 'hover:bg-[#0b1633]'
                    }`}
                  >
                    <td className="py-2 font-semibold">
                      {sol.id} {sol.isRecommendedKnee ? '★ Best' : ''}
                    </td>
                    <td className="py-2 font-sans text-slate-200">
                      {TOPOLOGY_LABELS[sol.params.topology]}
                    </td>
                    <td className="py-2">{sol.prediction.gainDbi}</td>
                    <td className="py-2">{sol.prediction.bandwidthMHz}</td>
                    <td className="py-2">{sol.prediction.efficiencyPct}%</td>
                    <td className="py-2">{sol.prediction.areaMm2}</td>
                    <td className="py-2">${sol.prediction.estimatedCostUsd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedSol && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <AntennaViewport3D
                params={activeDesign}
                prediction={activePrediction}
                heightClass="h-[340px]"
                compact
                titleBadge={`Current Studio Design (${activeDesign.operatingFreqGHz} GHz)`}
              />
              <AntennaViewport3D
                params={selectedSol.params}
                prediction={selectedSol.prediction}
                heightClass="h-[340px]"
                compact
                titleBadge={`Pareto Optimal (${selectedSol.id})`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};
