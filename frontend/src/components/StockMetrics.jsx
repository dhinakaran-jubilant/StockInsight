import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiConfig';

export function StockCard({ name, subtitle, price, change, isPositive, icon, bgColor, tag }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-xs border border-slate-100/90 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-4 min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-11 h-11 flex-shrink-0 flex items-center justify-center ${bgColor} rounded-xl shadow-2xs`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-base text-slate-800 leading-tight truncate" title={name}>{name}</h4>
            <p className="text-xs text-slate-400 font-medium truncate" title={subtitle}>{subtitle}</p>
          </div>
        </div>
        {tag && (
          <span className="flex-shrink-0 flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-[#9462d2] border border-purple-100/60 whitespace-nowrap">
            {tag}
            <span className="material-symbols-outlined" style={{ fontSize: '13px', fontVariationSettings: "'FILL' 1, 'wght' 600" }}>arrow_upward</span>
          </span>
        )}
      </div>
      <div className="flex items-end justify-between mt-2">
        <div>
          <span className="text-2xl font-black text-slate-900 tracking-tight block">{price}</span>
        </div>
        {change && (
          <span
            className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${
              isPositive
                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200/60'
                : 'text-rose-700 bg-rose-50 border border-rose-200/60'
            }`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isPositive ? (
                <path d="M5 10l7-7m0 0l7 7m-7-7v18" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
              ) : (
                <path d="M19 14l-7 7m0 0l-7-7m7 7V3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
              )}
            </svg>
            {change}
          </span>
        )}
      </div>
    </div>
  );
}

