import { jsPDF } from 'jspdf';
import type { AntennaDesignParams, PredictionResult } from '../shared/antennaTypes.ts';
import {
  ARRAY_LAYOUT_LABELS,
  FEATURE_ORDER,
  FEED_TYPE_LABELS,
  OUTPUT_ORDER,
  PORT_CONFIGURATION_LABELS,
  buildFeatureRecord21,
  getActiveConditionalFields,
  FEATURE_METADATA,
} from '../shared/antennaSchema.ts';
import {
  CONDUCTOR_CATALOG,
  SUBSTRATE_CATALOG,
  TOPOLOGY_LABELS,
  hasAchievedTenDbBandwidth,
} from '../shared/rfPhysics.ts';

export function downloadAntennaCSV(params: AntennaDesignParams, prediction: PredictionResult) {
  const rec = buildFeatureRecord21(params);
  const headers = [
    'designName',
    ...FEATURE_ORDER,
    ...OUTPUT_ORDER,
    'returnLossDb',
    'vswr',
    'inputImpedanceOhm',
    'beamwidthDeg',
    'areaMm2',
    'estimatedCostUsd',
    'estimationLabel',
    'provenance',
  ];

  const tenDbAchieved = hasAchievedTenDbBandwidth(prediction);
  const values: Array<string | number> = [
    `"${params.name.replace(/"/g, '""')}"`,
    ...FEATURE_ORDER.map((k) => rec[k]),
    prediction.gainDbi,
    tenDbAchieved ? prediction.bandwidthMHz : 0,
    prediction.resonantFreqGHz,
    prediction.efficiencyPct,
    prediction.returnLossDb,
    prediction.vswr,
    prediction.inputImpedanceOhm,
    prediction.beamwidthDeg,
    prediction.areaMm2,
    prediction.estimatedCostUsd,
    '"Demo estimate (synthetic/analytical ML surrogate)"',
    `"${prediction.provenance.replace(/"/g, '""')}"`,
  ];

  const csvContent = headers.join(',') + '\n' + values.join(',') + '\n';

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `antenna_ai_report_${params.operatingFreqGHz}ghz.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadAntennaPDF(params: AntennaDesignParams, prediction: PredictionResult) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 44;
  let y = 52;
  const rec = buildFeatureRecord21(params);
  const activeCond = getActiveConditionalFields(params.topology);

  // Header band
  doc.setFillColor(6, 13, 32);
  doc.rect(0, 0, 595, 102, 'F');
  doc.setTextColor(34, 211, 238);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text('ANTENNA AI — ENGINEERING REPORT (DEMO ESTIMATE)', margin, 40);
  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    `Design: ${params.name}  |  Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`,
    margin,
    62,
  );
  doc.text(`Provenance: ${prediction.provenance}`, margin, 78);
  doc.setTextColor(251, 191, 36);
  doc.text('Notice: Synthetic/analytical surrogate predictions — verify in CST/HFSS/openEMS before fabrication.', margin, 92);

  y = 128;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('1. Antenna Geometry & 21-Feature Specification', margin, y);
  y += 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const dimLine =
    params.topology === 'circular_patch'
      ? `Circular Disk Radius: ${params.patchRadiusMm} mm (L=0 mm, W=0 mm encoded for circular mode)`
      : `Patch Dimensions (L x W): ${params.patchLengthMm} mm x ${params.patchWidthMm} mm`;

  const geoLines = [
    `Topology Architecture: ${TOPOLOGY_LABELS[params.topology]} (topologyCode = ${rec.topologyCode})`,
    `Operating Frequency: ${params.operatingFreqGHz} GHz`,
    dimLine,
    `Substrate: ${SUBSTRATE_CATALOG[params.substrateMaterial].name} (er = ${params.dielectricConstant}, tan d = ${params.lossTangent}, h = ${params.substrateHeightMm} mm)`,
    `Conductor Layer: ${CONDUCTOR_CATALOG[params.conductorMaterial].name} (sigma_norm = ${rec.conductorSigmaNorm})`,
    `Feed Coordinates (x, y): (${params.feedXMm} mm, ${params.feedYMm} mm)`,
  ];

  for (const key of activeCond) {
    const meta = FEATURE_METADATA[key];
    let valText = `${rec[key]} ${meta.unit}`.trim();
    if (key === 'feedTypeCode') valText = `${rec[key]} (${FEED_TYPE_LABELS[rec[key]] ?? 'Custom'})`;
    if (key === 'arrayLayoutCode') valText = `${rec[key]} (${ARRAY_LAYOUT_LABELS[rec[key]] ?? 'Custom'})`;
    if (key === 'portConfigurationCode') valText = `${rec[key]} (${PORT_CONFIGURATION_LABELS[rec[key]] ?? 'Custom'})`;
    geoLines.push(`${meta.label}: ${valText}`);
  }

  for (const line of geoLines) {
    doc.text(line, margin + 8, y);
    y += 16;
  }

  y += 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('2. Machine Learning Predicted RF Performance (Demo Estimate)', margin, y);
  y += 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const tenDbBwText = hasAchievedTenDbBandwidth(prediction)
    ? `${prediction.bandwidthMHz} MHz`
    : '0 MHz (No -10 dB bandwidth achieved)';
  const perfLines = [
    `Realized Gain: ${prediction.gainDbi} dBi`,
    `Impedance Bandwidth (S11 <= -10 dB): ${tenDbBwText}`,
    `Resonant Frequency: ${prediction.resonantFreqGHz} GHz`,
    `Radiation Efficiency: ${prediction.efficiencyPct} %`,
    `Return Loss (S11): ${prediction.returnLossDb} dB  |  VSWR: ${prediction.vswr}:1`,
    `Input Impedance: ${prediction.inputImpedanceOhm} Ohm  |  3dB Beamwidth: ${prediction.beamwidthDeg} deg`,
    `Board Footprint Area: ${prediction.areaMm2} mm^2  |  Est. Material Cost: $${prediction.estimatedCostUsd}`,
  ];
  for (const line of perfLines) {
    doc.text(line, margin + 8, y);
    y += 16;
  }

  if (prediction.shapContributions && prediction.shapContributions.length > 0) {
    y += 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('3. Top 21-Feature Surrogate Attribution Drivers', margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    for (const s of prediction.shapContributions.slice(0, 6)) {
      doc.text(
        `${s.label}: value=${s.value}${s.unit ? ' ' + s.unit : ''} | importance=${s.importancePct}% | gain delta=${s.gainImpactDbi >= 0 ? '+' : ''}${s.gainImpactDbi} dBi`,
        margin + 8,
        y,
      );
      y += 15;
    }
  }

  y += 16;
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8.5);
  doc.text(
    'Demo estimate notice: Surrogate predictions are generated by ANTENNA AI ML models trained on Balanis analytical cavity equations (21-feature schema). They are not CST/HFSS full-wave simulation or VNA measured results.',
    margin,
    y,
    { maxWidth: 505 },
  );

  doc.save(`antenna_ai_report_${params.operatingFreqGHz}ghz.pdf`);
}
