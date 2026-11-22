import * as XLSX from 'xlsx';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type {
  AntennaDesignParams,
  AntennaTopology,
  ConductorMaterial,
  SubstrateMaterial,
} from '../shared/antennaTypes.ts';
import {
  TOPOLOGY_BY_CODE,
  TOPOLOGY_CANONICAL_NAMES,
  validateAndParseImportedRows,
} from '../shared/antennaSchema.ts';
import {
  SUBSTRATE_CATALOG,
  createDefaultDesign,
} from '../shared/rfPhysics.ts';

export interface ParsedUploadResult {
  ok: boolean;
  designs: AntennaDesignParams[];
  notice: string;
  warnings: string[];
  errors: string[];
  stlBuffer?: ArrayBuffer;
}

const CANONICAL_NAME_TO_TOPOLOGY: Record<string, AntennaTopology> = Object.fromEntries(
  Object.entries(TOPOLOGY_CANONICAL_NAMES).map(([topo, name]) => [
    name.toLowerCase(),
    topo as AntennaTopology,
  ]),
);

const TOPOLOGY_NAME_TO_CODE: Record<string, number> = {
  microstrip_inset_patch: 0,
  microstrip_patch: 0,
  probe_fed_rectangular_patch: 1,
  rectangular_patch: 1,
  circular_disk_patch: 2,
  circular_patch: 2,
  '2x2_phased_planar_array': 3,
  array_2x2: 3,
  '4_element_mimo_array': 4,
  multi_element_mimo: 4,
};

function inferSubstrateFromEr(er: number): SubstrateMaterial {
  if (Math.abs(er - 4.4) < 0.35) return 'FR4';
  if (Math.abs(er - 3.48) <= 0.05) return 'Rogers_RO4350B';
  if (Math.abs(er - 2.2) < 0.3) return 'Rogers_RT5880';
  if (er > 7.5) return 'Alumina';
  return 'Rogers_RO4003C';
}

function inferConductor(sigmaNorm: number): ConductorMaterial {
  if (sigmaNorm > 1.04) return 'Silver';
  if (sigmaNorm < 0.68) return 'Aluminum';
  if (sigmaNorm < 0.85) return 'Gold_ENIG';
  return 'Copper';
}

