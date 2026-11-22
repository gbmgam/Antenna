import React from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Bot,
  FileUp,
  GitCompare,
  Radar,
  ShieldAlert,
  Sliders,
  Sparkles,
} from 'lucide-react';
import type {
  AntennaDesignParams,
  AntennaTopology,
  AppModuleId,
  PredictionResult,
} from '../shared/antennaTypes.ts';
import { TOPOLOGY_LABELS } from '../shared/rfPhysics.ts';
import { AntennaViewport3D } from '../components/AntennaViewport3D.tsx';

interface LandingHomePageProps {
  activeDesign: AntennaDesignParams;
  activePrediction: PredictionResult | null;
  onNavigateModule: (module: AppModuleId) => void;
  onTopologyChange: (topology: AntennaTopology) => void;
}

const PROPOSED_SOLUTIONS: Array<{
  id: string;
  num: string;
  title: string;
  module: AppModuleId;
  summary: string;
  bullets: string[];
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'nl-assistant',
    num: '01',
    title: 'Natural Language Assistant',
    module: 'assistant',
    summary: 'Translate plain-English RF requirements into synthesized antenna geometry and ML predictions.',
    bullets: [
      'Parse frequency, gain, bandwidth, and topology',
      'Identify missing physical parameters automatically',
      'Suggest initial geometry and send to ML engine',
    ],
    icon: Bot,
  },
  {
    id: 'fault-detection',
    num: '02',
    title: 'Fault Detection & Suggestions',
    module: 'faults',
    summary: 'Diagnose impedance mismatch, frequency detuning, and high-loss dielectric substrates.',
    bullets: [
      'Detect low gain and narrow fractional bandwidth',
      'Audit substrate loss tangent and feed coordinates',
      'Predict before-and-after corrected performance',
    ],
    icon: ShieldAlert,
  },
  {
    id: 'multi-freq',
    num: '03',
    title: 'Multi-Frequency Prediction',
    module: 'multifreq',
    summary: 'Sweep performance profiles across Wi-Fi, Bluetooth BLE, IoT ISM, and 5G mmWave bands.',
    bullets: [
      'Wi-Fi, Bluetooth, IoT, and 5G band evaluation',
      'Gain, S11, and bandwidth per frequency',
      'Interactive frequency-response and 3D lobe views',
    ],
    icon: Radar,
  },
  {
    id: 'nsga2',
    num: '04',
    title: 'Multi-Objective Optimization',
    module: 'optimize',
    summary: 'Discover Pareto-optimal trade-offs balancing electromagnetic gain against footprint and cost.',
    bullets: [
      'Maximize gain, bandwidth, and radiation efficiency',
      'Minimize physical area and fabrication cost',
      'NSGA-II non-dominated Pareto front analysis',
    ],
    icon: Sliders,
  },
  {
    id: 'comparison',
    num: '05',
    title: 'Comparison Dashboard',
    module: 'compare',
    summary: 'Benchmark multiple antenna candidates with synchronized 3D viewers and multi-metric charts.',
    bullets: [
      'Compare gain, bandwidth, efficiency, and size',
      'Interactive bar charts and radar calibration plots',
      'Objective-weighted winner recommendation',
    ],
    icon: GitCompare,
  },
  {
    id: 'existing-eval',
    num: '06',
    title: 'Existing Antenna Evaluation',
    module: 'evaluate',
    summary: 'Upload CAD meshes, tabular parameter sheets, or schematics to predict and optimize.',
    bullets: [
      'Supports CSV, Excel, STL, STEP, DXF, and images',
      'Extract parameters with manual calibration override',
      'Predict, diagnose faults, and export PDF/CSV reports',
    ],
    icon: FileUp,
  },
];

