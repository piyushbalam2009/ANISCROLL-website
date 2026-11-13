'use client';

import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';

export interface ChartDatum {
  label: string;
  value: number;
  secondaryValue?: number;
}

export function AdminChartEmpty({
  title,
  message = 'Data unavailable',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center border border-dashed border-[#292929] rounded-xl bg-[#070707]">
      <BarChart3 size={20} className="text-[#555555] mb-2" aria-hidden="true" />
      {title && <div className="text-xs font-semibold text-white mb-0.5">{title}</div>}
      <div className="text-xs font-mono text-[#707070]">{message}</div>
    </div>
  );
}

export function AdminAreaChart({
  data,
  height = 180,
  valueSuffix = '',
  primaryLabel = 'Value',
  secondaryLabel,
  emptyMessage = 'Data unavailable',
}: {
  data: ChartDatum[];
  height?: number;
  valueSuffix?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  emptyMessage?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return <AdminChartEmpty message={emptyMessage} />;
  }

  const width = 560;
  const padLeft = 40;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allVals = data.flatMap((d) =>
    typeof d.secondaryValue === 'number' ? [d.value, d.secondaryValue] : [d.value]
  );
  const maxVal = Math.max(1, ...allVals);
  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  const coords = data.map((d, idx) => {
    const x =
      data.length === 1
        ? padLeft + plotW / 2
        : padLeft + (idx / (data.length - 1)) * plotW;
    const y = padTop + plotH - (d.value / maxVal) * plotH;
    const y2 =
      typeof d.secondaryValue === 'number'
        ? padTop + plotH - (d.secondaryValue / maxVal) * plotH
        : null;
    return { x, y, y2, ...d };
  });

  const linePath = coords
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath =
    coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1]!.x.toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${coords[0]!.x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
      : '';

  const secondaryPath = coords.every((p) => p.y2 !== null)
    ? coords
        .map(
          (p, i) =>
            `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${(p.y2 as number).toFixed(1)}`
        )
        .join(' ')
    : null;

  const activePoint = hoverIdx !== null ? coords[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none"
        role="img"
        aria-label={primaryLabel}
      >
        <defs>
          <linearGradient id="adminAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {yTicks.map((tick, i) => {
          const y = padTop + plotH - (tick / maxVal) * plotH;
          return (
            <g key={`${tick}-${i}`}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#222222"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                fill="#707070"
                fontSize="10"
                fontFamily="monospace"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill="url(#adminAreaGrad)" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {secondaryPath && (
          <path
            d={secondaryPath}
            fill="none"
            stroke="#707070"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />
        )}

        {coords.map((p, idx) => {
          const showLabel =
            data.length <= 8 || idx === 0 || idx === data.length - 1 || idx % 2 === 0;
          const isHovered = hoverIdx === idx;
          return (
            <g key={`${p.label}-${idx}`}>
              {showLabel && (
                <text
                  x={p.x}
                  y={height - 6}
                  textAnchor="middle"
                  fill="#707070"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {p.label}
                </text>
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={isHovered ? 4.5 : 2.5}
                fill={isHovered ? '#ffffff' : '#0A0A0A'}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              <rect
                x={p.x - Math.max(12, plotW / Math.max(2, data.length * 2))}
                y={padTop}
                width={Math.max(24, plotW / Math.max(1, data.length))}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
                className="cursor-crosshair"
              />
            </g>
          );
        })}
      </svg>

      {activePoint && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] text-[11px] font-mono tabular-nums">
          <span className="text-[#A0A0A0]">{activePoint.label}</span>
          <div className="flex items-center gap-3">
            <span className="text-white font-semibold">
              {primaryLabel}: {activePoint.value}
              {valueSuffix}
            </span>
            {secondaryLabel && typeof activePoint.secondaryValue === 'number' && (
              <span className="text-[#A0A0A0]">
                {secondaryLabel}: {activePoint.secondaryValue}
                {valueSuffix}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminBarChart({
  data,
  height = 180,
  valueSuffix = '',
  primaryLabel = 'Value',
  emptyMessage = 'Data unavailable',
}: {
  data: ChartDatum[];
  height?: number;
  valueSuffix?: string;
  primaryLabel?: string;
  emptyMessage?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return <AdminChartEmpty message={emptyMessage} />;
  }

  const width = 560;
  const padLeft = 40;
  const padRight = 14;
  const padTop = 16;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const maxVal = Math.max(1, ...data.map((d) => d.value));
  const barSlot = plotW / data.length;
  const barW = Math.min(38, Math.max(10, barSlot * 0.58));

  const activeBar = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none"
        role="img"
        aria-label={primaryLabel}
      >
        {[0, Math.round(maxVal / 2), maxVal].map((tick, i) => {
          const y = padTop + plotH - (tick / maxVal) * plotH;
          return (
            <g key={`${tick}-${i}`}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#222222"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                fill="#707070"
                fontSize="10"
                fontFamily="monospace"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {data.map((d, idx) => {
          const barH = Math.max(2, (d.value / maxVal) * plotH);
          const x = padLeft + idx * barSlot + (barSlot - barW) / 2;
          const y = padTop + plotH - barH;
          const isHovered = hoverIdx === idx;
          return (
            <g
              key={`${d.label}-${idx}`}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-pointer"
            >
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx="3"
                fill={isHovered ? '#ffffff' : '#d4d4d4'}
                opacity={isHovered ? 1 : 0.82}
              />
              <text
                x={x + barW / 2}
                y={height - 8}
                textAnchor="middle"
                fill="#707070"
                fontSize="10"
                fontFamily="monospace"
              >
                {d.label.slice(0, 10)}
              </text>
            </g>
          );
        })}
      </svg>

      {activeBar && (
        <div className="mt-2 flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] text-[11px] font-mono tabular-nums">
          <span className="text-[#A0A0A0]">{activeBar.label}</span>
          <span className="text-white font-semibold">
            {primaryLabel}: {activeBar.value}
            {valueSuffix}
          </span>
        </div>
      )}
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function AdminDonutChart({
  segments,
  centerValue,
  centerLabel,
  emptyMessage = 'Data unavailable',
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
  emptyMessage?: string;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) {
    return <AdminChartEmpty message={emptyMessage} />;
  }

  const size = 148;
  const strokeW = 16;
  const radius = (size - strokeW) / 2;
  const circumference = 2 * Math.PI * radius;

  const positiveSegments = segments.filter((s) => s.value > 0);
  const segmentsWithOffsets = positiveSegments.reduce<
    Array<DonutSegment & { dashLen: number; dashOffset: number }>
  >((acc, seg) => {
    const prevUsed = acc.reduce((sum, item) => sum + item.dashLen, 0);
    const dashLen = (seg.value / total) * circumference;
    acc.push({
      ...seg,
      dashLen,
      dashOffset: -prevUsed,
    });
    return acc;
  }, []);

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#1A1A1A"
            strokeWidth={strokeW}
          />
          {segmentsWithOffsets.map((seg, idx) => (
            <circle
              key={`${seg.label}-${idx}`}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeW}
              strokeDasharray={`${seg.dashLen} ${circumference - seg.dashLen}`}
              strokeDashoffset={seg.dashOffset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <div className="text-xl font-bold text-white tabular-nums">{centerValue}</div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#707070]">
            {centerLabel}
          </div>
        </div>
      </div>

      <div className="flex-1 w-full space-y-2">
        {segments.map((seg, idx) => {
          const pct = Math.round((seg.value / total) * 100);
          return (
            <div
              key={`${seg.label}-${idx}`}
              className="flex items-center justify-between text-xs font-mono tabular-nums"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                <span className="text-[#D4D4D4] truncate">{seg.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-white font-semibold">{seg.value}</span>
                <span className="text-[#707070] w-9 text-right">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
