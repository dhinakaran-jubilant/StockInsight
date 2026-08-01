import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../apiConfig';

export default function PortfolioChart() {
  const [timeframe, setTimeframe] = useState('Monthly');
  const [cashflowData, setCashflowData] = useState([]);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [loading, setLoading] = useState(true);

  const timeframes = ['Daily', 'Monthly', 'Yearly'];

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/cashflow?period_type=${timeframe.toLowerCase()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.cashflow) {
          // Take recent 10-12 data points in chronological order (left to right)
          const slice = [...data.cashflow].reverse().slice(-12);
          setCashflowData(slice);
        }
      })
      .catch((err) => console.error('Error fetching portfolio chart cashflow:', err))
      .finally(() => setLoading(false));
  }, [timeframe]);

  const svgWidth = 800;
  const svgHeight = 280;
  const paddingLeft = 65;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 45;
  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  const minMax = useMemo(() => {
    if (!cashflowData || cashflowData.length === 0) return { min: -50000, max: 50000 };
    const allVals = cashflowData.flatMap((d) => [d.fiiNetRaw || 0, d.diiNetRaw || 0]);
    let min = Math.min(...allVals, 0);
    let max = Math.max(...allVals, 0);
    const pad = (max - min) * 0.15 || 1000;
    return { min: min - pad, max: max + pad };
  }, [cashflowData]);

  const getX = (i) => {
    if (cashflowData.length <= 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (i / (cashflowData.length - 1)) * chartWidth;
  };

  const getY = (val) => {
    const { min, max } = minMax;
    const pct = (val - min) / (max - min || 1);
    return paddingTop + chartHeight - pct * chartHeight;
  };

  const zeroY = getY(0);

  const getSmoothCurvePath = (points) => {
    if (!points || points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    if (points.length === 2) return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;

    let path = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? i : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      path += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
    return path;
  };

  const fiiPoints = cashflowData.map((d, i) => ({ x: getX(i), y: getY(d.fiiNetRaw || 0) }));
  const diiPoints = cashflowData.map((d, i) => ({ x: getX(i), y: getY(d.diiNetRaw || 0) }));

  const fiiPath = getSmoothCurvePath(fiiPoints);
  const diiPath = getSmoothCurvePath(diiPoints);

  const formatCr = (val) => {
    if (val === null || val === undefined) return '—';
    if (Math.abs(val) >= 100000) return `₹${(val / 100000).toFixed(2)} L Cr`;
    return `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
  };

  return (
    <div
      className="col-span-12 lg:col-span-8 bg-white p-6 sm:p-8 rounded-xl shadow-xs border border-slate-100 relative"
      data-purpose="performance-chart-container"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xl font-bold text-slate-800 mb-1">Institutional Cash Flow Trend</h3>
          <p className="text-xs text-slate-400 font-medium">Real-time FII vs DII net market flow activity</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {/* Legend */}
          <div className="flex items-center gap-3 text-xs font-bold">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#9462d2]"></span>
              <span className="text-slate-600">FII Net Flow</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span>
              <span className="text-slate-600">DII Net Flow</span>
            </div>
          </div>
          {/* Timeframe Toggles */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => {
                  setTimeframe(tf);
                  setHoveredIdx(null);
                }}
                className={`px-3.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  timeframe === tf
                    ? 'bg-white shadow-xs text-[#9462d2]'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Floating Hover Tooltip */}
      {hoveredIdx !== null && cashflowData[hoveredIdx] && (() => {
        const item = cashflowData[hoveredIdx];
        const x = getX(hoveredIdx);
        const isRightHalf = x > svgWidth / 2;
        const leftPct = (x / svgWidth) * 100;
        return (
          <div
            className="absolute top-16 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl p-3 shadow-xl z-30 min-w-[200px] pointer-events-none transition-all duration-75 ease-out"
            style={{
              left: isRightHalf ? 'auto' : `${leftPct}%`,
              right: isRightHalf ? `${100 - leftPct}%` : 'auto',
              transform: isRightHalf ? 'translateX(-30px)' : 'translateX(30px)'
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5 mb-2">
              <span className="font-bold text-slate-800 text-xs">{item.period}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-[#9462d2]">
                {timeframe}
              </span>
            </div>
            <div className="space-y-1.5 text-xs font-semibold">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#9462d2]"></span>
                  FII Net
                </span>
                <span className={`font-bold ${item.fiiNetRaw >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {item.fiiNet}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span>
                  DII Net
                </span>
                <span className={`font-bold ${item.diiNetRaw >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {item.diiNet}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="relative w-full overflow-hidden">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible">
          {/* Zero Line */}
          <line
            x1={paddingLeft}
            y1={zeroY}
            x2={svgWidth - paddingRight}
            y2={zeroY}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            strokeWidth="1.5"
          />

          {/* FII Curve */}
          {fiiPoints.length > 0 && (
            <path
              d={fiiPath}
              fill="none"
              stroke="#9462d2"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="transition-all duration-500 ease-in-out"
            />
          )}

          {/* DII Curve */}
          {diiPoints.length > 0 && (
            <path
              d={diiPath}
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="transition-all duration-500 ease-in-out"
            />
          )}

          {/* Hover Guide Line */}
          {hoveredIdx !== null && (
            <line
              x1={getX(hoveredIdx)}
              y1={paddingTop}
              x2={getX(hoveredIdx)}
              y2={paddingTop + chartHeight}
              stroke="#64748b"
              strokeDasharray="3 3"
              strokeWidth="1.5"
            />
          )}

          {/* X Axis Labels */}
          {cashflowData.map((d, i) => {
            const x = getX(i);
            const isHovered = hoveredIdx === i;
            return (
              <text
                key={d.period + i}
                x={x}
                y={svgHeight - 12}
                textAnchor="middle"
                className={`text-[9px] transition-all duration-300 ${
                  isHovered ? 'fill-[#9462d2] font-black text-[11px]' : 'fill-slate-500 font-bold'
                }`}
              >
                {d.period}
              </text>
            );
          })}

          {/* Hover Hitboxes */}
          {cashflowData.map((_, i) => {
            const x = getX(i);
            const w = chartWidth / Math.max(cashflowData.length, 1);
            return (
              <rect
                key={'hit' + i}
                x={x - w / 2}
                y={paddingTop}
                width={w}
                height={chartHeight}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