export const LandingHomePage: React.FC<LandingHomePageProps> = ({
  activeDesign,
  activePrediction,
  onNavigateModule,
  onTopologyChange,
}) => {
  return (
    <div className="space-y-20 pb-16">
      {/* HERO SECTION */}
      <section id="overview" className="relative pt-4">
        <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
          {/* Left Hero Editorial & CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex flex-col justify-between lg:col-span-5"
          >
            <div className="space-y-5">
              <div className="space-y-2">
                <h1 className="font-display text-5xl font-bold italic tracking-tight text-white sm:text-6xl">
                  ANTENNA <span className="text-cyan-400">AI</span>
                </h1>
                <p className="font-display text-lg font-semibold italic tracking-widest text-sky-300">
                  BUILD. LAUNCH. BREAK. REPEAT.
                </p>
              </div>

              <p className="max-w-xl text-base leading-relaxed text-slate-300">
                An intelligent machine-learning platform that designs, predicts, evaluates, and
                optimizes antenna performance inside an interactive 3D electromagnetic visualization
                studio.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onNavigateModule('studio')}
                  className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-300 whitespace-nowrap"
                >
                  <span>Explore AI Design Studio</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateModule('assistant')}
                  className="inline-flex items-center gap-2 rounded-lg border border-sky-400/35 bg-[#0b1633]/85 px-5 py-3 text-sm font-semibold text-sky-100 transition-colors hover:border-cyan-400 hover:text-cyan-200 whitespace-nowrap"
                >
                  <Sparkles className="h-4 w-4 text-cyan-400" />
                  <span>Create New Antenna</span>
                </button>
              </div>
            </div>

            {/* Active Design Quick Telemetry Readout */}
            <div className="mt-8 rounded-xl border border-sky-400/20 bg-[#071028]/90 p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
                <span className="font-medium text-sky-200">
                  Active 3D Model: {TOPOLOGY_LABELS[activeDesign.topology]} · Demo estimate
                </span>
                <span className="font-mono tabular-nums text-cyan-300">
                  {activeDesign.operatingFreqGHz.toFixed(2)} GHz
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-[11px] text-slate-400">Predicted Gain</div>
                  <div className="font-mono text-lg font-bold tabular-nums text-white">
                    {activePrediction ? `${activePrediction.gainDbi}` : '7.12'}
                    <span className="ml-1 text-xs font-normal text-cyan-300">dBi</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Bandwidth</div>
                  <div className="font-mono text-lg font-bold tabular-nums text-white">
                    {activePrediction ? `${activePrediction.bandwidthMHz}` : '96.4'}
                    <span className="ml-1 text-xs font-normal text-cyan-300">MHz</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Efficiency</div>
                  <div className="font-mono text-lg font-bold tabular-nums text-white">
                    {activePrediction ? `${activePrediction.efficiencyPct}` : '86.2'}
                    <span className="ml-1 text-xs font-normal text-cyan-300">%</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Return Loss</div>
                  <div className="font-mono text-lg font-bold tabular-nums text-white">
                    {activePrediction ? `${activePrediction.returnLossDb}` : '-21.4'}
                    <span className="ml-1 text-xs font-normal text-cyan-300">dB</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right Massive Interactive 3D Antenna Centerpiece */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55 }}
            className="lg:col-span-7"
          >
            <AntennaViewport3D
              params={activeDesign}
              prediction={activePrediction}
              heightClass="h-[480px] lg:h-[540px]"
              onTopologyChange={onTopologyChange}
              titleBadge="Hero 3D Electromagnetic Lab"
            />
          </motion.div>
        </div>
      </section>

      {/* PAGE 2: PROPOSED SOLUTION (7 INTERACTIVE FEATURE CARDS) */}
      <section id="solutions" className="space-y-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <p className="text-xs font-mono tracking-wider text-cyan-400">PROPOSED SOLUTION</p>
            <h2 className="section-heading-italic text-3xl text-white sm:text-4xl">
              Seven Intelligent Electromagnetic Engineering Engines
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigateModule('studio')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
          >
            <span>Open AI Design Studio</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {PROPOSED_SOLUTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className="glass-panel glass-panel-hover flex flex-col justify-between rounded-xl p-6"
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                    <span>{item.num}. SOLUTION MODULE</span>
                    <Icon className="h-4 w-4 text-cyan-400" />
                  </div>
                  <h3 className="mt-3 font-display text-xl font-bold italic text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.summary}</p>
                  <ul className="mt-4 space-y-1.5 text-xs text-slate-400">
                    {item.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigateModule(item.module)}
                  className="mt-6 inline-flex w-full items-center justify-between rounded-lg border border-sky-400/25 bg-[#0b1633]/90 px-4 py-2.5 text-xs font-semibold text-sky-100 transition-colors hover:border-cyan-400/60 hover:text-cyan-300"
                >
                  <span>Launch {item.title}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
