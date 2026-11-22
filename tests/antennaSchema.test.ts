import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_ORDER,
  OUTPUT_ORDER,
  TOPOLOGY_CODE_MAP,
  encodeFeatures,
  validateAndParseImportedRows,
  validateAntennaDesign,
} from '../src/shared/antennaSchema.ts';
import { createDefaultDesign } from '../src/shared/rfPhysics.ts';
import type { AntennaTopology, MLModelType } from '../src/shared/antennaTypes.ts';
import { mlEngine } from '../server/mlEngine.ts';
import { mapDesignToPredictorInput } from '../server/pythonBridge.ts';

const ALL_TOPOLOGIES: AntennaTopology[] = [
  'microstrip_patch',
  'rectangular_patch',
  'circular_patch',
  'array_2x2',
  'multi_element_mimo',
];

const FEATURE_IDX = Object.fromEntries(FEATURE_ORDER.map((k, i) => [k, i])) as Record<
  (typeof FEATURE_ORDER)[number],
  number
>;

test('FEATURE_ORDER has exact 21 features and OUTPUT_ORDER has exact 4 outputs', () => {
  assert.equal(FEATURE_ORDER.length, 21);
  assert.deepEqual(FEATURE_ORDER, [
    'patchLengthMm',
    'patchWidthMm',
    'substrateHeightMm',
    'dielectricConstant',
    'lossTangent',
    'feedXMm',
    'feedYMm',
    'operatingFreqGHz',
    'topologyCode',
    'conductorSigmaNorm',
    'insetDepthMm',
    'notchWidthMm',
    'probeDiameterMm',
    'feedTypeCode',
    'patchRadiusMm',
    'elementSpacingXmm',
    'elementSpacingYmm',
    'phaseXDeg',
    'phaseYDeg',
    'arrayLayoutCode',
    'portConfigurationCode',
  ]);
  assert.deepEqual(OUTPUT_ORDER, ['gainDbi', 'bandwidthMHz', 'resonantFreqGHz', 'efficiencyPct']);
});

