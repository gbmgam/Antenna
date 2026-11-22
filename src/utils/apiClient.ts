import type {
  AntennaDesignParams,
  AssistantResponse,
  CrossValidationReport,
  FaultAnalysisResponse,
  HistoryRecord,
  MLModelType,
  ModelValidationMetric,
  NSGA2Response,
  PredictionResult,
  SubstrateMaterial,
  SurrogateStatusResponse,
  TargetOptimizationResponse,
} from '../shared/antennaTypes.ts';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchSurrogateStatus(): Promise<SurrogateStatusResponse> {
  const res = await fetch('/api/ml/status');
  if (!res.ok) throw new Error('Failed to load surrogate status');
  return res.json();
}

export async function refreshSurrogateStatus(): Promise<SurrogateStatusResponse> {
  return postJson<SurrogateStatusResponse>('/api/ml/status/refresh', {});
}

export async function uploadSurrogateArtifact(
  file: File,
  onProgress?: (pct: number, uploadedBytes: number, totalBytes: number) => void,
): Promise<{
  saved: string;
  bytes: number;
  status: SurrogateStatusResponse;
}> {
  const CHUNK_SIZE = 512 * 1024; // 512 KB chunks stay well under nginx/Cloud Run body limits
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const uploadId = `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  let finalResult: { saved: string; bytes: number; status: SurrogateStatusResponse } | null = null;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const slice = file.slice(start, end);

    const res = await fetch('/api/ml/upload-chunk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Artifact-Filename': file.name,
        'X-Upload-Id': uploadId,
        'X-Chunk-Index': String(chunkIndex),
        'X-Total-Chunks': String(totalChunks),
      },
      body: slice,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Upload failed (HTTP ${res.status})` }));
      throw new Error(err.error || `Upload failed (${res.status})`);
    }
    const payload = (await res.json()) as {
      completed?: boolean;
      saved?: string;
      bytes?: number;
      status?: SurrogateStatusResponse;
    };
    onProgress?.(Math.round(((chunkIndex + 1) / totalChunks) * 100), end, file.size);
    if (payload.completed && payload.saved && payload.status) {
      finalResult = {
        saved: payload.saved,
        bytes: payload.bytes ?? file.size,
        status: payload.status,
      };
    }
  }

  if (!finalResult) {
    throw new Error('Upload did not complete cleanly.');
  }
  return finalResult;
}

export async function fetchModelMetrics(): Promise<{
  featureOrder: string[];
  outputOrder: string[];
  metrics: ModelValidationMetric[];
  crossValidationReport: CrossValidationReport;
  surrogateStatus?: SurrogateStatusResponse;
  isDemoEstimate: boolean;
}> {
  const res = await fetch('/api/ml/metrics');
  if (!res.ok) throw new Error('Failed to load ML model metrics');
  return res.json();
}

export async function predictAntenna(
  params: AntennaDesignParams,
  model: MLModelType = 'ensemble',
  saveToHistory = false,
  historyType: 'prediction' | 'evaluation' | 'assistant' = 'prediction',
): Promise<PredictionResult> {
  return postJson<PredictionResult>('/api/ml/predict', {
    params,
    model,
    saveToHistory,
    historyType,
  });
}

export async function evaluateMultiFrequency(
  params: AntennaDesignParams,
  frequenciesGHz: number[],
): Promise<{
  results: Array<{
    freqGHz: number;
    gainDbi: number;
    bandwidthMHz: number;
    resonantFreqGHz: number;
    efficiencyPct: number;
    returnLossDb: number;
  }>;
  isDemoEstimate?: boolean;
  provenance?: string;
}> {
  return postJson('/api/ml/multifreq', { params, frequenciesGHz });
}

export async function optimizeDesignForTarget(
  params: AntennaDesignParams,
  model: MLModelType = 'ensemble',
  allowTopologyUpgrade = true,
  saveToHistory = true,
): Promise<TargetOptimizationResponse> {
  return postJson<TargetOptimizationResponse>('/api/ml/optimize-target', {
    params,
    model,
    allowTopologyUpgrade,
    saveToHistory,
  });
}

export async function diagnoseAntennaFaults(
  params: AntennaDesignParams,
): Promise<FaultAnalysisResponse> {
  return postJson<FaultAnalysisResponse>('/api/diagnose', { params });
}


export async function runNSGA2Optimization(
  targetFreqGHz: number,
  substrateMaterial: SubstrateMaterial,
): Promise<NSGA2Response> {
  return postJson<NSGA2Response>('/api/optimize/nsga2', {
    targetFreqGHz,
    substrateMaterial,
  });
}

export async function askDesignAssistant(prompt: string): Promise<AssistantResponse> {
  return postJson<AssistantResponse>('/api/assistant/parse', { prompt });
}

export async function fetchHistory(): Promise<HistoryRecord[]> {
  const res = await fetch('/api/history');
  if (!res.ok) throw new Error('Failed to load prediction history');
  const data = (await res.json()) as { records: HistoryRecord[] };
  return data.records;
}

export async function saveToHistory(
  record: Omit<HistoryRecord, 'id' | 'timestamp'>,
): Promise<HistoryRecord> {
  const data = await postJson<{ record: HistoryRecord }>('/api/history', record);
  return data.record;
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  await fetch(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function exportSolverScript(
  params: AntennaDesignParams,
  solver: 'openems' | 'hfss' | 'cst',
): Promise<{ filename: string; content: string }> {
  return postJson('/api/solver/export-script', { params, solver });
}