function parseJsonDesignItem(
  raw: Record<string, unknown>,
  idx: number,
  filename: string,
): AntennaDesignParams {
  let topology: AntennaTopology = 'microstrip_patch';
  if (typeof raw.topology === 'string' && raw.topology in TOPOLOGY_CANONICAL_NAMES) {
    topology = raw.topology as AntennaTopology;
  } else if (typeof raw.topologyName === 'string') {
    topology =
      CANONICAL_NAME_TO_TOPOLOGY[raw.topologyName.trim().toLowerCase()] ?? 'microstrip_patch';
  } else if (typeof raw.topologyCode === 'number' && raw.topologyCode in TOPOLOGY_BY_CODE) {
    topology = TOPOLOGY_BY_CODE[raw.topologyCode];
  }

  const freq =
    typeof raw.operatingFreqGHz === 'number' && Number.isFinite(raw.operatingFreqGHz)
      ? raw.operatingFreqGHz
      : 2.45;
  const er =
    typeof raw.dielectricConstant === 'number' && Number.isFinite(raw.dielectricConstant)
      ? raw.dielectricConstant
      : 3.55;
  const sub: SubstrateMaterial =
    typeof raw.substrateMaterial === 'string' && raw.substrateMaterial in SUBSTRATE_CATALOG
      ? (raw.substrateMaterial as SubstrateMaterial)
      : inferSubstrateFromEr(er);

  const base = createDefaultDesign(freq, topology, sub);
  const numOr = (val: unknown, fallback: number) =>
    typeof val === 'number' && Number.isFinite(val) ? val : fallback;

  const sigmaNorm = numOr(raw.conductorSigmaNorm, 1.0);
  const conductor: ConductorMaterial =
    typeof raw.conductorMaterial === 'string'
      ? (raw.conductorMaterial as ConductorMaterial)
      : inferConductor(sigmaNorm);

  const patchLengthMm =
    topology === 'circular_patch' ? 0 : numOr(raw.patchLengthMm, base.patchLengthMm);
  const patchWidthMm =
    topology === 'circular_patch' ? 0 : numOr(raw.patchWidthMm, base.patchWidthMm);

  return {
    ...base,
    id: `upload-json-${idx + 1}-${Date.now()}`,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : typeof raw.designName === 'string' && raw.designName.trim()
          ? raw.designName.trim()
          : `${filename.replace(/\.[^.]+$/, '')} #${idx + 1}`,
    topology,
    operatingFreqGHz: freq,
    substrateMaterial: sub,
    conductorMaterial: conductor,
    dielectricConstant: er,
    lossTangent: numOr(raw.lossTangent, SUBSTRATE_CATALOG[sub].lossTangent),
    substrateHeightMm: numOr(raw.substrateHeightMm, base.substrateHeightMm),
    patchLengthMm,
    patchWidthMm,
    patchRadiusMm: topology === 'circular_patch' ? numOr(raw.patchRadiusMm, base.patchRadiusMm) : 0,
    feedXMm: numOr(raw.feedXMm, base.feedXMm),
    feedYMm: numOr(raw.feedYMm, base.feedYMm),
    insetDepthMm:
      topology === 'microstrip_patch' ? numOr(raw.insetDepthMm, base.insetDepthMm) : 0,
    notchWidthMm:
      topology === 'microstrip_patch' ? numOr(raw.notchWidthMm, base.notchWidthMm) : 0,
    probeDiameterMm:
      topology === 'rectangular_patch' ? numOr(raw.probeDiameterMm, base.probeDiameterMm) : 0,
    feedTypeCode:
      topology === 'rectangular_patch' ? numOr(raw.feedTypeCode, base.feedTypeCode) : 0,
    elementSpacingXmm:
      topology === 'array_2x2' || topology === 'multi_element_mimo'
        ? numOr(raw.elementSpacingXmm, base.elementSpacingXmm)
        : 0,
    elementSpacingYmm:
      topology === 'array_2x2' || topology === 'multi_element_mimo'
        ? numOr(raw.elementSpacingYmm, base.elementSpacingYmm)
        : 0,
    phaseXDeg: topology === 'array_2x2' ? numOr(raw.phaseXDeg, base.phaseXDeg) : 0,
    phaseYDeg: topology === 'array_2x2' ? numOr(raw.phaseYDeg, base.phaseYDeg) : 0,
    arrayLayoutCode:
      topology === 'array_2x2' ? numOr(raw.arrayLayoutCode, base.arrayLayoutCode) : 0,
    portConfigurationCode:
      topology === 'multi_element_mimo'
        ? numOr(raw.portConfigurationCode, base.portConfigurationCode)
        : 0,
    targetGainDbi: typeof raw.targetGainDbi === 'number' ? raw.targetGainDbi : base.targetGainDbi,
  };
}