test('encodeFeatures produces 21 finite numbers for every topology with exact zeroing of inactive fields', () => {
  for (const topology of ALL_TOPOLOGIES) {
    // Deliberately pollute all conditional fields with non-zero numbers to ensure encoder zeroes inactive ones
    const polluted = {
      ...createDefaultDesign(2.45, topology),
      insetDepthMm: 6.5,
      notchWidthMm: 2.1,
      probeDiameterMm: 1.3,
      feedTypeCode: 2,
      patchRadiusMm: 17.5,
      elementSpacingXmm: 62,
      elementSpacingYmm: 64,
      phaseXDeg: 25,
      phaseYDeg: -15,
      arrayLayoutCode: 1,
      portConfigurationCode: 4,
    };

    const vec = encodeFeatures(polluted);
    assert.equal(vec.length, 21, `${topology} vector length must be 21`);
    for (let i = 0; i < vec.length; i++) {
      assert.ok(Number.isFinite(vec[i]), `${topology} index ${i} (${FEATURE_ORDER[i]}) must be finite`);
    }
    assert.equal(vec[FEATURE_IDX.topologyCode], TOPOLOGY_CODE_MAP[topology]);

    if (topology === 'microstrip_patch') {
      assert.ok(vec[FEATURE_IDX.insetDepthMm] > 0);
      assert.ok(vec[FEATURE_IDX.notchWidthMm] > 0);
      assert.equal(vec[FEATURE_IDX.probeDiameterMm], 0);
      assert.equal(vec[FEATURE_IDX.feedTypeCode], 0);
      assert.equal(vec[FEATURE_IDX.patchRadiusMm], 0);
      assert.equal(vec[FEATURE_IDX.elementSpacingXmm], 0);
      assert.equal(vec[FEATURE_IDX.elementSpacingYmm], 0);
      assert.equal(vec[FEATURE_IDX.phaseXDeg], 0);
      assert.equal(vec[FEATURE_IDX.phaseYDeg], 0);
      assert.equal(vec[FEATURE_IDX.arrayLayoutCode], 0);
      assert.equal(vec[FEATURE_IDX.portConfigurationCode], 0);
    } else if (topology === 'rectangular_patch') {
      assert.equal(vec[FEATURE_IDX.insetDepthMm], 0);
      assert.equal(vec[FEATURE_IDX.notchWidthMm], 0);
      assert.ok(vec[FEATURE_IDX.probeDiameterMm] > 0);
      assert.equal(vec[FEATURE_IDX.feedTypeCode], 2);
      assert.equal(vec[FEATURE_IDX.patchRadiusMm], 0);
      assert.equal(vec[FEATURE_IDX.elementSpacingXmm], 0);
      assert.equal(vec[FEATURE_IDX.elementSpacingYmm], 0);
      assert.equal(vec[FEATURE_IDX.phaseXDeg], 0);
      assert.equal(vec[FEATURE_IDX.phaseYDeg], 0);
      assert.equal(vec[FEATURE_IDX.arrayLayoutCode], 0);
      assert.equal(vec[FEATURE_IDX.portConfigurationCode], 0);
    } else if (topology === 'circular_patch') {
      assert.equal(vec[FEATURE_IDX.patchLengthMm], 0);
      assert.equal(vec[FEATURE_IDX.patchWidthMm], 0);
      assert.ok(vec[FEATURE_IDX.patchRadiusMm] > 0);
      assert.equal(vec[FEATURE_IDX.insetDepthMm], 0);
      assert.equal(vec[FEATURE_IDX.notchWidthMm], 0);
      assert.equal(vec[FEATURE_IDX.probeDiameterMm], 0);
      assert.equal(vec[FEATURE_IDX.feedTypeCode], 0);
      assert.equal(vec[FEATURE_IDX.elementSpacingXmm], 0);
      assert.equal(vec[FEATURE_IDX.elementSpacingYmm], 0);
      assert.equal(vec[FEATURE_IDX.phaseXDeg], 0);
      assert.equal(vec[FEATURE_IDX.phaseYDeg], 0);
      assert.equal(vec[FEATURE_IDX.arrayLayoutCode], 0);
      assert.equal(vec[FEATURE_IDX.portConfigurationCode], 0);
    } else if (topology === 'array_2x2') {
      assert.equal(vec[FEATURE_IDX.insetDepthMm], 0);
      assert.equal(vec[FEATURE_IDX.notchWidthMm], 0);
      assert.equal(vec[FEATURE_IDX.probeDiameterMm], 0);
      assert.equal(vec[FEATURE_IDX.feedTypeCode], 0);
      assert.equal(vec[FEATURE_IDX.patchRadiusMm], 0);
      assert.ok(vec[FEATURE_IDX.elementSpacingXmm] > 0);
      assert.ok(vec[FEATURE_IDX.elementSpacingYmm] > 0);
      assert.equal(vec[FEATURE_IDX.phaseXDeg], 25);
      assert.equal(vec[FEATURE_IDX.phaseYDeg], -15);
      assert.equal(vec[FEATURE_IDX.arrayLayoutCode], 1);
      assert.equal(vec[FEATURE_IDX.portConfigurationCode], 0);
    } else if (topology === 'multi_element_mimo') {
      assert.equal(vec[FEATURE_IDX.insetDepthMm], 0);
      assert.equal(vec[FEATURE_IDX.notchWidthMm], 0);
      assert.equal(vec[FEATURE_IDX.probeDiameterMm], 0);
      assert.equal(vec[FEATURE_IDX.feedTypeCode], 0);
      assert.equal(vec[FEATURE_IDX.patchRadiusMm], 0);
      assert.ok(vec[FEATURE_IDX.elementSpacingXmm] > 0);
      assert.ok(vec[FEATURE_IDX.elementSpacingYmm] > 0);
      assert.equal(vec[FEATURE_IDX.phaseXDeg], 0);
      assert.equal(vec[FEATURE_IDX.phaseYDeg], 0);
      assert.equal(vec[FEATURE_IDX.arrayLayoutCode], 0);
      assert.equal(vec[FEATURE_IDX.portConfigurationCode], 4);
    }
  }
});

