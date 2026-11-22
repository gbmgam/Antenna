import React, { useMemo } from 'react';
import type { AntennaDesignParams, PredictionResult } from '../shared/antennaTypes.ts';
import { CONDUCTOR_CATALOG, SUBSTRATE_CATALOG, TOPOLOGY_LABELS } from '../shared/rfPhysics.ts';

interface AntennaViewport2DProps {
  params: AntennaDesignParams;
  prediction?: PredictionResult | null;
  compact?: boolean;
}

export const AntennaViewport2D: React.FC<AntennaViewport2DProps> = ({
  params,
  prediction = null,
  compact = false,
}) => {
  const conductor = CONDUCTOR_CATALOG[params.conductorMaterial] ?? CONDUCTOR_CATALOG.Copper;
  const substrate = SUBSTRATE_CATALOG[params.substrateMaterial] ?? SUBSTRATE_CATALOG.Rogers_RO4003C;

  const geometry = useMemo(() => {
    const isCircular = params.topology === 'circular_patch';
    const isArray = params.topology === 'array_2x2';
    const isMimo = params.topology === 'multi_element_mimo';
    const isLinear4 = isArray && params.arrayLayoutCode === 2;

    const patchL = isCircular
      ? Math.max(4, params.patchRadiusMm * 2)
      : Math.max(2, params.patchLengthMm);
    const patchW = isCircular
      ? Math.max(4, params.patchRadiusMm * 2)
      : Math.max(2, params.patchWidthMm);

    const dx = Math.max(patchL + 4, params.elementSpacingXmm || patchL * 1.45);
    const dy = Math.max(patchW + 4, params.elementSpacingYmm || patchW * 1.45);

    let spanX = patchL;
    let spanY = patchW;
    if (isLinear4) {
      spanX = 3 * dx + patchL;
      spanY = patchW;
    } else if (isArray || isMimo) {
      spanX = dx + patchL;
      spanY = dy + patchW;
    }

    const marginMm = Math.max(6, Math.min(18, Math.max(patchL, patchW) * 0.25));
    const boardL = spanX + marginMm * 2;
    const boardW = spanY + marginMm * 2;

    // Fit cleanly inside the left CAD zone
    const cadBox = compact
      ? { x: 48, y: 54, w: 664, h: 270 }
      : { x: 42, y: 56, w: 430, h: 256 };
    const scale = Math.min(cadBox.w / boardL, cadBox.h / boardW) * 0.88;
    const cx = cadBox.x + cadBox.w / 2;
    const cy = cadBox.y + cadBox.h / 2;

    return {
      isCircular,
      isArray,
      isMimo,
      isLinear4,
      patchL,
      patchW,
      dx,
      dy,
      boardL,
      boardW,
      scale,
      cx,
      cy,
      cadBox,
    };
  }, [params, compact]);

  const { isCircular, isArray, isMimo, isLinear4, patchL, patchW, dx, dy, boardL, boardW, scale, cx, cy } =
    geometry;

  const boardPxW = boardL * scale;
  const boardPxH = boardW * scale;
  const patchPxL = patchL * scale;
  const patchPxW = patchW * scale;

  const copperFill = conductor.colorHex;
  const substrateTint =
    params.substrateMaterial === 'FR4'
      ? '#123128'
      : params.substrateMaterial === 'Alumina'
        ? '#cbd5e1'
        : '#1a2742';
  const substrateStroke =
    params.substrateMaterial === 'Alumina' ? '#94a3b8' : '#38bdf8';

  const elementOffsets: Array<{ x: number; y: number; label: string; phase?: string }> = [];
  if (isLinear4) {
    for (let i = 0; i < 4; i++) {
      elementOffsets.push({
        x: (i - 1.5) * dx,
        y: 0,
        label: `E${i + 1}`,
        phase: `${Math.round(i * params.phaseXDeg)}°`,
      });
    }
  } else if (isArray) {
    const coords: Array<[number, number, string, number, number]> = [
      [-dx / 2, -dy / 2, 'E1', 0, 0],
      [dx / 2, -dy / 2, 'E2', 1, 0],
      [-dx / 2, dy / 2, 'E3', 0, 1],
      [dx / 2, dy / 2, 'E4', 1, 1],
    ];
    coords.forEach(([ox, oy, label, ix, iy]) => {
      elementOffsets.push({
        x: ox,
        y: oy,
        label,
        phase: `${Math.round(ix * params.phaseXDeg + iy * params.phaseYDeg)}°`,
      });
    });
  } else if (isMimo) {
    const coords: Array<[number, number, string]> = [
      [-dx / 2, -dy / 2, 'P1'],
      [dx / 2, -dy / 2, 'P2'],
      [-dx / 2, dy / 2, 'P3'],
      [dx / 2, dy / 2, 'P4'],
    ];
    coords.forEach(([ox, oy, label]) => {
      elementOffsets.push({ x: ox, y: oy, label });
    });
  } else {
    elementOffsets.push({ x: 0, y: 0, label: 'Patch' });
  }

  // Polar far-field E-plane lobe path for the 2D right-side inset
  const polarPath = useMemo(() => {
    const beamDeg = Math.max(18, Math.min(115, prediction?.beamwidthDeg ?? 74));
    const nExp = Math.max(0.8, Math.log(0.5) / Math.log(Math.cos(((beamDeg / 2) * Math.PI) / 180)));
    const pts: string[] = [];
    const rMax = 66;
    const pcx = 626;
    const pcy = 178;
    for (let deg = -180; deg <= 180; deg += 4) {
      const rad = (deg * Math.PI) / 180;
      const cosT = Math.cos(rad);
      const norm = cosT > 0 ? Math.pow(cosT, Math.min(8, nExp * 0.65)) : 0.14 + 0.08 * Math.abs(cosT);
      const r = rMax * norm;
      const px = pcx + r * Math.sin(rad);
      const py = pcy - r * Math.cos(rad);
      pts.push(`${deg === -180 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`);
    }
    return pts.join(' ') + ' Z';
  }, [prediction?.beamwidthDeg]);

  const probeRadiusPx = Math.max(2.5, Math.min(7, (params.probeDiameterMm || 1.27) * scale * 0.6));

  return (
    <div className="relative h-full w-full select-none bg-[#040814]">
      <svg
        viewBox="0 0 760 400"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label={`2D CAD schematic of ${TOPOLOGY_LABELS[params.topology]}`}
      >
        <defs>
          <pattern id="cad-grid-minor" width="16" height="16" patternUnits="userSpaceOnUse">
            <path
              d="M 16 0 L 0 0 0 16"
              fill="none"
              stroke="rgba(56, 189, 248, 0.06)"
              strokeWidth="0.7"
            />
          </pattern>
          <pattern id="cad-grid-major" width="64" height="64" patternUnits="userSpaceOnUse">
            <rect width="64" height="64" fill="url(#cad-grid-minor)" />
            <path
              d="M 64 0 L 0 0 0 64"
              fill="none"
              stroke="rgba(56, 189, 248, 0.14)"
              strokeWidth="0.9"
            />
          </pattern>
          <marker
            id="dim-arrow"
            viewBox="0 0 8 8"
            refX="4"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 8 4 L 0 7 z" fill="#22d3ee" />
          </marker>
        </defs>

        <rect width="760" height="400" fill="url(#cad-grid-major)" />

        {/* Center Crosshairs in CAD Zone */}
        <line
          x1={cx - boardPxW * 0.62}
          y1={cy}
          x2={cx + boardPxW * 0.62}
          y2={cy}
          stroke="rgba(34,211,238,0.22)"
          strokeDasharray="4 4"
        />
        <line
          x1={cx}
          y1={cy - boardPxH * 0.65}
          x2={cx}
          y2={cy + boardPxH * 0.65}
          stroke="rgba(34,211,238,0.22)"
          strokeDasharray="4 4"
        />

        {/* Substrate Footprint */}
        <rect
          x={cx - boardPxW / 2}
          y={cy - boardPxH / 2}
          width={boardPxW}
          height={boardPxH}
          rx={4}
          fill={substrateTint}
          fillOpacity={params.substrateMaterial === 'Alumina' ? 0.25 : 0.85}
          stroke={substrateStroke}
          strokeOpacity={0.55}
          strokeWidth={1.4}
        />

        {/* Ground Plane Margin Outline */}
        <rect
          x={cx - boardPxW / 2 + 4}
          y={cy - boardPxH / 2 + 4}
          width={Math.max(4, boardPxW - 8)}
          height={Math.max(4, boardPxH - 8)}
          rx={2}
          fill="none"
          stroke="rgba(217, 119, 6, 0.35)"
          strokeDasharray="3 3"
          strokeWidth={1}
        />

        {/* Array Corporate Feed Network (for 2x2 or Linear 4-Element) */}
        {isArray && (
          <g stroke={copperFill} strokeWidth={Math.max(1.8, scale * 1.1)} fill="none" opacity={0.9}>
            {isLinear4 ? (
              <>
                <line x1={cx - 1.5 * dx * scale} y1={cy + patchPxW * 0.68} x2={cx + 1.5 * dx * scale} y2={cy + patchPxW * 0.68} />
                <line x1={cx} y1={cy + patchPxW * 0.68} x2={cx} y2={cy + boardPxH / 2} />
                {elementOffsets.map((el) => (
                  <line
                    key={`tr-${el.label}`}
                    x1={cx + el.x * scale}
                    y1={cy}
                    x2={cx + el.x * scale}
                    y2={cy + patchPxW * 0.68}
                  />
                ))}
              </>
            ) : (
              <>
                <line x1={cx - (dx * scale) / 2} y1={cy - (dy * scale) / 2} x2={cx - (dx * scale) / 2} y2={cy + (dy * scale) / 2} />
                <line x1={cx + (dx * scale) / 2} y1={cy - (dy * scale) / 2} x2={cx + (dx * scale) / 2} y2={cy + (dy * scale) / 2} />
                <line x1={cx - (dx * scale) / 2} y1={cy} x2={cx + (dx * scale) / 2} y2={cy} />
                <line x1={cx} y1={cy} x2={cx} y2={cy + boardPxH / 2} />
              </>
            )}
          </g>
        )}

        {/* Radiating Copper Elements */}
        {elementOffsets.map((el) => {
          const ex = cx + el.x * scale;
          const ey = cy + el.y * scale;
          const feedRelX = Math.min(patchL * 0.48, Math.max(0, params.feedXMm));
          const feedRelY = Math.max(-patchW * 0.44, Math.min(patchW * 0.44, params.feedYMm));
          const feedPxX = ex - patchPxL / 2 + feedRelX * scale;
          const feedPxY = ey + feedRelY * scale;

          if (isCircular) {
            const radPx = Math.max(8, params.patchRadiusMm * scale);
            const circFeedX = ex - radPx + Math.min(radPx * 1.9, Math.max(0, params.feedXMm * scale));
            return (
              <g key={el.label}>
                <circle
                  cx={ex}
                  cy={ey}
                  r={radPx}
                  fill={copperFill}
                  fillOpacity={0.86}
                  stroke="#fde68a"
                  strokeWidth={1.2}
                />
                {/* Radius Vector Line */}
                <line
                  x1={ex}
                  y1={ey}
                  x2={ex + radPx * Math.cos(-Math.PI / 5)}
                  y2={ey + radPx * Math.sin(-Math.PI / 5)}
                  stroke="#040814"
                  strokeWidth={1.5}
                />
                <text
                  x={ex + radPx * 0.45}
                  y={ey - radPx * 0.25}
                  fill="#040814"
                  fontSize="11"
                  fontFamily="monospace"
                  fontWeight="700"
                >
                  R {params.patchRadiusMm}mm
                </text>
                {/* Coaxial feed marker */}
                <circle cx={circFeedX} cy={ey + feedRelY * scale} r={4} fill="#22d3ee" stroke="#040814" strokeWidth={1.2} />
              </g>
            );
          }

          const insetDepthPx =
            params.topology === 'microstrip_patch'
              ? Math.min(patchPxL * 0.46, Math.max(2, params.insetDepthMm * scale))
              : 0;
          const notchHalfPx =
            params.topology === 'microstrip_patch'
              ? Math.min(patchPxW * 0.28, Math.max(2, (params.notchWidthMm * scale) / 2))
              : 0;
          const lineHalfPx = Math.max(1.8, Math.min(5, scale * 0.65));

          return (
            <g key={el.label}>
              <rect
                x={ex - patchPxL / 2}
                y={ey - patchPxW / 2}
                width={patchPxL}
                height={patchPxW}
                rx={1.5}
                fill={copperFill}
                fillOpacity={0.88}
                stroke="#fde68a"
                strokeWidth={1}
              />

              {/* Inset notch + microstrip line */}
              {params.topology === 'microstrip_patch' && (
                <>
                  <rect
                    x={ex - patchPxL / 2}
                    y={ey - notchHalfPx - lineHalfPx}
                    width={insetDepthPx}
                    height={notchHalfPx * 2 + lineHalfPx * 2}
                    fill={substrateTint}
                  />
                  <rect
                    x={cx - boardPxW / 2}
                    y={ey - lineHalfPx}
                    width={ex - patchPxL / 2 + insetDepthPx - (cx - boardPxW / 2)}
                    height={lineHalfPx * 2}
                    fill={copperFill}
                  />
                  {/* SMA edge launch pad */}
                  <rect
                    x={cx - boardPxW / 2 - 4}
                    y={ey - 5}
                    width={6}
                    height={10}
                    fill="#facc15"
                    stroke="#040814"
                    strokeWidth={0.8}
                  />
                </>
              )}

              {/* Coaxial probe or inset marker for rectangular_patch */}
              {params.topology === 'rectangular_patch' && (
                <circle
                  cx={feedPxX}
                  cy={feedPxY}
                  r={probeRadiusPx}
                  fill="#22d3ee"
                  stroke="#040814"
                  strokeWidth={1.3}
                />
              )}

              {/* MIMO Port Pads */}
              {isMimo && (
                <>
                  <circle
                    cx={ex - patchPxL * 0.22}
                    cy={ey}
                    r={params.portConfigurationCode === 4 ? 3.5 : 2.5}
                    fill={params.portConfigurationCode === 4 ? '#22d3ee' : '#94a3b8'}
                    stroke="#040814"
                    strokeWidth={1}
                  />
                  <text
                    x={ex}
                    y={ey + 3}
                    textAnchor="middle"
                    fill="#040814"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="700"
                  >
                    {params.portConfigurationCode === 4 ? el.label : 'COMB'}
                  </text>
                </>
              )}

              {/* Phased Array Element Phase Label */}
              {isArray && el.phase && (
                <text
                  x={ex}
                  y={ey + 3}
                  textAnchor="middle"
                  fill="#040814"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="700"
                >
                  {el.phase}
                </text>
              )}
            </g>
          );
        })}

        {/* Top Horizontal Dimension (L or Span) */}
        <line
          x1={cx - patchPxL / 2}
          y1={cy - boardPxH / 2 - 14}
          x2={cx + patchPxL / 2}
          y2={cy - boardPxH / 2 - 14}
          stroke="#22d3ee"
          strokeWidth={1}
          markerStart="url(#dim-arrow)"
          markerEnd="url(#dim-arrow)"
        />
        <text
          x={cx}
          y={cy - boardPxH / 2 - 20}
          textAnchor="middle"
          fill="#67e8f9"
          fontSize="10.5"
          fontFamily="monospace"
        >
          {isCircular ? `D = ${(params.patchRadiusMm * 2).toFixed(1)} mm` : `L = ${params.patchLengthMm} mm`}
        </text>

        {/* Left Vertical Dimension (W or D) */}
        <line
          x1={cx - boardPxW / 2 - 14}
          y1={cy - patchPxW / 2}
          x2={cx - boardPxW / 2 - 14}
          y2={cy + patchPxW / 2}
          stroke="#22d3ee"
          strokeWidth={1}
          markerStart="url(#dim-arrow)"
          markerEnd="url(#dim-arrow)"
        />
        <text
          x={cx - boardPxW / 2 - 20}
          y={cy + 3}
          textAnchor="end"
          fill="#67e8f9"
          fontSize="10.5"
          fontFamily="monospace"
        >
          {isCircular ? `R ${params.patchRadiusMm}` : `W ${params.patchWidthMm}`}
        </text>

        {/* Array / MIMO Spacing Callout */}
        {(isArray || isMimo) && (
          <text
            x={cx}
            y={cy + boardPxH / 2 + 16}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize="10"
            fontFamily="monospace"
          >
            Pitch dX={params.elementSpacingXmm}mm · dY={params.elementSpacingYmm}mm · Feed ({params.feedXMm}, {params.feedYMm})mm
          </text>
        )}

        {/* Right Side: 2D Polar Far-Field Cut + Cross-Section Stackup (Full Viewport Mode) */}
        {!compact && (
          <>
            {/* Divider */}
            <line
              x1="495"
              y1="44"
              x2="495"
              y2="375"
              stroke="rgba(56, 189, 248, 0.16)"
              strokeDasharray="4 4"
            />

            {/* 2D Polar Radiation Lobe (E-Plane) */}
            <text
              x="626"
              y="62"
              textAnchor="middle"
              fill="#67e8f9"
              fontSize="10.5"
              fontFamily="monospace"
              fontWeight="600"
            >
              2D E-PLANE PATTERN · {prediction ? `${prediction.gainDbi} dBi` : '-- dBi'}
            </text>
            {[22, 44, 66].map((r) => (
              <circle
                key={r}
                cx="626"
                cy="178"
                r={r}
                fill="none"
                stroke="rgba(56, 189, 248, 0.18)"
                strokeDasharray="2 3"
              />
            ))}
            <line x1="554" y1="178" x2="698" y2="178" stroke="rgba(56, 189, 248, 0.22)" />
            <line x1="626" y1="106" x2="626" y2="250" stroke="rgba(56, 189, 248, 0.22)" />
            <path
              d={polarPath}
              fill="rgba(34, 211, 238, 0.18)"
              stroke="#22d3ee"
              strokeWidth={1.8}
            />
            <text
              x="626"
              y="265"
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="9.5"
              fontFamily="monospace"
            >
              3dB Beamwidth: {prediction?.beamwidthDeg ?? '--'}°
            </text>

            {/* Layer Stackup Cross-Section */}
            <text
              x="514"
              y="294"
              fill="#67e8f9"
              fontSize="10"
              fontFamily="monospace"
              fontWeight="600"
            >
              PCB LAYER STACKUP (SIDE)
            </text>
            {/* Top Copper Foil */}
            <rect x="546" y="306" width="160" height="6" fill={copperFill} />
            <text x="714" y="312" fill="#cbd5e1" fontSize="9" fontFamily="monospace">
              35μm {conductor.name}
            </text>
            {/* Dielectric Substrate */}
            <rect
              x="514"
              y="312"
              width="224"
              height="26"
              fill={substrateTint}
              stroke={substrateStroke}
              strokeOpacity={0.5}
            />
            <text
              x="626"
              y="328"
              textAnchor="middle"
              fill={params.substrateMaterial === 'Alumina' ? '#f8fafc' : '#e2e8f0'}
              fontSize="9.5"
              fontFamily="monospace"
            >
              {substrate.name} · h={params.substrateHeightMm}mm · εr={params.dielectricConstant}
            </text>
            {/* Bottom Ground Plane */}
            <rect x="514" y="338" width="224" height="6" fill="#d97706" />
            <text x="626" y="357" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">
              Ground Plane (Copper) · tan δ = {params.lossTangent}
            </text>
          </>
        )}
      </svg>
    </div>
  );
};
