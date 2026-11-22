import React, { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Download,
  FileUp,
  GitCompare,
  History,
  Home,
  Menu,
  Radar,
  ShieldAlert,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AntennaDesignParams,
  AntennaTopology,
  AppModuleId,
  HistoryRecord,
  MLModelType,
  PredictionResult,
} from './shared/antennaTypes.ts';
import { createDefaultDesign, switchDesignTopology } from './shared/rfPhysics.ts';
import { validateAntennaDesign } from './shared/antennaSchema.ts';
import { deleteHistoryRecord, fetchHistory, predictAntenna } from './utils/apiClient.ts';
import { LandingHomePage } from './pages/LandingHomePage.tsx';
import { DesignStudioPage } from './pages/DesignStudioPage.tsx';
import { AssistantPage } from './pages/AssistantPage.tsx';
import { EvaluateExistingPage } from './pages/EvaluateExistingPage.tsx';
import { FaultDetectionPage } from './pages/FaultDetectionPage.tsx';
import { MultiFrequencyPage } from './pages/MultiFrequencyPage.tsx';
import { OptimizationPage } from './pages/OptimizationPage.tsx';
import { CompareDesignsPage } from './pages/CompareDesignsPage.tsx';
import {
  DownloadReportsPage,
  PredictionHistoryPage,
} from './pages/HistoryAndReportsPages.tsx';

const MODULE_NAV: Array<{
  id: AppModuleId;
  num: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'home', num: '01', label: 'Home Dashboard', icon: Home },
  { id: 'assistant', num: '02', label: 'AI Design Assistant', icon: Bot },
  { id: 'studio', num: '03', label: 'Create New Design', icon: Sparkles },
  { id: 'evaluate', num: '04', label: 'Evaluate Existing', icon: FileUp },
  { id: 'faults', num: '05', label: 'Fault Detection', icon: ShieldAlert },
  { id: 'multifreq', num: '06', label: 'Multi-Frequency', icon: Radar },
  { id: 'optimize', num: '07', label: 'Optimization', icon: Sliders },
  { id: 'compare', num: '08', label: 'Compare Designs', icon: GitCompare },
  { id: 'history', num: '09', label: 'Prediction History', icon: History },
  { id: 'reports', num: '10', label: 'Download Reports', icon: Download },
];