test('validateAntennaDesign catches invalid common and conditional parameters', () => {
  const validCircular = createDefaultDesign(2.45, 'circular_patch');
  assert.deepEqual(validateAntennaDesign(validCircular), {});

  const badCircular = { ...validCircular, patchRadiusMm: 0 };
  const circularErrs = validateAntennaDesign(badCircular);
  assert.ok(circularErrs.patchRadiusMm);

  const badArray = {
    ...createDefaultDesign(5.8, 'array_2x2'),
    phaseXDeg: 240,
    operatingFreqGHz: -1,
  };
  const arrayErrs = validateAntennaDesign(badArray);
  assert.ok(arrayErrs.phaseXDeg);
  assert.ok(arrayErrs.operatingFreqGHz);
});

test('validateAndParseImportedRows handles 21-feature CSV, missing columns, and legacy 10-feature zero-fill', () => {
  const rows21 = ALL_TOPOLOGIES.map((topo, idx) => {
    const d = createDefaultDesign(2.4 + idx * 0.5, topo);
    const vec = encodeFeatures(d);
    const row: Record<string, unknown> = { designName: `Test_${topo}` };
    FEATURE_ORDER.forEach((k, i) => {
      row[k] = vec[i];
    });
    row.gainDbi = 7.5 + idx;
    row.bandwidthMHz = 110;
    row.resonantFreqGHz = d.operatingFreqGHz;
    row.efficiencyPct = 86;
    return row;
  });

  const parsed21 = validateAndParseImportedRows(rows21, { filename: 'suite21.csv' });
  assert.equal(parsed21.valid, true);
  assert.equal(parsed21.isLegacy10Feature, false);
  assert.equal(parsed21.hasOutputs, true);
  assert.equal(parsed21.rows.length, 5);
  parsed21.rows.forEach((r) => {
    assert.equal(r.featureVector.length, 21);
    assert.ok(r.featureVector.every((v) => Number.isFinite(v)));
    assert.ok(r.outputs && Number.isFinite(r.outputs.gainDbi));
  });

  // Missing required column error
  const badParsed = validateAndParseImportedRows([{ patchLengthMm: 28, patchWidthMm: 35 }]);
  assert.equal(badParsed.valid, false);
  assert.ok(badParsed.missingFeatureColumns.length > 0);
  assert.ok(badParsed.errors.length > 0);

  // Legacy 10-feature backward compatibility
  const legacyRow: Record<string, unknown> = {
    patchLengthMm: 28.4,
    patchWidthMm: 36.2,
    substrateHeightMm: 1.6,
    dielectricConstant: 4.4,
    lossTangent: 0.02,
    feedXMm: 6.2,
    feedYMm: 0,
    operatingFreqGHz: 2.45,
    topologyCode: 0,
    conductorSigmaNorm: 1.0,
  };
  const parsedLegacy = validateAndParseImportedRows([legacyRow], { filename: 'legacy10.csv' });
  assert.equal(parsedLegacy.valid, true);
  assert.equal(parsedLegacy.isLegacy10Feature, true);
  assert.equal(parsedLegacy.rows.length, 1);
  assert.equal(parsedLegacy.rows[0].featureVector.length, 21);
  assert.deepEqual(parsedLegacy.rows[0].featureVector.slice(10), new Array(11).fill(0));
});