export async function parseUploadedDesignFile(
  file: File,
  fallbackFreqGHz = 2.45,
): Promise<ParsedUploadResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    // Support files exported with `topologyName` instead of numeric `topologyCode`
    const normalizedRows = rawRows.map((row) => {
      if (row.topologyCode === undefined && typeof row.topologyName === 'string') {
        const mapped = TOPOLOGY_NAME_TO_CODE[row.topologyName.trim().toLowerCase()];
        if (mapped !== undefined) {
          return { ...row, topologyCode: mapped };
        }
      }
      return row;
    });

    const parsed = validateAndParseImportedRows(normalizedRows, {
      filename: file.name,
      requireOutputColumns: false,
    });

    if (!parsed.valid) {
      return {
        ok: false,
        designs: [],
        notice: `Validation failed (${parsed.errors.length} error${parsed.errors.length > 1 ? 's' : ''}).`,
        warnings: parsed.warnings,
        errors: parsed.errors,
      };
    }

    return {
      ok: true,
      designs: parsed.rows.map((r) => r.params),
      notice: `Loaded ${parsed.rows.length} design(s) from ${file.name} (${
        parsed.isLegacy10Feature ? '10-feature zero-filled to 21' : '21-feature schema'
      }).`,
      warnings: parsed.warnings,
      errors: [],
    };
  }

  if (ext === 'json') {
    try {
      const text = await file.text();
      const parsedJson = JSON.parse(text) as unknown;
      const list = Array.isArray(parsedJson)
        ? parsedJson
        : parsedJson && typeof parsedJson === 'object'
          ? [parsedJson]
          : [];
      const objects = list.filter(
        (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'),
      );
      if (objects.length === 0) {
        return {
          ok: false,
          designs: [],
          notice: 'JSON file does not contain any antenna design object.',
          warnings: [],
          errors: ['Expected a design JSON object or array of design objects.'],
        };
      }
      const designs = objects.map((obj, idx) => parseJsonDesignItem(obj, idx, file.name));
      return {
        ok: true,
        designs,
        notice: `Loaded ${designs.length} antenna design(s) from ${file.name}.`,
        warnings: [],
        errors: [],
      };
    } catch (err) {
      return {
        ok: false,
        designs: [],
        notice: 'Could not parse JSON file.',
        warnings: [],
        errors: [err instanceof Error ? err.message : 'Invalid JSON syntax'],
      };
    }
  }

  if (ext === 'stl') {
    try {
      const buf = await file.arrayBuffer();
      const loader = new STLLoader();
      const geo = loader.parse(buf);
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      const base = createDefaultDesign(fallbackFreqGHz, 'microstrip_patch', 'Rogers_RO4003C');
      let nextDesign: AntennaDesignParams = {
        ...base,
        id: `upload-stl-${Date.now()}`,
        name: `STL: ${file.name}`,
      };
      if (box) {
        const sx = Number((box.max.x - box.min.x).toFixed(2));
        const sy = Number((box.max.y - box.min.y).toFixed(2));
        const sz = Number((box.max.z - box.min.z).toFixed(2));
        const dims = [sx, sy, sz].sort((a, b) => b - a);
        const w = Math.max(2, Number((dims[0] * 0.62).toFixed(2)));
        const l = Math.max(2, Number((dims[1] * 0.62).toFixed(2)));
        const h = Math.max(0.3, Math.min(8, Number(dims[2].toFixed(2))));
        const feedX = Number((l * 0.31).toFixed(2));
        nextDesign = {
          ...nextDesign,
          patchWidthMm: w,
          patchLengthMm: l,
          substrateHeightMm: h,
          feedXMm: feedX,
          insetDepthMm: feedX,
          notchWidthMm: Number(Math.max(0.7, w * 0.08).toFixed(2)),
        };
      }
      geo.dispose();
      return {
        ok: true,
        designs: [nextDesign],
        notice: `Extracted bounding-box geometry from ${file.name} (${nextDesign.patchLengthMm} × ${nextDesign.patchWidthMm} mm, h=${nextDesign.substrateHeightMm} mm).`,
        warnings: ['Verify operatingFreqGHz and substrate εr for your STL mesh.'],
        errors: [],
        stlBuffer: buf,
      };
    } catch {
      return {
        ok: false,
        designs: [],
        notice: 'Could not parse STL mesh.',
        warnings: [],
        errors: ['Invalid or corrupted STL mesh file.'],
      };
    }
  }

  return {
    ok: false,
    designs: [],
    notice: `Unsupported file type ".${ext}". Use CSV, XLSX, JSON, or STL.`,
    warnings: [],
    errors: [`Unsupported extension ".${ext}". Supported formats: .csv, .xlsx, .xls, .json, .stl.`],
  };
}