export default function App() {
  const [activeModule, setActiveModule] = useState<AppModuleId>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [activeDesign, setActiveDesign] = useState<AntennaDesignParams>(() =>
    createDefaultDesign(2.45, 'microstrip_patch', 'Rogers_RO4003C'),
  );
  const [selectedModel, setSelectedModel] = useState<MLModelType>('ensemble');
  const [activePrediction, setActivePrediction] = useState<PredictionResult | null>(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  const refreshHistory = useCallback(async () => {
    try {
      const records = await fetchHistory();
      setHistory(records);
    } catch {
      // Non-blocking
    }
  }, []);

  const runPrediction = useCallback(
    async (
      params: AntennaDesignParams,
      saveToHistory = false,
      modelOverride?: MLModelType,
    ) => {
      const validationErrors = validateAntennaDesign(params);
      const errKeys = Object.keys(validationErrors);
      if (errKeys.length > 0) {
        setPredictError(validationErrors[errKeys[0] as keyof AntennaDesignParams] ?? 'Invalid parameters');
        return;
      }
      setPredictLoading(true);
      setPredictError(null);
      try {
        const pred = await predictAntenna(
          params,
          modelOverride ?? selectedModel,
          saveToHistory,
          'prediction',
        );
        setActivePrediction(pred);
        if (saveToHistory) {
          await refreshHistory();
        }
      } catch (err) {
        setPredictError(err instanceof Error ? err.message : 'Prediction failed');
      } finally {
        setPredictLoading(false);
      }
    },
    [selectedModel, refreshHistory],
  );

  useEffect(() => {
    runPrediction(activeDesign, false);
    refreshHistory();
  }, []);

  const handleTopologySwitch = (topology: AntennaTopology) => {
    const next = switchDesignTopology(activeDesign, topology);
    setActiveDesign(next);
    runPrediction(next, false);
  };

  const handleApplyToStudio = (params: AntennaDesignParams, prediction: PredictionResult) => {
    setActiveDesign(params);
    setActivePrediction(prediction);
    setActiveModule('studio');
    refreshHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigateModule = (mod: AppModuleId) => {
    setActiveModule(mod);
    setMobileMenuOpen(false);
    refreshHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };


  const handleDeleteHistory = async (id: string) => {
    await deleteHistoryRecord(id);
    await refreshHistory();
  };

  return (
    <div className="min-h-screen bg-[#040814] text-slate-100 pcb-circuit-bg">
      {/* Top Bar: Strict 3-Zone Contract */}
      <header className="sticky top-0 z-40 border-b border-sky-400/18 bg-[#040814]/92 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          {/* Zone 1: Single text wordmark */}
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              handleNavigateModule('home');
            }}
            className="font-display text-xl font-bold italic tracking-tight text-white whitespace-nowrap shrink-0"
          >
            ANTENNA <span className="text-cyan-400">AI</span>
          </a>

          {/* Zone 3: 1 primary action (+ mobile menu trigger on small viewports) */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => handleNavigateModule('studio')}
              className="rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 whitespace-nowrap shrink-0"
            >
              Open Studio
            </button>
            <button
              type="button"
              aria-label="Toggle module navigation"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="rounded-lg border border-sky-400/25 p-2 text-slate-200 lg:hidden"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Single-Line Top Module Navigation Bar */}
      <div className="hidden border-b border-sky-400/15 bg-[#060d20]/85 lg:block">
        <nav
          aria-label="Lab Modules"
          className="mx-auto flex max-w-[1480px] items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6"
        >
          {MODULE_NAV.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigateModule(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40'
                    : 'text-slate-300 border border-transparent hover:bg-[#0b1633] hover:text-white'
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${
                    active ? 'text-cyan-300' : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Mobile Module Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 bg-[#040814]/95 pt-18 px-4 pb-6 overflow-y-auto lg:hidden">
          <div className="mb-3 font-mono text-xs text-cyan-400">10 APPLICATION MODULES</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {MODULE_NAV.map((item) => {
              const Icon = item.icon;
              const active = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigateModule(item.id)}
                  className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left text-sm font-medium ${
                    active
                      ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                      : 'border-sky-400/20 bg-[#071028] text-slate-200'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-cyan-400" />
                  <span className="font-mono text-xs text-slate-400">{item.num}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Unified Workspace Layout */}
      <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6">
        <main className="min-w-0">
          {activeModule === 'home' && (
            <LandingHomePage
              activeDesign={activeDesign}
              activePrediction={activePrediction}
              onNavigateModule={handleNavigateModule}
              onTopologyChange={handleTopologySwitch}
            />
          )}

          {activeModule === 'studio' && (
            <DesignStudioPage
              design={activeDesign}
              prediction={activePrediction}
              loading={predictLoading}
              error={predictError}
              selectedModel={selectedModel}
              onModelChange={(model) => {
                setSelectedModel(model);
                runPrediction(activeDesign, false, model);
              }}
              onUpdateDesign={(next) => {
                setActiveDesign(next);
                if (Object.keys(validateAntennaDesign(next)).length === 0) {
                  runPrediction(next, false);
                }
              }}
              onRunPredict={runPrediction}
              onApplyOptimized={(nextParams, nextPred) => {
                setActiveDesign(nextParams);
                setActivePrediction(nextPred);
                refreshHistory();
              }}
            />
          )}

          {activeModule === 'assistant' && (
            <AssistantPage
              activeDesign={activeDesign}
              activePrediction={activePrediction}
              onApplyToStudio={handleApplyToStudio}
            />
          )}


          {activeModule === 'evaluate' && (
            <EvaluateExistingPage onApplyToStudio={handleApplyToStudio} />
          )}

          {activeModule === 'faults' && (
            <FaultDetectionPage
              activeDesign={activeDesign}
              onApplyToStudio={handleApplyToStudio}
            />
          )}

          {activeModule === 'multifreq' && (
            <MultiFrequencyPage activeDesign={activeDesign} history={history} />
          )}

          {activeModule === 'optimize' && (
            <OptimizationPage
              activeDesign={activeDesign}
              activePrediction={activePrediction}
              onApplyToStudio={handleApplyToStudio}
            />
          )}

          {activeModule === 'compare' && (
            <CompareDesignsPage history={history} onRefreshHistory={refreshHistory} />
          )}

          {activeModule === 'history' && (
            <PredictionHistoryPage
              history={history}
              onLoadDesign={handleApplyToStudio}
              onDeleteRecord={handleDeleteHistory}
            />
          )}

          {activeModule === 'reports' && (
            <DownloadReportsPage
              activeDesign={activeDesign}
              activePrediction={activePrediction}
              history={history}
            />
          )}
        </main>
      </div>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-sky-400/15 bg-[#040814]/95 py-6">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-4 px-4 text-xs text-slate-400 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold italic text-white">ANTENNA AI</span>
            <span>·</span>
            <span>Intelligent 3D Electromagnetic Design & Machine Learning Studio</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => handleNavigateModule('studio')}
              className="hover:text-cyan-300"
            >
              Design Studio
            </button>
            <button
              type="button"
              onClick={() => handleNavigateModule('reports')}
              className="hover:text-cyan-300"
            >
              Export Reports
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