test('mlEngine predicts finite 4 outputs, Demo estimate flag, 21-feature vector, and SHAP across all models and topologies', () => {
  const models: MLModelType[] = ['ensemble', 'random_forest', 'xgboost', 'mlp'];

  for (const topology of ALL_TOPOLOGIES) {
    const design = createDefaultDesign(topology === 'array_2x2' ? 5.8 : 2.45, topology);
    for (const model of models) {
      const pred = mlEngine.predict(design, model);
      assert.equal(pred.isDemoEstimate, true);
      assert.equal(pred.provenance, 'Demo analytical-estimate surrogate — not EM-validated data.');
      assert.equal(pred.featureVector21.length, 21);
      assert.ok(pred.featureVector21.every((v) => Number.isFinite(v)));
      assert.ok(Number.isFinite(pred.gainDbi) && pred.gainDbi > 0);
      const minS11 = Math.min(...pred.frequencySweep.map((p) => p.s11Db));
      if (minS11 <= -10 && pred.returnLossDb <= -10) {
        assert.ok(Number.isFinite(pred.bandwidthMHz) && pred.bandwidthMHz > 0);
      } else {
        assert.equal(pred.bandwidthMHz, 0);
      }
      if (model !== 'mlp') {
        assert.ok(pred.bandwidthMHz > 0, `${topology} / ${model} should achieve -10 dB bandwidth`);
      }
      assert.ok(Number.isFinite(pred.resonantFreqGHz) && pred.resonantFreqGHz > 0);
      assert.ok(Number.isFinite(pred.efficiencyPct) && pred.efficiencyPct > 0 && pred.efficiencyPct <= 99);
      assert.equal(pred.shapContributions.length, 21);
    }
  }
});

test('mlEngine enforces 0 MHz bandwidth when S11 curve does not reach -10 dB', () => {
  const detuned = {
    ...createDefaultDesign(2.45, 'microstrip_patch', 'Alumina'),
    patchLengthMm: 45,
    patchWidthMm: 50,
    feedXMm: 0.2,
    feedYMm: 15,
    insetDepthMm: 0.2,
  };
  const pred = mlEngine.predict(detuned, 'ensemble');
  const minS11 = Math.min(...pred.frequencySweep.map((p) => p.s11Db));
  assert.ok(minS11 > -10, `Expected S11 sweep min > -10 dB for severely detuned design, got ${minS11}`);
  assert.equal(pred.bandwidthMHz, 0);
});

test('Circular Disk demo: 915 MHz FR-4 circular-disk yields positive gain, non-zero bandwidth, and reasonable efficiency with Demo estimate', () => {
  const defaultCirc = createDefaultDesign(0.915, 'circular_patch', 'FR4');
  const directPred = mlEngine.predict(defaultCirc, 'ensemble');
  assert.equal(directPred.isDemoEstimate, true);
  assert.ok(directPred.gainDbi > 1.0, `Expected positive gain > 1.0 dBi, got ${directPred.gainDbi}`);
  assert.ok(directPred.bandwidthMHz > 5, `Expected non-zero bandwidth > 5 MHz, got ${directPred.bandwidthMHz}`);
  assert.ok(directPred.efficiencyPct >= 40, `Expected reasonable efficiency >= 40%, got ${directPred.efficiencyPct}`);

  const nlRes = mlEngine.parseNaturalLanguageDesign(
    'Build an IoT 915 MHz circular patch antenna on low cost FR-4 substrate.',
  );
  assert.equal(nlRes.generatedParams.topology, 'circular_patch');
  assert.equal(nlRes.generatedParams.substrateMaterial, 'FR4');
  assert.equal(nlRes.prediction.isDemoEstimate, true);
  assert.ok(nlRes.prediction.gainDbi > 1.0, `Expected assistant gain > 1.0 dBi, got ${nlRes.prediction.gainDbi}`);
  assert.ok(nlRes.prediction.bandwidthMHz > 5, `Expected assistant BW > 5 MHz, got ${nlRes.prediction.bandwidthMHz}`);
  assert.ok(nlRes.prediction.efficiencyPct >= 40, `Expected assistant eff >= 40%, got ${nlRes.prediction.efficiencyPct}`);
});