export default function StockMetrics() {
  const [metrics, setMetrics] = useState([
    {
      name: 'Crossover Signal',
      subtitle: 'Core & Pro Crossover',
      price: 'Loading...',
      change: 'Recent',
      isPositive: true,
      bgColor: 'bg-purple-100 text-[#9462d2]',
      tag: 'Pro Potential',
      icon: (
        <span className="material-symbols-outlined text-[24px]">waterfall_chart</span>
      )
    },
    {
      name: 'Low Breakout Signal',
      subtitle: 'Recent Low Breakout',
      price: 'Loading...',
      change: 'Recent',
      isPositive: false,
      bgColor: 'bg-rose-100 text-rose-600',
      tag: 'Support Base',
      icon: (
        <span className="material-symbols-outlined text-[24px]">trending_down</span>
      )
    },
    {
      name: 'Global Golden Cross',
      subtitle: 'Recent Golden Crossover',
      price: 'Loading...',
      change: 'Recent',
      isPositive: true,
      bgColor: 'bg-amber-100 text-amber-600',
      tag: 'High Gain',
      icon: (
        <span className="material-symbols-outlined text-[24px]">globe_asia</span>
      )
    },
    {
      name: 'Commodity Golden Cross',
      subtitle: 'Recent Golden Crossover',
      price: 'Loading...',
      change: 'Recent',
      isPositive: true,
      bgColor: 'bg-emerald-100 text-emerald-600',
      tag: 'High Gain',
      icon: (
        <span className="material-symbols-outlined text-[24px]">oil_barrel</span>
      )
    }
  ]);

  useEffect(() => {
    // 1st Card: Fetch Trend Crossover Analysis to find recent Core Crossover with High Prob & Pro Potential
    fetch(`${API_BASE}/trends`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.trends && data.trends.length > 0) {
          // Filter stocks with recent active Core Crossover (isActive == True) and not yet Pro Crossover (high potential for Pro Crossover)
          const candidates = data.trends.filter((item) => {
            const core = item.coreStats;
            const pro = item.proStats;
            return core && core.isActive && pro && !pro.isActive;
          });

          // Sort by highest probability (Core + Pro) & most recent active days
          candidates.sort((a, b) => {
            const scoreA = (a.coreStats.prob || 0) * 2 + (a.proStats.prob || 0) - (a.coreStats.activeDays || 0);
            const scoreB = (b.coreStats.prob || 0) * 2 + (b.proStats.prob || 0) - (b.coreStats.activeDays || 0);
            return scoreB - scoreA;
          });

          const topStock = candidates.length > 0 ? candidates[0] : data.trends[0];

          setMetrics((prev) => {
            const copy = [...prev];
            copy[0] = {
              name: topStock.stockName,
              subtitle: `Golden Cross (${(topStock.dma50_200 || '').replace(/^Yes\s*/i, '')})`,
              price: topStock.price,
              change: `${topStock.coreStats.prob}% Prob`,
              isPositive: true,
              bgColor: 'bg-purple-100 text-[#9462d2]',
              tag: `+${topStock.coreStats.avgGainPct}%`,
              icon: <span className="material-symbols-outlined text-[24px]">waterfall_chart</span>
            };
            return copy;
          });
        }
      })
      .catch((err) => console.error('Error fetching crossover metrics for 1st card:', err));

    // 2nd Card: Fetch Breakout Analysis to find Nifty stock with Low Breakout in recent days (matches Breakout tab table)
    fetch(`${API_BASE}/breakout`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.breakouts && data.breakouts.length > 0) {
          // Filter Nifty stocks with active Low Breakout
          const lowCandidates = data.breakouts.filter((item) => {
            return item.lowBreakout && item.lowBreakout !== '—' && item.lowPct >= 0;
          });

          // Sort by lowest base diff percentage (most recent low breakout threshold, e.g. -0.3%)
          lowCandidates.sort((a, b) => (a.lowPct || 0) - (b.lowPct || 0));

          const topLow = lowCandidates.length > 0 ? lowCandidates[0] : data.breakouts[0];
          const breakoutVal = topLow.lowBreakout ? topLow.lowBreakout.replace(/^Yes\s*/i, '') : `-${topLow.lowPct}%`;

          setMetrics((prev) => {
            const copy = [...prev];
            copy[1] = {
              name: topLow.stockName || topLow.ticker,
              subtitle: `Low Breakout (${breakoutVal})`,
              price: topLow.price,
              change: 'Low Breakout',
              isPositive: false,
              bgColor: 'bg-rose-100 text-rose-600',
              tag: `-${topLow.lowPct}%`,
              icon: <span className="material-symbols-outlined text-[24px]">trending_down</span>
            };
            return copy;
          });
        }
      })
      .catch((err) => console.error('Error fetching low breakout metrics for 2nd card:', err));

    // 3rd Card: Fetch Global stocks to find most recent Golden Crossover asset
    fetch(`${API_BASE}/global`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.global && data.global.length > 0) {
          // Filter for global stocks/indices with an active Golden Crossover (coreStats)
          const candidates = data.global.filter((item) => item.coreStats && item.coreStats.isActive);

          // Sort by most recent active days (lowest activeDays = most recent Golden Crossover)
          candidates.sort((a, b) => {
            const daysA = a.coreStats.activeDays || 999;
            const daysB = b.coreStats.activeDays || 999;
            if (daysA !== daysB) return daysA - daysB;
            return (b.coreStats.avgGainPct || 0) - (a.coreStats.avgGainPct || 0);
          });

          const topGlobal = candidates.length > 0 ? candidates[0] : data.global[0];
          const topStats = topGlobal.coreStats || {};

          const daysStr = topStats.activeDays
            ? (topStats.activeDays === 1 ? '1 day' : `${topStats.activeDays} days`)
            : 'Recent';

          const gainPct = topStats.avgGainPct || (topGlobal.highPct ? parseFloat(topGlobal.highPct) : 0);

          setMetrics((prev) => {
            const copy = [...prev];
            copy[2] = {
              name: topGlobal.stockName || topGlobal.ticker,
              subtitle: `Golden Cross (${daysStr})`,
              price: topGlobal.price,
              change: topStats.prob ? `${topStats.prob}% Prob` : 'Golden Cross',
              isPositive: true,
              bgColor: 'bg-amber-100 text-amber-600',
              tag: `+${gainPct}%`,
              icon: <span className="material-symbols-outlined text-[24px]">globe_asia</span>
            };
            return copy;
          });
        }
      })
      .catch((err) => console.error('Error fetching global crossover metrics for 3rd card:', err));

    // 4th Card: Fetch Commodity assets to find most recent Golden Crossover asset (matches Commodity page table)
    fetch(`${API_BASE}/commodity`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.commodity && data.commodity.length > 0) {
          // Filter for commodity assets with an active Golden Crossover (coreStats)
          const candidates = data.commodity.filter((item) => item.coreStats && item.coreStats.isActive);

          // Sort by most recent active days (lowest activeDays = most recent Golden Crossover)
          candidates.sort((a, b) => {
            const daysA = a.coreStats.activeDays || 999;
            const daysB = b.coreStats.activeDays || 999;
            if (daysA !== daysB) return daysA - daysB;
            return (b.coreStats.avgGainPct || 0) - (a.coreStats.avgGainPct || 0);
          });

          const topComm = candidates.length > 0 ? candidates[0] : data.commodity[0];
          const topStats = topComm.coreStats || {};

          const daysStr = topStats.activeDays
            ? (topStats.activeDays === 1 ? '1 day' : `${topStats.activeDays} days`)
            : 'Recent';

          const gainPct = topStats.avgGainPct || (topComm.highPct ? parseFloat(topComm.highPct) : 0);

          setMetrics((prev) => {
            const copy = [...prev];
            copy[3] = {
              name: topComm.stockName || topComm.name || topComm.ticker || topComm.symbol,
              subtitle: `Golden Cross (${daysStr})`,
              price: topComm.price,
              change: topStats.prob ? `${topStats.prob}% Prob` : 'Golden Cross',
              isPositive: true,
              bgColor: 'bg-emerald-100 text-emerald-600',
              tag: `+${gainPct}%`,
              icon: <span className="material-symbols-outlined text-[24px]">oil_barrel</span>
            };
            return copy;
          });
        }
      })
      .catch((err) => console.error('Error fetching commodity crossover metrics for 4th card:', err));
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8" data-purpose="stock-cards-grid">
      {metrics.map((stock, index) => (
        <StockCard key={index} {...stock} />
      ))}
    </div>
  );
}
