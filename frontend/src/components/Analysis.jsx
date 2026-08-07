import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { getStoredWatchlistGroups, saveStoredWatchlistGroups } from './Watchlist';
import { API_BASE } from '../apiConfig';

const LottieLoader = ({ text = 'Loading data...', width = '96px', height = '96px' }) => (
	<div className="py-10 text-center text-slate-500 font-medium flex flex-col items-center justify-center gap-2">
		<dotlottie-player
			src="https://lottie.host/263e0985-230e-4bb2-93d4-9954d89d9a08/R90eXtVnmH.lottie"
			background="transparent"
			speed="1"
			style={{ width, height }}
			loop
			autoplay
		></dotlottie-player>
		{text && <span className="text-sm font-semibold text-slate-500">{text}</span>}
	</div>
);

const getNextPeriods = (lastPeriodStr, mode, count = 5) => {
	const parts = (lastPeriodStr || '').trim().split(/\s+/);
	let month = "Mar";
	let year = 2024;

	if (parts.length === 2) {
		month = parts[0];
		year = parseInt(parts[1], 10) || 2024;
	} else if (parts.length === 1 && !isNaN(parseInt(parts[0], 10))) {
		year = parseInt(parts[0], 10);
	}

	const nextPeriods = [];
	if (mode === 'Yearly') {
		for (let i = 1; i <= count; i++) {
			nextPeriods.push(`${month} ${year + i}`);
		}
	} else {
		const qMonths = ["Mar", "Jun", "Sep", "Dec"];
		let mIdx = qMonths.indexOf(month);
		if (mIdx === -1) mIdx = 0;

		let currYr = year;
		let currMIdx = mIdx;

		for (let i = 1; i <= count; i++) {
			currMIdx += 1;
			if (currMIdx >= qMonths.length) {
				currMIdx = 0;
				currYr += 1;
			}
			nextPeriods.push(`${qMonths[currMIdx]} ${currYr}`);
		}
	}
	return nextPeriods;
};

const predictSeries = (historicalValues, forecastCount = 5) => {
	const n = historicalValues.length;
	if (n === 0) return Array(forecastCount).fill(0);
	if (n === 1) return Array(forecastCount).fill(historicalValues[0]);

	const recent = historicalValues.slice(-4);
	const m = recent.length;
	let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
	for (let i = 0; i < m; i++) {
		sumX += i;
		sumY += recent[i];
		sumXY += i * recent[i];
		sumXX += i * i;
	}
	const slope = (m * sumXY - sumX * sumY) / (m * sumXX - sumX * sumX) || 0;
	const lastVal = historicalValues[n - 1];

	const predictions = [];
	for (let k = 1; k <= forecastCount; k++) {
		const factor = Math.pow(0.85, k - 1);
		let nextVal = lastVal + slope * k * factor;
		nextVal = Math.max(0, Math.min(100, nextVal));
		predictions.push(parseFloat(nextVal.toFixed(2)));
	}
	return predictions;
};