test('Probe-Fed Patch preserves Rogers RO4350B without substitution and flags targetNotMet when gain target cannot be met', () => {
  const res = mlEngine.parseNaturalLanguageDesign(
    'Design a probe-fed patch antenna on Rogers RO4350B at 2.45 GHz with 10 dBi gain.',
  );
  assert.equal(res.generatedParams.topology, 'rectangular_patch');
  assert.equal(res.generatedParams.feedTypeCode, 2);
  assert.equal(res.generatedParams.substrateMaterial, 'Rogers_RO4350B');
  assert.equal(res.generatedParams.dielectricConstant, 3.48);
  assert.equal(res.generatedParams.lossTangent, 0.0037);
  assert.equal(res.targetNotMet, true);
  assert.ok(
    (res.targetStatusMessage ?? '').toLowerCase().includes('target not met'),
    `Expected targetStatusMessage to mention target not met, got: ${res.targetStatusMessage}`,
  );
  assert.ok(res.reply.toLowerCase().includes('target not met'));
});

test('5-fold cross-validation computes finite unscaled GHz/dBi/MHz/% mean +/- std metrics and improves bandwidth R2', () => {
  const cv = mlEngine.crossValidationReport;
  assert.equal(cv.folds, 5);
  assert.equal(cv.totalSamples, 750);
  assert.equal(cv.provenance, 'Demo estimate — not EM-validated');
  assert.equal(cv.bandwidthValidated, true);
  assert.ok(
    cv.bestPredictorPerOutput.bandwidthMHz.r2Mean >= 0.85,
    `Expected improved 5-fold bandwidth R2 >= 0.85, got ${cv.bestPredictorPerOutput.bandwidthMHz.r2Mean}`,
  );

  const [minFreq, maxFreq] = cv.datasetRanges.resonantFreqGHz;
  assert.ok(minFreq > 0.2 && maxFreq < 60);

  for (const modelRep of cv.models) {
    for (const targetKey of ['gainDbi', 'bandwidthMHz', 'resonantFreqGHz', 'efficiencyPct'] as const) {
      const m = modelRep[targetKey];
      for (const val of [m.r2Mean, m.r2Std, m.maeMean, m.maeStd, m.rmseMean, m.rmseStd]) {
        assert.ok(Number.isFinite(val), `${modelRep.model}.${targetKey} must be finite`);
      }
      assert.ok(m.maeMean >= 0 && m.rmseMean >= m.maeMean - 1e-6);
    }

    // Specifically verify resonantFreqGHz MAE/RMSE are strictly in physical GHz scale (not exploded)
    assert.ok(
      modelRep.resonantFreqGHz.maeMean < 2.5,
      `${modelRep.model} resonantFreqGHz MAE (${modelRep.resonantFreqGHz.maeMean}) must be in GHz`,
    );
    assert.ok(
      modelRep.resonantFreqGHz.rmseMean < 4.0,
      `${modelRep.model} resonantFreqGHz RMSE (${modelRep.resonantFreqGHz.rmseMean}) must be in GHz`,
    );
  }
});

