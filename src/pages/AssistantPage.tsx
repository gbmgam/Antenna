import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Bot, Send, Sparkles } from 'lucide-react';
import type {
  AntennaDesignParams,
  AssistantResponse,
  PredictionResult,
} from '../shared/antennaTypes.ts';
import { TOPOLOGY_LABELS } from '../shared/rfPhysics.ts';
import { askDesignAssistant } from '../utils/apiClient.ts';
import { AntennaViewport3D } from '../components/AntennaViewport3D.tsx';

interface AssistantPageProps {
  activeDesign: AntennaDesignParams;
  activePrediction: PredictionResult | null;
  onApplyToStudio: (params: AntennaDesignParams, prediction: PredictionResult) => void;
}

const PRESET_PROMPTS = [
  'Design a compact microstrip patch antenna operating at 2.4 GHz with high gain and wide bandwidth.',
  'Create a 28 GHz 5G mmWave phased array antenna on Rogers RT/duroid 5880 with 11 dBi gain.',
  'Build an IoT 915 MHz circular patch antenna on low cost FR-4 substrate.',
  'Synthesize a 5.8 GHz Wi-Fi MIMO antenna with wide bandwidth and high efficiency.',
];

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  result?: AssistantResponse;
}

export const AssistantPage: React.FC<AssistantPageProps> = ({
  activeDesign,
  activePrediction,
  onApplyToStudio,
}) => {
  const [input, setInput] = useState(PRESET_PROMPTS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Describe your target RF frequency, gain, bandwidth, size constraints, or substrate preference in plain English. I will extract specifications, identify missing parameters, synthesize initial geometry, evaluate it through the trained ML engine, and render the 3D antenna.',
    },
  ]);
  const [latestResult, setLatestResult] = useState<AssistantResponse | null>(null);

  const handleSend = async (promptText?: string) => {
    const query = (promptText ?? input).trim();
    if (!query || loading) return;

    setError(null);
    setLoading(true);
    const userEntry: ChatEntry = { id: `u-${Date.now()}`, role: 'user', text: query };
    setMessages((prev) => [...prev, userEntry]);
    if (!promptText) setInput('');

    try {
      const res = await askDesignAssistant(query);
      setLatestResult(res);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: res.reply,
          result: res,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant request failed');
    } finally {
      setLoading(false);
    }
  };

  const previewParams = latestResult?.generatedParams ?? activeDesign;
  const previewPrediction = latestResult?.prediction ?? activePrediction;

  return (
    <div className="space-y-6">
      <div className="border-b border-sky-400/15 pb-4">
        <p className="font-mono text-xs tracking-wider text-cyan-400">
          MODULE 02 · AI NATURAL LANGUAGE ASSISTANT
        </p>
        <h1 className="section-heading-italic text-3xl text-white">
          Conversational RF Specification & Geometry Synthesis
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Chat Column */}
        <div className="glass-panel flex h-[640px] flex-col rounded-xl p-5 xl:col-span-6">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESET_PROMPTS.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(p)}
                className="rounded-md border border-sky-400/20 bg-[#0b1633] px-2.5 py-1 text-left text-[11px] text-sky-200 transition-colors hover:border-cyan-400"
              >
                {p.slice(0, 56)}...
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-xl border p-4 ${
                  msg.role === 'user'
                    ? 'ml-8 border-cyan-400/35 bg-cyan-950/25 text-slate-100'
                    : 'mr-4 border-sky-400/20 bg-[#040814]/85 text-slate-200'
                }`}
              >
                <div className="mb-1.5 flex items-center gap-2 text-xs font-mono text-cyan-300">
                  {msg.role === 'assistant' ? (
                    <>
                      <Bot className="h-3.5 w-3.5" />
                      <span>ANTENNA AI SYNTHESIS ENGINE</span>
                    </>
                  ) : (
                    <span>ENGINEERING REQUEST</span>
                  )}
                </div>
                <p className="text-sm leading-relaxed">{msg.text}</p>

                {msg.result && (
                  <div className="mt-4 space-y-3 border-t border-sky-400/15 pt-3 text-xs">
                    {msg.result.targetNotMet && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-400/45 bg-amber-950/40 px-3 py-2 text-amber-200">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <div>
                          <div className="font-semibold text-amber-300">Target not met</div>
                          <div className="text-[11px] leading-snug text-amber-100/90">
                            {msg.result.targetStatusMessage ??
                              `Predicted performance (${msg.result.prediction.gainDbi} dBi) is below target (${msg.result.extractedSpecs.targetGainDbi} dBi).`}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-[#0b1633] p-2.5">
                        <div className="text-slate-400">Extracted Band</div>
                        <div className="font-mono font-semibold text-white">
                          {msg.result.extractedSpecs.bandLabel}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#0b1633] p-2.5">
                        <div className="text-slate-400">Topology & Substrate</div>
                        <div className="font-semibold text-cyan-300">
                          {TOPOLOGY_LABELS[msg.result.extractedSpecs.topology]}
                        </div>
                        <div className="font-mono text-[10px] text-slate-300">
                          {msg.result.generatedParams.substrateMaterial.replace(/_/g, ' ')} (εr=
                          {msg.result.generatedParams.dielectricConstant})
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#0b1633] p-2.5">
                        <div className="text-slate-400">ML Gain / BW (Demo estimate)</div>
                        <div className="font-mono font-semibold text-white">
                          {msg.result.prediction.gainDbi} dBi · {msg.result.prediction.bandwidthMHz} MHz
                        </div>
                      </div>
                    </div>

                    {msg.result.missingParameters.length > 0 && (
                      <div>
                        <div className="font-semibold text-amber-300">
                          Missing Parameters Auto-Inferred:
                        </div>
                        <ul className="mt-1 space-y-0.5 text-slate-300">
                          {msg.result.missingParameters.map((m) => (
                            <li key={m}>· {m}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <div className="font-semibold text-cyan-300">Recommended Improvements:</div>
                      <ul className="mt-1 space-y-0.5 text-slate-300">
                        {msg.result.recommendedImprovements.map((imp) => (
                          <li key={imp}>· {imp}</li>
                        ))}
                      </ul>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onApplyToStudio(msg.result!.generatedParams, msg.result!.prediction)
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
                    >
                      <span>Load Generated Design into Studio</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="mt-3 flex gap-2 border-t border-sky-400/15 pt-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Design a 5.8 GHz high-gain array antenna on Rogers..."
              className="flex-1 rounded-lg border border-sky-400/25 bg-[#040814] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              <span>{loading ? 'Synthesizing...' : 'Synthesize'}</span>
            </button>
          </form>
        </div>

        {/* Live 3D Generated Antenna Preview */}
        <div className="space-y-4 xl:col-span-6">
          <AntennaViewport3D
            params={previewParams}
            prediction={previewPrediction}
            heightClass="h-[460px]"
            titleBadge="Synthesized 3D Antenna"
          />

          <div className="glass-panel rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold italic text-white">
                  Synthesized Geometry & Surrogate Prediction
                </h3>
                <p className="text-xs text-slate-400">
                  Demo estimate · {previewPrediction?.provenance ?? 'Active workspace antenna'}
                </p>
              </div>
              <Sparkles className="h-4 w-4 text-cyan-400" />
            </div>

            {(latestResult?.targetNotMet ||
              (previewParams.targetGainDbi !== undefined &&
                previewPrediction &&
                previewPrediction.gainDbi < previewParams.targetGainDbi - 0.15)) && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/45 bg-amber-950/35 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  <strong className="text-amber-300">Target not met:</strong>{' '}
                  {latestResult?.targetStatusMessage ??
                    `Predicted gain (${previewPrediction?.gainDbi ?? '--'} dBi) is below target (${previewParams.targetGainDbi} dBi).`}
                </span>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <div className="text-[11px] text-slate-400">
                  {previewParams.topology === 'circular_patch' ? 'Disk Radius' : 'Patch L × W'}
                </div>
                <div className="font-mono text-sm font-bold tabular-nums text-white">
                  {previewParams.topology === 'circular_patch'
                    ? `R ${previewParams.patchRadiusMm} mm`
                    : `${previewParams.patchLengthMm} × ${previewParams.patchWidthMm} mm`}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Feed / Substrate</div>
                <div className="font-mono text-sm font-bold tabular-nums text-white">
                  ({previewParams.feedXMm}, {previewParams.feedYMm}) mm
                </div>
                <div className="font-mono text-[10px] text-slate-400">
                  {previewParams.substrateMaterial.replace(/_/g, ' ')} (εr=
                  {previewParams.dielectricConstant})
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Predicted Gain</div>
                <div className="font-mono text-sm font-bold tabular-nums text-cyan-300">
                  {previewPrediction?.gainDbi ?? '--'} dBi
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Bandwidth / Eff</div>
                <div className="font-mono text-sm font-bold tabular-nums text-cyan-300">
                  {previewPrediction?.bandwidthMHz ?? '--'} MHz ·{' '}
                  {previewPrediction?.efficiencyPct ?? '--'}%
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