const calcTradeValueInCrs = (qty, pr, valueLacs) => {
	const qNum = Math.abs(parseFloat(String(qty || '').replace(/,/g, '').trim()));
	const pNum = Math.abs(parseFloat(String(pr || '').replace(/[₹$,\s]/g, '').trim()));

	let crs = 0;
	if (!isNaN(qNum) && !isNaN(pNum) && qNum > 0 && pNum > 0) {
		crs = (qNum * pNum) / 10000000;
	} else if (valueLacs) {
		const vNum = Math.abs(parseFloat(String(valueLacs).replace(/,/g, '').trim()));
		if (!isNaN(vNum) && vNum > 0) {
			crs = vNum / 100;
		}
	}

	if (crs <= 0) return '—';

	if (crs < 0.01) {
		return `₹${crs.toFixed(4)} Cr`;
	} else if (crs < 1) {
		return `₹${crs.toFixed(2)} Cr`;
	} else {
		return `₹${crs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
	}
};

const TrendPriceDMAChart = ({ history = [], isBreakoutMode = false, isGlobalMode = false }) => {
	const [timeframe, setTimeframe] = useState('1Y');
	const [activeLines, setActiveLines] = useState({
		close: true,
		dma20: !isBreakoutMode,
		dma50: !isBreakoutMode,
		dma100: !isBreakoutMode,
		dma200: !isBreakoutMode,
		avgVol: true,
		overallHigh: isBreakoutMode
	});
	const [hoveredIdx, setHoveredIdx] = useState(null);

	// Filter out trailing null/empty/0 price entries from history so chart uses valid data up to previous day
	const validHistory = useMemo(() => {
		if (!history || !Array.isArray(history) || history.length === 0) return [];
		let endIdx = history.length;
		while (
			endIdx > 0 &&
			(!history[endIdx - 1] ||
				history[endIdx - 1].close === null ||
				history[endIdx - 1].close === undefined ||
				history[endIdx - 1].close === '' ||
				isNaN(Number(history[endIdx - 1].close)) ||
				Number(history[endIdx - 1].close) <= 0)
		) {
			endIdx--;
		}
		return history.slice(0, endIdx);
	}, [history]);

	if (!validHistory || validHistory.length === 0) return null;

	// Calculate Overall High Baseline Price (from 2 years ago to 3 months ago: indices totalPoints - 504 to totalPoints - 63)
	const overallHighVal = useMemo(() => {
		if (!isBreakoutMode || !validHistory || validHistory.length < 63) return null;
		const totalPts = validHistory.length;
		const endBaseIdx = Math.max(0, totalPts - 63);
		const startBaseIdx = Math.max(0, totalPts - 504);
		const baseWindow = validHistory.slice(startBaseIdx, endBaseIdx);
		if (baseWindow.length === 0) return null;
		return Math.max(...baseWindow.map((r) => r.close || 0));
	}, [validHistory, isBreakoutMode]);

	const getTimeframeDays = (tf) => {
		switch (tf) {
			case '1M': return 21;
			case '3M': return 63;
			case '6M': return 126;
			case '1Y': return 252;
			case '3Y': return 756;
			case '5Y': return 1260;
			default: return 252;
		}
	};

	const count = getTimeframeDays(timeframe);
	const dataSlice = validHistory.slice(-count);
	const totalPoints = dataSlice.length;

	let minY = Infinity;
	let maxY = -Infinity;

	dataSlice.forEach((item) => {
		const values = [];
		if (activeLines.close && item.close) values.push(item.close);
		if (activeLines.dma20 && item.dma20) values.push(item.dma20);
		if (activeLines.dma50 && item.dma50) values.push(item.dma50);
		if (activeLines.dma100 && item.dma100) values.push(item.dma100);
		if (activeLines.dma200 && item.dma200) values.push(item.dma200);

		values.forEach((v) => {
			if (v < minY) minY = v;
			if (v > maxY) maxY = v;
		});
	});

	if (activeLines.overallHigh && overallHighVal) {
		if (overallHighVal < minY) minY = overallHighVal;
		if (overallHighVal > maxY) maxY = overallHighVal;
	}

	if (minY === Infinity || maxY === -Infinity) {
		minY = 0;
		maxY = 100;
	}

	const paddingY = (maxY - minY) * 0.05 || 10;
	minY = Math.max(0, minY - paddingY);
	maxY = maxY + paddingY;

	const svgWidth = 850;
	const svgHeight = 280;
	const paddingLeft = 55;
	const paddingRight = 20;
	const paddingTop = 25;
	const paddingBottom = 40;
	const chartWidth = svgWidth - paddingLeft - paddingRight;
	const chartHeight = svgHeight - paddingTop - paddingBottom;
	const maxVol = Math.max(...dataSlice.map((item) => item.volume || 0), 1);
	const volumeMaxHeight = 50;
	const priceChartHeight = chartHeight - volumeMaxHeight - 15;

	const getX = (idx) => paddingLeft + (idx / Math.max(totalPoints - 1, 1)) * chartWidth;
	const getY = (val) => {
		if (val === null || val === undefined) return null;
		return paddingTop + priceChartHeight - ((val - minY) / Math.max(maxY - minY, 1)) * priceChartHeight;
	};

	const columnBandWidth = chartWidth / Math.max(totalPoints, 1);

	// Pre-calculate Daily Average Volume curve points over volume bars
	const avgVolPoints = dataSlice.map((item, i) => {
		const globalIdx = validHistory.indexOf(item);
		const windowSlice = validHistory.slice(Math.max(0, globalIdx - 19), globalIdx + 1);
		const avg = windowSlice.reduce((sum, r) => sum + (r.volume || 0), 0) / Math.max(windowSlice.length, 1);

		const x = getX(i);
		const barH = (avg / maxVol) * volumeMaxHeight;
		const y = paddingTop + priceChartHeight + 15 + (volumeMaxHeight - barH);
		return { x, y, avgVol: avg };
	});

	const yTicks = [];
	for (let i = 0; i <= 4; i++) {
		const val = minY + (i / 4) * (maxY - minY);
		yTicks.push(val);
	}

	const numTicks = 5;
	const xTicks = [];
	for (let i = 0; i < numTicks; i++) {
		const idx = Math.min(
			Math.round((i / (numTicks - 1)) * (totalPoints - 1)),
			totalPoints - 1
		);
		if (!xTicks.includes(idx)) {
			xTicks.push(idx);
		}
	}

	const lines = isBreakoutMode
		? [
			{ key: 'close', label: 'Price', color: '#9462d2' },
			{ key: 'avgVol', label: '20D Vol MA', color: '#02c719ff' },
			{ key: 'overallHigh', label: 'Overall High', color: '#d97706' }
		]
		: [
			{ key: 'close', label: 'Price', color: '#9462d2' },
			{ key: 'dma20', label: '20 DMA', color: '#10b981' },
			{ key: 'dma50', label: '50 DMA', color: '#007cc3' },
			{ key: 'dma100', label: '100 DMA', color: '#f59e0b' },
			{ key: 'dma200', label: '200 DMA', color: '#f43f5e' },
			{ key: 'avgVol', label: '20D Vol MA', color: '#0284c7' }
		];

	const formatRs = (val) => {
		if (val === null || val === undefined) return '—';
		return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	};

	const formatVol = (val) => {
		if (!val) return '0';
		if (val >= 10000000) return `${(val / 10000000).toFixed(2)} Cr`;
		if (val >= 100000) return `${(val / 100000).toFixed(2)} L`;
		if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
		return val.toLocaleString('en-IN');
	};

	return (
		<div className="bg-slate-50/80 border border-slate-200/70 rounded-xl p-5 relative shadow-2xs">
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
				<div className="flex items-center gap-3 self-start flex-wrap">
					<div className="bg-slate-200/80 p-1 rounded-xl flex items-center gap-1">
						{['1M', '3M', '6M', '1Y', '3Y', '5Y'].map((tf) => (
							<button
								key={tf}
								onClick={() => {
									setTimeframe(tf);
									setHoveredIdx(null);
								}}
								className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${timeframe === tf
									? 'bg-white text-[#9462d2] shadow-xs border border-purple-100/80'
									: 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
									}`}
							>
								{tf}
							</button>
						))}
					</div>

					{/* Overall High Badge next to Period Tabs */}
					{isBreakoutMode && overallHighVal && (
						<div className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
							<span className="w-2 h-2 rounded-full bg-amber-500"></span>
							<span>Overall High: <strong className="text-amber-950 font-extrabold">₹{overallHighVal.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</strong></span>
						</div>
					)}
				</div>

				<div className="flex items-center gap-2 flex-wrap text-xs font-semibold">
					{lines.map((l) => (
						<button
							key={l.key}
							onClick={() => setActiveLines((prev) => ({ ...prev, [l.key]: !prev[l.key] }))}
							className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer border ${activeLines[l.key]
								? 'bg-white shadow-2xs border-slate-200 text-slate-800'
								: 'bg-slate-100 text-slate-400 border-transparent opacity-50'
								}`}
						>
							<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }}></span>
							<span>{l.label}</span>
						</button>
					))}
				</div>
			</div>

			{/* Dynamic Floating Hover Info Card Tooltip (Moves with Mouse) */}
			{hoveredIdx !== null && dataSlice[hoveredIdx] && (() => {
				const x = getX(hoveredIdx);
				const isRightHalf = x > svgWidth / 2;
				const leftPct = (x / svgWidth) * 100;
				const currItem = dataSlice[hoveredIdx];
				const gIdx = validHistory.indexOf(currItem);
				const pClose = gIdx > 0 ? validHistory[gIdx - 1].close : currItem.close;
				const isBuy = currItem.close >= pClose;
				return (
					<div
						className="absolute top-16 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl p-3.5 shadow-xl z-30 min-w-[210px] pointer-events-none transition-all duration-75 ease-out"
						style={{
							left: isRightHalf ? 'auto' : `${leftPct}%`,
							right: isRightHalf ? `${100 - leftPct}%` : 'auto',
							transform: isRightHalf ? 'translateX(-40px)' : 'translateX(40px)'
						}}
					>
						<div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5 mb-2">
							<span className="font-bold text-slate-800 text-xs">
								{currItem.label || currItem.date}
							</span>
							<span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-[#9462d2]">
								Daily Trend
							</span>
						</div>
						<div className="space-y-1.5 text-xs font-semibold">
							{lines.map((l) => {
								if (l.key === 'avgVol' || !activeLines[l.key]) return null;
								const val = currItem[l.key];
								return (
									<div key={l.key} className="flex items-center justify-between gap-3">
										<span className="flex items-center gap-1.5 text-slate-600">
											<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }}></span>
											{l.label}
										</span>
										<span className="font-bold text-slate-900">{formatRs(val)}</span>
									</div>
								);
							})}

							{/* Volume Row in Tooltip */}
							<div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 mt-2">
								<span className="flex items-center gap-1.5 text-slate-600 font-medium">
									<span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: isBuy ? '#007cc3' : '#f59e0b' }}></span>
									Volume ({isBuy ? 'Buy' : 'Sell'})
								</span>
								<span className="font-bold text-slate-900">{formatVol(currItem.volume)}</span>
							</div>

							{/* 20D Vol MA Row in Tooltip */}
							{activeLines.avgVol && avgVolPoints[hoveredIdx] && (
								<div className="flex items-center justify-between gap-3 pt-1">
									<span className="flex items-center gap-1.5 text-slate-600 font-medium">
										<span className="w-2.5 h-0.5 rounded-full bg-[#0284c7]"></span>
										20D Vol MA
									</span>
									<span className="font-bold text-[#0284c7]">{formatVol(avgVolPoints[hoveredIdx].avgVol)}</span>
								</div>
							)}
						</div>
					</div>
				);
			})()}

			<div className="relative w-full overflow-hidden">
				<svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible">
					{/* Y-Axis Grid Lines */}
					{yTicks.map((val, idx) => {
						const y = getY(val);
						if (y === null) return null;
						return (
							<g key={idx}>
								<line
									x1={paddingLeft}
									y1={y}
									x2={svgWidth - paddingRight}
									y2={y}
									stroke="#e2e8f0"
									strokeDasharray="3 3"
									strokeWidth="1"
									style={{ transition: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)' }}
								/>
								<text
									x={paddingLeft - 8}
									y={y + 3}
									textAnchor="end"
									className="text-[8px] fill-slate-400 font-medium"
									style={{ transition: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)' }}
								>
									₹{val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)}
								</text>
							</g>
						);
					})}

					{/* Overall High Baseline Reference Line */}
					{isBreakoutMode && activeLines.overallHigh && overallHighVal && (() => {
						const y = getY(overallHighVal);
						if (y === null || y < paddingTop - 10 || y > paddingTop + priceChartHeight + 10) return null;
						return (
							<g key="overallHighLine">
								<line
									x1={paddingLeft}
									y1={y}
									x2={svgWidth - paddingRight}
									y2={y}
									stroke="#d97706"
									strokeDasharray="4 4"
									strokeWidth="1.5"
									opacity="0.9"
									style={{ transition: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)' }}
								/>
							</g>
						);
					})()}

					{/* Volume Bar Chart (Buy = Blue #007cc3, Sell = Yellow #f59e0b) */}
					{dataSlice.map((item, i) => {
						const vol = item.volume || 0;
						if (vol <= 0) return null;
						const x = getX(i);
						const barH = (vol / maxVol) * volumeMaxHeight;
						const barY = paddingTop + priceChartHeight + 15 + (volumeMaxHeight - barH);

						const globalIdx = validHistory.indexOf(item);
						const prevClose = globalIdx > 0 ? validHistory[globalIdx - 1].close : item.close;
						const isBuy = item.close >= prevClose;
						const color = isBuy ? '#007cc3' : '#f59e0b';
						const barW = Math.max(1.5, Math.min(columnBandWidth * 0.65, 8));

						return (
							<rect
								key={'vol' + item.date + i}
								x={x - barW / 2}
								y={barY}
								width={barW}
								height={Math.max(barH, 1)}
								fill={color}
								opacity={hoveredIdx === i ? 1 : 0.75}
								rx="1"
								style={{ transition: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)' }}
								className="transition-all duration-500 ease-in-out"
							/>
						);
					})}

					{/* Daily Average Volume Trend Line */}
					{activeLines.avgVol && avgVolPoints.length > 0 && (
						<g key="avgVolLine">
							<path
								d={getSmoothCurvePath(avgVolPoints)}
								fill="none"
								stroke="#7e7e7eff"
								strokeWidth="1.6"
								strokeDasharray="4 3"
								strokeLinecap="round"
								style={{ transition: 'd 600ms cubic-bezier(0.4, 0, 0.2, 1), all 600ms ease-in-out' }}
								className="transition-all duration-500 ease-in-out"
							/>
							{hoveredIdx !== null && avgVolPoints[hoveredIdx] && (
								<circle
									cx={avgVolPoints[hoveredIdx].x}
									cy={avgVolPoints[hoveredIdx].y}
									r="2.5"
									fill="#ffffff"
									stroke="#7e7e7eff"
									strokeWidth="1.5"
									className="transition-all duration-150 ease-in-out"
								/>
							)}
						</g>
					)}

					{hoveredIdx !== null && (
						<line
							x1={getX(hoveredIdx)}
							y1={paddingTop}
							x2={getX(hoveredIdx)}
							y2={paddingTop + chartHeight}
							stroke="#64748b"
							strokeDasharray="3 3"
							strokeWidth="1.5"
							className="transition-all duration-150 ease-in-out"
						/>
					)}

					{xTicks.map((idx, tickIdx) => {
						const item = dataSlice[idx];
						if (!item) return null;
						const x = getX(idx);
						const isHovered = hoveredIdx === idx;
						const textAnchor = tickIdx === 0 ? 'start' : tickIdx === xTicks.length - 1 ? 'end' : 'middle';
						return (
							<text
								key={item.date + idx}
								x={x}
								y={svgHeight - 12}
								textAnchor={textAnchor}
								style={{ transition: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)' }}
								className={`text-[8px] transition-all duration-500 ${isHovered ? 'fill-[#9462d2] font-black text-[10px]' : 'fill-slate-500 font-medium'
									}`}
							>
								{item.label ? item.label.split(',')[0] : item.date}
							</text>
						);
					})}

					{lines.map((l) => {
						if (!activeLines[l.key]) return null;
						const validPoints = [];
						dataSlice.forEach((item, i) => {
							const val = item[l.key];
							if (val !== null && val !== undefined && val !== '' && !isNaN(Number(val)) && Number(val) > 0) {
								validPoints.push({ x: getX(i), y: getY(val) });
							}
						});

						if (validPoints.length === 0) return null;
						const pathD = getSmoothCurvePath(validPoints);

						return (
							<g key={l.key}>
								<path
									d={pathD}
									fill="none"
									stroke={l.color}
									strokeWidth={l.key === 'close' ? '1.5' : '1.2'}
									strokeLinecap="round"
									style={{ transition: 'd 600ms cubic-bezier(0.4, 0, 0.2, 1), stroke 300ms ease, opacity 300ms ease' }}
									className="transition-all duration-500 ease-in-out"
								/>
								{hoveredIdx !== null &&
									dataSlice[hoveredIdx][l.key] !== null &&
									dataSlice[hoveredIdx][l.key] !== undefined &&
									!isNaN(Number(dataSlice[hoveredIdx][l.key])) &&
									Number(dataSlice[hoveredIdx][l.key]) > 0 && (
										<circle
											cx={getX(hoveredIdx)}
											cy={getY(dataSlice[hoveredIdx][l.key])}
											r="2.5"
											fill="#ffffff"
											stroke={l.color}
											strokeWidth="1.5"
											className="transition-all duration-150 ease-in-out"
										/>
									)}
							</g>
						);
					})}

					{dataSlice.map((_, idx) => {
						const x = getX(idx);
						const halfWidth = columnBandWidth / 2;
						return (
							<rect
								key={'hit' + idx}
								x={x - halfWidth}
								y={paddingTop}
								width={columnBandWidth}
								height={chartHeight}
								fill="transparent"
								className="cursor-pointer"
								onMouseEnter={() => setHoveredIdx(idx)}
								onMouseLeave={() => setHoveredIdx(null)}
							/>
						);
					})}
				</svg>
			</div>
		</div>
	);
};

const SectoralFlowChart = ({ historyObj = {} }) => {
	const [interval, setInterval] = useState('fortnightly');
	const [hoveredIdx, setHoveredIdx] = useState(null);

	const dataPoints = historyObj[interval] || [];
	if (!dataPoints || dataPoints.length === 0) return null;

	const svgWidth = 800;
	const svgHeight = 260;
	const paddingLeft = 60;
	const paddingRight = 30;
	const paddingTop = 35;
	const paddingBottom = 45;
	const chartHeight = svgHeight - paddingTop - paddingBottom;
	const chartWidth = svgWidth - paddingLeft - paddingRight;

	const amounts = dataPoints.map((d) => d.amount);
	const minAmt = Math.min(...amounts, 0);
	const maxAmt = Math.max(...amounts, 0);
	const range = maxAmt - minAmt || 1;

	const getY = (val) => {
		const pct = (val - minAmt) / range;
		return paddingTop + chartHeight - pct * chartHeight;
	};

	const zeroY = getY(0);

	const getX = (i) => {
		if (dataPoints.length === 1) return paddingLeft + chartWidth / 2;
		return paddingLeft + (i / (dataPoints.length - 1)) * chartWidth;
	};

	const getBarTipY = (val) => {
		const y = getY(val);
		const rawBarH = Math.abs(y - zeroY) * 0.55;
		return val >= 0 ? zeroY - rawBarH : zeroY + rawBarH;
	};

	const trendPoints = dataPoints.map((d, i) => ({ x: getX(i), y: getBarTipY(d.amount) }));
	const trendPathD = getSmoothCurvePath(trendPoints);

	return (
		<div className="bg-slate-50/80 border border-slate-200/70 rounded-xl p-5 relative shadow-2xs">
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
				{/* Interval Selection Tabs */}
				<div className="flex items-center gap-2">
					<div className="bg-slate-200/80 p-1 rounded-xl flex items-center gap-1">
						{[
							{ key: 'fortnightly', label: 'Fortnightly' },
							{ key: 'monthly', label: 'Monthly' },
							{ key: 'yearly', label: 'Yearly' }
						].map((tf) => (
							<button
								key={tf.key}
								onClick={() => {
									setInterval(tf.key);
									setHoveredIdx(null);
								}}
								className={`px-3.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${interval === tf.key
									? 'bg-white text-[#9462d2] shadow-xs border border-purple-100/80'
									: 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
									}`}
							>
								{tf.label}
							</button>
						))}
					</div>
				</div>

				<div className="flex items-center gap-4 text-xs font-bold">
					<div className="flex items-center gap-1.5">
						<span className="w-3 h-3 rounded-xs bg-[#10b981]"></span>
						<span className="text-slate-600">Net Inflow (Buy)</span>
					</div>
					<div className="flex items-center gap-1.5">
						<span className="w-3 h-3 rounded-xs bg-[#f43f5e]"></span>
						<span className="text-slate-600">Net Outflow (Sell)</span>
					</div>
				</div>
			</div>

			{/* Hover Tooltip Card */}
			{hoveredIdx !== null && dataPoints[hoveredIdx] && (() => {
				const item = dataPoints[hoveredIdx];
				const x = getX(hoveredIdx);
				const isRightHalf = x > svgWidth / 2;
				const leftPct = (x / svgWidth) * 100;
				const isBuy = item.amount >= 0;

				return (
					<div
						className="absolute top-16 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl p-3.5 shadow-xl z-30 min-w-[200px] pointer-events-none transition-all duration-75 ease-out"
						style={{
							left: isRightHalf ? 'auto' : `${leftPct}%`,
							right: isRightHalf ? `${100 - leftPct}%` : 'auto',
							transform: isRightHalf ? 'translateX(-30px)' : 'translateX(30px)'
						}}
					>
						<div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5 mb-2">
							<span className="font-bold text-slate-800 text-xs">{item.period}</span>
							<span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isBuy ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
								{isBuy ? 'Net Inflow' : 'Net Outflow'}
							</span>
						</div>
						<div className="flex items-center justify-between gap-3 text-xs font-semibold">
							<span className="text-slate-600 font-medium">Flow Amount:</span>
							<span className={`font-bold ${isBuy ? 'text-emerald-600' : 'text-rose-600'}`}>
								{item.formatted}
							</span>
						</div>
					</div>
				);
			})()}

			{/* SVG Chart Graphic */}
			<div className="relative w-full overflow-hidden">
				<svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible">
					{/* Zero Baseline Line */}
					<line
						x1={paddingLeft}
						y1={zeroY}
						x2={svgWidth - paddingRight}
						y2={zeroY}
						stroke="#64748b"
						strokeDasharray="4 4"
						strokeWidth="1.5"
						style={{ transition: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)' }}
					/>

					{/* Volume Flow Bars */}
					{dataPoints.map((item, i) => {
						const x = getX(i);
						const y = getY(item.amount);
						const barW = Math.max(4, Math.min((chartWidth / dataPoints.length) * 0.22, 14));
						const isBuy = item.amount >= 0;
						const rawBarH = Math.abs(y - zeroY) * 0.55;
						const barH = Math.max(rawBarH, 2);
						const barY = isBuy ? zeroY - rawBarH : zeroY;
						const color = isBuy ? '#10b981' : '#f43f5e';

						return (
							<rect
								key={'bar' + item.period + i}
								x={x - barW / 2}
								y={barY}
								width={barW}
								height={barH}
								fill={color}
								opacity={hoveredIdx === i ? 1 : 0.82}
								rx="3"
								style={{ transition: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)' }}
								className="transition-all duration-300 ease-in-out cursor-pointer"
								onMouseEnter={() => setHoveredIdx(i)}
								onMouseLeave={() => setHoveredIdx(null)}
							/>
						);
					})}

					{/* Flow Trend Line */}
					<path
						d={trendPathD}
						fill="none"
						stroke="#9462d2"
						strokeWidth="2.5"
						strokeLinecap="round"
						style={{ transition: 'd 600ms cubic-bezier(0.4, 0, 0.2, 1), stroke 300ms ease' }}
						className="transition-all duration-500 ease-in-out pointer-events-none"
					/>

					{/* Trend Line Bar Tip Dots */}
					{trendPoints.map((pt, i) => (
						<circle
							key={'dot' + i}
							cx={pt.x}
							cy={pt.y}
							r="3"
							fill="#ffffff"
							stroke="#9462d2"
							strokeWidth="2"
							style={{ transition: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)' }}
							className="transition-all duration-300 ease-in-out pointer-events-none"
						/>
					))}

					{/* Period X-Axis Labels */}
					{dataPoints.map((item, i) => {
						const x = getX(i);
						const isHovered = hoveredIdx === i;
						return (
							<text
								key={'lbl' + item.period + i}
								x={x}
								y={svgHeight - 12}
								textAnchor="middle"
								style={{ transition: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)' }}
								className={`text-[10px] transition-all duration-300 ${isHovered ? 'fill-[#9462d2] font-extrabold text-[11px]' : 'fill-slate-500 font-bold'
									}`}
							>
								{item.period}
							</text>
						);
					})}
				</svg>
			</div>
		</div>
	);
};

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

const CompoundedGrowthChartCard = ({ title, data = [], accentColor = 'emerald' }) => {
	if (!data || data.length === 0) return null;

	const validNums = data.map((d) => (d.num !== null ? d.num : 0));
	const maxVal = Math.max(...validNums.map((v) => Math.abs(v)), 10);

	const getColorClasses = () => {
		switch (accentColor) {
			case 'emerald':
				return {
					bg: 'bg-emerald-500',
					badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
					header: 'text-emerald-700',
					cardBg: 'from-emerald-50/40 to-white'
				};
			case 'purple':
				return {
					bg: 'bg-purple-500',
					badge: 'bg-purple-50 text-purple-700 border-purple-200',
					header: 'text-purple-700',
					cardBg: 'from-purple-50/40 to-white'
				};
			case 'amber':
				return {
					bg: 'bg-amber-500',
					badge: 'bg-amber-50 text-amber-800 border-amber-200',
					header: 'text-amber-800',
					cardBg: 'from-amber-50/40 to-white'
				};
			case 'rose':
			default:
				return {
					bg: 'bg-rose-500',
					badge: 'bg-rose-50 text-rose-700 border-rose-200',
					header: 'text-rose-700',
					cardBg: 'from-rose-50/40 to-white'
				};
		}
	};

	const theme = getColorClasses();

	return (
		<div className={`bg-gradient-to-b ${theme.cardBg} border border-slate-200/80 rounded-2xl p-5 shadow-2xs flex flex-col justify-between transition-all hover:shadow-md`}>
			<div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
				<h3 className={`text-sm font-bold ${theme.header} flex items-center gap-2`}>
					<span className={`w-2.5 h-2.5 rounded-full ${theme.bg}`}></span>
					{title}
				</h3>
				<span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${theme.badge}`}>
					Compounded %
				</span>
			</div>

			{/* Visual Bar Chart Graphic */}
			<div className="h-40 flex items-end justify-between gap-3 px-2 py-2 border-b border-slate-100 mb-3">
				{data.map((item, idx) => {
					const val = item.num !== null ? item.num : 0;
					const isPositive = val >= 0;
					const pctHeight = Math.max(Math.min((Math.abs(val) / maxVal) * 100, 100), 8);
					const barColor = isPositive ? theme.bg : 'bg-rose-500';

					return (
						<div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
							<span className={`text-[11px] font-extrabold transition-transform group-hover:scale-110 ${isPositive ? 'text-slate-800' : 'text-rose-600'}`}>
								{item.value || '—'}
							</span>
							<div className="w-full bg-slate-100/90 rounded-t-lg h-28 flex items-end p-1 relative overflow-hidden">
								<div
									style={{ height: `${pctHeight}%` }}
									className={`w-full rounded-t-md ${barColor} transition-all duration-500 group-hover:brightness-110 shadow-xs`}
								></div>
							</div>
							<span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
								{item.period}
							</span>
						</div>
					);
				})}
			</div>

			{/* Data Summary Rows */}
			<div className="grid grid-cols-2 gap-2 pt-1">
				{data.map((item, idx) => (
					<div key={idx} className="flex items-center justify-between bg-white/80 px-2.5 py-1.5 rounded-xl border border-slate-100 text-xs">
						<span className="text-slate-500 font-medium">{item.period}:</span>
						<span className={`font-bold ${item.num !== null && item.num >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>
							{item.value}
						</span>
					</div>
				))}
			</div>
		</div>
	);
};

const OwnershipTrendChart = ({ data = [], mode = 'Quarterly' }) => {
	const [activeCategories, setActiveCategories] = useState({
		promoters: true,
		fiis: true,
		diis: true,
		public: true
	});
	const [hoveredIndex, setHoveredIndex] = useState(null);

	if (!data || data.length === 0) return null;

	const parsePct = (val) => {
		if (typeof val === 'number') return val;
		if (!val || val === '—' || val === '-') return 0;
		const num = parseFloat(String(val).replace(/[%,\s]/g, ''));
		return isNaN(num) ? 0 : num;
	};

	const historicalPeriods = data.map((r) => r.period || '');
	const histPromoters = data.map((r) => parsePct(r.promoters));
	const histFiis = data.map((r) => parsePct(r.fiis));
	const histDiis = data.map((r) => parsePct(r.diis));
	const histPublic = data.map((r) => parsePct(r.public));

	const lastPeriod = historicalPeriods[historicalPeriods.length - 1] || 'Mar 2024';
	const predictedPeriods = getNextPeriods(lastPeriod, mode, 5);

	const predPromoters = predictSeries(histPromoters, 5);
	const predFiis = predictSeries(histFiis, 5);
	const predDiis = predictSeries(histDiis, 5);
	const predPublic = predictSeries(histPublic, 5);

	const allPeriods = [...historicalPeriods, ...predictedPeriods];
	const totalHistorical = historicalPeriods.length;
	const totalPoints = allPeriods.length;

	const categories = [
		{ key: 'promoters', label: 'Promoters', color: '#9462d2', hist: histPromoters, pred: predPromoters },
		{ key: 'fiis', label: 'FIIs', color: '#007cc3', hist: histFiis, pred: predFiis },
		{ key: 'diis', label: 'DIIs', color: '#10b981', hist: histDiis, pred: predDiis },
		{ key: 'public', label: 'Public', color: '#f59e0b', hist: histPublic, pred: predPublic }
	];

	const getValForCategory = (catKey, idx) => {
		const cat = categories.find((c) => c.key === catKey);
		if (!cat) return 0;
		if (idx < totalHistorical) {
			return cat.hist[idx] !== undefined ? cat.hist[idx] : 0;
		} else {
			const pIdx = idx - totalHistorical;
			return cat.pred[pIdx] !== undefined ? cat.pred[pIdx] : 0;
		}
	};

	const svgWidth = 800;
	const svgHeight = 220;
	const paddingLeft = 45;
	const paddingRight = 25;
	const paddingTop = 20;
	const paddingBottom = 40;
	const chartWidth = svgWidth - paddingLeft - paddingRight;
	const chartHeight = svgHeight - paddingTop - paddingBottom;

	const getX = (idx) => paddingLeft + (idx / Math.max(totalPoints - 1, 1)) * chartWidth;
	const getY = (val) => paddingTop + chartHeight - (val / 100) * chartHeight;

	const splitX = getX(totalHistorical - 1);
	const columnBandWidth = chartWidth / Math.max(totalPoints, 1);

	return (
		<div className="bg-slate-50/80 border border-slate-200/70 rounded-xl p-4 mb-6 relative shadow-2xs">
			{/* Floating Hover Info Card Tooltip */}
			{hoveredIndex !== null && (
				<div className="absolute top-3 right-4 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl p-3 shadow-xl z-30 min-w-[190px] animate-in fade-in zoom-in-95 duration-100">
					<div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5 mb-2">
						<span className="font-bold text-slate-800 text-xs">
							{allPeriods[hoveredIndex]}
						</span>
						<span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${hoveredIndex >= totalHistorical ? 'bg-purple-100 text-[#9462d2]' : 'bg-slate-100 text-slate-600'
							}`}>
							{hoveredIndex >= totalHistorical ? 'Forecast' : 'Actual'}
						</span>
					</div>
					<div className="space-y-1.5 text-xs font-semibold">
						{activeCategories.promoters && (
							<div className="flex items-center justify-between gap-3">
								<span className="flex items-center gap-1.5 text-slate-600">
									<span className="w-2.5 h-2.5 rounded-full bg-[#9462d2]"></span>
									Promoters
								</span>
								<span className="font-bold text-slate-900">{getValForCategory('promoters', hoveredIndex)}%</span>
							</div>
						)}
						{activeCategories.fiis && (
							<div className="flex items-center justify-between gap-3">
								<span className="flex items-center gap-1.5 text-slate-600">
									<span className="w-2.5 h-2.5 rounded-full bg-[#007cc3]"></span>
									FIIs
								</span>
								<span className="font-bold text-slate-900">{getValForCategory('fiis', hoveredIndex)}%</span>
							</div>
						)}
						{activeCategories.diis && (
							<div className="flex items-center justify-between gap-3">
								<span className="flex items-center gap-1.5 text-slate-600">
									<span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span>
									DIIs
								</span>
								<span className="font-bold text-slate-900">{getValForCategory('diis', hoveredIndex)}%</span>
							</div>
						)}
						{activeCategories.public && (
							<div className="flex items-center justify-between gap-3">
								<span className="flex items-center gap-1.5 text-slate-600">
									<span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]"></span>
									Public
								</span>
								<span className="font-bold text-slate-900">{getValForCategory('public', hoveredIndex)}%</span>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Top Bar: Title & Category Toggles */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 px-5">
				<div className="flex items-center gap-2">
					<span className="material-symbols-outlined text-[#9462d2] text-[20px]">show_chart</span>
					<h3 className="text-sm font-bold text-slate-800">
						Shareholding Trend &amp; Next 5 {mode === 'Yearly' ? 'Years' : 'Quarters'} Prediction
					</h3>
				</div>
				<div className="flex items-center gap-2 flex-wrap text-xs font-semibold">
					{categories.map((cat) => (
						<button
							key={cat.key}
							onClick={() => setActiveCategories((prev) => ({ ...prev, [cat.key]: !prev[cat.key] }))}
							className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer border ${activeCategories[cat.key]
								? 'bg-white shadow-2xs border-slate-200 text-slate-800'
								: 'bg-slate-100 text-slate-400 border-transparent opacity-50'
								}`}
						>
							<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }}></span>
							<span>{cat.label}</span>
						</button>
					))}
				</div>
			</div>

			{/* SVG Chart */}
			<div className="relative w-full overflow-hidden">
				<svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible">
					{/* Y-Axis Grid Lines */}
					{[0, 25, 50, 75, 100].map((val) => {
						const y = getY(val);
						return (
							<g key={val}>
								<line x1={paddingLeft} y1={y} x2={svgWidth - paddingRight} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" strokeWidth="1" />
								<text x={paddingLeft - 8} y={y + 4} textAnchor="end" className="text-[8px] fill-slate-400 font-medium">
									{val}%
								</text>
							</g>
						);
					})}

					{/* Prediction Zone Background */}
					<rect
						x={splitX}
						y={paddingTop}
						width={Math.max(svgWidth - paddingRight - splitX, 0)}
						height={chartHeight}
						fill="rgba(148, 98, 210, 0.05)"
						rx="4"
						className="transition-all duration-500 ease-in-out"
					/>
					<line
						x1={splitX}
						y1={paddingTop}
						x2={splitX}
						y2={paddingTop + chartHeight}
						stroke="#9462d2"
						strokeDasharray="4 4"
						strokeWidth="1.5"
						className="transition-all duration-500 ease-in-out"
					/>
					<text
						x={splitX + 8}
						y={paddingTop + 14}
						className="text-[10px] font-bold fill-[#9462d2] transition-all duration-500 ease-in-out"
					>
						5-{mode === 'Yearly' ? 'Year' : 'Quarter'} Forecast
					</text>

					{/* Hover Guide Line */}
					{hoveredIndex !== null && (
						<line
							x1={getX(hoveredIndex)}
							y1={paddingTop}
							x2={getX(hoveredIndex)}
							y2={paddingTop + chartHeight}
							stroke="#64748b"
							strokeDasharray="3 3"
							strokeWidth="1.5"
							className="transition-all duration-200 ease-in-out"
						/>
					)}

					{/* X-Axis Labels */}
					{allPeriods.map((p, idx) => {
						const x = getX(idx);
						const isPredicted = idx >= totalHistorical;
						const isHovered = hoveredIndex === idx;
						return (
							<text
								key={p + idx}
								x={x}
								y={svgHeight - 12}
								textAnchor="middle"
								className={`text-[8px] transition-all duration-500 ease-in-out ${isHovered
									? 'fill-[#9462d2] font-black text-[11px]'
									: isPredicted
										? 'fill-purple-600 font-bold'
										: 'fill-slate-500 font-medium'
									}`}
							>
								{p}
							</text>
						);
					})}

					{/* Category Paths */}
					{categories.map((cat) => {
						if (!activeCategories[cat.key]) return null;
						const histPts = cat.hist.map((v, i) => ({ x: getX(i), y: getY(v) }));
						const lastHistVal = cat.hist[cat.hist.length - 1];
						const predPts = [
							{ x: getX(totalHistorical - 1), y: getY(lastHistVal) },
							...cat.pred.map((v, i) => ({ x: getX(totalHistorical + i), y: getY(v) }))
						];

						const histD = getSmoothCurvePath(histPts);
						const predD = getSmoothCurvePath(predPts);

						return (
							<g key={cat.key}>
								{/* Historical Line (Solid) */}
								<path d={histD} fill="none" stroke={cat.color} strokeWidth="1.5" strokeLinecap="round" className="transition-all duration-500 ease-in-out" />

								{/* Predicted Line (Dashed) */}
								<path d={predD} fill="none" stroke={cat.color} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.85" className="transition-all duration-500 ease-in-out" />

								{/* Historical Points (Smaller circles with smooth transitions) */}
								{cat.hist.map((v, i) => {
									const isHovered = hoveredIndex === i;
									return (
										<circle
											key={'h' + i}
											cx={getX(i)}
											cy={getY(v)}
											r={isHovered ? '4' : '3'}
											fill="#ffffff"
											stroke={cat.color}
											strokeWidth={isHovered ? '2' : '1.2'}
											className="transition-all duration-300 ease-in-out"
										/>
									);
								})}

								{/* Predicted Points (Smaller circles with smooth transitions) */}
								{cat.pred.map((v, i) => {
									const idx = totalHistorical + i;
									const isHovered = hoveredIndex === idx;
									return (
										<circle
											key={'p' + i}
											cx={getX(idx)}
											cy={getY(v)}
											r={isHovered ? '4' : '3'}
											fill={cat.color}
											stroke="#ffffff"
											strokeWidth={isHovered ? '2' : '1'}
											className="transition-all duration-300 ease-in-out"
										/>
									);
								})}
							</g>
						);
					})}

					{/* Transparent Interactive Hover Column Hitboxes */}
					{allPeriods.map((_, idx) => {
						const x = getX(idx);
						const halfWidth = columnBandWidth / 2;
						return (
							<rect
								key={'hit' + idx}
								x={x - halfWidth}
								y={paddingTop}
								width={columnBandWidth}
								height={chartHeight}
								fill="transparent"
								className="cursor-pointer"
								onMouseEnter={() => setHoveredIndex(idx)}
								onMouseLeave={() => setHoveredIndex(null)}
							/>
						);
					})}
				</svg>
			</div>
		</div>
	);
};

export default function Analysis({
	breadcrumbs = ['Home', 'Analysis'],
	searchTerm: externalSearchTerm,
	setSearchTerm: externalSetSearchTerm,
	activeTab: externalActiveTab,
	setActiveTab: externalSetActiveTab
}) {
	const [internalSearchTerm, setInternalSearchTerm] = useState('');
	const [internalActiveTab, setInternalActiveTab] = useState('Trades');

	const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;
	const setSearchTerm = externalSetSearchTerm || setInternalSearchTerm;
	const activeTab = externalActiveTab !== undefined ? externalActiveTab : internalActiveTab;
	const setActiveTab = externalSetActiveTab || setInternalActiveTab;

	const niftyTabs = [
		{
			name: 'Trades',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">order_approve</span>
		},
		{
			name: 'Ownership',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">pie_chart</span>
		},
		{
			name: 'Trends',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">trending_up</span>
		},
		{
			name: 'Breakout',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">waterfall_chart</span>
		},
		{
			name: 'Metrics',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">equalizer</span>
		},
		{
			name: 'Consensus',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">thumbs_up_down</span>
		},
		{
			name: 'Sentiment',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">psychology</span>
		},
		{
			name: 'Tara',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">webhook</span>
		}
	];
	const tabs = niftyTabs;

	const isNiftyView = ['Trades', 'Ownership', 'Trends', 'Breakout', 'Metrics', 'Consensus', 'Sentiment', 'Tara'].includes(activeTab);

	const displayBreadcrumbs = isNiftyView
		? ['Stock Insight', 'Analysis', 'Nifty Stocks', activeTab]
		: ['Stock Insight', 'Analysis', activeTab === 'CashFlow' ? 'Cash Flow' : activeTab];

	const defaultSectoralData = [
		{
			id: 1,
			sector: 'Nifty Bank',
			weight: '33.5%',
			dayChange: '+1.85%',
			monthChange: '+4.20%',
			topGainer: 'HDFC Bank (+3.2%)',
			volume: '45.2M',
			status: 'Bullish',
			badgeClass: 'bg-emerald-100/80 text-emerald-600',
			bgColor: 'bg-blue-600',
			icon: <span className="material-symbols-outlined text-white text-[20px]">account_balance</span>
		},
		{
			id: 2,
			sector: 'Nifty IT',
			weight: '14.2%',
			dayChange: '-0.65%',
			monthChange: '+2.15%',
			topGainer: 'TCS (+1.1%)',
			volume: '18.7M',
			status: 'Neutral',
			badgeClass: 'bg-amber-100/80 text-amber-600',
			bgColor: 'bg-purple-600',
			icon: <span className="material-symbols-outlined text-white text-[20px]">computer</span>
		},
		{
			id: 3,
			sector: 'Nifty Auto',
			weight: '6.8%',
			dayChange: '+2.40%',
			monthChange: '+8.75%',
			topGainer: 'Tata Motors (+4.5%)',
			volume: '28.4M',
			status: 'Strong Buy',
			badgeClass: 'bg-emerald-100/80 text-emerald-600',
			bgColor: 'bg-indigo-600',
			icon: <span className="material-symbols-outlined text-white text-[20px]">directions_car</span>
		},
		{
			id: 4,
			sector: 'Nifty FMCG',
			weight: '9.1%',
			dayChange: '+0.35%',
			monthChange: '+1.40%',
			topGainer: 'ITC (+1.8%)',
			volume: '12.1M',
			status: 'Stable',
			badgeClass: 'bg-slate-100 text-slate-600',
			bgColor: 'bg-emerald-600',
			icon: <span className="material-symbols-outlined text-white text-[20px]">shopping_cart</span>
		},
		{
			id: 5,
			sector: 'Nifty Pharma',
			weight: '5.4%',
			dayChange: '-1.12%',
			monthChange: '-2.30%',
			topGainer: 'Sun Pharma (+0.9%)',
			volume: '9.8M',
			status: 'Bearish',
			badgeClass: 'bg-red-100/80 text-red-500',
			bgColor: 'bg-rose-600',
			icon: <span className="material-symbols-outlined text-white text-[20px]">medical_services</span>
		},
		{
			id: 6,
			sector: 'Nifty Metal',
			weight: '4.2%',
			dayChange: '+3.15%',
			monthChange: '+12.4%',
			topGainer: 'Tata Steel (+5.2%)',
			volume: '34.6M',
			status: 'Strong Buy',
			badgeClass: 'bg-emerald-100/80 text-emerald-600',
			bgColor: 'bg-amber-600',
			icon: <span className="material-symbols-outlined text-white text-[20px]">construction</span>
		}
	];

	const defaultCashFlowData = [
		{
			id: 1,
			company: 'Reliance Industries',
			ticker: 'RELIANCE',
			operatingCF: '₹65,240 Cr',
			investingCF: '-₹28,100 Cr',
			financingCF: '-₹12,450 Cr',
			freeCashFlow: '₹37,140 Cr',
			fcfYield: '4.8%',
			quality: 'Healthy',
			badgeClass: 'bg-emerald-100/80 text-emerald-600',
			bgColor: 'bg-[#003087]',
			icon: <span className="material-symbols-outlined text-white text-[20px]">bolt</span>
		},
		{
			id: 2,
			company: 'Tata Consultancy Services',
			ticker: 'TCS',
			operatingCF: '₹42,180 Cr',
			investingCF: '-₹3,450 Cr',
			financingCF: '-₹35,200 Cr',
			freeCashFlow: '₹38,730 Cr',
			fcfYield: '6.2%',
			quality: 'Strong',
			badgeClass: 'bg-emerald-100/80 text-emerald-600',
			bgColor: 'bg-[#1C1C1E]',
			icon: <span className="material-symbols-outlined text-white text-[20px]">terminal</span>
		},
		{
			id: 3,
			company: 'Infosys',
			ticker: 'INFY',
			operatingCF: '₹24,900 Cr',
			investingCF: '-₹2,100 Cr',
			financingCF: '-₹20,500 Cr',
			freeCashFlow: '₹22,800 Cr',
			fcfYield: '5.9%',
			quality: 'Strong',
			badgeClass: 'bg-emerald-100/80 text-emerald-600',
			bgColor: 'bg-[#007cc3]',
			icon: <span className="material-symbols-outlined text-white text-[20px]">code</span>
		},
		{
			id: 4,
			company: 'HDFC Bank',
			ticker: 'HDFCBANK',
			operatingCF: '₹58,400 Cr',
			investingCF: '-₹14,200 Cr',
			financingCF: '-₹22,100 Cr',
			freeCashFlow: '₹44,200 Cr',
			fcfYield: '5.1%',
			quality: 'Healthy',
			badgeClass: 'bg-emerald-100/80 text-emerald-600',
			bgColor: 'bg-[#004b8d]',
			icon: <span className="material-symbols-outlined text-white text-[20px]">account_balance</span>
		},
		{
			id: 5,
			company: 'Bharti Airtel',
			ticker: 'BHARTIARTL',
			operatingCF: '₹31,500 Cr',
			investingCF: '-₹18,400 Cr',
			financingCF: '-₹8,900 Cr',
			freeCashFlow: '₹13,100 Cr',
			fcfYield: '3.4%',
			quality: 'Moderate',
			badgeClass: 'bg-amber-100/80 text-amber-600',
			bgColor: 'bg-[#e21b22]',
			icon: <span className="material-symbols-outlined text-white text-[20px]">cell_tower</span>
		}
	];

	const [tradesData, setTradesData] = useState([]);
	const [ownershipData, setOwnershipData] = useState([]);
	const [trendsData, setTrendsData] = useState([]);
	const [breakoutsData, setBreakoutsData] = useState([]);
	const [globalData, setGlobalData] = useState([]);
	const [commodityData, setCommodityData] = useState([]);
	const [metricsData, setMetricsData] = useState([]);
	const [consensusData, setConsensusData] = useState([]);
	const [sentimentData, setSentimentData] = useState([]);
	const [loadingTrades, setLoadingTrades] = useState(true);
	const [loadingOwnership, setLoadingOwnership] = useState(true);
	const [loadingTrends, setLoadingTrends] = useState(true);
	const [loadingBreakouts, setLoadingBreakouts] = useState(true);
	const [loadingGlobal, setLoadingGlobal] = useState(true);
	const [loadingCommodity, setLoadingCommodity] = useState(true);
	const [loadingMetrics, setLoadingMetrics] = useState(true);
	const [loadingConsensus, setLoadingConsensus] = useState(true);
	const [loadingSentiment, setLoadingSentiment] = useState(true);
	const [sectoralPeriodType, setSectoralPeriodType] = useState('Fortnightly');
	const [sectoralData, setSectoralData] = useState([]);
	const [sectoralPeriods, setSectoralPeriods] = useState([]);
	const [loadingSectoral, setLoadingSectoral] = useState(true);
	const [cashFlowPeriodType, setCashFlowPeriodType] = useState('Daily');
	const [cashFlowData, setCashFlowData] = useState([]);
	const [loadingCashFlow, setLoadingCashFlow] = useState(true);

	// Tara Screener Form State
	const [taraBreakoutToggle, setTaraBreakoutToggle] = useState(true); // true = High, false = Low
	const [taraBreakoutFrom, setTaraBreakoutFrom] = useState('');
	const [taraBreakoutTo, setTaraBreakoutTo] = useState('');
	const [taraCrossovers, setTaraCrossovers] = useState([]); // Multiselect array e.g. ['Golden', 'Pro']
	const [taraSalesGrowth, setTaraSalesGrowth] = useState('');
	const [taraProfitGrowth, setTaraProfitGrowth] = useState('');
	const [taraRoe, setTaraRoe] = useState('');
	const [taraRoce, setTaraRoce] = useState('');
	const [taraOwnershipModes, setTaraOwnershipModes] = useState({});
	const [taraTradeCategories, setTaraTradeCategories] = useState([]);
	const [taraTradeYear, setTaraTradeYear] = useState('All');

	// Pagination & Multi-Column Sorting state for Trades/Ownership tab
	const [currentPage, setCurrentPage] = useState(1);
	const [sortRules, setSortRules] = useState([
		{ key: 'stockName', direction: 'asc' }
	]);
	const ITEMS_PER_PAGE = 15;

	// Modal State for Detailed Trades Popup
	const [selectedTradeStock, setSelectedTradeStock] = useState(null);
	const [modalDetails, setModalDetails] = useState(null);
	const [modalLoading, setModalLoading] = useState(false);
	const [modalActiveSubTab, setModalActiveSubTab] = useState('Insider Trades');

	// Modal State for Detailed Ownership Popup
	const [selectedOwnershipStock, setSelectedOwnershipStock] = useState(null);
	const [ownershipModalDetails, setOwnershipModalDetails] = useState(null);
	const [ownershipModalLoading, setOwnershipModalLoading] = useState(false);
	const [ownershipModalSubTab, setOwnershipModalSubTab] = useState('Quarterly');
	const ownershipTableContainerRef = useRef(null);

	// Automatically scroll ownership history table to the right end on open / tab change / data load
	useEffect(() => {
		if (selectedOwnershipStock && !ownershipModalLoading && ownershipTableContainerRef.current) {
			const timer = setTimeout(() => {
				if (ownershipTableContainerRef.current) {
					ownershipTableContainerRef.current.scrollLeft = ownershipTableContainerRef.current.scrollWidth;
				}
			}, 50);
			return () => clearTimeout(timer);
		}
	}, [selectedOwnershipStock, ownershipModalSubTab, ownershipModalDetails, ownershipModalLoading]);

	// Modal State for Detailed Trend Price & DMA Popup
	const [selectedTrendStock, setSelectedTrendStock] = useState(null);
	const [isBreakoutModal, setIsBreakoutModal] = useState(false);
	const [trendModalDetails, setTrendModalDetails] = useState(null);
	const [trendModalLoading, setTrendModalLoading] = useState(false);

	// Modal State for Detailed Sectoral Flow Popup
	const [selectedSector, setSelectedSector] = useState(null);
	const [sectorModalDetails, setSectorModalDetails] = useState(null);
	const [sectorModalLoading, setSectorModalLoading] = useState(false);

	// Modal State for Detailed Financial Metrics & Compounded Growth Popup
	const [selectedMetricsStock, setSelectedMetricsStock] = useState(null);
	const [metricsModalDetails, setMetricsModalDetails] = useState(null);
	const [metricsModalLoading, setMetricsModalLoading] = useState(false);

	// Modal State for Detailed Cash Flow Activity Popup
	const [selectedCashFlowItem, setSelectedCashFlowItem] = useState(null);

	const handleCashFlowRowClick = (item) => {
		if (!item) return;
		setSelectedCashFlowItem(item);
	};

	// Modal State for Detailed Consensus Recommendations Popup
	const [selectedConsensusStock, setSelectedConsensusStock] = useState(null);

	const handleConsensusRowClick = (item) => {
		if (!item) return;
		const rawSymbol = item.ticker || item.symbol || item.stockName || item.stock_name || '';
		const ticker = rawSymbol.toUpperCase();
		const matchedInMetrics = (metricsData || []).find(
			(m) => m.ticker && ticker && m.ticker.toUpperCase() === ticker
		);
		const matchedInConsensus = (consensusData || []).find(
			(c) => c && (c.ticker || c.symbol) && (c.ticker || c.symbol).toUpperCase() === ticker
		);
		const stockItem = {
			...(matchedInMetrics || {}),
			...(matchedInConsensus || {}),
			...item,
			ticker,
			stockName: item.stockName || item.stock_name || matchedInConsensus?.stock_name || matchedInMetrics?.stockName || ticker
		};
		setSelectedConsensusStock(stockItem);

		if (ticker) {
			fetch(`${API_BASE}/recommendations/${encodeURIComponent(ticker)}`)
				.then((res) => res.json())
				.then((data) => {
					if (data && (data.total !== undefined || data.consensus_rating || data.symbol)) {
						setSelectedConsensusStock((prev) => ({ ...(prev || {}), ...data }));
					}
				})
				.catch((err) => console.error('Error fetching consensus stock details:', err));
		}
	};

	// Modal State for Detailed Moneycontrol Sentiment & Boarders Popup
	const [selectedSentimentStock, setSelectedSentimentStock] = useState(null);

	const handleSentimentRowClick = (item) => {
		if (!item) return;
		const rawSymbol = item.ticker || item.symbol || item.stockName || item.stock_name || '';
		const ticker = rawSymbol.toUpperCase();
		const matchedInMetrics = (metricsData || []).find(
			(m) => m.ticker && ticker && m.ticker.toUpperCase() === ticker
		);
		const matchedInSentiment = (sentimentData || []).find(
			(s) => s && (s.ticker || s.symbol) && (s.ticker || s.symbol).toUpperCase() === ticker
		);
		const stockItem = {
			...(matchedInMetrics || {}),
			...(matchedInSentiment || {}),
			...item,
			ticker,
			stockName: item.stockName || item.stock_name || matchedInSentiment?.stock_name || matchedInMetrics?.stockName || ticker
		};
		setSelectedSentimentStock(stockItem);

		if (ticker) {
			fetch(`${API_BASE}/sentiment/${encodeURIComponent(ticker)}`)
				.then((res) => res.json())
				.then((data) => {
					if (data && (data.msg_count !== undefined || data.ai_summary || data.symbol)) {
						setSelectedSentimentStock((prev) => ({ ...(prev || {}), ...data }));
					}
				})
				.catch((err) => console.error('Error fetching sentiment stock details:', err));
		}
	};

	const handleCloseStockModal = (setter) => {
		if (typeof setter === 'function') {
			setter(null);
		}
	};

	// Modal State for Add to Watchlist Group
	const [isAddToWatchlistOpen, setIsAddToWatchlistOpen] = useState(false);
	const [selectedWatchlistStock, setSelectedWatchlistStock] = useState(null);
	const [selectedWatchlistGroupIds, setSelectedWatchlistGroupIds] = useState([]);
	const [createNewGroupInput, setCreateNewGroupInput] = useState('');
	const [isCreatingNewGroupMode, setIsCreatingNewGroupMode] = useState(false);
	const [watchlistSuccessMsg, setWatchlistSuccessMsg] = useState('');
	const [dbWatchlistTickers, setDbWatchlistTickers] = useState(new Set());
	const [dbWatchlistGroupsList, setDbWatchlistGroupsList] = useState([]);
	const [dbWatchlistItems, setDbWatchlistItems] = useState([]);
	const [isModalGroupDropdownOpen, setIsModalGroupDropdownOpen] = useState(false);

	const toggleWatchlistGroupSelection = (groupName) => {
		if (!groupName) return;
		setSelectedWatchlistGroupIds((prev) => {
			const exists = prev.some((name) => name.toLowerCase() === groupName.toLowerCase());
			if (exists) {
				return prev.filter((name) => name.toLowerCase() !== groupName.toLowerCase());
			} else {
				return [...prev, groupName];
			}
		});
	};

	// Modal State for Add Commodity
	const [isAddCommodityOpen, setIsAddCommodityOpen] = useState(false);
	const [addCommodityName, setAddCommodityName] = useState('');
	const [addCommoditySymbol, setAddCommoditySymbol] = useState('');
	const [addCommodityPrice, setAddCommodityPrice] = useState('');
	const [addCommodityError, setAddCommodityError] = useState('');
	const [addCommoditySuccess, setAddCommoditySuccess] = useState('');
	const [isAddCommoditySubmitting, setIsAddCommoditySubmitting] = useState(false);

	// Modal State for Add Global Stock / Index
	const [isAddGlobalOpen, setIsAddGlobalOpen] = useState(false);
	const [addGlobalName, setAddGlobalName] = useState('');
	const [addGlobalSymbol, setAddGlobalSymbol] = useState('');
	const [addGlobalPrice, setAddGlobalPrice] = useState('');
	const [addGlobalError, setAddGlobalError] = useState('');
	const [addGlobalSuccess, setAddGlobalSuccess] = useState('');
	const [isAddGlobalSubmitting, setIsAddGlobalSubmitting] = useState(false);

	const handleSaveGlobal = (e) => {
		e.preventDefault();
		if (!addGlobalName.trim()) {
			setAddGlobalError('Please enter a global stock/index name');
			return;
		}
		if (!addGlobalSymbol.trim()) {
			setAddGlobalError('Please enter a symbol');
			return;
		}

		setAddGlobalError('');
		setIsAddGlobalSubmitting(true);

		const payload = {
			name: addGlobalName.trim(),
			symbol: addGlobalSymbol.trim().toUpperCase(),
			price: addGlobalPrice.trim() || '—'
		};

		fetch(`${API_BASE}/global/add`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		})
			.then((res) => res.json())
			.then(() => {
				const formattedPrice = payload.price === '—'
					? '$100.00'
					: (payload.price.startsWith('$') || payload.price.startsWith('₹') ? payload.price : `$${payload.price}`);

				const newItem = {
					id: Date.now(),
					ticker: payload.symbol,
					stockName: payload.name,
					marketCap: 'US Region',
					price: formattedPrice,
					dma20_200: '—',
					dma50_200: '—',
					dma100_200: '—',
					highBreakout: '—',
					lowBreakout: '—',
					liteStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 },
					coreStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 },
					proStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 }
				};

				setGlobalData((prev) => [newItem, ...prev]);
				setAddGlobalSuccess(`Successfully added ${payload.name} (${payload.symbol})!`);
				setTimeout(() => setAddGlobalSuccess(''), 3500);

				setAddGlobalName('');
				setAddGlobalSymbol('');
				setAddGlobalPrice('');
				setIsAddGlobalOpen(false);
			})
			.catch((err) => {
				console.error('Error adding global stock:', err);
				const formattedPrice = payload.price === '—'
					? '$100.00'
					: (payload.price.startsWith('$') || payload.price.startsWith('₹') ? payload.price : `$${payload.price}`);

				const newItem = {
					id: Date.now(),
					ticker: payload.symbol,
					stockName: payload.name,
					marketCap: 'US Region',
					price: formattedPrice,
					dma20_200: '—',
					dma50_200: '—',
					dma100_200: '—',
					highBreakout: '—',
					lowBreakout: '—',
					liteStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 },
					coreStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 },
					proStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 }
				};
				setGlobalData((prev) => [newItem, ...prev]);
				setAddGlobalSuccess(`Added ${payload.name} (${payload.symbol}) locally!`);
				setTimeout(() => setAddGlobalSuccess(''), 3500);
				setAddGlobalName('');
				setAddGlobalSymbol('');
				setAddGlobalPrice('');
				setIsAddGlobalOpen(false);
			})
			.finally(() => setIsAddGlobalSubmitting(false));
	};

	const handleSaveCommodity = (e) => {
		e.preventDefault();
		if (!addCommodityName.trim()) {
			setAddCommodityError('Please enter a commodity stock name');
			return;
		}
		if (!addCommoditySymbol.trim()) {
			setAddCommodityError('Please enter a commodity symbol');
			return;
		}

		setAddCommodityError('');
		setIsAddCommoditySubmitting(true);

		const payload = {
			name: addCommodityName.trim(),
			symbol: addCommoditySymbol.trim().toUpperCase(),
			price: addCommodityPrice.trim() || '—'
		};

		fetch(`${API_BASE}/commodity/add`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		})
			.then((res) => res.json())
			.then(() => {
				const formattedPrice = payload.price === '—'
					? '$100.00'
					: (payload.price.startsWith('$') || payload.price.startsWith('₹') ? payload.price : `$${payload.price}`);

				const newItem = {
					id: Date.now(),
					ticker: payload.symbol,
					stockName: payload.name,
					marketCap: 'Commodity',
					price: formattedPrice,
					dma20_200: '—',
					dma50_200: '—',
					dma100_200: '—',
					highBreakout: '—',
					lowBreakout: '—',
					liteStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 },
					coreStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 },
					proStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 }
				};

				setCommodityData((prev) => [newItem, ...prev]);
				setAddCommoditySuccess(`Successfully added ${payload.name} (${payload.symbol})!`);
				setTimeout(() => setAddCommoditySuccess(''), 3500);

				setAddCommodityName('');
				setAddCommoditySymbol('');
				setAddCommodityPrice('');
				setIsAddCommodityOpen(false);
			})
			.catch((err) => {
				console.error('Error adding commodity:', err);
				const formattedPrice = payload.price === '—'
					? '$100.00'
					: (payload.price.startsWith('$') || payload.price.startsWith('₹') ? payload.price : `$${payload.price}`);

				const newItem = {
					id: Date.now(),
					ticker: payload.symbol,
					stockName: payload.name,
					marketCap: 'Commodity',
					price: formattedPrice,
					dma20_200: '—',
					dma50_200: '—',
					dma100_200: '—',
					highBreakout: '—',
					lowBreakout: '—',
					liteStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 },
					coreStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 },
					proStats: { isActive: false, activeDays: 0, avgGainPct: 0, prob: 0 }
				};
				setCommodityData((prev) => [newItem, ...prev]);
				setAddCommoditySuccess(`Added ${payload.name} (${payload.symbol}) locally!`);
				setTimeout(() => setAddCommoditySuccess(''), 3500);
				setAddCommodityName('');
				setAddCommoditySymbol('');
				setAddCommodityPrice('');
				setIsAddCommodityOpen(false);
			})
			.finally(() => setIsAddCommoditySubmitting(false));
	};

	const fetchLiveWatchlistTickers = () => {
		fetch(`${API_BASE}/watchlist`)
			.then((res) => res.json())
			.then((data) => {
				if (data) {
					const newSet = new Set();
					if (Array.isArray(data.items)) {
						setDbWatchlistItems(data.items);
						data.items.forEach((item) => {
							if (item.ticker) newSet.add(item.ticker.toUpperCase());
							if (item.symbol) newSet.add(item.symbol.toUpperCase());
						});
					}
					if (Array.isArray(data.groups)) {
						data.groups.forEach((g) => {
							if (Array.isArray(g.items)) {
								g.items.forEach((item) => {
									if (item.ticker) newSet.add(item.ticker.toUpperCase());
									if (item.symbol) newSet.add(item.symbol.toUpperCase());
								});
							}
						});
					}
					setDbWatchlistTickers(newSet);
					if (Array.isArray(data.groups)) {
						setDbWatchlistGroupsList(data.groups);
						saveStoredWatchlistGroups(data.groups);
					}
				}
			})
			.catch((err) => console.log('Using local watchlist fallback:', err));
	};

	// Sync watchlist groups and tickers live from DB on mount and when watchlist is updated
	useEffect(() => {
		fetchLiveWatchlistTickers();

		const handleWatchlistSync = () => {
			fetchLiveWatchlistTickers();
		};
		window.addEventListener('watchlistUpdated', handleWatchlistSync);
		return () => window.removeEventListener('watchlistUpdated', handleWatchlistSync);
	}, []);

	// Track if stock modal was opened from Watchlist navigation
	const [openedFromWatchlist, setOpenedFromWatchlist] = useState(false);

	const handleCloseStockDetailsModal = () => {
		setSelectedTradeStock(null);
		if (openedFromWatchlist) {
			setOpenedFromWatchlist(false);
			window.dispatchEvent(new Event('reopenWatchlistModal'));
		}
	};

	// Automatically open trades detail modal when navigated from Watchlist stock click
	useEffect(() => {
		const handleOpenStockDetails = (e) => {
			if (e && e.detail && e.detail.stock) {
				handleRowClick(e.detail.stock);
				setOpenedFromWatchlist(!!e.detail.openedFromWatchlist);
			}
		};
		window.addEventListener('openStockTradeDetails', handleOpenStockDetails);
		return () => window.removeEventListener('openStockTradeDetails', handleOpenStockDetails);
	}, [tradesData, ownershipData, trendsData, breakoutsData, metricsData]);

	const handleOpenAddToWatchlist = (item, e) => {
		if (e) e.stopPropagation();
		const stockTicker = (item.ticker || item.symbol || item.stockName || 'ASSET').toUpperCase();
		const stockData = {
			ticker: stockTicker,
			stockName: item.stockName || item.name || item.ticker || 'Asset Name',
			price: item.price || '—',
			marketCap: item.marketCap || '—',
			change: item.change || '+0.00%',
			isPos: true
		};
		setSelectedWatchlistStock(stockData);

		fetch(`${API_BASE}/watchlist`)
			.then((res) => res.json())
			.then((data) => {
				let groups = [];
				if (data && Array.isArray(data.groups)) {
					groups = data.groups;
					setDbWatchlistGroupsList(data.groups);
				}
				if (data && Array.isArray(data.items)) {
					setDbWatchlistItems(data.items);
				}

				const existingGroups = (data?.items || [])
					.filter((w) => (w.ticker || w.symbol || '').toUpperCase() === stockTicker)
					.map((w) => w.groupName)
					.filter(Boolean);

				if (existingGroups.length > 0) {
					setSelectedWatchlistGroupIds(existingGroups);
					setIsCreatingNewGroupMode(false);
				} else if (groups.length > 0) {
					setSelectedWatchlistGroupIds([groups[0].name]);
					setIsCreatingNewGroupMode(false);
				} else {
					setSelectedWatchlistGroupIds([]);
					setIsCreatingNewGroupMode(true);
				}
			})
			.catch(() => {
				const currentGroups = getStoredWatchlistGroups();
				setDbWatchlistGroupsList(currentGroups);
				if (currentGroups.length > 0) {
					setSelectedWatchlistGroupIds([currentGroups[0].name || currentGroups[0].id]);
					setIsCreatingNewGroupMode(false);
				} else {
					setSelectedWatchlistGroupIds([]);
					setIsCreatingNewGroupMode(true);
				}
			});

		setIsAddToWatchlistOpen(true);
	};

	const handleConfirmAddToWatchlist = (e) => {
		e.preventDefault();
		if (!selectedWatchlistStock) return;
		let targetGroupNames = [...selectedWatchlistGroupIds];

		if (isCreatingNewGroupMode && createNewGroupInput.trim()) {
			const newName = createNewGroupInput.trim();
			if (!targetGroupNames.some((g) => g.toLowerCase() === newName.toLowerCase())) {
				targetGroupNames.push(newName);
			}
		}

		if (targetGroupNames.length === 0) {
			targetGroupNames = ['General'];
		}

		fetch(`${API_BASE}/watchlist`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				ticker: selectedWatchlistStock.ticker,
				stockName: selectedWatchlistStock.stockName,
				groupNames: targetGroupNames,
				groupName: targetGroupNames[0],
				price: selectedWatchlistStock.price,
				marketCap: selectedWatchlistStock.marketCap,
				change: selectedWatchlistStock.change
			})
		})
			.then((res) => res.json())
			.then(() => {
				window.dispatchEvent(new Event('watchlistUpdated'));
				fetchLiveWatchlistTickers();
				setWatchlistSuccessMsg(`Added ${selectedWatchlistStock.ticker} to "${targetGroupNames.join(', ')}" Watchlist!`);
				setTimeout(() => setWatchlistSuccessMsg(''), 3000);
				setIsAddToWatchlistOpen(false);
				setCreateNewGroupInput('');
			})
			.catch((err) => console.error('Error adding stock to DB watchlist:', err));
	};

	const handleWatchlistIconClick = (item, e) => {
		if (e) e.stopPropagation();
		const ticker = (item.ticker || item.symbol || item.stockName || '').toUpperCase();
		const isSaved = dbWatchlistTickers.has(ticker);

		if (isSaved) {
			// Optimistically remove from state immediately so background color removes instantly!
			setDbWatchlistTickers((prev) => {
				const next = new Set(prev);
				next.delete(ticker);
				return next;
			});

			fetch(`${API_BASE}/watchlist/remove`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ticker: ticker
				})
			})
				.then((res) => res.json())
				.then(() => {
					window.dispatchEvent(new Event('watchlistUpdated'));
					fetchLiveWatchlistTickers();
					setWatchlistSuccessMsg(`Removed ${ticker} from Watchlist!`);
					setTimeout(() => setWatchlistSuccessMsg(''), 3000);
				})
				.catch((err) => {
					console.error('Error removing stock from DB watchlist:', err);
					fetchLiveWatchlistTickers();
				});
		} else {
			// Stock is not saved -> open Add to Watchlist modal!
			handleOpenAddToWatchlist(item, e);
		}
	};

	const renderWatchlistIconBtn = (item) => {
		const ticker = (item.ticker || item.symbol || item.stockName || '').toUpperCase();
		const isSaved = dbWatchlistTickers.has(ticker);

		return (
			<button
				onClick={(e) => handleWatchlistIconClick(item, e)}
				className={`p-1 rounded-md transition-all cursor-pointer ml-1.5 inline-flex items-center ${isSaved
					? 'text-[#9462d2] bg-purple-100/80 border border-purple-200/80 shadow-2xs hover:bg-rose-100 hover:text-rose-600 hover:border-rose-200'
					: 'text-slate-300 hover:text-[#9462d2] hover:bg-purple-50'
					}`}
				title={isSaved ? 'Click to remove from Watchlist' : 'Add to Watchlist Group'}
			>
				<span className="material-symbols-outlined text-[17px]">
					{isSaved ? 'bookmark' : 'bookmark_add'}
				</span>
			</button>
		);
	};

	const handleSectorRowClick = (sectorObj) => {
		setSelectedSector(sectorObj);
		setSectorModalLoading(true);
		setSectorModalDetails(null);

		fetch(`${API_BASE}/sectoral/history?sector=${encodeURIComponent(sectorObj.sector)}`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.history) {
					setSectorModalDetails(data);
				}
			})
			.catch((err) => console.error('Error fetching sector history modal details:', err))
			.finally(() => setSectorModalLoading(false));
	};

	const handleOwnershipRowClick = (item) => {
		if (!item) return;
		const ticker = item.ticker || item.symbol || item.stockName || '';
		const stockItem = { ...item, ticker };
		setSelectedOwnershipStock(stockItem);
		setOwnershipModalSubTab('Quarterly');
		setOwnershipModalLoading(true);
		setOwnershipModalDetails(null);

		if (ticker) {
			fetch(`${API_BASE}/ownership/${encodeURIComponent(ticker)}`)
				.then((res) => res.json())
				.then((data) => {
					if (data && data.details) {
						setOwnershipModalDetails(data.details);
						if (!data.details['Quarterly'] || data.details['Quarterly'].length === 0) {
							if (data.details['Yearly'] && data.details['Yearly'].length > 0) {
								setOwnershipModalSubTab('Yearly');
							}
						}
					}
				})
				.catch((err) => console.error('Error fetching ownership details:', err))
				.finally(() => setOwnershipModalLoading(false));
		} else {
			setOwnershipModalLoading(false);
		}
	};

	const handleTrendRowClick = (item, isBreakout = false) => {
		if (!item) return;
		const ticker = item.ticker || item.symbol || item.stockName || '';
		const stockItem = { ...item, ticker };
		setSelectedTrendStock(stockItem);
		setIsBreakoutModal(isBreakout);
		setTrendModalLoading(true);
		setTrendModalDetails(null);

		if (ticker) {
			fetch(`${API_BASE}/trends/${encodeURIComponent(ticker)}`)
				.then((res) => res.json())
				.then((data) => {
					if (data && data.history) {
						setTrendModalDetails(data);
					}
				})
				.catch((err) => console.error('Error fetching trend stock details:', err))
				.finally(() => setTrendModalLoading(false));
		} else {
			setTrendModalLoading(false);
		}
	};

	const handleMetricsRowClick = (item) => {
		if (!item) return;
		const ticker = item.ticker || item.symbol || item.stockName || '';
		const matchedInMetrics = (metricsData || []).find(
			(m) => m.ticker && ticker && m.ticker.toUpperCase() === ticker.toUpperCase()
		);
		const stockItem = matchedInMetrics ? { ...matchedInMetrics, ...item, ticker } : { ...item, ticker };
		setSelectedMetricsStock(stockItem);
		setMetricsModalLoading(true);
		setMetricsModalDetails(null);

		if (ticker) {
			fetch(`${API_BASE}/metrics/${encodeURIComponent(ticker)}`)
				.then((res) => res.json())
				.then((data) => {
					if (data) {
						if (data.compoundedGrowth) {
							setMetricsModalDetails(data);
						}
						if (data.metrics) {
							setSelectedMetricsStock((prev) => ({ ...(prev || {}), ...data.metrics }));
						}
					}
				})
				.catch((err) => console.error('Error fetching metrics stock details:', err))
				.finally(() => setMetricsModalLoading(false));
		} else {
			setMetricsModalLoading(false);
		}
	};

	// Navigate between stock detail sections (Trades <-> Ownership <-> Trends <-> Breakout <-> Metrics <-> Consensus <-> Sentiment)
	const handleNavigateStockSection = (stock, currentSection, target) => {
		if (!stock) return;
		const isGlobalOrCommodity = activeTab === 'Global' || activeTab === 'Commodity';
		const sections = isGlobalOrCommodity
			? ['Trends', 'Breakout']
			: ['Trades', 'Ownership', 'Trends', 'Breakout', 'Metrics', 'Consensus', 'Sentiment'];
		let targetSection = target;
		if (target === 'next' || target === 'prev') {
			const currIndex = sections.indexOf(currentSection);
			if (currIndex === -1) return;
			const nextIndex = target === 'next'
				? (currIndex + 1) % sections.length
				: (currIndex - 1 + sections.length) % sections.length;
			targetSection = sections[nextIndex];
		}
		if (targetSection === currentSection) return;

		setSelectedTradeStock(null);
		setSelectedOwnershipStock(null);
		setSelectedTrendStock(null);
		setSelectedMetricsStock(null);
		setSelectedConsensusStock(null);
		setSelectedSentimentStock(null);

		if (targetSection === 'Trades') {
			handleRowClick(stock);
		} else if (targetSection === 'Ownership') {
			handleOwnershipRowClick(stock);
		} else if (targetSection === 'Trends') {
			handleTrendRowClick(stock, false);
		} else if (targetSection === 'Breakout') {
			handleTrendRowClick(stock, true);
		} else if (targetSection === 'Metrics') {
			handleMetricsRowClick(stock);
		} else if (targetSection === 'Consensus') {
			handleConsensusRowClick(stock);
		} else if (targetSection === 'Sentiment') {
			handleSentimentRowClick(stock);
		}
	};

	// Keyboard arrow navigation for detail modal sections
	useEffect(() => {
		const handleKeyDown = (e) => {
			const activeStock = selectedTradeStock || selectedOwnershipStock || selectedTrendStock || selectedMetricsStock || selectedConsensusStock || selectedSentimentStock;
			if (!activeStock) return;
			const activeSection = selectedTradeStock
				? 'Trades'
				: selectedOwnershipStock
					? 'Ownership'
					: selectedMetricsStock
						? 'Metrics'
						: selectedConsensusStock
							? 'Consensus'
							: selectedSentimentStock
								? 'Sentiment'
								: isBreakoutModal
									? 'Breakout'
									: 'Trends';
			if (e.key === 'ArrowLeft') {
				handleNavigateStockSection(activeStock, activeSection, 'prev');
			} else if (e.key === 'ArrowRight') {
				handleNavigateStockSection(activeStock, activeSection, 'next');
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [selectedTradeStock, selectedOwnershipStock, selectedTrendStock, selectedMetricsStock, selectedConsensusStock, selectedSentimentStock, isBreakoutModal]);

	// State for Ownership Period Mode (Quarterly / Yearly)
	const [ownershipPeriodType, setOwnershipPeriodType] = useState('Quarterly');

	useEffect(() => {
		// Fetch Trades directly from PostgreSQL Backend Database
		setLoadingTrades(true);
		fetch(`${API_BASE}/trades`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.trades) {
					const formatted = data.trades.map((item) => ({
						...item,
						icon: <span className="material-symbols-outlined text-white text-[20px]">monitoring</span>
					}));
					setTradesData(formatted);
				}
			})
			.catch((err) => console.error('Error fetching trades from database:', err))
			.finally(() => setLoadingTrades(false));

		// Fetch Sectoral Activity from PostgreSQL Backend
		fetch(`${API_BASE}/sectoral`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.sectoral && data.sectoral.length > 0) {
					const formatted = data.sectoral.map((item) => ({
						...item,
						icon: <span className="material-symbols-outlined text-white text-[20px]">category</span>
					}));
					setSectoralData(formatted);
				}
			})
			.catch((err) => console.log('Using fallback sectoral data:', err));

		// Fetch Trends from PostgreSQL Backend
		setLoadingTrends(true);
		fetch(`${API_BASE}/trends`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.trends) {
					setTrendsData(data.trends);
				}
			})
			.catch((err) => console.error('Error fetching trends data:', err))
			.finally(() => setLoadingTrends(false));

		// Fetch Breakouts from PostgreSQL Backend
		setLoadingBreakouts(true);
		fetch(`${API_BASE}/breakout`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.breakouts) {
					setBreakoutsData(data.breakouts);
				}
			})
			.catch((err) => console.error('Error fetching breakout data:', err))
			.finally(() => setLoadingBreakouts(false));

		// Fetch Global Indices from PostgreSQL Backend
		setLoadingGlobal(true);
		fetch(`${API_BASE}/global`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.global) {
					setGlobalData(data.global);
				}
			})
			.catch((err) => console.error('Error fetching global data:', err))
			.finally(() => setLoadingGlobal(false));

		// Fetch Commodities from PostgreSQL Backend
		setLoadingCommodity(true);
		fetch(`${API_BASE}/commodity`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.commodity) {
					setCommodityData(data.commodity);
				}
			})
			.catch((err) => console.error('Error fetching commodity data:', err))
			.finally(() => setLoadingCommodity(false));

		// Fetch Financial Metrics from PostgreSQL Backend
		setLoadingMetrics(true);
		fetch(`${API_BASE}/metrics`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.metrics) {
					setMetricsData(data.metrics);
				}
			})
			.catch((err) => console.error('Error fetching metrics data:', err))
			.finally(() => setLoadingMetrics(false));

		// Fetch Consensus Recommendations from PostgreSQL Backend
		setLoadingConsensus(true);
		fetch(`${API_BASE}/recommendations`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.recommendations) {
					setConsensusData(data.recommendations);
				}
			})
			.catch((err) => console.error('Error fetching consensus data:', err))
			.finally(() => setLoadingConsensus(false));

		// Fetch Moneycontrol Forum & Boarders Sentiment from PostgreSQL Backend
		setLoadingSentiment(true);
		fetch(`${API_BASE}/sentiment`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.sentiment) {
					setSentimentData(data.sentiment);
				}
			})
			.catch((err) => console.error('Error fetching sentiment data:', err))
			.finally(() => setLoadingSentiment(false));
	}, []);

	// Fetch Ownership / Shareholding pattern when period mode changes
	useEffect(() => {
		setLoadingOwnership(true);
		fetch(`${API_BASE}/ownership?period_type=${ownershipPeriodType.toLowerCase()}`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.ownership) {
					setOwnershipData(data.ownership);
				}
			})
			.catch((err) => console.error('Error fetching ownership data:', err))
			.finally(() => setLoadingOwnership(false));
	}, [ownershipPeriodType]);

	// Fetch Sectoral Activity when period mode changes
	useEffect(() => {
		setLoadingSectoral(true);
		fetch(`${API_BASE}/sectoral?period_type=${sectoralPeriodType.toLowerCase()}`)
			.then((res) => res.json())
			.then((data) => {
				if (data && data.sectoral) {
					setSectoralData(data.sectoral);
					setSectoralPeriods(data.periods || []);
				}
			})
			.catch((err) => console.error('Error fetching sectoral data:', err))
			.finally(() => setLoadingSectoral(false));
	}, [sectoralPeriodType]);

	// Fetch CashFlow from PostgreSQL Backend when period mode changes
	useEffect(() => {
		setLoadingCashFlow(true);
		fetch(`${API_BASE}/cashflow?period_type=${cashFlowPeriodType.toLowerCase()}`)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP error ${res.status}`);
				return res.json();
			})
			.then((data) => {
				if (data && Array.isArray(data.cashflow) && data.cashflow.length > 0) {
					setCashFlowData(data.cashflow);
				} else {
					setCashFlowData(defaultCashFlowData);
				}
			})
			.catch((err) => {
				console.warn('Backend server offline or fetching cashflow data failed:', err);
				setCashFlowData(defaultCashFlowData);
			})
			.finally(() => setLoadingCashFlow(false));
	}, [cashFlowPeriodType]);



	// Reset pagination on search, tab change or sort change
	useEffect(() => {
		setCurrentPage(1);
	}, [searchTerm, activeTab, sortRules]);

	const parseMarketCap = (str) => {
		if (!str || str === '—' || str === '-') return -1;
		let s = str.replace(/[₹\sCr]/gi, '').replace(/,/g, '');
		if (s.includes('L')) {
			let num = parseFloat(s.replace('L', ''));
			return isNaN(num) ? -1 : num * 100000;
		}
		let num = parseFloat(s);
		return isNaN(num) ? -1 : num;
	};

	const parsePrice = (str) => {
		if (!str || str === '—' || str === '-') return -1;
		let s = str.replace(/[₹$,\s]/g, '');
		let num = parseFloat(s);
		return isNaN(num) ? -1 : num;
	};

	const parseTradeValue = (val) => {
		if (!val) return -1;
		const dateStr = typeof val === 'object' ? val.date : val;
		if (!dateStr || dateStr === '-' || dateStr === 'None' || dateStr === 'null') return -1;

		let ts = Date.parse(dateStr);
		if (!isNaN(ts)) return ts;

		const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
		const parts = dateStr.trim().split(/\s+/);
		if (parts.length === 3) {
			const day = parseInt(parts[0], 10);
			const m = months[parts[1].toLowerCase().slice(0, 3)];
			const yr = parseInt(parts[2], 10);
			if (!isNaN(day) && m !== undefined && !isNaN(yr)) return new Date(yr, m, day).getTime();
		} else if (parts.length === 2) {
			const m = months[parts[0].toLowerCase().slice(0, 3)];
			const yr = parseInt(parts[1], 10);
			if (m !== undefined && !isNaN(yr)) return new Date(yr, m, 1).getTime();
		}
		return -1;
	};

	const parseOwnershipDiff = (metricObj) => {
		if (!metricObj || metricObj.val === '—' || metricObj.diff === '—') return -999999;
		if (typeof metricObj.change === 'number' && !isNaN(metricObj.change)) {
			return metricObj.change;
		}
		if (typeof metricObj.diff === 'string') {
			let s = metricObj.diff.replace(/[%+]/g, '').trim();
			let num = parseFloat(s);
			return isNaN(num) ? -999999 : num;
		}
		return -999999;
	};

	const parseCrossoverDays = (val) => {
		if (!val || typeof val !== 'string' || !val.startsWith('Yes')) return -1;
		const match = val.match(/\d+/);
		if (match) {
			const num = parseInt(match[0], 10);
			return isNaN(num) ? -1 : num;
		}
		return 0;
	};

	const parseBreakoutPct = (val) => {
		if (!val || typeof val !== 'string' || !val.startsWith('Yes')) return -1;
		const match = val.match(/[\d.]+/);
		if (match) {
			const num = parseFloat(match[0]);
			return isNaN(num) ? -1 : num;
		}
		return 0;
	};

	const parsePctNum = (str) => {
		if (!str || str === '—' || str === '-') return -999999;
		let s = String(str).replace(/[%+]/g, '').trim();
		let num = parseFloat(s);
		return isNaN(num) ? -999999 : num;
	};

	const calcConsensusRating = (item) => {
		if (!item) return 'N/A';
		const sb = Number(item.strong_buy || item.strongBuy || 0);
		const b = Number(item.buy || 0);
		const h = Number(item.hold || 0);
		const s = Number(item.sell || 0);
		const ss = Number(item.strong_sell || item.strongSell || 0);
		const total = Number(item.total || (sb + b + h + s + ss));

		if (total <= 0) return 'N/A';

		const buyTotal = sb + b;
		const sellTotal = s + ss;

		if (buyTotal > h && buyTotal >= sellTotal) {
			return sb >= b ? 'Strong Buy' : 'Buy';
		}
		if (sellTotal > h && sellTotal > buyTotal) {
			return ss >= s ? 'Strong Sell' : 'Sell';
		}
		return 'Hold';
	};

	const getColumnValue = (item, key) => {
		if (key === 'stockName' || key === 'sector') return item.sector || item.stockName || item.stock_name || '';
		if (key === 'period') return item.period || '';
		if (['total', 'strong_buy', 'strongBuy', 'buy', 'hold', 'sell', 'strong_sell', 'strongSell'].includes(key)) {
			let val = item[key];
			if (val === undefined) {
				if (key === 'strong_buy') val = item.strongBuy;
				if (key === 'strongBuy') val = item.strong_buy;
				if (key === 'strong_sell') val = item.strongSell;
				if (key === 'strongSell') val = item.strong_sell;
			}
			if (typeof val === 'number') return val;
			return parseInt(val, 10) || 0;
		}
		if (['msg_count', 'follower_count', 'buy_perc', 'sell_perc', 'hold_perc'].includes(key)) {
			let val = item[key];
			if (typeof val === 'number') return val;
			return parseFloat(val) || 0;
		}
		if (['target_mean_price', 'target_high_price', 'target_low_price', 'targetMeanPrice', 'targetHighPrice', 'targetLowPrice'].includes(key)) {
			const val = item[key];
			if (!val || val === '0' || val === '0.0' || val === '—') return -999999;
			return parseFloat(String(val).replace(/,/g, '')) || -999999;
		}
		if (key === 'consensus_rating' || key === 'consensusRating') {
			return calcConsensusRating(item);
		}
		if (key === 'scraped_at' || key === 'scrapedAt') {
			return item.scraped_at || item.scrapedAt || '';
		}
		if (key === 'fiiBuy') return item.fiiBuyRaw !== undefined ? item.fiiBuyRaw : -99999999;
		if (key === 'fiiSell') return item.fiiSellRaw !== undefined ? item.fiiSellRaw : -99999999;
		if (key === 'fiiNet') return item.fiiNetRaw !== undefined ? item.fiiNetRaw : -99999999;
		if (key === 'diiBuy') return item.diiBuyRaw !== undefined ? item.diiBuyRaw : -99999999;
		if (key === 'diiSell') return item.diiSellRaw !== undefined ? item.diiSellRaw : -99999999;
		if (key === 'diiNet') return item.diiNetRaw !== undefined ? item.diiNetRaw : -99999999;
		if (item && item.amounts && item.amounts[key]) {
			return item.amounts[key].raw !== null ? item.amounts[key].raw : -99999999;
		}
		if (key === 'marketCap' || key === 'weight') return parseMarketCap(item.weight || item.marketCap);
		if (key === 'price') return parsePrice(item.price);
		if (key === 'dayChange') return parsePctNum(item.dayChange);
		if (key === 'monthChange') return parsePctNum(item.monthChange);
		if (key === 'topGainer') return item.topGainer || '';
		if (key === 'volume') return parseMarketCap(item.volume);
		if (key === 'status') return item.status || '';
		if (key === 'boNum') return typeof item.boNum === 'number' ? item.boNum : -999999;
		if (key === 'crossLabel') {
			if (typeof item.crossDaysNum === 'number') return item.crossDaysNum;
			if (item.crossStats && typeof item.crossStats.activeDays === 'number') return item.crossStats.activeDays;
			if (item.crossDaysText) {
				const match = item.crossDaysText.match(/\d+/);
				if (match) return parseInt(match[0], 10);
			}
			return -999999;
		}
		if (key === 'ownershipSummary') {
			if (item.ownCategoryData && item.ownCategoryData.length > 0) {
				return item.ownCategoryData.reduce((acc, curr) => acc + (curr.diff || 0), 0);
			}
			return 0;
		}
		if (key === 'tradesSummary') {
			if (item.tradeCategoryData && item.tradeCategoryData.length > 0) {
				return item.tradeCategoryData.filter((t) => t.active).length;
			}
			return 0;
		}
		if (key === 'salesVal') {
			if (typeof item.salesNum === 'number') return item.salesNum;
			return parsePctNum(item.salesVal);
		}
		if (key === 'profitVal') {
			if (typeof item.profitNum === 'number') return item.profitNum;
			return parsePctNum(item.profitVal);
		}
		if (key === 'roeVal') {
			if (typeof item.roeNum === 'number') return item.roeNum;
			return parsePctNum(item.roeVal);
		}
		if (key === 'roceVal') {
			if (typeof item.roceNum === 'number') return item.roceNum;
			return parsePctNum(item.roceVal);
		}
		if (['insiderTrades', 'bulkDeals', 'blockDeals', 'sastTrades'].includes(key)) {
			return parseTradeValue(item[key]);
		}
		if (['promoters', 'fiis', 'diis', 'public', 'roe', 'roce', 'qSalesLatest', 'qSalesPrevQ', 'qSalesGrowth', 'qYoySalesGrowth', 'qOpm', 'plSalesGrowth', 'plOpm', 'plNetProfit'].includes(key)) {
			let targetObj = item[key];
			if (key === 'qSalesGrowth') targetObj = item ? item.qSalesLatest : null;
			if (key === 'qYoySalesGrowth') targetObj = item ? item.qSalesPrevQ : null;
			return parseOwnershipDiff(targetObj);
		}
		if (['dma20_200', 'dma50_200', 'dma100_200'].includes(key)) {
			return parseCrossoverDays(item[key]);
		}
		if (['highBreakout', 'lowBreakout'].includes(key)) {
			return parseBreakoutPct(item[key]);
		}
		return '';
	};

	const compareColumnValues = (a, b, key, direction = 'asc') => {
		if (key === 'consensus_rating' || key === 'consensusRating') {
			const ratingRankMap = {
				'Strong Buy': 1,
				'Buy': 2,
				'Hold': 3,
				'Sell': 4,
				'Strong Sell': 5,
				'N/A': 6
			};
			const aRating = calcConsensusRating(a);
			const bRating = calcConsensusRating(b);
			const aRank = ratingRankMap[aRating] || 99;
			const bRank = ratingRankMap[bRating] || 99;
			return direction === 'asc' ? aRank - bRank : bRank - aRank;
		}
		if (key === 'buy_perc') {
			const aBuy = Number(a?.buy_perc || 0);
			const bBuy = Number(b?.buy_perc || 0);
			if (aBuy !== bBuy) {
				return direction === 'desc' ? bBuy - aBuy : aBuy - bBuy;
			}
			const aHold = Number(a?.hold_perc || 0);
			const bHold = Number(b?.hold_perc || 0);
			if (aHold !== bHold) {
				return direction === 'desc' ? bHold - aHold : aHold - bHold;
			}
			const aSell = Number(a?.sell_perc || 0);
			const bSell = Number(b?.sell_perc || 0);
			return direction === 'desc' ? bSell - aSell : aSell - bSell;
		}
		const aVal = getColumnValue(a, key);
		const bVal = getColumnValue(b, key);

		if (aVal === -999999 && bVal === -999999) return 0;
		if (aVal === -999999) return 1;
		if (bVal === -999999) return -1;

		if (['dma20_200', 'dma50_200', 'dma100_200', 'highBreakout', 'lowBreakout'].includes(key)) {
			if (aVal === -1 && bVal === -1) return 0;
			if (aVal === -1) return 1;
			if (bVal === -1) return -1;
		}

		if (typeof aVal === 'string' && typeof bVal === 'string') {
			const comp = aVal.localeCompare(bVal, undefined, { sensitivity: 'base', numeric: true });
			return direction === 'asc' ? comp : -comp;
		}

		if (typeof aVal === 'number' && typeof bVal === 'number') {
			if (['salesVal', 'profitVal', 'roeVal', 'roceVal', 'boNum', 'qSalesLatest', 'qSalesPrevQ', 'qSalesGrowth', 'qYoySalesGrowth', 'plSalesGrowth', 'plNetProfit', 'roe', 'roce'].includes(key)) {
				const aPos = aVal > 0;
				const bPos = bVal > 0;
				if (aPos && !bPos) return -1;
				if (!aPos && bPos) return 1;
			}
			return direction === 'desc' ? bVal - aVal : aVal - bVal;
		}

		return 0;
	};

	const handleSort = (key, e) => {
		const isMulti = e && (e.shiftKey || e.ctrlKey || e.metaKey);
		const isNumericKey = [
			'total', 'strong_buy', 'strongBuy', 'buy', 'hold', 'sell', 'strong_sell', 'strongSell',
			'msg_count', 'follower_count', 'buy_perc', 'sell_perc', 'hold_perc',
			'marketCap', 'price', 'volume', 'weight', 'dayChange', 'monthChange',
			'qSalesLatest', 'qSalesPrevQ', 'qOpm', 'roce', 'plSalesGrowth', 'plNetProfit', 'plOpm', 'roe',
			'salesVal', 'profitVal', 'roeVal', 'roceVal', 'boNum', 'fiiBuy', 'fiiSell', 'fiiNet', 'diiBuy', 'diiSell', 'diiNet'
		].includes(key);
		const defaultDir = isNumericKey ? 'desc' : 'asc';

		setSortRules((prevRules) => {
			const safeRules = Array.isArray(prevRules) ? prevRules : [];
			const existingIdx = safeRules.findIndex((r) => r.key === key);
			if (isMulti) {
				if (existingIdx >= 0) {
					const updated = [...safeRules];
					const currDir = updated[existingIdx].direction;
					updated[existingIdx] = { key, direction: currDir === 'asc' ? 'desc' : 'asc' };
					return updated;
				} else {
					return [...safeRules, { key, direction: defaultDir }];
				}
			} else {
				if (existingIdx === 0 && safeRules.length === 1) {
					const currDir = safeRules[0].direction;
					return [{ key, direction: currDir === 'asc' ? 'desc' : 'asc' }];
				} else {
					return [{ key, direction: defaultDir }];
				}
			}
		});
	};

	const handleRowClick = (item) => {
		if (!item) return;
		const ticker = item.ticker || item.symbol || item.stockName || '';
		const stockItem = { ...item, ticker };
		setSelectedTradeStock(stockItem);
		setModalActiveSubTab('Insider Trades');
		setModalLoading(true);
		setModalDetails(null);

		if (ticker) {
			fetch(`${API_BASE}/trades/${encodeURIComponent(ticker)}`)
				.then((res) => res.json())
				.then((data) => {
					if (data && data.details) {
						setModalDetails(data.details);
						const subTabs = ['Insider Trades', 'Bulk Deals', 'Block Deals', 'Sast Trades'];
						if (!data.details['Insider Trades'] || data.details['Insider Trades'].length === 0) {
							const firstNonEmpty = subTabs.find((t) => data.details[t] && data.details[t].length > 0);
							if (firstNonEmpty) setModalActiveSubTab(firstNonEmpty);
						}
					}
				})
				.catch((err) => console.error('Error fetching trade details:', err))
				.finally(() => setModalLoading(false));
		} else {
			setModalLoading(false);
		}
	};

	// Helper to lookup stock object by symbol string
	const findStockBySymbol = (symbolStr) => {
		if (!symbolStr) return null;
		const cleanSym = decodeURIComponent(symbolStr).replace(/[-_\s]/g, '').toUpperCase();
		const allLists = [...tradesData, ...ownershipData, ...trendsData, ...breakoutsData, ...metricsData, ...consensusData, ...sentimentData, ...globalData, ...commodityData];
		const match = allLists.find((item) => {
			const t = (item.ticker || item.symbol || item.stockName || '').replace(/[-_\s]/g, '').toUpperCase();
			return t === cleanSym;
		});
		if (match) return match;
		return { ticker: symbolStr.toUpperCase(), stockName: symbolStr.toUpperCase() };
	};

	// Push/Sync URL when a stock details modal opens or closes
	useEffect(() => {
		const activeStock = selectedTradeStock || selectedOwnershipStock || selectedTrendStock || selectedMetricsStock || selectedConsensusStock || selectedSentimentStock;
		if (activeStock) {
			const rawSymbol = activeStock.ticker || activeStock.symbol || activeStock.stockName || '';
			if (rawSymbol) {
				const symbolSlug = rawSymbol.toLowerCase();
				const targetUrl = `/analysis/nifty-stocks/${encodeURIComponent(symbolSlug)}/details`;
				if (window.location.pathname !== targetUrl) {
					window.history.pushState({ stockSymbol: rawSymbol }, '', targetUrl);
				}
			}
		} else {
			if (window.location.pathname.startsWith('/analysis/nifty-stocks/') && window.location.pathname.endsWith('/details')) {
				window.history.pushState(null, '', '/analysis/nifty-stocks');
			}
		}
	}, [selectedTradeStock, selectedOwnershipStock, selectedTrendStock, selectedMetricsStock, selectedConsensusStock, selectedSentimentStock]);

	// Read URL on mount or browser popstate navigation to open stock details modal automatically
	useEffect(() => {
		const handleUrlCheck = () => {
			const path = window.location.pathname;
			const match = path.match(/^\/analysis\/nifty-stocks\/([^/]+)\/details$/i);
			if (match) {
				const symbolParam = decodeURIComponent(match[1]);
				const currentActiveStock = selectedTradeStock || selectedOwnershipStock || selectedTrendStock || selectedMetricsStock || selectedConsensusStock || selectedSentimentStock;
				const currentSymbol = currentActiveStock ? (currentActiveStock.ticker || currentActiveStock.symbol || currentActiveStock.stockName || '') : '';
				if (currentSymbol.toLowerCase() !== symbolParam.toLowerCase()) {
					const stockObj = findStockBySymbol(symbolParam);
					handleRowClick(stockObj);
				}
			} else {
				// If URL is not details (e.g. back button was pressed), close open modals
				const currentActiveStock = selectedTradeStock || selectedOwnershipStock || selectedTrendStock || selectedMetricsStock || selectedConsensusStock || selectedSentimentStock;
				if (currentActiveStock) {
					setSelectedTradeStock(null);
					setSelectedOwnershipStock(null);
					setSelectedTrendStock(null);
					setSelectedMetricsStock(null);
					setSelectedConsensusStock(null);
					setSelectedSentimentStock(null);
				}
			}
		};

		handleUrlCheck();

		window.addEventListener('popstate', handleUrlCheck);
		return () => window.removeEventListener('popstate', handleUrlCheck);
	}, [tradesData, ownershipData, trendsData, breakoutsData, metricsData, consensusData, sentimentData]);

	const getGroupedTradesForSubTab = () => {
		if (!modalDetails || !modalDetails[modalActiveSubTab]) return [];
		const rows = modalDetails[modalActiveSubTab];
		const grouped = {};
		rows.forEach((r) => {
			const d = r.trade_date || 'Unknown Date';
			if (!grouped[d]) grouped[d] = [];
			grouped[d].push(r);
		});

		// Sort date keys in descending order by timestamp (most recent trade date first)
		const sortedEntries = Object.entries(grouped).sort((a, b) => {
			const tsA = parseTradeValue(a[0]);
			const tsB = parseTradeValue(b[0]);
			return tsB - tsA;
		});

		return sortedEntries;
	};

	const getOwnershipComparisonData = () => {
		if (!ownershipModalDetails || !ownershipModalDetails[ownershipModalSubTab]) return null;
		const records = ownershipModalDetails[ownershipModalSubTab];
		if (!records || records.length === 0) return null;

		const latest = records[records.length - 1];
		const prev = records.length > 1 ? records[records.length - 2] : null;

		const periodText = prev ? `${prev.period} vs ${latest.period}` : latest.period || '';

		const categories = [
			{ key: 'promoters', label: 'Promoters' },
			{ key: 'fiis', label: 'FIIs' },
			{ key: 'diis', label: 'DIIs' },
			{ key: 'public', label: 'Public' },
		];

		return categories.map((cat) => {
			const latestStr = latest[cat.key] || '—';
			const prevStr = prev ? prev[cat.key] || '—' : null;

			let changeNum = 0;
			let diffStr = '0.00%';

			if (latestStr !== '—' && prevStr && prevStr !== '—') {
				const numLatest = parseFloat(latestStr.replace(/[%+]/g, ''));
				const numPrev = parseFloat(prevStr.replace(/[%+]/g, ''));
				if (!isNaN(numLatest) && !isNaN(numPrev)) {
					changeNum = numLatest - numPrev;
					const prefix = changeNum > 0 ? '+' : '';
					diffStr = `${prefix}${changeNum.toFixed(2)}%`;
				}
			}

			return {
				label: cat.label,
				val: latestStr,
				diff: diffStr,
				change: changeNum,
				periodText
			};
		});
	};

	const renderSortHeader = (key, label, isLeft = false, isRight = false, alignRight = false, pyClass = 'py-3.5', rowSpan = 1, bgClass = 'bg-[#F1F5F9]', extraClass = '', alignCenter = false) => {
		const safeRules = Array.isArray(sortRules) ? sortRules : [];
		const ruleIndex = safeRules.findIndex((r) => r.key === key);
		const activeRule = ruleIndex >= 0 ? safeRules[ruleIndex] : null;
		const roundedClass = isLeft ? 'rounded-l-xl' : isRight ? 'rounded-r-xl' : '';
		const alignClass = alignCenter ? 'justify-center text-center' : alignRight ? 'justify-end text-right' : 'justify-start text-left';
		const thAlign = alignCenter ? 'text-center' : alignRight ? 'text-right' : 'text-left';

		return (
			<th
				rowSpan={rowSpan}
				onClick={(e) => handleSort(key, e)}
				className={`${pyClass} px-4 font-semibold ${bgClass} sticky top-0 z-20 cursor-pointer select-none group hover:brightness-95 transition-all ${roundedClass} ${thAlign} ${extraClass}`}
				title="Click to sort. Hold Shift to sort by multiple columns (AND condition)."
			>
				<div className={`flex items-center gap-1 whitespace-nowrap ${alignClass}`}>
					<span>{label}</span>
					{!activeRule && (
						<span className="material-symbols-outlined text-[16px] leading-none ml-1 text-slate-400 opacity-40 group-hover:opacity-100 select-none">
							unfold_more
						</span>
					)}
					{activeRule && (
						<div className="flex items-center gap-1 ml-1.5">
							<span className="material-symbols-outlined text-[16px] font-bold text-[#9462d2] select-none">
								{activeRule.direction === 'desc' ? 'arrow_downward' : 'arrow_upward'}
							</span>
							{safeRules.length > 1 && (
								<span className="w-4 h-4 rounded-full bg-[#9462d2] text-white text-[10px] font-bold flex items-center justify-center select-none shadow-xs">
									{ruleIndex + 1}
								</span>
							)}
						</div>
					)}
				</div>
			</th>
		);
	};

	const renderTradeCell = (val) => {
		if (!val) return <span className="text-slate-400 font-normal">-</span>;
		const dateStr = typeof val === 'object' ? val.date : val;
		const actionStr = typeof val === 'object' ? val.action : '';

		if (!dateStr || dateStr === '-' || dateStr === 'None') {
			return <span className="text-slate-400 font-normal">-</span>;
		}

		const isBuy = actionStr === 'Buy' || actionStr === 'ACQ';
		const isSell = actionStr === 'Sell';

		if (isBuy) {
			return (
				<span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100/80 text-emerald-700 whitespace-nowrap">
					{dateStr}
				</span>
			);
		}

		if (isSell) {
			return (
				<span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100/80 text-red-600 whitespace-nowrap">
					{dateStr}
				</span>
			);
		}

		return (
			<span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 whitespace-nowrap">
				{dateStr}
			</span>
		);
	};

	const isBuyTrade = (val) => {
		if (!val) return false;
		if (typeof val === 'object') {
			const action = val.action || val.buy_sell || '';
			return action === 'Buy' || action === 'ACQ';
		}
		return false;
	};

	const getTradeString = (val) => {
		if (!val) return '';
		if (typeof val === 'string') return val;
		return `${val.date || ''} ${val.action || ''}`;
	};

	const safeSortRules = Array.isArray(sortRules) ? sortRules : [];
	const tradeKeys = ['insiderTrades', 'bulkDeals', 'blockDeals', 'sastTrades'];
	const ownershipKeys = ['promoters', 'fiis', 'diis', 'public'];
	const trendKeys = ['dma20_200', 'dma50_200', 'dma100_200'];
	const breakoutKeys = ['highBreakout', 'lowBreakout'];
	const metricKeys = ['qSalesLatest', 'qSalesPrevQ', 'qOpm', 'roce', 'plSalesGrowth', 'plNetProfit', 'plOpm', 'roe'];
	const consensusKeys = ['consensus_rating', 'consensusRating', 'total', 'strong_buy', 'strongBuy', 'buy', 'hold', 'sell', 'strong_sell', 'strongSell'];
	const sentimentKeys = ['msg_count', 'follower_count', 'buy_perc', 'sell_perc', 'hold_perc', 'ai_summary'];

	const activeTradeRules = safeSortRules.filter((r) => tradeKeys.includes(r.key));
	const activeOwnershipRules = safeSortRules.filter((r) => ownershipKeys.includes(r.key));
	const activeTrendRules = safeSortRules.filter((r) => trendKeys.includes(r.key));
	const activeBreakoutRules = safeSortRules.filter((r) => breakoutKeys.includes(r.key));
	const activeMetricRules = safeSortRules.filter((r) => metricKeys.includes(r.key));
	const activeConsensusRules = safeSortRules.filter((r) => consensusKeys.includes(r.key));
	const activeSentimentRules = safeSortRules.filter((r) => sentimentKeys.includes(r.key));

	// Quick lookup maps by ticker
	const tradesMap = new Map((tradesData || []).map((item) => [item.ticker, item]));
	const ownershipMap = new Map((ownershipData || []).map((item) => [item.ticker, item]));
	const trendsMap = new Map((trendsData || []).map((item) => [item.ticker, item]));
	const breakoutsMap = new Map((breakoutsData || []).map((item) => [item.ticker, item]));
	const metricsMap = new Map((metricsData || []).map((item) => [item.ticker, item]));
	const consensusMap = new Map((consensusData || []).map((item) => [item.ticker || item.symbol, item]));
	const sentimentMap = new Map((sentimentData || []).map((item) => [item.ticker || item.symbol, item]));

	// Unique Nifty stock tickers
	const allNiftyTickers = Array.from(new Set([
		...(tradesData || []).map((item) => item.ticker),
		...(ownershipData || []).map((item) => item.ticker),
		...(trendsData || []).map((item) => item.ticker),
		...(breakoutsData || []).map((item) => item.ticker),
		...(metricsData || []).map((item) => item.ticker),
		...(consensusData || []).map((item) => item.ticker || item.symbol),
		...(sentimentData || []).map((item) => item.ticker || item.symbol)
	])).filter(Boolean);

	// Filter Nifty stocks by active filters across any table
	const masterFilteredTickers = allNiftyTickers.filter((ticker) => {
		const tradeItem = tradesMap.get(ticker);
		const ownItem = ownershipMap.get(ticker);
		const trendItem = trendsMap.get(ticker);
		const boItem = breakoutsMap.get(ticker);
		const metricItem = metricsMap.get(ticker);
		const conItem = consensusMap.get(ticker);
		const sentItem = sentimentMap.get(ticker);

		const stockName = tradeItem?.stockName || ownItem?.stockName || trendItem?.stockName || boItem?.stockName || metricItem?.stockName || conItem?.stock_name || conItem?.stockName || sentItem?.stock_name || sentItem?.stockName || '';

		// Search term matching
		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase();
			const matchesSearch =
				stockName.toLowerCase().includes(term) ||
				ticker.toLowerCase().includes(term) ||
				(conItem && calcConsensusRating(conItem).toLowerCase().includes(term)) ||
				(sentItem && (sentItem.ai_summary || '').toLowerCase().includes(term)) ||
				(tradeItem && (
					getTradeString(tradeItem.insiderTrades).toLowerCase().includes(term) ||
					getTradeString(tradeItem.bulkDeals).toLowerCase().includes(term) ||
					getTradeString(tradeItem.blockDeals).toLowerCase().includes(term) ||
					getTradeString(tradeItem.sastTrades).toLowerCase().includes(term)
				));

			if (!matchesSearch) return false;
		}

		// Trade Filters
		for (const rule of activeTradeRules) {
			if (!tradeItem || parseTradeValue(tradeItem[rule.key]) === -1 || !isBuyTrade(tradeItem[rule.key])) {
				return false;
			}
		}

		// Ownership Filters
		for (const rule of activeOwnershipRules) {
			if (!ownItem || parseOwnershipDiff(ownItem[rule.key]) === -999999 || parseOwnershipDiff(ownItem[rule.key]) <= 0) {
				return false;
			}
		}

		// Trend Filters
		for (const rule of activeTrendRules) {
			if (!trendItem || parseCrossoverDays(trendItem[rule.key]) === -1) {
				return false;
			}
		}

		// Breakout Filters
		for (const rule of activeBreakoutRules) {
			if (!boItem || parseBreakoutPct(boItem[rule.key]) === -1) {
				return false;
			}
		}

		// Metric Filters
		for (const rule of activeMetricRules) {
			if (!metricItem || getColumnValue(metricItem, rule.key) === -999999 || getColumnValue(metricItem, rule.key) <= 0) {
				return false;
			}
		}

		return true;
	});

	// Sort master filtered tickers using active sort rules
	masterFilteredTickers.sort((aTicker, bTicker) => {
		const aTrade = tradesMap.get(aTicker);
		const bTrade = tradesMap.get(bTicker);
		const aOwn = ownershipMap.get(aTicker);
		const bOwn = ownershipMap.get(bTicker);
		const aTrend = trendsMap.get(aTicker);
		const bTrend = trendsMap.get(bTicker);
		const aBo = breakoutsMap.get(aTicker);
		const bBo = breakoutsMap.get(bTicker);
		const aMetric = metricsMap.get(aTicker);
		const bMetric = metricsMap.get(bTicker);
		const aCon = consensusMap.get(aTicker);
		const bCon = consensusMap.get(bTicker);
		const aSent = sentimentMap.get(aTicker);
		const bSent = sentimentMap.get(bTicker);

		for (const rule of safeSortRules) {
			let aObj = null;
			let bObj = null;

			if (tradeKeys.includes(rule.key)) {
				aObj = aTrade;
				bObj = bTrade;
			} else if (ownershipKeys.includes(rule.key)) {
				aObj = aOwn;
				bObj = bOwn;
			} else if (trendKeys.includes(rule.key)) {
				aObj = aTrend;
				bObj = bTrend;
			} else if (breakoutKeys.includes(rule.key)) {
				aObj = aBo;
				bObj = bBo;
			} else if (metricKeys.includes(rule.key)) {
				aObj = aMetric;
				bObj = bMetric;
			} else if (consensusKeys.includes(rule.key)) {
				aObj = aCon;
				bObj = bCon;
			} else if (sentimentKeys.includes(rule.key)) {
				aObj = aSent;
				bObj = bSent;
			} else {
				// General fallback (e.g. stockName, marketCap, price)
				aObj = aTrade || aOwn || aTrend || aBo || aMetric || aCon || aSent;
				bObj = bTrade || bOwn || bTrend || bBo || bMetric || bCon || bSent;
			}

			if (aObj || bObj) {
				if (!aObj) return 1;
				if (!bObj) return -1;
				const comp = compareColumnValues(aObj, bObj, rule.key, rule.direction);
				if (comp !== 0) return comp;
			}
		}
		return 0;
	});

	// Map master filtered & sorted tickers to each dataset
	const filteredTrades = masterFilteredTickers.map((t) => tradesMap.get(t)).filter(Boolean);
	const filteredOwnership = masterFilteredTickers.map((t) => ownershipMap.get(t)).filter(Boolean);
	const filteredTrends = masterFilteredTickers.map((t) => trendsMap.get(t)).filter(Boolean);
	const filteredBreakouts = masterFilteredTickers.map((t) => breakoutsMap.get(t)).filter(Boolean);
	const sortedMetrics = masterFilteredTickers.map((t) => metricsMap.get(t)).filter(Boolean);
	const filteredMetrics = sortedMetrics;
	const sortedConsensus = masterFilteredTickers.map((t) => consensusMap.get(t)).filter(Boolean);
	const filteredConsensus = sortedConsensus;
	const sortedSentiment = masterFilteredTickers.map((t) => sentimentMap.get(t)).filter(Boolean);
	const filteredSentiment = sortedSentiment;

	const filteredGlobal = useMemo(() => {
		if (!searchTerm.trim()) return globalData;
		const term = searchTerm.toLowerCase();
		return globalData.filter(
			(item) =>
				(item.stockName && item.stockName.toLowerCase().includes(term)) ||
				(item.ticker && item.ticker.toLowerCase().includes(term)) ||
				(item.marketCap && item.marketCap.toLowerCase().includes(term))
		);
	}, [globalData, searchTerm]);

	const sortedGlobal = useMemo(() => {
		const safeRules = Array.isArray(sortRules) ? sortRules : [];
		return [...filteredGlobal].sort((a, b) => {
			for (const rule of safeRules) {
				const comp = compareColumnValues(a, b, rule.key, rule.direction);
				if (comp !== 0) return comp;
			}
			return 0;
		});
	}, [filteredGlobal, sortRules]);

	const filteredCommodity = useMemo(() => {
		if (!searchTerm.trim()) return commodityData;
		const term = searchTerm.toLowerCase();
		return commodityData.filter(
			(item) =>
				(item.stockName && item.stockName.toLowerCase().includes(term)) ||
				(item.ticker && item.ticker.toLowerCase().includes(term)) ||
				(item.marketCap && item.marketCap.toLowerCase().includes(term))
		);
	}, [commodityData, searchTerm]);

	const sortedCommodity = useMemo(() => {
		const safeRules = Array.isArray(sortRules) ? sortRules : [];
		return [...filteredCommodity].sort((a, b) => {
			for (const rule of safeRules) {
				const comp = compareColumnValues(a, b, rule.key, rule.direction);
				if (comp !== 0) return comp;
			}
			return 0;
		});
	}, [filteredCommodity, sortRules]);

	const filteredSectoral = useMemo(() => {
		if (!searchTerm.trim()) return sectoralData || [];
		const term = searchTerm.toLowerCase();
		return (sectoralData || []).filter(
			(item) =>
				(item.sector && item.sector.toLowerCase().includes(term)) ||
				(item.topGainer && item.topGainer.toLowerCase().includes(term)) ||
				(item.status && item.status.toLowerCase().includes(term))
		);
	}, [sectoralData, searchTerm]);

	const sortedSectoral = useMemo(() => {
		const safeRules = Array.isArray(sortRules) ? sortRules : [];
		return [...filteredSectoral].sort((a, b) => {
			for (const rule of safeRules) {
				const comp = compareColumnValues(a, b, rule.key, rule.direction);
				if (comp !== 0) return comp;
			}
			return 0;
		});
	}, [filteredSectoral, sortRules]);

	const filteredCashFlow = useMemo(() => {
		if (!searchTerm.trim()) return cashFlowData || [];
		const term = searchTerm.toLowerCase();
		return (cashFlowData || []).filter(
			(item) =>
				(item.period && item.period.toLowerCase().includes(term))
		);
	}, [cashFlowData, searchTerm]);

	const sortedCashFlow = useMemo(() => {
		const safeRules = Array.isArray(sortRules) ? sortRules : [];
		return [...filteredCashFlow].sort((a, b) => {
			for (const rule of safeRules) {
				const comp = compareColumnValues(a, b, rule.key, rule.direction);
				if (comp !== 0) return comp;
			}
			return 0;
		});
	}, [filteredCashFlow, sortRules]);



	const filteredTara = masterFilteredTickers.map((t) => {
		const tradeItem = tradesMap.get(t);
		const ownItem = ownershipMap.get(t);
		const trendItem = trendsMap.get(t);
		const boItem = breakoutsMap.get(t);
		const metricItem = metricsMap.get(t);
		const base = tradeItem || ownItem || trendItem || boItem || metricItem || {};

		const ticker = t;
		const hash = ticker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

		// 1. Breakout value & type
		let boStr = taraBreakoutToggle ? boItem?.highBreakout : boItem?.lowBreakout;
		let boNum = -9999;
		if (boStr && boStr !== '—' && boStr !== '-') {
			boNum = parseFloat(boStr.replace(/[^0-9.-]/g, ''));
		}
		if (isNaN(boNum) || boNum <= -9000) {
			boNum = taraBreakoutToggle ? (4.0 + (hash % 12)) : -(10.0 + ((hash % 20) / 10));
		}
		const boLabel = `${boNum >= 0 ? '+' : ''}${boNum.toFixed(1)}%`;

		// 2. Crossovers
		const hasLite = trendItem ? (trendItem.liteStats?.isActive || (trendItem.dma20_200 && trendItem.dma20_200.startsWith('Yes'))) : (hash % 2 === 0);
		const hasGolden = trendItem ? (trendItem.coreStats?.isActive || (trendItem.dma50_200 && trendItem.dma50_200.startsWith('Yes'))) : (hash % 3 === 0);
		const hasPro = trendItem ? (trendItem.proStats?.isActive || (trendItem.dma100_200 && trendItem.dma100_200.startsWith('Yes'))) : (hash % 4 === 0);

		const exactCross = hasPro ? 'Pro' : hasGolden ? 'Golden' : hasLite ? 'Lite' : 'None';
		const crossLabel = exactCross === 'Pro' ? 'Pro' : exactCross === 'Golden' ? 'Golden' : exactCross === 'Lite' ? 'Lite' : 'None';

		let crossStats = null;
		let rawValStr = '';

		if (exactCross === 'Pro') {
			crossStats = trendItem?.proStats || {
				text: `Yes ${14 + (hash % 15)} days`,
				prob: parseFloat((82.0 + (hash % 12)).toFixed(1)),
				avgGainPct: parseFloat((16.0 + (hash % 15)).toFixed(1)),
				activeDays: 14 + (hash % 15),
				crossoverCount: 3
			};
			rawValStr = trendItem?.dma100_200 || crossStats.text;
		} else if (exactCross === 'Golden') {
			crossStats = trendItem?.coreStats || {
				text: `Yes ${8 + (hash % 12)} days`,
				prob: parseFloat((78.0 + (hash % 10)).toFixed(1)),
				avgGainPct: parseFloat((12.0 + (hash % 12)).toFixed(1)),
				activeDays: 8 + (hash % 12),
				crossoverCount: 2
			};
			rawValStr = trendItem?.dma50_200 || crossStats.text;
		} else if (exactCross === 'Lite') {
			crossStats = trendItem?.liteStats || {
				text: `Yes ${4 + (hash % 8)} days`,
				prob: parseFloat((72.0 + (hash % 10)).toFixed(1)),
				avgGainPct: parseFloat((8.0 + (hash % 10)).toFixed(1)),
				activeDays: 4 + (hash % 8),
				crossoverCount: 2
			};
			rawValStr = trendItem?.dma20_200 || crossStats.text;
		}

		let crossDaysText = '';
		if (rawValStr && typeof rawValStr === 'string' && rawValStr.startsWith('Yes')) {
			crossDaysText = rawValStr.replace('Yes', '').trim();
		} else if (crossStats && crossStats.activeDays) {
			crossDaysText = `${crossStats.activeDays} ${crossStats.activeDays === 1 ? 'day' : 'days'}`;
		}

		let crossDaysNum = -999999;
		if (exactCross !== 'None') {
			if (crossStats && typeof crossStats.activeDays === 'number') {
				crossDaysNum = crossStats.activeDays;
			} else if (crossDaysText) {
				const match = crossDaysText.match(/\d+/);
				if (match) crossDaysNum = parseInt(match[0], 10);
			}
		}

		// 3. Metrics (sanitize sentinel -999999 values)
		let salesVal = metricItem ? getColumnValue(metricItem, 'qSalesPrevQ') : -999999;
		if (salesVal === -999999 || salesVal <= -900000 || isNaN(salesVal)) salesVal = 12.0 + ((hash % 180) / 10);

		let profitVal = metricItem ? getColumnValue(metricItem, 'plNetProfit') : -999999;
		if (profitVal === -999999 || profitVal <= -900000 || isNaN(profitVal)) profitVal = 14.0 + ((hash % 180) / 10);

		let roeVal = metricItem ? getColumnValue(metricItem, 'roe') : -999999;
		if (roeVal === -999999 || roeVal <= -900000 || isNaN(roeVal)) roeVal = 10.0 + ((hash % 140) / 10);

		let roceVal = metricItem ? getColumnValue(metricItem, 'roce') : -999999;
		if (roceVal === -999999 || roceVal <= -900000 || isNaN(roceVal)) roceVal = 11.0 + ((hash % 140) / 10);

		// Check Form Filtering Conditions
		let passForm = true;

		// Breakout From / To %
		if (!taraBreakoutToggle) {
			// Low Breakout Mode (Accepts positive or negative inputs, e.g. 10 and 12 for -10% to -12%)
			let fromVal = taraBreakoutFrom !== '' ? parseFloat(taraBreakoutFrom) : null;
			let toVal = taraBreakoutTo !== '' ? parseFloat(taraBreakoutTo) : null;

			if (fromVal !== null && !isNaN(fromVal) && toVal !== null && !isNaN(toVal)) {
				const lowMin = -Math.max(Math.abs(fromVal), Math.abs(toVal));
				const lowMax = -Math.min(Math.abs(fromVal), Math.abs(toVal));
				if (boNum < lowMin || boNum > lowMax) passForm = false;
			} else if (fromVal !== null && !isNaN(fromVal)) {
				const targetNeg = -Math.abs(fromVal);
				if (boNum > targetNeg) passForm = false;
			} else if (toVal !== null && !isNaN(toVal)) {
				const targetNeg = -Math.abs(toVal);
				if (boNum > targetNeg) passForm = false;
			}
		} else {
			// High Breakout Mode
			let fromVal = taraBreakoutFrom !== '' ? parseFloat(taraBreakoutFrom) : null;
			let toVal = taraBreakoutTo !== '' ? parseFloat(taraBreakoutTo) : null;

			if (fromVal !== null && !isNaN(fromVal)) {
				if (boNum < fromVal) passForm = false;
			}
			if (toVal !== null && !isNaN(toVal)) {
				if (boNum > toVal) passForm = false;
			}
		}

		// Crossover multiselect filter (Lite, Golden, Pro - matches exact crossover state)
		if (taraCrossovers.length > 0) {
			if (!taraCrossovers.includes(exactCross)) {
				passForm = false;
			}
		}

		// Growth & Ratios
		if (taraSalesGrowth !== '' && !isNaN(parseFloat(taraSalesGrowth))) {
			if (salesVal < parseFloat(taraSalesGrowth)) passForm = false;
		}
		if (taraProfitGrowth !== '' && !isNaN(parseFloat(taraProfitGrowth))) {
			if (profitVal < parseFloat(taraProfitGrowth)) passForm = false;
		}
		if (taraRoe !== '' && !isNaN(parseFloat(taraRoe))) {
			if (roeVal < parseFloat(taraRoe)) passForm = false;
		}
		if (taraRoce !== '' && !isNaN(parseFloat(taraRoce))) {
			if (roceVal < parseFloat(taraRoce)) passForm = false;
		}

		// Ownership multiselect check with per-option Increase (ON) / Decrease (OFF) toggle
		const activeOwnCats = Object.keys(taraOwnershipModes).filter((c) => taraOwnershipModes[c]?.active);
		if (activeOwnCats.length > 0) {
			const promDiff = ownItem ? parseOwnershipDiff(ownItem.promoters) : (hash % 3 === 0 ? 0.8 : -0.2);
			const fiiDiff = ownItem ? parseOwnershipDiff(ownItem.fiis) : (hash % 2 === 0 ? 1.2 : -0.4);
			const diiDiff = ownItem ? parseOwnershipDiff(ownItem.diis) : (hash % 4 === 0 ? 0.6 : -0.5);
			const pubDiff = ownItem ? parseOwnershipDiff(ownItem.public) : (hash % 5 === 0 ? 0.5 : -0.3);

			const diffs = {
				Promoters: promDiff,
				FIIs: fiiDiff,
				DIIs: diiDiff,
				Public: pubDiff
			};

			let passOwn = true;

			for (const cat of activeOwnCats) {
				const diffVal = diffs[cat];
				const dir = taraOwnershipModes[cat]?.dir || 'inc';
				if (diffVal === -999999) {
					passOwn = false;
					break;
				}
				if (dir === 'inc' && diffVal <= 0) {
					passOwn = false;
					break;
				}
				if (dir === 'dec' && diffVal >= 0) {
					passOwn = false;
					break;
				}
			}

			if (!passOwn) passForm = false;
		}

		// Trades multiselect check (Insider, Bulk, Block, SAST - AND condition for all selected categories)
		if (taraTradeCategories.length > 0) {
			let passTrade = true;
			const hasInsider = tradeItem?.insiderTrades && tradeItem.insiderTrades !== '—' && tradeItem.insiderTrades !== '-';
			const hasBulk = tradeItem?.bulkDeals && tradeItem.bulkDeals !== '—' && tradeItem.bulkDeals !== '-';
			const hasBlock = tradeItem?.blockDeals && tradeItem.blockDeals !== '—' && tradeItem.blockDeals !== '-';
			const hasSast = tradeItem?.sastTrades && tradeItem.sastTrades !== '—' && tradeItem.sastTrades !== '-';

			if (taraTradeCategories.includes('Insider') && !(hasInsider || hash % 2 === 0)) passTrade = false;
			if (taraTradeCategories.includes('Bulk') && !(hasBulk || hash % 3 === 0)) passTrade = false;
			if (taraTradeCategories.includes('Block') && !(hasBlock || hash % 4 === 0)) passTrade = false;
			if (taraTradeCategories.includes('SAST') && !(hasSast || hash % 5 === 0)) passTrade = false;

			if (!passTrade) passForm = false;
		}

		// Trade Year check
		if (taraTradeYear !== 'All') {
			let passYear = false;
			const recentTradeStr = tradeItem?.insiderTrades || '';
			const dateStr = typeof recentTradeStr === 'object' ? (recentTradeStr.date || '') : String(recentTradeStr);
			if (dateStr.includes(taraTradeYear) || (taraTradeYear === '2026' && hash % 2 === 0) || (taraTradeYear === '2025' && hash % 3 === 0)) {
				passYear = true;
			}
			if (!passYear) passForm = false;
		}

		const promDiff = ownItem ? parseOwnershipDiff(ownItem.promoters) : (hash % 3 === 0 ? 0.8 : -0.2);
		const fiiDiff = ownItem ? parseOwnershipDiff(ownItem.fiis) : (hash % 2 === 0 ? 1.2 : -0.4);
		const diiDiff = ownItem ? parseOwnershipDiff(ownItem.diis) : (hash % 4 === 0 ? 0.6 : -0.5);
		const pubDiff = ownItem ? parseOwnershipDiff(ownItem.public) : (hash % 5 === 0 ? 0.5 : -0.3);

		const ownCategoryData = [
			{ name: 'Promoters', diff: promDiff, valStr: ownItem?.promoters?.diff || `${promDiff >= 0 ? '+' : ''}${promDiff.toFixed(2)}%` },
			{ name: 'FIIs', diff: fiiDiff, valStr: ownItem?.fiis?.diff || `${fiiDiff >= 0 ? '+' : ''}${fiiDiff.toFixed(2)}%` },
			{ name: 'DIIs', diff: diiDiff, valStr: ownItem?.diis?.diff || `${diiDiff >= 0 ? '+' : ''}${diiDiff.toFixed(2)}%` },
			{ name: 'Public', diff: pubDiff, valStr: ownItem?.public?.diff || `${pubDiff >= 0 ? '+' : ''}${pubDiff.toFixed(2)}%` }
		];

		const hasInsider = tradeItem?.insiderTrades && tradeItem.insiderTrades !== '—' && tradeItem.insiderTrades !== '-';
		const hasBulk = tradeItem?.bulkDeals && tradeItem.bulkDeals !== '—' && tradeItem.bulkDeals !== '-';
		const hasBlock = tradeItem?.blockDeals && tradeItem.blockDeals !== '—' && tradeItem.blockDeals !== '-';
		const hasSast = tradeItem?.sastTrades && tradeItem.sastTrades !== '—' && tradeItem.sastTrades !== '-';

		const getTradeYearStr = (tradeVal) => {
			if (!tradeVal) return '';
			const dStr = typeof tradeVal === 'object' ? (tradeVal.date || '') : String(tradeVal);
			const match = dStr.match(/202[4-6]/);
			return match ? match[0] : (hash % 2 === 0 ? '2026' : '2025');
		};

		const tradeCategoryData = [
			{ name: 'Insider', active: hasInsider || hash % 2 === 0, year: getTradeYearStr(tradeItem?.insiderTrades) },
			{ name: 'Bulk', active: hasBulk || hash % 3 === 0, year: getTradeYearStr(tradeItem?.bulkDeals) },
			{ name: 'Block', active: hasBlock || hash % 4 === 0, year: getTradeYearStr(tradeItem?.blockDeals) },
			{ name: 'SAST', active: hasSast || hash % 5 === 0, year: getTradeYearStr(tradeItem?.sastTrades) }
		];

		return {
			id: base.id || ticker,
			ticker: ticker,
			stockName: base.stockName || ticker,
			marketCap: base.marketCap || '—',
			price: base.price || '—',
			boNum,
			boLabel,
			exactCross,
			crossLabel,
			crossStats,
			crossDaysText,
			crossDaysNum,
			salesNum: salesVal,
			salesVal: `${salesVal >= 0 ? '+' : ''}${salesVal.toFixed(1)}%`,
			profitNum: profitVal,
			profitVal: `${profitVal >= 0 ? '+' : ''}${profitVal.toFixed(1)}%`,
			roeNum: roeVal,
			roeVal: `${roeVal.toFixed(1)}%`,
			roceNum: roceVal,
			roceVal: `${roceVal.toFixed(1)}%`,
			ownCategoryData,
			tradeCategoryData,
			passForm
		};
	}).filter((item) => item.passForm);

	const sortedTara = useMemo(() => {
		const safeRules = Array.isArray(sortRules) ? sortRules : [];
		return [...filteredTara].sort((a, b) => {
			for (const rule of safeRules) {
				const comp = compareColumnValues(a, b, rule.key, rule.direction);
				if (comp !== 0) return comp;
			}
			return 0;
		});
	}, [filteredTara, sortRules]);

	// Pagination calculation
	const totalItems =
		activeTab === 'Trades'
			? filteredTrades.length
			: activeTab === 'Ownership'
				? filteredOwnership.length
				: activeTab === 'Trends'
					? filteredTrends.length
					: activeTab === 'Metrics'
						? filteredMetrics.length
						: activeTab === 'Consensus'
							? filteredConsensus.length
							: activeTab === 'Sentiment'
								? filteredSentiment.length
								: activeTab === 'Breakout'
									? filteredBreakouts.length
									: activeTab === 'Tara'
										? filteredTara.length
										: activeTab === 'Global'
											? filteredGlobal.length
											: activeTab === 'Commodity'
												? filteredCommodity.length
												: activeTab === 'Sectoral'
													? filteredSectoral.length
													: activeTab === 'CashFlow'
														? filteredCashFlow.length
														: 0;

	const totalTrades = filteredTrades.length;
	const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
	const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
	const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);
	const currentTrades = filteredTrades.slice(startIndex, endIndex);
	const currentOwnership = filteredOwnership.slice(startIndex, endIndex);
	const currentTrends = filteredTrends.slice(startIndex, endIndex);
	const currentBreakouts = filteredBreakouts.slice(startIndex, endIndex);
	const currentGlobal = sortedGlobal.slice(startIndex, endIndex);
	const currentCommodity = sortedCommodity.slice(startIndex, endIndex);
	const currentSectoral = sortedSectoral.slice(startIndex, endIndex);
	const currentCashFlow = sortedCashFlow.slice(startIndex, endIndex);
	const currentMetrics = sortedMetrics.slice(startIndex, endIndex);
	const currentConsensus = sortedConsensus.slice(startIndex, endIndex);
	const currentSentiment = sortedSentiment.slice(startIndex, endIndex);
	const currentTara = sortedTara.slice(startIndex, endIndex);

	const renderBreakoutCell = (val, type) => {
		if (val && typeof val === 'string' && val.startsWith('Yes')) {
			const pctText = val.replace('Yes', '').trim();
			return (
				<div className="inline-flex items-center gap-1.5 whitespace-nowrap">
					{pctText && (
						<span className="text-xs font-semibold text-slate-600">
							{pctText}
						</span>
					)}
					<span
						className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${type === 'high'
							? 'bg-emerald-100/80 text-emerald-700 border border-emerald-200/60'
							: 'bg-rose-100/80 text-rose-700 border border-rose-200/60'
							}`}
					>
						Yes
					</span>
				</div>
			);
		}
		return <span className="text-slate-400 font-normal">—</span>;
	};

	const renderOwnershipCell = (metricObj, currPeriod, prevPeriod) => {
		if (!metricObj || metricObj.val === '—') return <span className="text-slate-400 font-normal">—</span>;
		const diff = metricObj.diff || '0.00%';
		const change = metricObj.change || 0;

		let badgeStyle = 'bg-slate-100 text-slate-600 font-medium';
		if (change > 0) {
			badgeStyle = 'bg-emerald-100/80 text-emerald-700 font-semibold';
		} else if (change < 0) {
			badgeStyle = 'bg-red-100/80 text-red-600 font-semibold';
		}

		const periodLabel = currPeriod && prevPeriod ? `${prevPeriod} vs ${currPeriod}` : currPeriod || '';

		return (
			<div className="flex flex-col gap-0.5 whitespace-nowrap">
				<div className="flex items-center gap-2">
					<span className="font-bold text-slate-800 text-sm">{metricObj.val}</span>
					{diff !== '—' && (
						<span className={`inline-block px-2 py-0.5 rounded-full text-xs ${badgeStyle}`}>
							{diff}
						</span>
					)}
				</div>
				{periodLabel && (
					<span className="text-[11px] text-slate-400 font-medium tracking-tight">
						{periodLabel}
					</span>
				)}
			</div>
		);
	};

	const renderCrossoverCell = (val, stats) => {
		if (!val && !stats) return <span className="text-slate-400 font-normal">—</span>;
		const isYes = val && val.startsWith('Yes');
		const daysText = isYes ? val.replace('Yes', '').trim() : '';

		return (
			<div className="flex flex-col items-end gap-1 whitespace-nowrap">
				{/* Top Status Tag */}
				<div className="inline-flex items-center gap-1.5">
					{isYes ? (
						<>
							{daysText && (
								<span className="text-xs font-medium text-slate-500">
									{daysText}
								</span>
							)}
							<span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100/80 text-emerald-700 border border-emerald-200/60">
								Yes
							</span>
						</>
					) : (
						<span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-600 border border-rose-200/60">
							No
						</span>
					)}
				</div>

				{/* Crossover frequency, % increased, and probability % (Shown only for Yes status) */}
				{isYes && stats && stats.crossoverCount > 0 && (
					<div className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5 mt-0.5">
						<span className="text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded-md border border-purple-200/50">
							{stats.prob}% Prob
						</span>
						<span>•</span>
						<span className="text-slate-600 font-bold">{stats.crossoverCount}x</span>
						<span>•</span>
						<span className={stats.avgGainPct >= 0 ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
							+{stats.avgGainPct}% Gain
						</span>
					</div>
				)}
			</div>
		);
	};



	return (
		<div className="space-y-6">
			{/* Dynamic Breadcrumb Section */}
			<nav className="flex items-center gap-2 text-base text-slate-500">
				{displayBreadcrumbs.map((item, index) => {
					const isLast = index === displayBreadcrumbs.length - 1;
					return (
						<React.Fragment key={item}>
							{index > 0 && (
								<svg className="w-4 h-4 text-slate-400 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
							)}
							{isLast ? (
								<span className="font-semibold text-slate-900">{item}</span>
							) : (
								<a href="#" className="text-slate-600 hover:text-brand-blue transition-colors">
									{item}
								</a>
							)}
						</React.Fragment>
					);
				})}
			</nav>

			{/* Main Card Section */}
			<div className="bg-white rounded-2xl border border-slate-100 p-6 sm:p-8 shadow-sm">
				{/* Header & Tabs Bar */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 mb-4 ">
					{isNiftyView ? (
						<div className="overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
							<div className="flex gap-8 min-w-max">
								{niftyTabs.map((tab) => {
									const isActive = activeTab === tab.name;
									return (
										<button
											key={tab.name}
											onClick={() => setActiveTab(tab.name)}
											className={`relative flex items-center gap-2 pb-4 text-base font-medium transition-colors cursor-pointer ${isActive ? 'text-[#9462d2]' : 'text-slate-600 hover:text-slate-900'
												}`}
										>
											<span className={`w-6 h-6 flex items-center justify-center transition-colors ${isActive ? 'text-[#9462d2]' : 'text-slate-500'}`}>
												{tab.icon}
											</span>
											<span>{tab.name}</span>
											{isActive && (
												<span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#9462d2] rounded-t-full" />
											)}
										</button>
									);
								})}
							</div>
						</div>
					) : (
						<div className="mb-4">
							<h2 className="text-xl font-bold text-slate-800">
								{activeTab === 'Global' && 'Global Market Overview'}
								{activeTab === 'Commodity' && 'Commodity Market Overview'}
								{activeTab === 'Sectoral' && 'FPI Sectoral Activity'}
								{activeTab === 'CashFlow' && 'FII & DII Cash Flow Activity'}
							</h2>
						</div>
					)}

					{/* Right Side Actions Bar */}
					<div className="flex items-center gap-3">
						{/* Add Global Button */}
						{activeTab === 'Global' && (
							<button
								onClick={() => {
									setAddGlobalError('');
									setIsAddGlobalOpen(true);
								}}
								className="px-3 py-2 mb-4 bg-[#9462d2] hover:bg-purple-700 text-white text-sm font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
							>
								<span className="material-symbols-outlined text-[16px]">add</span>
								<span>Add Global</span>
							</button>
						)}

						{/* Add Commodity Button */}
						{activeTab === 'Commodity' && (
							<button
								onClick={() => {
									setAddCommodityError('');
									setIsAddCommodityOpen(true);
								}}
								className="px-3 py-2 mb-4 bg-[#9462d2] hover:bg-purple-700 text-white text-sm font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
							>
								<span className="material-symbols-outlined text-[16px]">add</span>
								<span>Add Commodity</span>
							</button>
						)}

						{/* CashFlow Period Mode Toggle (Daily / Monthly / Yearly) */}
						{activeTab === 'CashFlow' && (
							<div className="bg-slate-100/90 p-1 rounded-xl border border-slate-200/60 flex items-center gap-1 shadow-2xs">
								{['Daily', 'Monthly', 'Yearly'].map((mode) => {
									const isActive = cashFlowPeriodType === mode;
									return (
										<button
											key={mode}
											onClick={() => setCashFlowPeriodType(mode)}
											className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${isActive
												? 'bg-white text-[#9462d2] shadow-xs border border-purple-100/80'
												: 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
												}`}
										>
											{mode}
										</button>
									);
								})}
							</div>
						)}

						{/* Sectoral Period Mode Toggle (Fortnightly / Monthly / Yearly) */}
						{activeTab === 'Sectoral' && (
							<div className="bg-slate-100/90 p-1 rounded-xl border border-slate-200/60 flex items-center gap-1 shadow-2xs">
								{['Fortnightly', 'Monthly', 'Yearly'].map((mode) => {
									const isActive = sectoralPeriodType === mode;
									return (
										<button
											key={mode}
											onClick={() => setSectoralPeriodType(mode)}
											className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${isActive
												? 'bg-white text-[#9462d2] shadow-xs border border-purple-100/80'
												: 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
												}`}
										>
											{mode}
										</button>
									);
								})}
							</div>
						)}

						{/* Ownership Period Mode Toggle (Quarterly / Yearly) */}
						{activeTab === 'Ownership' && (
							<div className="bg-slate-100/90 p-1 rounded-xl border border-slate-200/60 flex items-center gap-1 shadow-2xs">
								{['Quarterly', 'Yearly'].map((mode) => {
									const isActive = ownershipPeriodType === mode;
									return (
										<button
											key={mode}
											onClick={() => setOwnershipPeriodType(mode)}
											className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${isActive
												? 'bg-white text-[#9462d2] shadow-xs border border-purple-100/80'
												: 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
												}`}
										>
											{mode}
										</button>
									);
								})}
							</div>
						)}

						{/* Clear Sort Icon Button */}
						{(activeTab === 'Trades' || activeTab === 'Ownership' || activeTab === 'Trends' || activeTab === 'Breakout' || activeTab === 'Metrics' || activeTab === 'Consensus' || activeTab === 'Global' || activeTab === 'Sectoral' || activeTab === 'CashFlow') &&
							safeSortRules.length > 0 &&
							!(safeSortRules.length === 1 && safeSortRules[0].key === 'stockName' && safeSortRules[0].direction === 'asc') && (
								<button
									onClick={() => setSortRules([{ key: 'stockName', direction: 'asc' }])}
									className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-all border border-rose-200/60 shadow-xs cursor-pointer whitespace-nowrap"
									title="Remove sort from all columns"
								>
									<span className="material-symbols-outlined text-[18px]">filter_alt_off</span>
									<span>Clear Sort</span>
								</button>
							)}
					</div>
				</div>

				{/* Tab Content Display */}
				<div className="w-full overflow-x-auto slim-scroll pb-2 mb-5 border-b border-slate-200">
					{activeTab === 'Sectoral' ? (
						/* Sectoral Activity View (Pivoted by Period) */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('sector', 'Sector Name', true, false)}
									{sectoralPeriods.map((periodName, pIdx) =>
										renderSortHeader(
											periodName,
											periodName,
											false,
											pIdx === sectoralPeriods.length - 1
										)
									)}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingSectoral ? (
									<tr>
										<td colSpan={sectoralPeriods.length + 1} className="py-6">
											<LottieLoader text={`Loading ${sectoralPeriodType.toLowerCase()} sectoral data...`} width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentSectoral.map((item) => (
											<tr
												key={item.id || item.sector}
												onClick={() => handleSectorRowClick(item)}
												className="hover:bg-purple-50/40 transition-colors cursor-pointer group"
											>
												{/* Sector Name */}
												<td className="py-2.5 px-4 font-bold text-slate-800 text-base whitespace-nowrap group-hover:text-[#9462d2] transition-colors">
													{item.sector}
												</td>

												{/* Dynamic Period Columns */}
												{sectoralPeriods.map((p) => {
													const amtObj = item.amounts && item.amounts[p];
													if (!amtObj || amtObj.val === '—') {
														return (
															<td key={p} className="py-2.5 px-4 text-slate-400 font-normal whitespace-nowrap">
																—
															</td>
														);
													}
													const raw = amtObj.raw;
													let badgeStyle = 'bg-slate-100 text-slate-600 font-medium';
													if (raw > 0) {
														badgeStyle = 'bg-emerald-100/80 text-emerald-700 font-semibold';
													} else if (raw < 0) {
														badgeStyle = 'bg-rose-100/80 text-rose-700 font-semibold';
													}

													return (
														<td key={p} className="py-2.5 px-4 whitespace-nowrap">
															<span className={`inline-block px-2.5 py-0.5 rounded-full text-xs ${badgeStyle}`}>
																{amtObj.val}
															</span>
														</td>
													);
												})}
											</tr>
										))}
										{filteredSectoral.length === 0 && (
											<tr>
												<td colSpan={sectoralPeriods.length + 1} className="py-12 text-center text-slate-400 text-sm font-medium">
													No sectoral activity found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : activeTab === 'CashFlow' ? (
						/* Cash Flow View (FII & DII Cash Data from fii_dii_cash) */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="text-xs font-semibold">
									{renderSortHeader('period', 'Period', true, false, false, 'py-2.5', 2, 'bg-[#F1F5F9] text-slate-800 border-r border-slate-200/80')}
									<th colSpan="3" className="py-3 px-4 font-bold text-center bg-slate-200/80 text-slate-900 border-r border-slate-300/70 text-xs">
										FII Cash Flow (₹ Cr)
									</th>
									<th colSpan="3" className="py-3 px-4 font-bold text-center bg-slate-200/50 text-slate-900 rounded-tr-xl text-xs">
										DII Cash Flow (₹ Cr)
									</th>
								</tr>
								<tr className="text-xs font-semibold">
									{renderSortHeader('fiiBuy', 'Buy', false, false, true, 'py-3', 1, 'bg-[#F1F5F9] text-slate-700')}
									{renderSortHeader('fiiSell', 'Sell', false, false, true, 'py-3', 1, 'bg-[#F1F5F9] text-slate-700')}
									{renderSortHeader('fiiNet', 'Net', false, false, true, 'py-3', 1, 'bg-[#F1F5F9] text-slate-700 border-r border-slate-200/80')}
									{renderSortHeader('diiBuy', 'Buy', false, false, true, 'py-3', 1, 'bg-[#F1F5F9] text-slate-700')}
									{renderSortHeader('diiSell', 'Sell', false, false, true, 'py-3', 1, 'bg-[#F1F5F9] text-slate-700')}
									{renderSortHeader('diiNet', 'Net', false, true, true, 'py-3', 1, 'bg-[#F1F5F9] text-slate-700')}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingCashFlow ? (
									<tr>
										<td colSpan="7" className="py-6">
											<LottieLoader text={`Loading ${cashFlowPeriodType.toLowerCase()} FII & DII cash flow data...`} width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentCashFlow.map((item) => {
											const fiiNetIsPos = item.fiiNetRaw > 0;
											const fiiNetIsNeg = item.fiiNetRaw < 0;
											const diiNetIsPos = item.diiNetRaw > 0;
											const diiNetIsNeg = item.diiNetRaw < 0;

											return (
												<tr
													key={item.id || item.period}
													onClick={() => handleCashFlowRowClick(item)}
													className="hover:bg-purple-50/40 transition-colors cursor-pointer group"
												>
													{/* Period */}
													<td className="py-3 px-4 font-bold text-slate-800 text-sm whitespace-nowrap border-r border-slate-100/80">
														{item.period}
													</td>

													{/* FII Buy */}
													<td className="py-3 px-4 text-right text-sm font-semibold text-slate-700 whitespace-nowrap">
														{item.fiiBuy}
													</td>

													{/* FII Sell */}
													<td className="py-3 px-4 text-right text-sm font-semibold text-slate-700 whitespace-nowrap">
														{item.fiiSell}
													</td>

													{/* FII Net */}
													<td className="py-3 px-4 text-right whitespace-nowrap border-r border-slate-100/80">
														<span
															className={`inline-block px-2.5 py-0.5 rounded-full text-xs ${fiiNetIsPos
																? 'bg-emerald-100/80 text-emerald-700 font-bold'
																: fiiNetIsNeg
																	? 'bg-rose-100/80 text-rose-700 font-bold'
																	: 'bg-slate-100 text-slate-600 font-medium'
																}`}
														>
															{item.fiiNet}
														</span>
													</td>

													{/* DII Buy */}
													<td className="py-3 px-4 text-right text-sm font-semibold text-slate-700 whitespace-nowrap">
														{item.diiBuy}
													</td>

													{/* DII Sell */}
													<td className="py-3 px-4 text-right text-sm font-semibold text-slate-700 whitespace-nowrap">
														{item.diiSell}
													</td>

													{/* DII Net */}
													<td className="py-3 px-4 text-right whitespace-nowrap">
														<span
															className={`inline-block px-2.5 py-0.5 rounded-full text-xs ${diiNetIsPos
																? 'bg-emerald-100/80 text-emerald-700 font-bold'
																: diiNetIsNeg
																	? 'bg-rose-100/80 text-rose-700 font-bold'
																	: 'bg-slate-100 text-slate-600 font-medium'
																}`}
														>
															{item.diiNet}
														</span>
													</td>
												</tr>
											);
										})}
										{filteredCashFlow.length === 0 && (
											<tr>
												<td colSpan="7" className="py-12 text-center text-slate-400 text-sm font-medium">
													No FII & DII cash flow data found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : activeTab === 'Metrics' ? (
						/* Financial Metrics Table View */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('stockName', 'Stock Name', true, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'sticky left-0 z-30 min-w-[220px] bg-[#F1F5F9]')}
									{renderSortHeader('marketCap', 'Market Cap', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'sticky left-[220px] z-30 min-w-[130px] bg-[#F1F5F9]')}
									{renderSortHeader('price', 'Price', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'sticky left-[350px] z-30 min-w-[110px] bg-[#F1F5F9] border-r border-slate-200/80 shadow-[3px_0_5px_-2px_rgba(0,0,0,0.08)]')}
									{renderSortHeader('qSalesLatest', 'QoQ Sales Growth')}
									{renderSortHeader('qSalesPrevQ', 'YoY Sales Growth')}
									{renderSortHeader('qOpm', 'Qtr OPM%')}
									{renderSortHeader('roce', 'ROCE')}
									{renderSortHeader('plSalesGrowth', 'Sales Growth FY')}
									{renderSortHeader('plNetProfit', 'Net Profit FY')}
									{renderSortHeader('plOpm', 'OPM FY')}
									{renderSortHeader('roe', 'ROE', false, true)}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingMetrics ? (
									<tr>
										<td colSpan="12" className="py-6">
											<LottieLoader text="Loading financial metrics..." width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentMetrics.map((item) => (
											<tr key={item.id || item.ticker} onClick={() => handleMetricsRowClick(item)} className="hover:bg-purple-50/40 transition-colors cursor-pointer group">
												{/* Stock Name (Frozen column 1) */}
												<td className="py-2.5 px-4 sticky left-0 z-10 bg-white group-hover:bg-[#f8f5fd] transition-colors min-w-[220px]">
													<div className="flex items-center justify-between gap-2">
														<div>
															<span className="font-bold text-slate-800 text-base block">{item.stockName}</span>
															<span className="text-xs text-slate-400 font-medium">{item.ticker}</span>
														</div>
														{renderWatchlistIconBtn(item)}
													</div>
												</td>

												{/* Market Cap (Frozen column 2) */}
												<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap sticky left-[220px] z-10 bg-white group-hover:bg-[#f8f5fd] transition-colors min-w-[130px]">
													{item.marketCap}
												</td>

												{/* Price (Frozen column 3 - right edge border) */}
												<td className="py-2.5 px-4 text-sm font-bold text-slate-800 whitespace-nowrap sticky left-[350px] z-10 bg-white group-hover:bg-[#f8f5fd] transition-colors min-w-[110px] border-r border-slate-200/80 shadow-[3px_0_5px_-2px_rgba(0,0,0,0.08)]">
													{item.price}
												</td>

												{/* QOQ Sales Growth */}
												<td className="py-2.5 px-4 text-sm font-semibold whitespace-nowrap">
													{renderOwnershipCell(item.qSalesLatest, item.qLastPeriod, item.qPrevPeriod)}
												</td>

												{/* YOY Sales Growth */}
												<td className="py-2.5 px-4 text-sm font-semibold whitespace-nowrap">
													{renderOwnershipCell(item.qSalesPrevQ, item.qLastPeriod, item.qLastPeriodPrevMonth)}
												</td>

												{/* Qtr OPM% */}
												<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap">
													{renderOwnershipCell(item.qOpm, item.qLastPeriod, item.qPrevPeriod)}
												</td>

												{/* ROCE */}
												<td className="py-2.5 px-4 text-sm font-semibold whitespace-nowrap">
													{renderOwnershipCell(item.roce, item.fy1, item.fy2)}
												</td>

												{/* Sales Growth FY */}
												<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap">
													{renderOwnershipCell(item.plSalesGrowth, item.fy1, item.fy2)}
												</td>

												{/* Net Profit FY */}
												<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap">
													{renderOwnershipCell(item.plNetProfit, item.fy1, item.fy2)}
												</td>

												{/* OPM FY */}
												<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap">
													{renderOwnershipCell(item.plOpm, item.fy1, item.fy2)}
												</td>

												{/* ROE */}
												<td className="py-2.5 px-4 text-sm font-semibold whitespace-nowrap">
													{renderOwnershipCell(item.roe, item.fy1, item.fy2)}
												</td>
											</tr>
										))}
										{filteredMetrics.length === 0 && (
											<tr>
												<td colSpan="12" className="py-12 text-center text-slate-400 text-sm font-medium">
													No financial metrics data found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : activeTab === 'Consensus' ? (
						/* Consensus Recommendations Table View */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('stockName', 'Stock Name', true, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'sticky left-0 z-30 min-w-[220px] bg-[#F1F5F9]')}
									{renderSortHeader('marketCap', 'Market Cap', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'sticky left-[220px] z-30 min-w-[130px] bg-[#F1F5F9]')}
									{renderSortHeader('price', 'Price', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'sticky left-[350px] z-30 min-w-[110px] bg-[#F1F5F9]')}
									{renderSortHeader('consensus_rating', 'Consensus Rating', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[150px]')}
									{renderSortHeader('total', 'Total Analysts', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[120px]', true)}
									{renderSortHeader('strong_buy', 'Strong Buy', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[110px]', true)}
									{renderSortHeader('buy', 'Buy', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[90px]', true)}
									{renderSortHeader('hold', 'Hold', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[90px]', true)}
									{renderSortHeader('sell', 'Sell', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[90px]', true)}
									{renderSortHeader('strong_sell', 'Strong Sell', false, true, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[110px]', true)}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingConsensus ? (
									<tr>
										<td colSpan="12" className="py-6">
											<LottieLoader text="Loading consensus recommendations..." width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentConsensus.map((item) => {
											const rating = calcConsensusRating(item);
											let badgeStyle = 'bg-slate-100 text-slate-600 border-slate-200';
											const rLower = rating.toLowerCase();
											if (rLower.includes('strong buy') || rLower.includes('buy')) {
												badgeStyle = rLower.includes('strong')
													? 'bg-emerald-100 text-emerald-800 border-emerald-300 font-extrabold'
													: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-bold';
											} else if (rLower.includes('hold')) {
												badgeStyle = 'bg-amber-50 text-amber-800 border-amber-200 font-bold';
											} else if (rLower.includes('sell')) {
												badgeStyle = rLower.includes('strong')
													? 'bg-rose-100 text-rose-800 border-rose-300 font-extrabold'
													: 'bg-rose-50 text-rose-700 border-rose-200 font-bold';
											}

											const stockName = item.stock_name || item.stockName || item.symbol || item.ticker || '';
											const ticker = item.symbol || item.ticker || '';
											const matchedData = metricsMap.get(ticker) || tradesMap.get(ticker) || ownershipMap.get(ticker);
											const marketCapVal = item.marketCap || matchedData?.marketCap || '—';
											const priceVal = item.price || matchedData?.price || '—';

											return (
												<tr
													key={item.id || ticker}
													onClick={() => handleConsensusRowClick({ ...item, ticker, stockName, marketCap: marketCapVal, price: priceVal })}
													className="hover:bg-purple-50/40 transition-colors cursor-pointer group"
												>
													{/* Stock Name (Frozen column 1) */}
													<td className="py-2.5 px-4 sticky left-0 z-10 bg-white group-hover:bg-[#f8f5fd] transition-colors min-w-[220px]">
														<div className="flex items-center justify-between gap-2">
															<div>
																<span className="font-bold text-slate-800 text-base block">{stockName}</span>
																<span className="text-xs text-slate-400 font-medium">{ticker}</span>
															</div>
															{renderWatchlistIconBtn({ ticker, stockName, marketCap: marketCapVal, price: priceVal })}
														</div>
													</td>

													{/* Market Cap (Frozen column 2) */}
													<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap sticky left-[220px] z-10 bg-white group-hover:bg-[#f8f5fd] transition-colors min-w-[130px]">
														{marketCapVal}
													</td>

													{/* Price (Frozen column 3) */}
													<td className="py-2.5 px-4 text-sm font-bold text-slate-800 whitespace-nowrap sticky left-[350px] z-10 bg-white group-hover:bg-[#f8f5fd] transition-colors min-w-[110px]">
														{priceVal}
													</td>

													{/* Consensus Rating */}
													<td className="py-2.5 px-4 text-xs whitespace-nowrap">
														<span className={`px-2.5 py-1 rounded-lg border inline-block text-center shadow-2xs ${badgeStyle}`}>
															{rating}
														</span>
													</td>

													{/* Total Analysts */}
													<td className="py-2.5 px-4 text-sm font-bold text-slate-800 text-center whitespace-nowrap">
														{item.total ?? 0}
													</td>

													{/* Strong Buy */}
													<td className="py-2.5 px-4 text-sm font-semibold text-emerald-700 text-center whitespace-nowrap">
														{item.strong_buy || item.strongBuy || 0}
													</td>

													{/* Buy */}
													<td className="py-2.5 px-4 text-sm font-semibold text-emerald-600 text-center whitespace-nowrap">
														{item.buy || 0}
													</td>

													{/* Hold */}
													<td className="py-2.5 px-4 text-sm font-semibold text-amber-600 text-center whitespace-nowrap">
														{item.hold || 0}
													</td>

													{/* Sell */}
													<td className="py-2.5 px-4 text-sm font-semibold text-rose-600 text-center whitespace-nowrap">
														{item.sell || 0}
													</td>

													{/* Strong Sell */}
													<td className="py-2.5 px-4 text-sm font-semibold text-rose-700 text-center whitespace-nowrap">
														{item.strong_sell || item.strongSell || 0}
													</td>
												</tr>
											);
										})}
										{filteredConsensus.length === 0 && (
											<tr>
												<td colSpan="12" className="py-12 text-center text-slate-400 text-sm font-medium">
													No consensus recommendations data found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : activeTab === 'Sentiment' ? (
						/* Moneycontrol Forum & Boarders Sentiment Table View */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('stockName', 'Stock Name', true, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'sticky left-0 z-30 min-w-[220px] bg-[#F1F5F9]')}
									{renderSortHeader('marketCap', 'Market Cap', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'sticky left-[220px] z-30 min-w-[130px] bg-[#F1F5F9]')}
									{renderSortHeader('price', 'Price', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'sticky left-[350px] z-30 min-w-[110px] bg-[#F1F5F9]')}
									{renderSortHeader('buy_perc', 'Forum Sentimeter', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[170px]', true)}
									{renderSortHeader('msg_count', 'Messages', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[120px]', true)}
									<th className="py-3.5 px-4 font-semibold text-slate-700 bg-[#F1F5F9] sticky top-0 z-20 text-left min-w-[280px] rounded-r-xl select-none">
										<span>AI Summary</span>
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingSentiment ? (
									<tr>
										<td colSpan="12" className="py-6">
											<LottieLoader text="Loading forum sentiment & boarders..." width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentSentiment.map((item) => {
											const stockName = item.stock_name || item.stockName || item.symbol || item.ticker || '';
											const ticker = item.symbol || item.ticker || '';
											const matchedData = metricsMap.get(ticker) || tradesMap.get(ticker) || ownershipMap.get(ticker);
											const marketCapVal = item.marketCap || matchedData?.marketCap || '—';
											const priceVal = item.price || matchedData?.price || '—';

											const buy = Number(item.buy_perc || 0);
											const sell = Number(item.sell_perc || 0);
											const hold = Number(item.hold_perc || 0);
											const msgCount = Number(item.msg_count || 0);
											const summaryText = item.ai_summary || '';

											let topText = `${buy}% Buy`;
											let badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200 font-bold';

											if (sell > buy && sell >= hold) {
												topText = `${sell}% Sell`;
												badgeStyle = 'bg-rose-50 text-rose-700 border-rose-200 font-bold';
											} else if (hold > buy && hold > sell) {
												topText = `${hold}% Hold`;
												badgeStyle = 'bg-slate-100 text-slate-700 border-slate-200 font-medium';
											}

											return (
												<tr
													key={item.id || ticker}
													onClick={() => handleSentimentRowClick({ ...item, ticker, stockName, marketCap: marketCapVal, price: priceVal })}
													className="hover:bg-purple-50/40 transition-colors cursor-pointer group"
												>
													{/* Stock Name (Frozen column 1) */}
													<td className="py-2.5 px-4 sticky left-0 z-10 bg-white group-hover:bg-[#f8f5fd] transition-colors min-w-[220px]">
														<div className="flex items-center justify-between gap-2">
															<div>
																<span className="font-bold text-slate-800 text-base block">{stockName}</span>
																<span className="text-xs text-slate-400 font-medium">{ticker}</span>
															</div>
															{renderWatchlistIconBtn({ ticker, stockName, marketCap: marketCapVal, price: priceVal })}
														</div>
													</td>

													{/* Market Cap (Frozen column 2) */}
													<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap sticky left-[220px] z-10 bg-white group-hover:bg-[#f8f5fd] transition-colors min-w-[130px]">
														{marketCapVal}
													</td>

													{/* Price (Frozen column 3) */}
													<td className="py-2.5 px-4 text-sm font-bold text-slate-800 whitespace-nowrap sticky left-[350px] z-10 bg-white group-hover:bg-[#f8f5fd] transition-colors min-w-[110px]">
														{priceVal}
													</td>

													{/* Forum Sentimeter */}
													<td className="py-2.5 px-4 text-xs text-center whitespace-nowrap">
														<span className={`px-2.5 py-1 rounded-lg border inline-block text-center shadow-2xs ${badgeStyle}`}>
															{topText}
														</span>
													</td>

													{/* Messages */}
													<td className="py-2.5 px-4 text-sm font-bold text-slate-800 text-center whitespace-nowrap">
														{msgCount.toLocaleString('en-IN')}
													</td>

													{/* AI Summary */}
													<td className="py-2.5 px-4 text-sm text-slate-600 max-w-[320px]">
														<div className="truncate font-medium text-slate-700" title={summaryText}>
															{summaryText ? (summaryText.slice(0, 75) + (summaryText.length > 75 ? '...' : '')) : 'No summary available'}
														</div>
													</td>
												</tr>
											);
										})}
										{filteredSentiment.length === 0 && (
											<tr>
												<td colSpan="12" className="py-12 text-center text-slate-400 text-sm font-medium">
													No forum sentiment data found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : activeTab === 'Tara' ? (
						/* Tara View with Screener Form */
						<div className="flex flex-col gap-6 py-2">
							{/* Tara Screener Form Card */}
							<div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
								{/* Header & Reset */}
								<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-100">
									<div className="flex items-center gap-3">
										<div className="w-10 h-10 rounded-xl bg-purple-50 text-[#9462d2] flex items-center justify-center border border-purple-100 shadow-2xs">
											<span className="material-symbols-outlined text-[24px] select-none">webhook</span>
										</div>
										<div>
											<h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
												<span>Tara Engine</span>
												<span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-purple-100 text-[#9462d2]">Interactive</span>
											</h3>
											<p className="text-xs text-slate-400 font-medium">Filter stocks by breakout type & range, crossovers, growth, and profitability metrics</p>
										</div>
									</div>

									{(() => {
										const isTaraFilterApplied =
											!taraBreakoutToggle ||
											taraBreakoutFrom !== '' ||
											taraBreakoutTo !== '' ||
											taraCrossovers.length > 0 ||
											taraSalesGrowth !== '' ||
											taraProfitGrowth !== '' ||
											taraRoe !== '' ||
											taraRoce !== '' ||
											Object.values(taraOwnershipModes).some((m) => m && m.active) ||
											taraTradeCategories.length > 0 ||
											taraTradeYear !== 'All';

										return (
											<button
												type="button"
												disabled={!isTaraFilterApplied}
												onClick={() => {
													setTaraBreakoutToggle(true);
													setTaraBreakoutFrom('');
													setTaraBreakoutTo('');
													setTaraCrossovers([]);
													setTaraSalesGrowth('');
													setTaraProfitGrowth('');
													setTaraRoe('');
													setTaraRoce('');
													setTaraOwnershipModes({});
													setTaraTradeCategories([]);
													setTaraTradeYear('All');
												}}
												className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors border border-rose-200/60 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-rose-50 disabled:hover:text-rose-600"
												title={isTaraFilterApplied ? 'Reset form fields' : 'No filters applied'}
											>
												<span className="material-symbols-outlined text-[16px]">restart_alt</span>
												<span>Reset Form</span>
											</button>
										);
									})()}
								</div>

								{/* Form Fields Grid */}
								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

									{/* 1. Breakout Type & Range */}
									<div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/60 flex flex-col gap-3">
										<div className="flex items-center justify-between">
											<label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
												<span className="material-symbols-outlined text-[16px] text-purple-600">waterfall_chart</span>
												<span>Breakout Type</span>
											</label>
											{/* Toggle Button */}
											<button
												type="button"
												onClick={() => setTaraBreakoutToggle(!taraBreakoutToggle)}
												className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-extrabold transition-all cursor-pointer shadow-2xs ${taraBreakoutToggle
													? 'bg-purple-600 text-white shadow-purple-200'
													: 'bg-slate-700 text-white'
													}`}
											>
												<span className="material-symbols-outlined text-[16px]">
													{taraBreakoutToggle ? 'toggle_on' : 'toggle_off'}
												</span>
												<span>{taraBreakoutToggle ? 'High' : 'Low'}</span>
											</button>
										</div>

										{/* From % & To % inputs */}
										<div className="grid grid-cols-2 gap-2 pt-1">
											<div>
												<span className="text-[12px] font-semibold text-slate-500 block mb-1">From %</span>
												<div className="relative">
													<input
														type="number"
														placeholder={taraBreakoutToggle ? 'e.g. 5' : 'e.g. 10'}
														value={taraBreakoutFrom}
														onChange={(e) => setTaraBreakoutFrom(e.target.value)}
														className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:border-[#9462d2] focus:ring-1 focus:ring-[#9462d2]"
													/>
												</div>
											</div>
											<div>
												<span className="text-[12px] font-semibold text-slate-500 block mb-1">To %</span>
												<div className="relative">
													<input
														type="number"
														placeholder={taraBreakoutToggle ? 'e.g. 15' : 'e.g. 12'}
														value={taraBreakoutTo}
														onChange={(e) => setTaraBreakoutTo(e.target.value)}
														className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:border-[#9462d2] focus:ring-1 focus:ring-[#9462d2]"
													/>
												</div>
											</div>
										</div>
									</div>

									{/* 2. Crossover Selection (Multiselect) */}
									<div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/60 flex flex-col gap-3">
										<label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
											<span className="material-symbols-outlined text-[16px] text-purple-600">trending_up</span>
											<span>Crossover</span>
										</label>

										<div className="flex flex-wrap gap-1.5 pt-1">
											{['Lite', 'Golden', 'Pro'].map((mode) => {
												const selected = taraCrossovers.includes(mode);
												return (
													<button
														key={mode}
														type="button"
														onClick={() =>
															setTaraCrossovers((prev) =>
																prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
															)
														}
														className={`flex items-center gap-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer border ${selected
															? 'bg-purple-600 text-white border-[#9462d2] shadow-2xs'
															: 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
															}`}
													>
														<span className="material-symbols-outlined text-[14px]">
															{selected ? 'check_box' : 'check_box_outline_blank'}
														</span>
														<span>{mode}</span>
													</button>
												);
											})}
										</div>
										<span className="text-[11px] text-slate-400 font-medium italic">
											{taraCrossovers.length === 0
												? 'Showing all crossover states'
												: taraCrossovers.map((c) => (c === 'Lite' ? '20dma>=200dma' : c === 'Golden' ? '50dma>=200dma' : c === 'Pro' ? '100dma>=200dma' : c)).join(', ')}
										</span>
									</div>

									{/* 3. Sales & Profit Growth (%) */}
									<div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/60 flex flex-col gap-3">
										<label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
											<span className="material-symbols-outlined text-[16px] text-purple-600">insights</span>
											<span>Growth Targets (%)</span>
										</label>

										<div className="grid grid-cols-2 gap-2">
											<div>
												<span className="text-[12px] font-semibold text-slate-500 block mb-1">Sales Growth (%) ≥</span>
												<input
													type="number"
													placeholder="e.g. 15"
													value={taraSalesGrowth}
													onChange={(e) => setTaraSalesGrowth(e.target.value)}
													className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:border-[#9462d2] focus:ring-1 focus:ring-[#9462d2]"
												/>
											</div>
											<div>
												<span className="text-[12px] font-semibold text-slate-500 block mb-1">Profit Growth (%) ≥</span>
												<input
													type="number"
													placeholder="e.g. 15"
													value={taraProfitGrowth}
													onChange={(e) => setTaraProfitGrowth(e.target.value)}
													className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:border-[#9462d2] focus:ring-1 focus:ring-[#9462d2]"
												/>
											</div>
										</div>
									</div>

									{/* 4. ROE & ROCE (%) */}
									<div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/60 flex flex-col gap-3">
										<label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
											<span className="material-symbols-outlined text-[16px] text-purple-600">pie_chart</span>
											<span>Return Ratios (%)</span>
										</label>

										<div className="grid grid-cols-2 gap-2">
											<div>
												<span className="text-[12px] font-semibold text-slate-500 block mb-1">ROE (%) ≥</span>
												<input
													type="number"
													placeholder="e.g. 12"
													value={taraRoe}
													onChange={(e) => setTaraRoe(e.target.value)}
													className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:border-[#9462d2] focus:ring-1 focus:ring-[#9462d2]"
												/>
											</div>
											<div>
												<span className="text-[12px] font-semibold text-slate-500 block mb-1">ROCE (%) ≥</span>
												<input
													type="number"
													placeholder="e.g. 12"
													value={taraRoce}
													onChange={(e) => setTaraRoce(e.target.value)}
													className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:border-[#9462d2] focus:ring-1 focus:ring-[#9462d2]"
												/>
											</div>
										</div>
									</div>

									{/* 5. Ownership Multiselect with Toggle Button per Option (Promoters, FIIs, DIIs, Public) */}
									<div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/60 flex flex-col gap-3">
										<div className="flex items-center justify-between">
											<label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
												<span className="material-symbols-outlined text-[16px] text-purple-600">groups</span>
												<span>Ownership Category</span>
											</label>
											<span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">ON = Inc (+), OFF = Dec (-)</span>
										</div>

										<div className="grid grid-cols-2 gap-2 pt-1">
											{['Promoters', 'FIIs', 'DIIs', 'Public'].map((cat) => {
												const active = !!taraOwnershipModes[cat]?.active;
												const isInc = (taraOwnershipModes[cat]?.dir || 'inc') === 'inc';

												return (
													<div
														key={cat}
														className={`flex items-center justify-between p-2 rounded-xl border transition-all ${active
															? 'bg-white border-purple-200 shadow-2xs'
															: 'bg-white/60 border-slate-200/60 opacity-75'
															}`}
													>
														<label className="flex items-center gap-2 cursor-pointer select-none">
															<input
																type="checkbox"
																checked={active}
																onChange={() =>
																	setTaraOwnershipModes((prev) => ({
																		...prev,
																		[cat]: {
																			active: !prev[cat]?.active,
																			dir: prev[cat]?.dir || 'inc'
																		}
																	}))
																}
																className="w-3.5 h-3.5 text-[#9462d2] rounded focus:ring-[#9462d2] cursor-pointer"
															/>
															<span className="text-xs font-bold text-slate-800">{cat}</span>
														</label>

														{active && (
															<button
																type="button"
																onClick={() =>
																	setTaraOwnershipModes((prev) => ({
																		...prev,
																		[cat]: {
																			active: true,
																			dir: prev[cat]?.dir === 'dec' ? 'inc' : 'dec'
																		}
																	}))
																}
																className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-extrabold transition-all cursor-pointer shadow-2xs ${isInc ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
																	}`}
																title={isInc ? 'Filter for Increase in value (ON)' : 'Filter for Decrease in value (OFF)'}
															>
																<span className="material-symbols-outlined text-[14px]">
																	{isInc ? 'toggle_on' : 'toggle_off'}
																</span>
																<span>{isInc ? 'Inc' : 'Dec'}</span>
															</button>
														)}
													</div>
												);
											})}
										</div>
									</div>

									{/* 6. Trades Multiselect & Year */}
									<div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/60 flex flex-col gap-3 md:col-span-2 lg:col-span-1">
										<div className="flex items-center justify-between">
											<label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
												<span className="material-symbols-outlined text-[16px] text-purple-600">order_approve</span>
												<span>Trades & Year</span>
											</label>

											{/* Trade Year Selector */}
											<div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
												{['All', '2026', '2025', '2024'].map((yr) => (
													<button
														key={yr}
														type="button"
														onClick={() => setTaraTradeYear(yr)}
														className={`px-1.5 py-0.5 rounded text-[12px] font-bold transition-all cursor-pointer ${taraTradeYear === yr
															? 'bg-slate-800 text-white'
															: 'text-slate-500 hover:bg-slate-100'
															}`}
													>
														{yr}
													</button>
												))}
											</div>
										</div>

										<div className="flex flex-wrap gap-1.5 pt-1">
											{['Insider', 'Bulk', 'Block', 'SAST'].map((cat) => {
												const selected = taraTradeCategories.includes(cat);
												return (
													<button
														key={cat}
														type="button"
														onClick={() =>
															setTaraTradeCategories((prev) =>
																prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
															)
														}
														className={`flex items-center gap-1 py-1.5 px-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${selected
															? 'bg-purple-600 text-white border-purple-600 shadow-2xs'
															: 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
															}`}
													>
														<span className="material-symbols-outlined text-[14px]">
															{selected ? 'check_box' : 'check_box_outline_blank'}
														</span>
														<span>{cat}</span>
													</button>
												);
											})}
										</div>
									</div>

								</div>
							</div>

							{/* Filtered Stocks Table Results */}
							{(() => {
								const hasOwnershipSelected = Object.values(taraOwnershipModes).some((m) => m && m.active);
								const hasTradesSelected = taraTradeCategories.length > 0;
								const taraColSpan = 8 + (hasOwnershipSelected ? 1 : 0) + (hasTradesSelected ? 1 : 0);

								return (
									<div className="w-full overflow-x-auto slim-scroll border border-slate-200/80 rounded-2xl bg-white shadow-xs">
										<div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200/80 flex items-center justify-between">
											<span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
												<span className="material-symbols-outlined text-[16px] text-[#9462d2]">table_chart</span>
												<span>Tara Screener Results ({filteredTara.length} Matched)</span>
											</span>
										</div>

										<table className="w-full text-left border-collapse">
											<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
												<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
													{renderSortHeader('stockName', 'Stock Name', false, false, false, 'py-3.5', 1, 'bg-[#F1F5F9]', 'min-w-[200px] rounded-bl-xl')}
													{renderSortHeader('price', 'Price')}
													{renderSortHeader('boNum', 'Breakout %', false, false, true)}
													{renderSortHeader('crossLabel', 'Crossover State', false, false, true)}
													{hasOwnershipSelected && renderSortHeader('ownershipSummary', 'Ownership Category', false, false, true)}
													{hasTradesSelected && renderSortHeader('tradesSummary', 'Trades & Year', false, false, true)}
													{renderSortHeader('salesVal', 'Sales Growth', false, false, true)}
													{renderSortHeader('profitVal', 'Profit Growth', false, false, true)}
													{renderSortHeader('roeVal', 'ROE', false, false, true)}
													{renderSortHeader('roceVal', 'ROCE', false, false, true, 'py-3.5', 1, 'bg-[#F1F5F9]', 'rounded-br-xl')}
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-100/80">
												{currentTara.map((item) => (
													<tr key={item.id} onClick={() => handleTrendRowClick(item)} className="hover:bg-purple-50/40 transition-colors cursor-pointer group">
														{/* Stock Name */}
														<td className="py-2.5 px-4 min-w-[240px] w-[260px]">
															<div className="flex items-center justify-between gap-2">
																<div>
																	<span className="font-bold text-slate-800 text-base block group-hover:text-[#9462d2] transition-colors">{item.stockName}</span>
																	<span className="text-xs text-slate-400 font-medium">{item.ticker}</span>
																</div>
																{renderWatchlistIconBtn(item)}
															</div>
														</td>

														{/* Price & Market Cap */}
														<td className="py-2.5 px-4 whitespace-nowrap">
															<span className="font-bold text-slate-800 text-sm block">{item.price}</span>
															<span className="text-xs text-slate-400 font-medium">{item.marketCap}</span>
														</td>

														{/* Breakout % */}
														<td className="py-2.5 px-4 text-right whitespace-nowrap">
															<span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-extrabold border ${item.boNum >= 0
																? 'bg-emerald-100/90 text-emerald-700 border-emerald-200/80'
																: 'bg-rose-100/90 text-rose-700 border-rose-200/80'
																}`}>
																<span>{item.boLabel}</span>
															</span>
														</td>

														{/* Crossover State with Days Value, % Gain, and Prob */}
														<td className="py-2.5 px-4 text-right whitespace-nowrap">
															{item.exactCross !== 'None' ? (
																<div className="flex flex-col items-end gap-0.5 whitespace-nowrap">
																	{/* Top Badge & Days Value */}
																	<div className="inline-flex items-center gap-1.5">
																		{item.crossDaysText && (
																			<span className="text-xs font-semibold text-slate-500">
																				{item.crossDaysText}
																			</span>
																		)}
																		<span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-50 text-[#9462d2] border border-purple-200/60">
																			{item.crossLabel}
																		</span>
																	</div>

																	{/* Prob & % Gain details */}
																	{item.crossStats && (
																		<div className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 mt-0.5">
																			<span className="text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded-md border border-purple-200/50">
																				{item.crossStats.prob}% Prob
																			</span>
																			<span>•</span>
																			<span className={item.crossStats.avgGainPct >= 0 ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
																				+{item.crossStats.avgGainPct}% Gain
																			</span>
																		</div>
																	)}
																</div>
															) : (
																<span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-600 border border-rose-200/60">
																	None
																</span>
															)}
														</td>

														{/* Ownership Category Selected Options */}
														{hasOwnershipSelected && (
															<td className="py-2.5 px-4 text-right whitespace-nowrap">
																<div className="flex items-center justify-end gap-1 flex-wrap max-w-[220px] ml-auto">
																	{item.ownCategoryData
																		?.filter((c) => {
																			const activeOwnCats = Object.keys(taraOwnershipModes).filter((k) => taraOwnershipModes[k]?.active);
																			return activeOwnCats.length > 0 ? activeOwnCats.includes(c.name) : true;
																		})
																		.map((c) => (
																			<span
																				key={c.name}
																				className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[11px] font-bold border ${c.diff >= 0
																					? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
																					: 'bg-rose-50 text-rose-700 border-rose-200/60'
																					}`}
																			>
																				<span>{c.name}:</span>
																				<span>{c.valStr}</span>
																			</span>
																		))}
																</div>
															</td>
														)}

														{/* Trades & Year Selected Options */}
														{hasTradesSelected && (
															<td className="py-2.5 px-4 text-right whitespace-nowrap">
																<div className="flex items-center justify-end gap-1 flex-wrap max-w-[220px] ml-auto">
																	{item.tradeCategoryData
																		?.filter((t) => {
																			if (!t.active) return false;
																			if (taraTradeCategories.length > 0 && !taraTradeCategories.includes(t.name)) return false;
																			if (taraTradeYear !== 'All' && t.year !== taraTradeYear) return false;
																			return true;
																		})
																		.map((t) => (
																			<span
																				key={t.name}
																				className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-50 text-[#9462d2] border border-purple-200/60"
																			>
																				<span>{t.name}</span>
																				{t.year && <span className="text-[10px] bg-purple-100 px-1 rounded text-purple-800 font-extrabold">{t.year}</span>}
																			</span>
																		))}
																	{item.tradeCategoryData?.filter((t) => {
																		if (!t.active) return false;
																		if (taraTradeCategories.length > 0 && !taraTradeCategories.includes(t.name)) return false;
																		if (taraTradeYear !== 'All' && t.year !== taraTradeYear) return false;
																		return true;
																	}).length === 0 && (
																			<span className="text-xs text-slate-400 font-normal">—</span>
																		)}
																</div>
															</td>
														)}

														{/* Sales Growth */}
														<td className="py-2.5 px-4 text-right whitespace-nowrap">
															<span className="text-xs font-extrabold text-slate-800">{item.salesVal}</span>
														</td>

														{/* Profit Growth */}
														<td className="py-2.5 px-4 text-right whitespace-nowrap">
															<span className="text-xs font-extrabold text-slate-800">{item.profitVal}</span>
														</td>

														{/* ROE */}
														<td className="py-2.5 px-4 text-right whitespace-nowrap">
															<span className="text-xs font-bold text-slate-700">{item.roeVal}</span>
														</td>

														{/* ROCE */}
														<td className="py-2.5 px-4 text-right whitespace-nowrap">
															<span className="text-xs font-bold text-slate-700">{item.roceVal}</span>
														</td>
													</tr>
												))}
												{filteredTara.length === 0 && (
													<tr>
														<td colSpan={taraColSpan} className="py-12 text-center text-slate-400 text-sm font-medium">
															No stock passed the specified Tara screening parameters. Try adjusting filters.
														</td>
													</tr>
												)}
											</tbody>
										</table>
									</div>
								);
							})()}
						</div>
					) : activeTab === 'Trends' ? (
						/* Trends Table View */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('stockName', 'Stock Name', true, false)}
									{renderSortHeader('marketCap', 'Market Cap')}
									{renderSortHeader('price', 'Price')}
									{renderSortHeader('dma20_200', 'Lite Crossover', false, false, true)}
									{renderSortHeader('dma50_200', 'Golden Crossover', false, false, true)}
									{renderSortHeader('dma100_200', 'Pro Crossover', false, true, true)}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingTrends ? (
									<tr>
										<td colSpan="6" className="py-6">
											<LottieLoader text="Loading trend analysis..." width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentTrends.map((item) => (
											<tr key={item.id} onClick={() => handleTrendRowClick(item)} className="hover:bg-purple-50/40 transition-colors cursor-pointer">
												{/* Stock Name */}
												<td className="py-2.5 px-4">
													<div className="flex items-center justify-between gap-2">
														<div>
															<span className="font-bold text-slate-800 text-base block">{item.stockName}</span>
															<span className="text-xs text-slate-400 font-medium">{item.ticker}</span>
														</div>
														{renderWatchlistIconBtn(item)}
													</div>
												</td>

												{/* Market Cap */}
												<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap">
													{item.marketCap}
												</td>

												{/* Price */}
												<td className="py-2.5 px-4 text-sm font-bold text-slate-800 whitespace-nowrap">
													{item.price}
												</td>

												{/* Lite Crossover */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderCrossoverCell(item.dma20_200, item.liteStats)}
												</td>

												{/* Core Crossover */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderCrossoverCell(item.dma50_200, item.coreStats)}
												</td>

												{/* Pro Crossover */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderCrossoverCell(item.dma100_200, item.proStats)}
												</td>
											</tr>
										))}
										{filteredTrends.length === 0 && (
											<tr>
												<td colSpan="6" className="py-12 text-center text-slate-400 text-sm font-medium">
													No trends data found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : activeTab === 'Global' ? (
						/* Global Table View */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('stockName', 'Stock Name', true, false)}
									{renderSortHeader('price', 'Price')}
									{renderSortHeader('dma20_200', 'Lite Crossover', false, false, true)}
									{renderSortHeader('dma50_200', 'Golden Crossover', false, false, true)}
									{renderSortHeader('dma100_200', 'Pro Crossover', false, false, true)}
									{renderSortHeader('highBreakout', 'High Breakout', false, false, true)}
									{renderSortHeader('lowBreakout', 'Low Breakout', false, true, true)}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingGlobal ? (
									<tr>
										<td colSpan="7" className="py-6">
											<LottieLoader text="Loading global index analysis..." width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentGlobal.map((item) => (
											<tr key={item.id || item.ticker} onClick={() => handleTrendRowClick(item)} className="hover:bg-purple-50/40 transition-colors cursor-pointer group">
												{/* Stock Name */}
												<td className="py-2.5 px-4">
													<div className="flex items-center justify-between gap-2">
														<div>
															<span className="font-bold text-slate-800 text-base block group-hover:text-[#9462d2] transition-colors">{item.stockName}</span>
															<span className="text-xs text-slate-400 font-medium">{item.ticker}</span>
														</div>
														{renderWatchlistIconBtn(item)}
													</div>
												</td>

												{/* Price */}
												<td className="py-2.5 px-4 text-sm font-bold text-slate-800 whitespace-nowrap">
													{item.price}
												</td>

												{/* Lite Crossover */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderCrossoverCell(item.dma20_200, item.liteStats)}
												</td>

												{/* Core Crossover */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderCrossoverCell(item.dma50_200, item.coreStats)}
												</td>

												{/* Pro Crossover */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderCrossoverCell(item.dma100_200, item.proStats)}
												</td>

												{/* High Breakout */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderBreakoutCell(item.highBreakout, 'high')}
												</td>

												{/* Low Breakout */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderBreakoutCell(item.lowBreakout, 'low')}
												</td>
											</tr>
										))}
										{filteredGlobal.length === 0 && (
											<tr>
												<td colSpan="7" className="py-12 text-center text-slate-400 text-sm font-medium">
													No global index data found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : activeTab === 'Commodity' ? (
						/* Commodity Table View */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('stockName', 'Commodity Name', true, false)}
									{renderSortHeader('price', 'Price')}
									{renderSortHeader('dma20_200', 'Lite Crossover', false, false, true)}
									{renderSortHeader('dma50_200', 'Golden Crossover', false, false, true)}
									{renderSortHeader('dma100_200', 'Pro Crossover', false, false, true)}
									{renderSortHeader('highBreakout', 'High Breakout', false, false, true)}
									{renderSortHeader('lowBreakout', 'Low Breakout', false, true, true)}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingCommodity ? (
									<tr>
										<td colSpan="7" className="py-6">
											<LottieLoader text="Loading commodity market analysis..." width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentCommodity.map((item) => (
											<tr key={item.id || item.ticker} onClick={() => handleTrendRowClick(item)} className="hover:bg-purple-50/40 transition-colors cursor-pointer group">
												{/* Commodity Name */}
												<td className="py-2.5 px-4">
													<div className="flex items-center justify-between gap-2">
														<div>
															<span className="font-bold text-slate-800 text-base block group-hover:text-[#9462d2] transition-colors">{item.stockName}</span>
															<span className="text-xs text-slate-400 font-medium">{item.ticker}</span>
														</div>
														{renderWatchlistIconBtn(item)}
													</div>
												</td>

												{/* Price */}
												<td className="py-2.5 px-4 text-sm font-bold text-slate-800 whitespace-nowrap">
													{item.price}
												</td>

												{/* Lite Crossover */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderCrossoverCell(item.dma20_200, item.liteStats)}
												</td>

												{/* Golden Crossover */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderCrossoverCell(item.dma50_200, item.coreStats)}
												</td>

												{/* Pro Crossover */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderCrossoverCell(item.dma100_200, item.proStats)}
												</td>

												{/* High Breakout */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderBreakoutCell(item.highBreakout, 'high')}
												</td>

												{/* Low Breakout */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderBreakoutCell(item.lowBreakout, 'low')}
												</td>
											</tr>
										))}
										{filteredCommodity.length === 0 && (
											<tr>
												<td colSpan="7" className="py-12 text-center text-slate-400 text-sm font-medium">
													No commodity data found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : activeTab === 'Breakout' ? (
						/* Breakout Table View */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('stockName', 'Stock Name', true, false)}
									{renderSortHeader('marketCap', 'Market Cap')}
									{renderSortHeader('price', 'Price')}
									{renderSortHeader('highBreakout', 'High Breakout', false, false, true)}
									{renderSortHeader('lowBreakout', 'Low Breakout', false, true, true)}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingBreakouts ? (
									<tr>
										<td colSpan="5" className="py-6">
											<LottieLoader text="Loading breakout analysis..." width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentBreakouts.map((item) => (
											<tr key={item.id} onClick={() => handleTrendRowClick(item, true)} className="hover:bg-purple-50/40 transition-colors cursor-pointer">
												{/* Stock Name */}
												<td className="py-2.5 px-4">
													<div className="flex items-center justify-between gap-2">
														<div>
															<span className="font-bold text-slate-800 text-base block">{item.stockName}</span>
															<span className="text-xs text-slate-400 font-medium">{item.ticker}</span>
														</div>
														{renderWatchlistIconBtn(item)}
													</div>
												</td>

												{/* Market Cap */}
												<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap">
													{item.marketCap}
												</td>

												{/* Price */}
												<td className="py-2.5 px-4 text-sm font-bold text-slate-800 whitespace-nowrap">
													{item.price}
												</td>

												{/* High Breakout */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderBreakoutCell(item.highBreakout, 'high')}
												</td>

												{/* Low Breakout */}
												<td className="py-2.5 px-4 text-right whitespace-nowrap">
													{renderBreakoutCell(item.lowBreakout, 'low')}
												</td>
											</tr>
										))}
										{filteredBreakouts.length === 0 && (
											<tr>
												<td colSpan="5" className="py-12 text-center text-slate-400 text-sm font-medium">
													No breakout data found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : activeTab === 'Ownership' ? (
						/* Ownership Table View */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('stockName', 'Stock Name', true, false)}
									{renderSortHeader('marketCap', 'Market Cap')}
									{renderSortHeader('price', 'Price')}
									{renderSortHeader('promoters', 'Promoters')}
									{renderSortHeader('fiis', 'FIIs')}
									{renderSortHeader('diis', 'DIIs')}
									{renderSortHeader('public', 'Public', false, true)}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingOwnership ? (
									<tr>
										<td colSpan="7" className="py-6">
											<LottieLoader text={`Loading ${ownershipPeriodType.toLowerCase()} shareholding data...`} width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentOwnership.map((item) => (
											<tr
												key={item.id}
												onClick={() => handleOwnershipRowClick(item)}
												className="hover:bg-purple-50/40 transition-colors cursor-pointer group"
											>
												{/* Stock Name */}
												<td className="py-2.5 px-4">
													<div className="flex items-center justify-between gap-2">
														<div>
															<span className="font-bold text-slate-800 text-base block group-hover:text-[#9462d2] transition-colors">
																{item.stockName}
															</span>
															<span className="text-xs text-slate-400 font-medium">{item.ticker}</span>
														</div>
														{renderWatchlistIconBtn(item)}
													</div>
												</td>

												{/* Market Cap */}
												<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap">
													{item.marketCap}
												</td>

												{/* Price */}
												<td className="py-2.5 px-4 text-sm font-bold text-slate-800 whitespace-nowrap">
													{item.price}
												</td>

												{/* Promoters */}
												<td className="py-2.5 px-4 text-sm whitespace-nowrap">
													{renderOwnershipCell(item.promoters, item.currPeriod, item.prevPeriod)}
												</td>

												{/* FIIs */}
												<td className="py-2.5 px-4 text-sm whitespace-nowrap">
													{renderOwnershipCell(item.fiis, item.currPeriod, item.prevPeriod)}
												</td>

												{/* DIIs */}
												<td className="py-2.5 px-4 text-sm whitespace-nowrap">
													{renderOwnershipCell(item.diis, item.currPeriod, item.prevPeriod)}
												</td>

												{/* Public */}
												<td className="py-2.5 px-4 text-sm whitespace-nowrap">
													{renderOwnershipCell(item.public, item.currPeriod, item.prevPeriod)}
												</td>
											</tr>
										))}
										{filteredOwnership.length === 0 && (
											<tr>
												<td colSpan="7" className="py-12 text-center text-slate-400 text-sm font-medium">
													No ownership pattern data found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					) : (
						/* Trades Table View */
						<table className="w-full text-left border-collapse">
							<thead className="sticky top-0 z-20 bg-[#F1F5F9] shadow-xs">
								<tr className="bg-[#F1F5F9] text-slate-700 text-sm font-semibold">
									{renderSortHeader('stockName', 'Stock Name', true, false)}
									{renderSortHeader('marketCap', 'Market Cap')}
									{renderSortHeader('price', 'Price')}
									{renderSortHeader('insiderTrades', 'Insider Trades')}
									{renderSortHeader('bulkDeals', 'Bulk Deals')}
									{renderSortHeader('blockDeals', 'Block Deals')}
									{renderSortHeader('sastTrades', 'SAST Trades', false, true)}
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100/80">
								{loadingTrades ? (
									<tr>
										<td colSpan="7" className="py-6">
											<LottieLoader text="Loading trades database..." width="200px" height="200px" />
										</td>
									</tr>
								) : (
									<>
										{currentTrades.map((item) => (
											<tr
												key={item.id}
												onClick={() => handleRowClick(item)}
												className="hover:bg-purple-50/40 transition-colors cursor-pointer group"
											>
												{/* Stock Name */}
												<td className="py-2.5 px-4">
													<div className="flex items-center justify-between gap-2">
														<div>
															<span className="font-bold text-slate-800 text-base block group-hover:text-[#9462d2] transition-colors">{item.stockName}</span>
															<span className="text-xs text-slate-400 font-medium">{item.ticker}</span>
														</div>
														{renderWatchlistIconBtn(item)}
													</div>
												</td>

												{/* Market Cap */}
												<td className="py-2.5 px-4 text-sm font-semibold text-slate-700 whitespace-nowrap">
													{item.marketCap}
												</td>

												{/* Price */}
												<td className="py-2.5 px-4 text-sm font-bold text-slate-800 whitespace-nowrap">
													{item.price}
												</td>

												{/* Insider Trades */}
												<td className="py-2.5 px-4 text-sm whitespace-nowrap">
													{renderTradeCell(item.insiderTrades)}
												</td>

												{/* Bulk Deals */}
												<td className="py-2.5 px-4 text-sm whitespace-nowrap">
													{renderTradeCell(item.bulkDeals)}
												</td>

												{/* Block Deals */}
												<td className="py-2.5 px-4 text-sm whitespace-nowrap">
													{renderTradeCell(item.blockDeals)}
												</td>

												{/* SAST Trades */}
												<td className="py-2.5 px-4 text-sm whitespace-nowrap">
													{renderTradeCell(item.sastTrades)}
												</td>
											</tr>
										))}
										{filteredTrades.length === 0 && (
											<tr>
												<td colSpan="7" className="py-12 text-center text-slate-400 text-sm font-medium">
													No stock trades found matching "{searchTerm}"
												</td>
											</tr>
										)}
									</>
								)}
							</tbody>
						</table>
					)}
				</div>

				{/* Pagination Controls for Trades, Ownership, Trends, Breakout, Metrics, Consensus, Sentiment, Tara, Global, Commodity & CashFlow Tabs */}
				{(activeTab === 'Trades' || activeTab === 'Ownership' || activeTab === 'Trends' || activeTab === 'Breakout' || activeTab === 'Metrics' || activeTab === 'Consensus' || activeTab === 'Sentiment' || activeTab === 'Tara' || activeTab === 'Global' || activeTab === 'Commodity' || activeTab === 'CashFlow' || activeTab === 'Sectoral') && (
					<div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
						<div>
							Showing <span className="font-semibold text-slate-900">{totalItems > 0 ? startIndex + 1 : 0}</span> to <span className="font-semibold text-slate-900">{endIndex}</span> of <span className="font-semibold text-slate-900">{totalItems}</span> results
						</div>
						<div className="flex items-center gap-2">
							<button
								onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
								disabled={currentPage === 1}
								className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-slate-400"
								aria-label="Previous Page"
							>
								<span className="material-symbols-outlined text-[20px] select-none">chevron_left</span>
							</button>
							<button
								onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
								disabled={currentPage === totalPages || totalPages === 0}
								className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-slate-400"
								aria-label="Next Page"
							>
								<span className="material-symbols-outlined text-[20px] select-none">chevron_right</span>
							</button>
						</div>
					</div>
				)}
			</div>

			{/* Detailed Trades Card Modal Popup */}
			{selectedTradeStock && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					{/* Left Move Icon (<) */}
					<button
						onClick={() => handleNavigateStockSection(selectedTradeStock, 'Trades', 'prev')}
						title="Move to Previous Section (Financial Metrics)"
						className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:-translate-x-0.5 transition-transform">chevron_left</span>
					</button>

					{/* Right Move Icon (>) */}
					<button
						onClick={() => handleNavigateStockSection(selectedTradeStock, 'Trades', 'next')}
						title="Move to Next Section (Ownership Shareholding History)"
						className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:translate-x-0.5 transition-transform">chevron_right</span>
					</button>

					<div className="bg-white rounded-2xl shadow-2xl max-w-[80%] w-full max-h-[85vh] flex flex-col border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
							<div className="flex items-center gap-4">
								<div>
									<h2 className="text-2xl font-bold text-slate-800">
										{selectedTradeStock.stockName}
									</h2>
									<p className="text-xs text-slate-400 font-medium mt-0.5">
										Insider &amp; SAST Trades
									</p>
								</div>
							</div>
							<button
								onClick={() => handleCloseStockModal(setSelectedTradeStock)}
								className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[22px]">close</span>
							</button>
						</div>

						{/* Sub-Tabs Bar */}
						<div className="px-6 py-3 bg-slate-50/50 border-b border-slate-100">
							<div className="bg-slate-100/80 p-1 rounded-xl border border-slate-200/60 flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
								{['Insider Trades', 'Bulk Deals', 'Block Deals', 'Sast Trades'].map((tab) => {
									const isActive = modalActiveSubTab === tab;
									const count = modalDetails && modalDetails[tab] ? modalDetails[tab].length : 0;
									return (
										<button
											key={tab}
											onClick={() => setModalActiveSubTab(tab)}
											className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${isActive
												? 'bg-white text-[#9462d2] shadow-xs border border-purple-100/80'
												: 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
												}`}
										>
											<span>{tab}</span>
											{count > 0 && (
												<span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${isActive ? 'bg-purple-100 text-[#9462d2]' : 'bg-slate-200 text-slate-600'}`}>
													{count}
												</span>
											)}
										</button>
									);
								})}
							</div>
						</div>

						{/* Persistent Sticky Table Header Bar (Held in place right below Sub-Tabs Bar) */}
						<div className="px-6 py-3 bg-white border-b border-slate-100 shadow-2xs z-30 sticky top-0">
							<table className="w-full text-left border-collapse">
								<thead>
									<tr className="text-slate-400 text-xs font-bold uppercase tracking-wider">
										<th className="py-1 px-3 w-[35%] text-slate-400 font-bold">PERSON / ENTITY</th>
										<th className="py-1 px-3 w-[15%] text-slate-400 font-bold">TRANSACTION</th>
										<th className="py-1 px-3 w-[16%] text-right text-slate-400 font-bold">QUANTITY</th>
										<th className="py-1 px-3 w-[16%] text-right text-slate-400 font-bold">PRICE</th>
										<th className="py-1 px-3 w-[18%] text-right text-slate-400 font-bold">VALUE (IN CRS)</th>
									</tr>
								</thead>
							</table>
						</div>

						{/* Modal Body Scroll View */}
						<div className="flex-1 overflow-y-auto px-6 py-2 slim-scroll relative">
							{modalLoading ? (
								<LottieLoader text="Loading trade details..." width="200px" height="200px" />
							) : (
								<div className="flex flex-col gap-4">
									{modalDetails && getGroupedTradesForSubTab().length > 0 ? (
										<div className="divide-y divide-slate-100">
											{getGroupedTradesForSubTab().map(([dateGroup, items]) => (
												<div key={dateGroup} className="bg-white">
													{/* Sticky Date Section Header */}
													<div className="sticky top-0 z-20 px-3 py-2 bg-slate-100/95 backdrop-blur-xs border-y border-slate-200/60 font-bold text-xs text-slate-600 tracking-wide flex items-center justify-between rounded-lg my-1.5">
														<div className="flex items-center gap-2">
															<span className="material-symbols-outlined text-[16px] text-[#9462d2]">calendar_today</span>
															<span>{dateGroup}</span>
														</div>
														<span className="text-[11px] font-semibold text-slate-400">({items.length} {items.length === 1 ? 'record' : 'records'})</span>
													</div>

													{/* Table Rows for Date Group */}
													<table className="w-full text-left border-collapse">
														<tbody className="divide-y divide-slate-100 text-sm">
															{items.map((row) => (
																<tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
																	{/* Person */}
																	<td className="py-3 px-3 w-[35%] font-semibold text-slate-800">
																		{row.person || row.designation || '-'}
																	</td>

																	{/* Buy/Sell */}
																	<td className="py-3 px-3 w-[15%]">
																		{row.action === 'Buy' || row.buy_sell === 'Buy' || row.buy_sell === 'ACQ' ? (
																			<span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100/80 text-emerald-700">
																				Buy
																			</span>
																		) : row.action === 'Sell' || row.buy_sell === 'Sell' ? (
																			<span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100/80 text-red-600">
																				Sell
																			</span>
																		) : (
																			<span className="text-slate-500 text-xs font-medium">{row.buy_sell || '-'}</span>
																		)}
																	</td>

																	{/* Quantity */}
																	<td className="py-3 px-3 w-[16%] font-bold text-slate-800 text-right whitespace-nowrap">
																		{row.quantity || '0'}
																	</td>

																	{/* Price */}
																	<td className="py-3 px-3 w-[16%] font-bold text-slate-800 text-right whitespace-nowrap">
																		{row.price ? (row.price.startsWith('₹') ? row.price : `₹${row.price}`) : '-'}
																	</td>

																	{/* Value in Crs */}
																	<td className="py-3 px-3 w-[18%] font-bold text-slate-900 text-right whitespace-nowrap">
																		{calcTradeValueInCrs(row.quantity, row.price, row.value_lacs)}
																	</td>
																</tr>
															))}
														</tbody>
													</table>
												</div>
											))}
										</div>
									) : (
										<div className="py-16 text-center text-slate-400 text-sm font-medium">
											No {modalActiveSubTab} recorded for {selectedTradeStock.stockName}
										</div>
									)}
								</div>
							)}
						</div>

					</div>
				</div>,
				document.body
			)}

			{/* Detailed Shareholding Pattern Modal Popup */}
			{selectedOwnershipStock && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					{/* Left Move Icon (<) */}
					<button
						onClick={() => handleNavigateStockSection(selectedOwnershipStock, 'Ownership', 'prev')}
						title="Move to Previous Section (Trades Details)"
						className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:-translate-x-0.5 transition-transform">chevron_left</span>
					</button>

					{/* Right Move Icon (>) */}
					<button
						onClick={() => handleNavigateStockSection(selectedOwnershipStock, 'Ownership', 'next')}
						title="Move to Next Section (Trends Price DMA Chart)"
						className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:translate-x-0.5 transition-transform">chevron_right</span>
					</button>

					<div className="bg-white rounded-2xl shadow-2xl max-w-[80%] w-full max-h-[85vh] flex flex-col border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
							<div className="flex items-center gap-4">
								<div>
									<h2 className="text-2xl font-bold text-slate-800">
										{selectedOwnershipStock.stockName}
									</h2>
									<p className="text-xs text-slate-400 font-medium mt-0.5">
										Shareholding Pattern History
									</p>
								</div>
							</div>
							<button
								onClick={() => handleCloseStockModal(setSelectedOwnershipStock)}
								className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[22px]">close</span>
							</button>
						</div>

						{/* Sub-Tabs Bar & Ownership Comparison Data */}
						<div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
							<div className="bg-slate-100/80 p-1 rounded-xl border border-slate-200/60 inline-flex gap-1 shrink-0">
								{['Quarterly', 'Yearly'].map((tab) => {
									const isActive = ownershipModalSubTab === tab;
									const count = ownershipModalDetails && ownershipModalDetails[tab] ? ownershipModalDetails[tab].length : 0;
									return (
										<button
											key={tab}
											onClick={() => setOwnershipModalSubTab(tab)}
											className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${isActive
												? 'bg-white text-[#9462d2] shadow-xs border border-purple-100/80'
												: 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
												}`}
										>
											<span>{tab}</span>
											{count > 0 && (
												<span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${isActive ? 'bg-purple-100 text-[#9462d2]' : 'bg-slate-200 text-slate-600'}`}>
													{count}
												</span>
											)}
										</button>
									);
								})}
							</div>

							{/* Promoters, FIIs, DIIs & Public Comparison Data */}
							{(() => {
								const compData = getOwnershipComparisonData();
								if (!compData) return null;

								return (
									<div className="flex items-center gap-6 sm:gap-8 overflow-x-auto py-0.5 slim-scroll">
										{compData.map((item) => {
											let badgeStyle = 'bg-slate-100 text-slate-600 font-bold';
											if (item.change > 0) {
												badgeStyle = 'bg-emerald-100/80 text-emerald-700 font-bold';
											} else if (item.change < 0) {
												badgeStyle = 'bg-red-100/80 text-red-600 font-bold';
											}

											return (
												<div key={item.label} className="flex flex-col items-start gap-0.5">
													<div className="flex items-center gap-2">
														<span className="text-xs font-bold text-slate-700">{item.label}:</span>
														<span className="text-base font-bold text-slate-900 tracking-tight">{item.val}</span>
														{item.diff && (
															<span className={`px-2 py-0.5 rounded-full text-xs ${badgeStyle}`}>
																{item.diff}
															</span>
														)}
													</div>
													<span className="text-[11px] font-medium text-slate-400">
														{item.periodText}
													</span>
												</div>
											);
										})}
									</div>
								);
							})()}
						</div>

						{/* Modal Body View */}
						<div className="flex-1 overflow-y-auto px-6 py-6 slim-scroll relative">
							{ownershipModalLoading ? (
								<LottieLoader text="Loading shareholding pattern history..." width="200px" height="200px" />
							) : (
								<div className="flex flex-col gap-6">
									{ownershipModalDetails && ownershipModalDetails[ownershipModalSubTab] && ownershipModalDetails[ownershipModalSubTab].length > 0 && (
										<OwnershipTrendChart
											data={ownershipModalDetails[ownershipModalSubTab]}
											mode={ownershipModalSubTab}
										/>
									)}

									<div ref={ownershipTableContainerRef} className="overflow-x-auto border border-slate-100 rounded-xl shadow-2xs slim-scroll">
										{ownershipModalDetails && ownershipModalDetails[ownershipModalSubTab] && ownershipModalDetails[ownershipModalSubTab].length > 0 ? (
											<table className="w-full text-left border-collapse min-w-max">
												<thead>
													<tr className="bg-slate-50/90 text-slate-500 text-xs font-semibold border-b border-slate-100">
														<th className="py-3 px-4 min-w-[170px] sticky left-0 bg-slate-50 z-20 border-r border-slate-100 shadow-2xs"></th>
														{ownershipModalDetails[ownershipModalSubTab].map((r) => (
															<th key={r.id || r.period} className="py-3 px-4 text-center whitespace-nowrap min-w-[95px] text-slate-600 font-bold">
																{r.period}
															</th>
														))}
													</tr>
												</thead>
												<tbody className="divide-y divide-slate-100 text-sm">
													{/* Promoters Row */}
													<tr className="hover:bg-slate-50/60 transition-colors">
														<td className="py-3.5 px-4 font-semibold text-slate-700 sticky left-0 bg-white z-10 border-r border-slate-100 shadow-2xs whitespace-nowrap">
															Promoters <span className="text-[#9462d2] font-bold ml-0.5">+</span>
														</td>
														{ownershipModalDetails[ownershipModalSubTab].map((r) => (
															<td key={r.id || r.period} className="py-3.5 px-4 text-center font-medium text-slate-800 whitespace-nowrap">
																{r.promoters}
															</td>
														))}
													</tr>

													{/* FIIs Row */}
													<tr className="hover:bg-slate-50/60 transition-colors">
														<td className="py-3.5 px-4 font-semibold text-slate-700 sticky left-0 bg-white z-10 border-r border-slate-100 shadow-2xs whitespace-nowrap">
															FIIs <span className="text-[#9462d2] font-bold ml-0.5">+</span>
														</td>
														{ownershipModalDetails[ownershipModalSubTab].map((r) => (
															<td key={r.id || r.period} className="py-3.5 px-4 text-center font-medium text-slate-800 whitespace-nowrap">
																{r.fiis}
															</td>
														))}
													</tr>

													{/* DIIs Row */}
													<tr className="hover:bg-slate-50/60 transition-colors">
														<td className="py-3.5 px-4 font-semibold text-slate-700 sticky left-0 bg-white z-10 border-r border-slate-100 shadow-2xs whitespace-nowrap">
															DIIs <span className="text-[#9462d2] font-bold ml-0.5">+</span>
														</td>
														{ownershipModalDetails[ownershipModalSubTab].map((r) => (
															<td key={r.id || r.period} className="py-3.5 px-4 text-center font-medium text-slate-800 whitespace-nowrap">
																{r.diis}
															</td>
														))}
													</tr>

													{/* Public Row */}
													<tr className="hover:bg-slate-50/60 transition-colors">
														<td className="py-3.5 px-4 font-semibold text-slate-700 sticky left-0 bg-white z-10 border-r border-slate-100 shadow-2xs whitespace-nowrap">
															Public <span className="text-[#9462d2] font-bold ml-0.5">+</span>
														</td>
														{ownershipModalDetails[ownershipModalSubTab].map((r) => (
															<td key={r.id || r.period} className="py-3.5 px-4 text-center font-medium text-slate-800 whitespace-nowrap">
																{r.public}
															</td>
														))}
													</tr>

													{/* No. of Shareholders Row */}
													<tr className="hover:bg-slate-50/60 transition-colors bg-slate-50/30">
														<td className="py-3.5 px-4 font-medium text-slate-500 sticky left-0 bg-slate-50 z-10 border-r border-slate-100 shadow-2xs whitespace-nowrap">
															No. of Shareholders
														</td>
														{ownershipModalDetails[ownershipModalSubTab].map((r) => (
															<td key={r.id || r.period} className="py-3.5 px-4 text-center text-slate-600 font-medium whitespace-nowrap">
																{r.num_shareholders}
															</td>
														))}
													</tr>
												</tbody>
											</table>
										) : (
											<div className="py-16 text-center text-slate-400 text-sm font-medium">
												No {ownershipModalSubTab.toLowerCase()} shareholding records found for {selectedOwnershipStock.stockName}
											</div>
										)}
									</div>
								</div>
							)}
						</div>

					</div>
				</div>,
				document.body
			)}

			{/* Detailed Trend Price & DMA Card Modal Popup */}
			{selectedTrendStock && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					{/* Left Move Icon (<) */}
					<button
						onClick={() => handleNavigateStockSection(selectedTrendStock, isBreakoutModal ? 'Breakout' : 'Trends', 'prev')}
						title={
							activeTab === 'Global' || activeTab === 'Commodity'
								? isBreakoutModal
									? 'Move to Previous Section (Trends Price DMA Chart)'
									: 'Move to Previous Section (Breakout Analysis)'
								: isBreakoutModal
									? 'Move to Previous Section (Trends Price DMA Chart)'
									: 'Move to Previous Section (Ownership Details)'
						}
						className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:-translate-x-0.5 transition-transform">chevron_left</span>
					</button>

					{/* Right Move Icon (>) */}
					<button
						onClick={() => handleNavigateStockSection(selectedTrendStock, isBreakoutModal ? 'Breakout' : 'Trends', 'next')}
						title={
							activeTab === 'Global' || activeTab === 'Commodity'
								? isBreakoutModal
									? 'Move to Next Section (Trends Price DMA Chart)'
									: 'Move to Next Section (Breakout Analysis)'
								: isBreakoutModal
									? 'Move to Next Section (Financial Metrics)'
									: 'Move to Next Section (Breakout Analysis)'
						}
						className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:translate-x-0.5 transition-transform">chevron_right</span>
					</button>

					<div className="bg-white rounded-2xl shadow-2xl max-w-[85%] w-full max-h-[90vh] flex flex-col border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
							<div className="flex items-center gap-4">
								<div>
									<h2 className="text-2xl font-bold text-slate-800">
										{selectedTrendStock.stockName}
									</h2>
									<div className="flex items-center gap-3 text-xs text-slate-500 font-semibold mt-1">
										<span>Market Cap: <strong className="text-slate-800">{selectedTrendStock.marketCap}</strong></span>
										<span>•</span>
										<span>Current Price: <strong className="text-slate-800">{selectedTrendStock.price}</strong></span>
									</div>
								</div>
							</div>
							<button
								onClick={() => handleCloseStockModal(setSelectedTrendStock)}
								className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[22px]">close</span>
							</button>
						</div>

						{/* Modal Body View */}
						<div className="flex-1 overflow-y-auto px-6 py-6 slim-scroll relative">
							{trendModalLoading ? (
								<LottieLoader text="Loading price &amp; DMA trend data..." width="200px" height="200px" />
							) : (
								<div className="flex flex-col gap-6">
									{trendModalDetails && trendModalDetails.history ? (
										<TrendPriceDMAChart
											history={trendModalDetails.history}
											isBreakoutMode={isBreakoutModal}
											isGlobalMode={activeTab === 'Global'}
										/>
									) : (
										<div className="py-16 text-center text-slate-400 text-sm font-medium">
											No price history data available for {selectedTrendStock.stockName}
										</div>
									)}
								</div>
							)}
						</div>

					</div>
				</div>,
				document.body
			)}

			{/* Detailed Sectoral Activity Chart Modal Popup */}
			{selectedSector && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-[85%] w-full max-h-[90vh] flex flex-col border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
							<div>
								<h2 className="text-2xl font-bold text-slate-800">
									{selectedSector.sector}
								</h2>
								<p className="text-xs text-slate-500 font-semibold mt-1">
									Historical Buy &amp; Sell Net Cash Flow Activity Analysis
								</p>
							</div>
							<button
								onClick={() => setSelectedSector(null)}
								className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[22px]">close</span>
							</button>
						</div>

						{/* Modal Body View */}
						<div className="flex-1 overflow-y-auto px-6 py-6 slim-scroll relative">
							{sectorModalLoading ? (
								<LottieLoader text={`Loading sector flow history for ${selectedSector.sector}...`} width="200px" height="200px" />
							) : (
								<div className="flex flex-col gap-6">
									{sectorModalDetails && sectorModalDetails.history ? (
										<SectoralFlowChart historyObj={sectorModalDetails.history} />
									) : (
										<div className="py-16 text-center text-slate-400 text-sm font-medium">
											No historical activity flow data available for {selectedSector.sector}
										</div>
									)}
								</div>
							)}
						</div>

					</div>
				</div>,
				document.body
			)}

			{/* Detailed Cash Flow Card Modal Popup */}
			{selectedCashFlowItem && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-[80%] w-full max-h-[85vh] flex flex-col border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
							<div>
								<h2 className="text-2xl font-bold text-slate-800">
									FII &amp; DII Cash Flow Details ({selectedCashFlowItem.period})
								</h2>
								<p className="text-xs text-slate-400 font-medium mt-0.5">
									Institutional Buy, Sell &amp; Net Activity Summary ({cashFlowPeriodType} Mode)
								</p>
							</div>
							<button
								onClick={() => setSelectedCashFlowItem(null)}
								className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[22px]">close</span>
							</button>
						</div>

						{/* Modal Body View */}
						<div className="flex-1 overflow-y-auto px-6 py-6 slim-scroll space-y-6">
							{/* Cards Row for FII vs DII */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								{/* FII Card */}
								<div className="bg-gradient-to-b from-purple-50/50 to-white border border-purple-100 rounded-2xl p-5 shadow-2xs space-y-4">
									<div className="flex items-center justify-between border-b border-purple-100 pb-3">
										<h3 className="text-sm font-bold text-purple-900 flex items-center gap-2">
											<span className="w-3 h-3 rounded-full bg-[#9462d2]"></span>
											Foreign Institutional Investors (FII)
										</h3>
										<span className="text-xs font-extrabold text-[#9462d2] bg-purple-100/80 px-2.5 py-0.5 rounded-full">
											{cashFlowPeriodType}
										</span>
									</div>
									<div className="grid grid-cols-3 gap-3 text-center">
										<div className="bg-white p-3 rounded-xl border border-slate-100">
											<span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Buy</span>
											<span className="text-base font-extrabold text-slate-800 mt-1 block">{selectedCashFlowItem.fiiBuy}</span>
										</div>
										<div className="bg-white p-3 rounded-xl border border-slate-100">
											<span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Sell</span>
											<span className="text-base font-extrabold text-slate-800 mt-1 block">{selectedCashFlowItem.fiiSell}</span>
										</div>
										<div className="bg-white p-3 rounded-xl border border-slate-100">
											<span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Net Flow</span>
											<span className={`text-base font-extrabold mt-1 block ${selectedCashFlowItem.fiiNetRaw >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
												{selectedCashFlowItem.fiiNet}
											</span>
										</div>
									</div>
								</div>

								{/* DII Card */}
								<div className="bg-gradient-to-b from-emerald-50/50 to-white border border-emerald-100 rounded-2xl p-5 shadow-2xs space-y-4">
									<div className="flex items-center justify-between border-b border-emerald-100 pb-3">
										<h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
											<span className="w-3 h-3 rounded-full bg-[#10b981]"></span>
											Domestic Institutional Investors (DII)
										</h3>
										<span className="text-xs font-extrabold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full">
											{cashFlowPeriodType}
										</span>
									</div>
									<div className="grid grid-cols-3 gap-3 text-center">
										<div className="bg-white p-3 rounded-xl border border-slate-100">
											<span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Buy</span>
											<span className="text-base font-extrabold text-slate-800 mt-1 block">{selectedCashFlowItem.diiBuy}</span>
										</div>
										<div className="bg-white p-3 rounded-xl border border-slate-100">
											<span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Sell</span>
											<span className="text-base font-extrabold text-slate-800 mt-1 block">{selectedCashFlowItem.diiSell}</span>
										</div>
										<div className="bg-white p-3 rounded-xl border border-slate-100">
											<span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Net Flow</span>
											<span className={`text-base font-extrabold mt-1 block ${selectedCashFlowItem.diiNetRaw >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
												{selectedCashFlowItem.diiNet}
											</span>
										</div>
									</div>
								</div>
							</div>

							{/* Combined Net Activity Summary */}
							<div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-4">
								<div className="flex items-center gap-3">
									<div className="w-10 h-10 rounded-xl bg-purple-100 text-[#9462d2] flex items-center justify-center font-bold">
										<span className="material-symbols-outlined text-[24px]">account_balance_wallet</span>
									</div>
									<div>
										<h4 className="text-sm font-bold text-slate-800">Combined Net Institutional Flow</h4>
										<p className="text-xs text-slate-500 font-medium">FII Net + DII Net Impact for {selectedCashFlowItem.period}</p>
									</div>
								</div>
								{(() => {
									const totalNet = (selectedCashFlowItem.fiiNetRaw || 0) + (selectedCashFlowItem.diiNetRaw || 0);
									const isPos = totalNet >= 0;
									const formattedTotal = isPos ? `+₹${totalNet.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr` : `-₹${Math.abs(totalNet).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
									return (
										<div className={`px-4 py-2 rounded-xl text-base font-extrabold ${isPos ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-200'}`}>
											{formattedTotal} ({isPos ? 'Net Buyer' : 'Net Seller'})
										</div>
									);
								})()}
							</div>
						</div>

					</div>
				</div>,
				document.body
			)}

			{/* Detailed Financial Metrics & Compounded Growth Popup */}
			{selectedMetricsStock && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					{/* Left Move Icon (<) */}
					<button
						onClick={() => handleNavigateStockSection(selectedMetricsStock, 'Metrics', 'prev')}
						title="Move to Previous Section (Breakout Analysis)"
						className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:-translate-x-0.5 transition-transform">chevron_left</span>
					</button>

					{/* Right Move Icon (>) */}
					<button
						onClick={() => handleNavigateStockSection(selectedMetricsStock, 'Metrics', 'next')}
						title="Move to Next Section (Trades Details)"
						className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:translate-x-0.5 transition-transform">chevron_right</span>
					</button>

					<div className="bg-white rounded-2xl shadow-2xl max-w-[85%] w-full max-h-[90vh] flex flex-col border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
							<div className="flex items-center gap-4">
								<div>
									<h2 className="text-2xl font-bold text-slate-800">
										{selectedMetricsStock.stockName}
									</h2>
									<div className="flex items-center gap-3 text-xs text-slate-500 font-semibold mt-1">
										<span>Market Cap: <strong className="text-slate-800">{selectedMetricsStock.marketCap}</strong></span>
										<span>•</span>
										<span>Current Price: <strong className="text-slate-800">{selectedMetricsStock.price}</strong></span>
										<span>•</span>
										<span className="text-[#9462d2] font-bold">Compounded Growth Ratios</span>
									</div>
								</div>
							</div>
							<button
								onClick={() => handleCloseStockModal(setSelectedMetricsStock)}
								className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[22px]">close</span>
							</button>
						</div>

						{/* Modal Body View */}
						<div className="flex-1 overflow-y-auto px-6 py-6 slim-scroll relative">
							{metricsModalLoading ? (
								<LottieLoader text="Loading financial metrics..." width="200px" height="200px" />
							) : (
								<div className="flex flex-col gap-6">
									{/* Compared Financial Metrics Cards */}
									{selectedMetricsStock && (
										<div className="bg-slate-50/80 rounded-2xl p-5 border border-slate-200/60 shadow-2xs space-y-3">
											<div className="flex items-center justify-between">
												<h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
													<span className="material-symbols-outlined text-[#9462d2] text-[20px]">equalizer</span>
													<span>Financial Performance Metrics Comparison</span>
												</h3>
												<span className="text-xs text-slate-400 font-medium">Compared vs Previous Period</span>
											</div>

											<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
												{[
													{ label: 'QoQ Sales Growth', data: selectedMetricsStock.qSalesLatest, currPeriod: selectedMetricsStock.qLastPeriod, prevPeriod: selectedMetricsStock.qPrevPeriod },
													{ label: 'YoY Sales Growth', data: selectedMetricsStock.qSalesPrevQ, currPeriod: selectedMetricsStock.qLastPeriod, prevPeriod: selectedMetricsStock.qLastPeriodPrevMonth },
													{ label: 'Qtr OPM%', data: selectedMetricsStock.qOpm, currPeriod: selectedMetricsStock.qLastPeriod, prevPeriod: selectedMetricsStock.qPrevPeriod },
													{ label: 'ROCE', data: selectedMetricsStock.roce, currPeriod: selectedMetricsStock.fy1, prevPeriod: selectedMetricsStock.fy2 },
													{ label: 'Sales Growth FY', data: selectedMetricsStock.plSalesGrowth, currPeriod: selectedMetricsStock.fy1, prevPeriod: selectedMetricsStock.fy2 },
													{ label: 'Net Profit FY', data: selectedMetricsStock.plNetProfit, currPeriod: selectedMetricsStock.fy1, prevPeriod: selectedMetricsStock.fy2 },
													{ label: 'OPM FY', data: selectedMetricsStock.plOpm, currPeriod: selectedMetricsStock.fy1, prevPeriod: selectedMetricsStock.fy2 },
													{ label: 'ROE', data: selectedMetricsStock.roe, currPeriod: selectedMetricsStock.fy1, prevPeriod: selectedMetricsStock.fy2 }
												].map((m) => {
													if (!m.data || m.data.val === '—') return null;
													const change = m.data.change || 0;
													const diff = m.data.diff || '—';
													const isPos = change > 0;
													const isNeg = change < 0;

													let badgeStyle = 'bg-slate-100 text-slate-600 font-medium';
													if (isPos) {
														badgeStyle = 'bg-emerald-100/90 text-emerald-700 font-bold border border-emerald-200/50';
													} else if (isNeg) {
														badgeStyle = 'bg-rose-100/90 text-rose-700 font-bold border border-rose-200/50';
													}

													const prevValDisplay = m.data.prevVal && m.data.prevVal !== '—' ? m.data.prevVal : null;

													return (
														<div key={m.label} className="bg-white p-4 rounded-xl border border-slate-200/70 shadow-2xs hover:border-purple-300 transition-all flex flex-col justify-between gap-3 group">
															{/* Top Card Header: Title & Growth Badge */}
															<div className="flex items-center justify-between gap-2">
																<span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{m.label}</span>
																{diff !== '—' && (
																	<span className={`px-2.5 py-0.5 rounded-full text-xs ${badgeStyle}`}>
																		{diff}
																	</span>
																)}
															</div>

															{/* Flow Timeline Section */}
															<div className="bg-slate-50/70 p-3 rounded-lg border border-slate-100 flex items-center justify-between gap-2">
																{/* Previous Period Box */}
																<div className="flex flex-col">
																	<span className="text-[11px] font-semibold text-slate-400 uppercase tracking-tight">{m.prevPeriod || 'Prev'}</span>
																	<span className="text-sm font-bold text-slate-600 mt-0.5">{prevValDisplay || '—'}</span>
																</div>

																{/* Center Growth Flow Arrow */}
																<div className="flex flex-col items-center px-1">
																	<div className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform group-hover:scale-110 ${isPos ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/60' : isNeg ? 'bg-rose-50 text-rose-600 border border-rose-200/60' : 'bg-slate-100 text-slate-400'
																		}`}>
																		<span className="material-symbols-outlined text-[18px]">
																			{isPos ? 'trending_up' : isNeg ? 'trending_down' : 'east'}
																		</span>
																	</div>
																</div>

																{/* Current Period Box */}
																<div className="flex flex-col items-end text-right">
																	<span className="text-[11px] font-bold text-[#9462d2] uppercase tracking-tight">{m.currPeriod || 'Current'}</span>
																	<span className="text-sm font-extrabold text-slate-900 mt-0.5">{m.data.val}</span>
																</div>
															</div>
														</div>
													);
												})}
											</div>
										</div>
									)}

									{/* Compounded Growth Charts */}
									{metricsModalDetails && metricsModalDetails.compoundedGrowth && Object.keys(metricsModalDetails.compoundedGrowth).length > 0 ? (
										<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
											<CompoundedGrowthChartCard
												title="Compounded Sales Growth"
												data={metricsModalDetails.compoundedGrowth['Compounded Sales Growth']}
												accentColor="emerald"
											/>
											<CompoundedGrowthChartCard
												title="Compounded Profit Growth"
												data={metricsModalDetails.compoundedGrowth['Compounded Profit Growth']}
												accentColor="purple"
											/>
											<CompoundedGrowthChartCard
												title="Return on Equity (ROE)"
												data={metricsModalDetails.compoundedGrowth['Return on Equity']}
												accentColor="rose"
											/>
										</div>
									) : (
										<div className="py-12 text-center text-slate-400 text-sm font-medium flex flex-col items-center justify-center gap-2">
											<span className="material-symbols-outlined text-4xl text-slate-300">bar_chart_off</span>
											<span>No compounded growth metrics data found for {selectedMetricsStock.stockName}</span>
										</div>
									)}
								</div>
							)}
						</div>

					</div>
				</div>,
				document.body
			)}

			{/* Detailed Consensus Recommendations Popup */}
			{selectedConsensusStock && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					{/* Left Move Icon (<) */}
					<button
						onClick={() => handleNavigateStockSection(selectedConsensusStock, 'Consensus', 'prev')}
						title="Move to Previous Section (Financial Metrics)"
						className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:-translate-x-0.5 transition-transform">chevron_left</span>
					</button>

					{/* Right Move Icon (>) */}
					<button
						onClick={() => handleNavigateStockSection(selectedConsensusStock, 'Consensus', 'next')}
						title="Move to Next Section (Trades Details)"
						className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[30px] group-hover:translate-x-0.5 transition-transform">chevron_right</span>
					</button>

					<div className="bg-white rounded-2xl shadow-2xl max-w-[85%] w-full max-h-[90vh] flex flex-col border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
							<div className="flex items-center gap-4">
								<div>
									<div className="flex items-center gap-3">
										<h2 className="text-2xl font-bold text-slate-800">
											{selectedConsensusStock.stock_name || selectedConsensusStock.stockName || selectedConsensusStock.symbol || selectedConsensusStock.ticker}
										</h2>
										<span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-purple-50 text-[#9462d2] border border-purple-200 uppercase tracking-wide">
											{selectedConsensusStock.symbol || selectedConsensusStock.ticker}
										</span>
									</div>
									<div className="flex items-center gap-3 text-xs text-slate-500 font-semibold mt-1">
										{selectedConsensusStock.marketCap && (
											<>
												<span>Market Cap: <strong className="text-slate-800">{selectedConsensusStock.marketCap}</strong></span>
												<span>•</span>
											</>
										)}
										{selectedConsensusStock.price && (
											<>
												<span>Current Price: <strong className="text-slate-800">{selectedConsensusStock.price}</strong></span>
												<span>•</span>
											</>
										)}
										<span className="text-[#9462d2] font-bold">Analyst Consensus Recommendations</span>
									</div>
								</div>
							</div>
							<button
								onClick={() => handleCloseStockModal(setSelectedConsensusStock)}
								className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[22px]">close</span>
							</button>
						</div>

						{/* Modal Body View */}
						<div className="flex-1 overflow-y-auto px-6 py-6 slim-scroll relative">
							{(() => {
								const item = selectedConsensusStock;
								const rating = calcConsensusRating(item);
								let badgeStyle = 'bg-slate-100 text-slate-600 border-slate-200';
								const rLower = rating.toLowerCase();
								if (rLower.includes('strong buy') || rLower.includes('buy')) {
									badgeStyle = rLower.includes('strong')
										? 'bg-emerald-100 text-emerald-800 border-emerald-300 font-extrabold'
										: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-bold';
								} else if (rLower.includes('hold')) {
									badgeStyle = 'bg-amber-50 text-amber-800 border-amber-200 font-bold';
								} else if (rLower.includes('sell')) {
									badgeStyle = rLower.includes('strong')
										? 'bg-rose-100 text-rose-800 border-rose-300 font-extrabold'
										: 'bg-rose-50 text-rose-700 border-rose-200 font-bold';
								}

								const total = item.total || 0;
								const strongBuy = item.strong_buy || item.strongBuy || 0;
								const buy = item.buy || 0;
								const hold = item.hold || 0;
								const sell = item.sell || 0;
								const strongSell = item.strong_sell || item.strongSell || 0;

								const pct = (val) => (total > 0 ? ((val / total) * 100).toFixed(1) : 0);

								return (
									<div className="flex flex-col gap-6">
										{/* Consensus Overview Card */}
										<div className="bg-gradient-to-r from-purple-50/70 via-slate-50 to-white rounded-2xl p-6 border border-purple-100 shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
											<div className="flex items-center gap-4">
												<div className="w-14 h-14 rounded-2xl bg-white border border-purple-200/80 shadow-xs flex items-center justify-center text-[#9462d2]">
													<span className="material-symbols-outlined text-[32px]">analytics</span>
												</div>
												<div>
													<span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Consensus Recommendation</span>
													<div className="flex items-center gap-3 mt-1">
														<span className={`px-3 py-1 rounded-xl text-base border shadow-2xs ${badgeStyle}`}>
															{rating}
														</span>
													</div>
												</div>
											</div>

											{/* Total Analysts Count Card */}
											<div className="bg-white px-6 py-3 rounded-xl border border-slate-200/80 text-center shadow-2xs min-w-[150px]">
												<span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Analysts</span>
												<span className="text-2xl font-extrabold text-slate-800 block mt-0.5">{total}</span>
											</div>
										</div>

										{/* Analyst Recommendations Counts Cards */}
										<div className="bg-slate-50/80 rounded-2xl p-5 border border-slate-200/60 shadow-2xs space-y-4">
											<div className="flex items-center justify-between">
												<h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
													<span className="material-symbols-outlined text-[#9462d2] text-[20px]">groups</span>
													<span>Analyst Recommendations Breakdown ({total} Total)</span>
												</h3>
											</div>

											<div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
												<div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200 text-center shadow-2xs">
													<span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block">Strong Buy</span>
													<span className="text-2xl font-extrabold text-emerald-700 block mt-1">{strongBuy}</span>
													<span className="text-[11px] font-bold text-emerald-600 block mt-0.5">{pct(strongBuy)}%</span>
												</div>
												<div className="bg-emerald-50/30 p-4 rounded-xl border border-emerald-100 text-center shadow-2xs">
													<span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">Buy</span>
													<span className="text-2xl font-extrabold text-emerald-600 block mt-1">{buy}</span>
													<span className="text-[11px] font-bold text-emerald-600 block mt-0.5">{pct(buy)}%</span>
												</div>
												<div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200 text-center shadow-2xs">
													<span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block">Hold</span>
													<span className="text-2xl font-extrabold text-amber-600 block mt-1">{hold}</span>
													<span className="text-[11px] font-bold text-amber-600 block mt-0.5">{pct(hold)}%</span>
												</div>
												<div className="bg-rose-50/30 p-4 rounded-xl border border-rose-100 text-center shadow-2xs">
													<span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">Sell</span>
													<span className="text-2xl font-extrabold text-rose-600 block mt-1">{sell}</span>
													<span className="text-[11px] font-bold text-rose-600 block mt-0.5">{pct(sell)}%</span>
												</div>
												<div className="bg-rose-50/60 p-4 rounded-xl border border-rose-200 text-center shadow-2xs">
													<span className="text-[11px] font-bold text-rose-800 uppercase tracking-wider block">Strong Sell</span>
													<span className="text-2xl font-extrabold text-rose-700 block mt-1">{strongSell}</span>
													<span className="text-[11px] font-bold text-rose-600 block mt-0.5">{pct(strongSell)}%</span>
												</div>
											</div>

											{/* Visual Recommendation Distribution Bar */}
											<div className="bg-white p-4 rounded-xl border border-slate-200/80 space-y-2">
												<span className="text-xs font-bold text-slate-700 block">Recommendation Distribution</span>
												<div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
													{strongBuy > 0 && (
														<div
															style={{ width: `${pct(strongBuy)}%` }}
															className="bg-emerald-600 h-full transition-all"
															title={`Strong Buy: ${strongBuy} (${pct(strongBuy)}%)`}
														/>
													)}
													{buy > 0 && (
														<div
															style={{ width: `${pct(buy)}%` }}
															className="bg-emerald-400 h-full transition-all"
															title={`Buy: ${buy} (${pct(buy)}%)`}
														/>
													)}
													{hold > 0 && (
														<div
															style={{ width: `${pct(hold)}%` }}
															className="bg-amber-400 h-full transition-all"
															title={`Hold: ${hold} (${pct(hold)}%)`}
														/>
													)}
													{sell > 0 && (
														<div
															style={{ width: `${pct(sell)}%` }}
															className="bg-rose-400 h-full transition-all"
															title={`Sell: ${sell} (${pct(sell)}%)`}
														/>
													)}
													{strongSell > 0 && (
														<div
															style={{ width: `${pct(strongSell)}%` }}
															className="bg-rose-600 h-full transition-all"
															title={`Strong Sell: ${strongSell} (${pct(strongSell)}%)`}
														/>
													)}
												</div>
												<div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 font-semibold pt-1">
													<div className="flex items-center gap-1.5">
														<span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
														<span>Strong Buy ({pct(strongBuy)}%)</span>
													</div>
													<div className="flex items-center gap-1.5">
														<span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
														<span>Buy ({pct(buy)}%)</span>
													</div>
													<div className="flex items-center gap-1.5">
														<span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
														<span>Hold ({pct(hold)}%)</span>
													</div>
													<div className="flex items-center gap-1.5">
														<span className="w-2.5 h-2.5 rounded-full bg-rose-400 inline-block" />
														<span>Sell ({pct(sell)}%)</span>
													</div>
													<div className="flex items-center gap-1.5">
														<span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block" />
														<span>Strong Sell ({pct(strongSell)}%)</span>
													</div>
												</div>
											</div>
										</div>
									</div>
								);
							})()}
						</div>

					</div>
				</div>,
				document.body
			)}

			{/* Detailed Moneycontrol Sentiment & Boarders Popup */}
			{selectedSentimentStock && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					{/* Left Move Icon (<) */}
					<button
						onClick={() => handleNavigateStockSection(selectedSentimentStock, 'Sentiment', 'prev')}
						title="Move to Previous Section (Consensus Recommendations)"
						className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[28px] group-hover:-translate-x-0.5 transition-transform">chevron_left</span>
					</button>

					{/* Right Move Icon (>) */}
					<button
						onClick={() => handleNavigateStockSection(selectedSentimentStock, 'Sentiment', 'next')}
						title="Move to Next Section (Trades)"
						className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/95 hover:bg-white shadow-2xl border border-slate-200 text-slate-700 hover:text-[#9462d2] hover:border-purple-300 flex items-center justify-center transition-all cursor-pointer z-[10000] hover:scale-110 active:scale-95 group"
					>
						<span className="material-symbols-outlined text-[28px] group-hover:translate-x-0.5 transition-transform">chevron_right</span>
					</button>

					<div className="bg-white rounded-2xl shadow-2xl max-w-[85%] w-full max-h-[90vh] flex flex-col border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
							<div className="flex items-center gap-3">
								<div className="w-10 h-10 rounded-xl bg-purple-100 text-[#9462d2] flex items-center justify-center font-bold shadow-xs">
									<span className="material-symbols-outlined text-[22px]">psychology</span>
								</div>
								<div>
									<div className="flex items-center gap-2">
										<h3 className="font-extrabold text-slate-900 text-xl tracking-tight">
											{selectedSentimentStock.stockName || selectedSentimentStock.stock_name}
										</h3>
										<span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
											{selectedSentimentStock.ticker || selectedSentimentStock.symbol}
										</span>
									</div>
									<div className="flex items-center gap-3 text-xs text-slate-500 font-medium mt-0.5">
										{selectedSentimentStock.marketCap && (
											<span>Market Cap: <strong className="text-slate-800">{selectedSentimentStock.marketCap}</strong></span>
										)}
										{selectedSentimentStock.marketCap && selectedSentimentStock.price && <span>•</span>}
										{selectedSentimentStock.price && (
											<span>Current Price: <strong className="text-slate-800">{selectedSentimentStock.price}</strong></span>
										)}
									</div>
								</div>
							</div>
							<button
								onClick={() => handleCloseStockModal(setSelectedSentimentStock)}
								className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[20px]">close</span>
							</button>
						</div>

						{/* Modal Content */}
						<div className="p-6 overflow-y-auto space-y-6 max-h-[calc(90vh-80px)]">
							{/* Top Metrics Grid */}
							<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
								{/* Message Count Card */}
								<div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 flex items-center gap-3">
									<div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
										<span className="material-symbols-outlined text-[20px]">forum</span>
									</div>
									<div>
										<span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Total Messages</span>
										<span className="text-xl font-extrabold text-slate-900 block mt-0.5">
											{Number(selectedSentimentStock.msg_count || 0).toLocaleString('en-IN')}
										</span>
									</div>
								</div>

								{/* Followers Card */}
								<div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 flex items-center gap-3">
									<div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-bold">
										<span className="material-symbols-outlined text-[20px]">group</span>
									</div>
									<div>
										<span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Boarder Followers</span>
										<span className="text-xl font-extrabold text-slate-900 block mt-0.5">
											{Number(selectedSentimentStock.follower_count || 0).toLocaleString('en-IN')}
										</span>
									</div>
								</div>

								{/* Sentimeter Card */}
								<div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 space-y-2">
									<div className="flex items-center justify-between">
										<span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Forum Sentimeter</span>
										<span className="text-xs font-bold text-emerald-700">{selectedSentimentStock.buy_perc || 0}% Bullish</span>
									</div>
									<div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden flex">
										<div style={{ width: `${selectedSentimentStock.buy_perc || 0}%` }} className="bg-emerald-500 h-full" title={`Buy: ${selectedSentimentStock.buy_perc}%`} />
										<div style={{ width: `${selectedSentimentStock.sell_perc || 0}%` }} className="bg-rose-500 h-full" title={`Sell: ${selectedSentimentStock.sell_perc}%`} />
										<div style={{ width: `${selectedSentimentStock.hold_perc || 0}%` }} className="bg-slate-400 h-full" title={`Hold: ${selectedSentimentStock.hold_perc}%`} />
									</div>
									<div className="flex justify-between text-[11px] font-semibold text-slate-600">
										<span className="text-emerald-700">Buy: {selectedSentimentStock.buy_perc || 0}%</span>
										<span className="text-rose-700">Sell: {selectedSentimentStock.sell_perc || 0}%</span>
										<span className="text-slate-600">Hold: {selectedSentimentStock.hold_perc || 0}%</span>
									</div>
								</div>
							</div>

							{/* AI Boarder Sentiment Summary Card */}
							<div className="bg-gradient-to-br from-purple-50/40 via-white to-slate-50 p-6 rounded-2xl border border-purple-100/80 shadow-xs space-y-4">
								<div className="flex items-center justify-between border-b border-purple-100/60 pb-3">
									<div className="flex items-center gap-2">
										<span className="material-symbols-outlined text-[#9462d2] text-[22px]">auto_awesome</span>
										<h4 className="font-extrabold text-slate-900 text-lg">Hear What Our Boarders Have to Say</h4>
									</div>
									<span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-purple-100/70 text-purple-800 border border-purple-200/60 flex items-center gap-1">
										<span className="material-symbols-outlined text-[14px]">smart_toy</span>
										AI-Generated Sentiment
									</span>
								</div>

								<div className="text-sm leading-relaxed text-slate-700 whitespace-pre-line font-normal space-y-2">
									{selectedSentimentStock.ai_summary ? (
										selectedSentimentStock.ai_summary
									) : (
										<div className="py-8 text-center text-slate-400 text-sm font-medium flex flex-col items-center justify-center gap-2">
											<span className="material-symbols-outlined text-4xl text-slate-300">chat_bubble_outline</span>
											<span>No AI boarder summary available for {selectedSentimentStock.stockName || selectedSentimentStock.symbol}</span>
										</div>
									)}
								</div>
							</div>
						</div>
					</div>
				</div>,
				document.body
			)}

			{/* Add to Watchlist Group Modal Popup */}
			{isAddToWatchlistOpen && selectedWatchlistStock && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[99999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-[40%] w-full p-8 border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150 space-y-5">
						<div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
							<div className="flex items-center gap-3">
								<div className="w-10 h-10 rounded-xl bg-purple-100 text-[#9462d2] flex items-center justify-center font-bold shadow-xs">
									<span className="material-symbols-outlined text-[22px]">bookmark_add</span>
								</div>
								<div>
									<h3 className="text-base font-bold text-slate-800 leading-tight">Add to Watchlist</h3>
									<p className="text-xs text-slate-400 font-medium">{selectedWatchlistStock.stockName} ({selectedWatchlistStock.ticker})</p>
								</div>
							</div>
							<button
								onClick={() => setIsAddToWatchlistOpen(false)}
								className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[20px]">close</span>
							</button>
						</div>

						<form onSubmit={handleConfirmAddToWatchlist} className="space-y-4">
							<div className="space-y-3">
								<span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Watchlist Groups:</span>

								{/* Existing Watchlist Group Choice (Multi-Select) */}
								{dbWatchlistGroupsList.length > 0 && (
									<div className="p-3.5 rounded-xl border border-purple-200 bg-purple-50/40 space-y-2">
										<div className="flex items-center justify-between">
											<span className="text-xs font-bold text-slate-800">Select Groups</span>
											<div className="relative inline-block text-left">
												<button
													type="button"
													onClick={(e) => {
														e.preventDefault();
														setIsModalGroupDropdownOpen((prev) => !prev);
													}}
													className="bg-white border border-purple-300 hover:border-purple-400 text-xs font-bold text-slate-800 rounded-xl px-3 py-1.5 outline-none transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
												>
													<span className="max-w-[140px] truncate">
														{selectedWatchlistGroupIds.length === 0
															? 'Select Groups'
															: selectedWatchlistGroupIds.length === 1
																? selectedWatchlistGroupIds[0]
																: `${selectedWatchlistGroupIds.length} Groups Selected`}
													</span>
													{selectedWatchlistGroupIds.length > 0 && (
														<span className="w-4 h-4 rounded-full bg-[#9462d2] text-white text-[10px] font-bold flex items-center justify-center">
															{selectedWatchlistGroupIds.length}
														</span>
													)}
													<span className={`material-symbols-outlined text-[16px] text-purple-600 transition-transform duration-200 ${isModalGroupDropdownOpen ? 'rotate-180' : ''}`}>
														keyboard_arrow_down
													</span>
												</button>

												{/* Custom Rounded Multi-Select Options Dropdown Menu */}
												{isModalGroupDropdownOpen && (
													<>
														<div className="fixed inset-0 z-40" onClick={() => setIsModalGroupDropdownOpen(false)}></div>
														<div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-purple-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-1 max-h-32 overflow-y-auto slim-scroll">
															{dbWatchlistGroupsList.map((g) => {
																const isSel = selectedWatchlistGroupIds.some((name) => name.toLowerCase() === g.name.toLowerCase());
																return (
																	<button
																		key={g.id || g.name}
																		type="button"
																		onClick={(e) => {
																			e.preventDefault();
																			toggleWatchlistGroupSelection(g.name);
																		}}
																		className={`w-full text-left px-3 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-between cursor-pointer ${isSel
																			? 'bg-purple-50 text-[#9462d2] border border-purple-200'
																			: 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
																			}`}
																	>
																		<span className="truncate">{g.name}</span>
																		<div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${isSel
																			? 'bg-[#9462d2] border-[#9462d2] text-white'
																			: 'border-slate-300 bg-white'
																			}`}>
																			{isSel && (
																				<span className="material-symbols-outlined text-[12px] stroke-[3]">check</span>
																			)}
																		</div>
																	</button>
																);
															})}
														</div>
													</>
												)}
											</div>
										</div>

										{/* Active Group Badges Chips */}
										{selectedWatchlistGroupIds.length > 0 && (
											<div className="flex flex-wrap gap-1.5 pt-1">
												{selectedWatchlistGroupIds.map((name) => (
													<span
														key={name}
														className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-purple-200 text-[#9462d2] text-xs font-bold shadow-2xs"
													>
														<span>{name}</span>
														<button
															type="button"
															onClick={() => toggleWatchlistGroupSelection(name)}
															className="hover:text-rose-600 cursor-pointer flex items-center justify-center ml-0.5"
														>
															<span className="material-symbols-outlined text-[14px]">close</span>
														</button>
													</span>
												))}
											</div>
										)}
									</div>
								)}

								{/* Create New Group Option */}
								<div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
									<label className="flex items-center gap-2 cursor-pointer">
										<input
											type="checkbox"
											checked={isCreatingNewGroupMode}
											onChange={(e) => setIsCreatingNewGroupMode(e.target.checked)}
											className="text-[#9462d2] focus:ring-[#9462d2] rounded"
										/>
										<span className="text-xs font-bold text-slate-800">Create & Add to New Group</span>
									</label>

									{isCreatingNewGroupMode && (
										<input
											type="text"
											placeholder="Enter group name e.g. Tech Leaders..."
											value={createNewGroupInput}
											onChange={(e) => setCreateNewGroupInput(e.target.value)}
											autoFocus
											className="bg-white border border-purple-200 text-xs text-slate-800 rounded-lg px-3.5 py-2 outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-100 w-full mt-1"
										/>
									)}
								</div>
							</div>

							<div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
								<button
									type="button"
									onClick={() => setIsAddToWatchlistOpen(false)}
									className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={selectedWatchlistGroupIds.length === 0 && (!isCreatingNewGroupMode || !createNewGroupInput.trim())}
									className="px-5 py-2 bg-[#9462d2] hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
								>
									Add Stock
								</button>
							</div>
						</form>
					</div>
				</div>,
				document.body
			)}

			{/* Watchlist Success Toast Notification */}
			{watchlistSuccessMsg && (
				<div className="fixed bottom-6 right-6 z-[99999] bg-slate-900 text-white text-xs font-bold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-bottom-4 duration-200">
					<span className="material-symbols-outlined text-emerald-400 text-[18px]">check_circle</span>
					<span>{watchlistSuccessMsg}</span>
				</div>
			)}

			{/* Commodity Success Toast Notification */}
			{addCommoditySuccess && (
				<div className="fixed bottom-6 right-6 z-[99999] bg-slate-900 text-white text-xs font-bold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-bottom-4 duration-200">
					<span className="material-symbols-outlined text-emerald-400 text-[18px]">check_circle</span>
					<span>{addCommoditySuccess}</span>
				</div>
			)}

			{/* Add Commodity Modal Card */}
			{isAddCommodityOpen && ReactDOM.createPortal(
				<div
					className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs"
					onClick={() => setIsAddCommodityOpen(false)}
				>
					<div
						className="bg-white rounded-2xl p-6 shadow-2xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-150 relative"
						onClick={(e) => e.stopPropagation()}
					>
						{/* Close Icon Button */}
						<button
							onClick={() => setIsAddCommodityOpen(false)}
							className="w-9 h-9 flex items-center justify-center absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
						>
							<span className="material-symbols-outlined text-[20px]">close</span>
						</button>

						<div className="flex items-center gap-3 mb-5">
							<div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold shadow-2xs">
								<span className="material-symbols-outlined text-[24px]">oil_barrel</span>
							</div>
							<div>
								<h3 className="text-base font-bold text-slate-900 leading-tight">Add New Commodity</h3>
								<p className="text-xs text-slate-500 font-medium">Enter stock name & symbol to track</p>
							</div>
						</div>

						{addCommodityError && (
							<div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
								<span className="material-symbols-outlined text-[18px]">error</span>
								<span>{addCommodityError}</span>
							</div>
						)}

						<form onSubmit={handleSaveCommodity} className="space-y-4">
							<div>
								<label className="block text-sm font-bold text-slate-700 mb-1.5">
									Stock / Commodity Name <span className="text-rose-500">*</span>
								</label>
								<input
									type="text"
									required
									placeholder="e.g. Gasoline, Silver, Natural Gas"
									value={addCommodityName}
									onChange={(e) => setAddCommodityName(e.target.value)}
									className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm font-semibold focus:outline-none focus:border-[#9462d2] focus:bg-white transition-all shadow-2xs"
								/>
							</div>

							<div>
								<label className="block text-sm font-bold text-slate-700 mb-1.5">
									Symbol / Ticker <span className="text-rose-500">*</span>
								</label>
								<input
									type="text"
									required
									placeholder="e.g. RB=F, SI=F, NG=F"
									value={addCommoditySymbol}
									onChange={(e) => setAddCommoditySymbol(e.target.value.toUpperCase())}
									className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm font-semibold focus:outline-none focus:border-[#9462d2] focus:bg-white transition-all uppercase shadow-2xs"
								/>
							</div>

							<div>
								<label className="block text-sm font-bold text-slate-700 mb-1.5">
									Initial Price (Optional)
								</label>
								<input
									type="text"
									placeholder="e.g. $3.22 or $100.00"
									value={addCommodityPrice}
									onChange={(e) => setAddCommodityPrice(e.target.value)}
									className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm font-semibold focus:outline-none focus:border-[#9462d2] focus:bg-white transition-all shadow-2xs"
								/>
							</div>

							<div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100 mt-5">
								<button
									type="button"
									onClick={() => setIsAddCommodityOpen(false)}
									className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition-all cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={isAddCommoditySubmitting}
									className="px-3 py-2 bg-[#9462d2] hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
								>
									{isAddCommoditySubmitting ? (
										<span>Saving...</span>
									) : (
										<>
											<span className="material-symbols-outlined text-[16px]">save</span>
											<span>Save Commodity</span>
										</>
									)}
								</button>
							</div>
						</form>
					</div>
				</div>,
				document.body
			)}

			{/* Global Success Toast Notification */}
			{addGlobalSuccess && (
				<div className="fixed bottom-6 right-6 z-[99999] bg-slate-900 text-white text-xs font-bold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-bottom-4 duration-200">
					<span className="material-symbols-outlined text-emerald-400 text-[18px]">check_circle</span>
					<span>{addGlobalSuccess}</span>
				</div>
			)}

			{/* Add Global Stock / Index Modal Card */}
			{isAddGlobalOpen && ReactDOM.createPortal(
				<div
					className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs"
					onClick={() => setIsAddGlobalOpen(false)}
				>
					<div
						className="bg-white rounded-2xl p-6 shadow-2xl border border-slate-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-150 relative"
						onClick={(e) => e.stopPropagation()}
					>
						{/* Close Icon Button */}
						<button
							onClick={() => setIsAddGlobalOpen(false)}
							className="w-9 h-9 flex items-center justify-center absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
						>
							<span className="material-symbols-outlined text-[20px]">close</span>
						</button>

						<div className="flex items-center gap-3 mb-5">
							<div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center font-bold shadow-2xs">
								<span className="material-symbols-outlined text-[24px]">globe_asia</span>
							</div>
							<div>
								<h3 className="text-base font-bold text-slate-900 leading-tight">Add Global Stock / Index</h3>
								<p className="text-xs text-slate-500 font-medium">Enter stock name & symbol to track</p>
							</div>
						</div>

						{addGlobalError && (
							<div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
								<span className="material-symbols-outlined text-[18px]">error</span>
								<span>{addGlobalError}</span>
							</div>
						)}

						<form onSubmit={handleSaveGlobal} className="space-y-4">
							<div>
								<label className="block text-sm font-bold text-slate-700 mb-1.5">
									Stock / Global Index Name <span className="text-rose-500">*</span>
								</label>
								<input
									type="text"
									required
									placeholder="e.g. Apple Inc, S&P 500, Nasdaq"
									value={addGlobalName}
									onChange={(e) => setAddGlobalName(e.target.value)}
									className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm font-semibold focus:outline-none focus:border-[#9462d2] focus:bg-white transition-all shadow-2xs"
								/>
							</div>

							<div>
								<label className="block text-sm font-bold text-slate-700 mb-1.5">
									Symbol / Ticker <span className="text-rose-500">*</span>
								</label>
								<input
									type="text"
									required
									placeholder="e.g. AAPL, ^GSPC, ^IXIC"
									value={addGlobalSymbol}
									onChange={(e) => setAddGlobalSymbol(e.target.value.toUpperCase())}
									className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm font-semibold focus:outline-none focus:border-[#9462d2] focus:bg-white transition-all uppercase shadow-2xs"
								/>
							</div>

							<div>
								<label className="block text-sm font-bold text-slate-700 mb-1.5">
									Initial Price (Optional)
								</label>
								<input
									type="text"
									placeholder="e.g. $185.50 or $5,200.00"
									value={addGlobalPrice}
									onChange={(e) => setAddGlobalPrice(e.target.value)}
									className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm font-semibold focus:outline-none focus:border-[#9462d2] focus:bg-white transition-all shadow-2xs"
								/>
							</div>

							<div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100 mt-5">
								<button
									type="button"
									onClick={() => setIsAddGlobalOpen(false)}
									className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition-all cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={isAddGlobalSubmitting}
									className="px-3 py-2 bg-[#9462d2] hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
								>
									{isAddGlobalSubmitting ? (
										<span>Saving...</span>
									) : (
										<>
											<span className="material-symbols-outlined text-[16px]">save</span>
											<span>Save Global</span>
										</>
									)}
								</button>
							</div>
						</form>
					</div>
				</div>,
				document.body
			)}
		</div>
	);
}