test('mapDesignToPredictorInput produces canonical topologyName and topology-specific fields for predict.py', () => {
  const inset = mapDesignToPredictorInput(createDefaultDesign(2.45, 'microstrip_patch', 'FR4'));
  assert.equal(inset.topologyName, 'Microstrip_Inset_Patch');
  assert.ok(typeof inset.patchLengthMm === 'number' && inset.patchLengthMm > 0);
  assert.ok(typeof inset.insetDepthMm === 'number' && inset.insetDepthMm > 0);
  assert.ok(typeof inset.notchWidthMm === 'number' && inset.notchWidthMm > 0);

  const probe = mapDesignToPredictorInput(createDefaultDesign(2.45, 'rectangular_patch'));
  assert.equal(probe.topologyName, 'Probe_Fed_Rectangular_Patch');
  assert.ok(typeof probe.probeDiameterMm === 'number' && probe.probeDiameterMm > 0);

  const circ = mapDesignToPredictorInput(createDefaultDesign(0.915, 'circular_patch'));
  assert.equal(circ.topologyName, 'Circular_Disk_Patch');
  assert.ok(typeof circ.patchRadiusMm === 'number' && circ.patchRadiusMm > 0);
  assert.equal(circ.patchLengthMm, undefined);

  const arr = mapDesignToPredictorInput(createDefaultDesign(5.8, 'array_2x2'));
  assert.equal(arr.topologyName, '2x2_Phased_Planar_Array');
  assert.ok(typeof arr.elementSpacingXmm === 'number' && arr.elementSpacingXmm > 0);
  assert.equal(typeof arr.phaseXDeg, 'number');

  const mimo = mapDesignToPredictorInput(createDefaultDesign(3.5, 'multi_element_mimo'));
  assert.equal(mimo.topologyName, '4_Element_MIMO_Array');
  assert.ok(typeof mimo.elementSpacingXmm === 'number' && mimo.elementSpacingXmm > 0);
});

test('mlEngine.buildPredictionFromSurrogateOutputs integrates trained .joblib outputs cleanly', () => {
  const design = createDefaultDesign(2.45, 'microstrip_patch', 'FR4');
  const pred = mlEngine.buildPredictionFromSurrogateOutputs(
    design,
    {
      gainDbi: 6.057,
      bandwidthMHz: 95.97,
      resonantFreqGHz: 2.644,
      efficiencyPct: 70.459,
    },
    'ensemble',
    {
      provenance: 'Trained AntennaSurrogatePredictor (antenna_surrogate_ensemble.joblib)',
      isDemoEstimate: false,
      enforceTenDbBandwidthGate: false,
    },
  );
  assert.equal(pred.isDemoEstimate, false);
  assert.equal(pred.gainDbi, 6.06);
  assert.equal(pred.bandwidthMHz, 96);
  assert.equal(pred.resonantFreqGHz, 2.644);
  assert.equal(pred.efficiencyPct, 70.5);
  assert.equal(pred.featureVector21.length, 21);
  assert.equal(pred.shapContributions.length, 21);
  assert.equal(pred.frequencySweep.length, 25);
});

test('mlEngine.optimizeForTargetAsync searches candidates to meet targetGainDbi', async () => {
  const base = {
    ...createDefaultDesign(2.45, 'microstrip_patch', 'FR4'),
    targetGainDbi: 10.0,
  };
  const res = await mlEngine.optimizeForTargetAsync(base, 'ensemble', true);
  assert.ok(res.evaluatedCount >= 20);
  assert.equal(res.targetGainDbi, 10.0);
  assert.ok(
    res.prediction.gainDbi >= res.originalPrediction.gainDbi,
    `Expected optimized gain (${res.prediction.gainDbi}) >= original (${res.originalPrediction.gainDbi})`,
  );
  assert.equal(res.targetMet, true);
  assert.equal(res.upgradedTopology, true);
});

test('mlEngine.diagnoseFaults detects faults consistent with originalPrediction and repairs design', () => {
  const faulty = {
    ...createDefaultDesign(5.8, 'microstrip_patch', 'FR4'),
    patchLengthMm: 16.5,
    patchWidthMm: 15.0,
    substrateHeightMm: 0.6,
    feedXMm: 1.1,
    feedYMm: 4.2,
    insetDepthMm: 1.1,
    notchWidthMm: 1.0,
    conductorMaterial: 'Aluminum' as const,
  };
  const diag = mlEngine.diagnoseFaults(faulty);
  assert.ok(diag.faults.length >= 3);
  assert.ok(diag.healthScore < 70);
  assert.ok(
    diag.correctedPrediction.efficiencyPct >= diag.originalPrediction.efficiencyPct,
    'Expected repaired efficiency >= original efficiency',
  );
});
