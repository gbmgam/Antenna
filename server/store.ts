import fs from 'fs';
import path from 'path';
import type { AntennaDesignParams, HistoryRecord, PredictionResult } from '../src/shared/antennaTypes.ts';
import { encodeFeatures } from '../src/shared/antennaSchema.ts';
import { createDefaultDesign, switchDesignTopology } from '../src/shared/rfPhysics.ts';
import { mlEngine } from './mlEngine.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'antenna_store.json');

function normalizeStoredRecord(raw: HistoryRecord): HistoryRecord {
  const base = createDefaultDesign(
    raw.params?.operatingFreqGHz ?? 2.45,
    raw.params?.topology ?? 'microstrip_patch',
    raw.params?.substrateMaterial ?? 'Rogers_RO4003C',
  );
  const mergedParams: AntennaDesignParams = {
    ...base,
    ...raw.params,
  };
  const cleanParams = switchDesignTopology(mergedParams, mergedParams.topology);
  cleanParams.id = raw.params?.id ?? cleanParams.id;
  cleanParams.name = raw.params?.name ?? raw.designName ?? cleanParams.name;

  const rawPred =
    raw.prediction?.featureVector21?.length === 21
      ? {
          ...raw.prediction,
          isDemoEstimate: true,
          shapContributions: raw.prediction.shapContributions ?? [],
        }
      : mlEngine.predict(cleanParams, raw.prediction?.modelUsed ?? 'ensemble');

  const minSweepS11 =
    Array.isArray(rawPred.frequencySweep) && rawPred.frequencySweep.length > 0
      ? Math.min(...rawPred.frequencySweep.map((p) => p.s11Db))
      : rawPred.returnLossDb;
  const pred: PredictionResult = {
    ...rawPred,
    bandwidthMHz: minSweepS11 <= -10 && rawPred.returnLossDb <= -10 ? rawPred.bandwidthMHz : 0,
    provenance: 'Demo analytical-estimate surrogate — not EM-validated data.',
  };

  return {
    ...raw,
    params: cleanParams,
    prediction: pred,
  };
}

function buildSeedHistory(): HistoryRecord[] {
  const seeds = [
    createDefaultDesign(2.45, 'microstrip_patch', 'Rogers_RO4003C'),
    createDefaultDesign(5.8, 'array_2x2', 'Rogers_RT5880'),
    createDefaultDesign(28.0, 'rectangular_patch', 'Rogers_RT5880'),
    createDefaultDesign(0.915, 'circular_patch', 'FR4'),
  ];

  seeds[0].id = 'seed-wifi-245';
  seeds[0].name = '2.45 GHz Wi-Fi Inset Patch';
  seeds[1].id = 'seed-58-array';
  seeds[1].name = '5.8 GHz 2x2 Phased Array';
  seeds[2].id = 'seed-28-5g';
  seeds[2].name = '28 GHz 5G mmWave Patch';
  seeds[3].id = 'seed-915-iot';
  seeds[3].name = '915 MHz IoT Circular Patch';

  return seeds.map((params, idx) => ({
    id: `hist-seed-${idx + 1}`,
    timestamp: new Date(Date.now() - (4 - idx) * 3600_000).toISOString(),
    type: idx === 1 ? 'nsga2_optimization' : 'prediction',
    designName: params.name,
    params,
    prediction: mlEngine.predict(params, 'ensemble'),
    notes: 'Demo estimate · Benchmark reference design pre-evaluated with 21-feature Ensemble Surrogate.',
  }));
}

export class AntennaHistoryStore {
  private records: HistoryRecord[] = [];

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.records = parsed
            .map((r) => normalizeStoredRecord(r as HistoryRecord))
            .filter((r) => encodeFeatures(r.params).length === 21);
          if (this.records.length > 0) {
            this.persist();
            return;
          }
        }
      }
    } catch {
      // Fallback to seeded history
    }
    this.records = buildSeedHistory();
    this.persist();
  }

  private persist() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.records, null, 2), 'utf-8');
    } catch {
      // Non-fatal in read-only containers
    }
  }

  public list(): HistoryRecord[] {
    return this.records;
  }

  public add(record: Omit<HistoryRecord, 'id' | 'timestamp'>): HistoryRecord {
    const entry: HistoryRecord = {
      ...record,
      id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
    };
    this.records = [entry, ...this.records].slice(0, 80);
    this.persist();
    return entry;
  }

  public remove(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.records.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }
}

export const historyStore = new AntennaHistoryStore();
