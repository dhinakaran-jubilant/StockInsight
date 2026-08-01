import React, { useState, useEffect } from 'react';

const getShortSectorName = (name) => {
  if (!name) return '';
  const clean = name.replace(/^Nifty\s+/i, '').trim();
  const upper = clean.toUpperCase();
  if (upper.includes('INFORMATION TECHNOLOGY')) return 'IT / TECH';
  if (upper.includes('FINANCIAL SERVICES')) return 'FINANCIAL SERV.';
  if (upper.includes('OIL') && upper.includes('GAS')) return 'OIL & GAS';
  if (upper.includes('CONSUMER GOODS') || upper.includes('FMCG')) return 'FMCG';
  if (upper.includes('CAPITAL GOODS')) return 'CAPITAL GOODS';
  if (upper.includes('METALS')) return 'METALS & MINING';
  if (upper.includes('AUTOMOBILE') || upper.includes('AUTO')) return 'AUTO';
  if (upper.includes('PHARMA') || upper.includes('HEALTHCARE')) return 'PHARMA';
  return clean;
};

export default function DividendChart() {
  const [sectorData, setSectorData] = useState([]);
  const [periodName, setPeriodName] = useState('Monthly');
  const [hoveredIdx, setHoveredIdx] = useState(null);

  useEffect(() => {
    const API_BASE = 'http://127.0.0.1:2500/api';
    fetch(`${API_BASE}/sectoral?period_type=monthly`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.sectoral && data.periods && data.periods.length > 0) {
          const latestPeriod = data.periods[0];
          setPeriodName(latestPeriod);

          const items = data.sectoral.map((item) => {
            const amtObj = item.amounts && item.amounts[latestPeriod];
            const raw = amtObj ? amtObj.raw : 0;
            const valStr = amtObj ? amtObj.val : '—';
            return {
              name: item.sector.replace('Nifty ', ''),
              raw: raw || 0,
              valStr: valStr
            };
          });

          // Sort by absolute flow amount and take top 5
          const top5 = items.sort((a, b) => Math.abs(b.raw) - Math.abs(a.raw)).slice(0, 5);
          setSectorData(top5);
        }
      })
      .catch((err) => console.error('Error fetching sectoral metrics for dashboard:', err));
  }, []);

  const maxVal = Math.max(...sectorData.map((d) => Math.abs(d.raw)), 1000);

  return (
    <div
      className="bg-white p-6 sm:p-8 rounded-xl shadow-xs border border-slate-100 flex-1 relative"
      data-purpose="sectoral-performance-widget"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-slate-800">Sectoral Inflow / Outflow</h3>
          <p className="text-xs text-slate-400 font-medium">Top 5 sector flows ({periodName})</p>
        </div>
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-purple-50 text-[#9462d2] border border-purple-100/60">
          Monthly
        </span>
      </div>

      {/* Floating Hover Info Card Tooltip */}
      {hoveredIdx !== null && sectorData[hoveredIdx] && (() => {
        const item = sectorData[hoveredIdx];
        const isBuy = item.raw >= 0;
        const leftPct = ((hoveredIdx + 0.5) / sectorData.length) * 100;
        const isRightHalf = hoveredIdx >= sectorData.length / 2;

        return (
          <div
            className="absolute top-16 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl p-3.5 shadow-xl z-30 min-w-[210px] pointer-events-none transition-all duration-150 ease-out"
            style={{
              left: isRightHalf ? 'auto' : `${leftPct}%`,
              right: isRightHalf ? `${100 - leftPct}%` : 'auto',
              transform: isRightHalf ? 'translateX(-25px)' : 'translateX(25px)'
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5 mb-2">
              <span className="font-bold text-slate-800 text-xs truncate max-w-[130px]">
                {item.name}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isBuy ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}
              >
                {isBuy ? 'Net Inflow' : 'Net Outflow'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs font-semibold">
              <span className="text-slate-500 font-medium">Flow Amount:</span>
              <span className={`font-extrabold ${isBuy ? 'text-emerald-600' : 'text-rose-600'}`}>
                {item.valStr}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[10px] font-medium text-slate-400 mt-1">
              <span>Period:</span>
              <span className="font-bold text-slate-600">{periodName}</span>
            </div>
          </div>
        );
      })()}

      <div className="relative h-60 w-full flex items-end justify-between px-2 pt-4">
        {/* Bars */}
        <div className="w-full flex-1 flex items-end justify-around h-full gap-2 sm:gap-4">
          {sectorData.map((item, idx) => {
            const pct = Math.min(78, Math.max(12, (Math.abs(item.raw) / maxVal) * 78));
            const isBuy = item.raw >= 0;
            const isHovered = hoveredIdx === idx;

            return (
              <div
                key={item.name}
                className="w-full flex flex-col items-center gap-1.5 h-full justify-end group cursor-pointer min-w-0"
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Tooltip / Label */}
                <span
                  className={`w-full text-[10px] font-bold transition-all truncate text-center px-0.5 ${
                    isHovered ? 'text-[#9462d2] font-black scale-105' : 'text-slate-600 opacity-90'
                  }`}
                  title={item.valStr}
                >
                  {item.valStr}
                </span>

                {/* Bar */}
                <div
                  className={`w-7 sm:w-9 rounded-t-lg transition-all duration-300 shadow-2xs ${
                    isBuy ? 'bg-emerald-500' : 'bg-rose-500'
                  } ${isHovered ? 'brightness-110' : 'group-hover:brightness-95'}`}
                  style={{ height: `${pct}%` }}
                ></div>

                {/* X Label */}
                <span
                  className={`w-full text-[10px] uppercase truncate text-center px-0.5 transition-all ${
                    isHovered ? 'text-[#9462d2] font-black scale-105' : 'text-slate-700 font-extrabold'
                  }`}
                  title={item.name}
                >
                  {getShortSectorName(item.name)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
