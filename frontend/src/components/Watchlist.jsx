import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../apiConfig';

export const getStoredWatchlistGroups = () => {
	try {
		const saved = localStorage.getItem('stockinsight_watchlist_groups');
		if (saved) {
			const parsed = JSON.parse(saved);
			if (Array.isArray(parsed)) return parsed;
		}
	} catch (e) {
		console.error('Error reading watchlist groups:', e);
	}
	return [];
};

export const saveStoredWatchlistGroups = (groups) => {
	try {
		localStorage.setItem('stockinsight_watchlist_groups', JSON.stringify(groups));
		window.dispatchEvent(new Event('watchlistUpdated'));
	} catch (e) {
		console.error('Error saving watchlist groups:', e);
	}
};

export default function Watchlist({ setActiveMenu, setActiveTab, setSearchTerm }) {
	const [groups, setGroups] = useState([]);
	const [loading, setLoading] = useState(true);
	const [isCreatingGroup, setIsCreatingGroup] = useState(false);
	const [newGroupName, setNewGroupName] = useState('');
	const [activeGroupId, setActiveGroupId] = useState('ALL');
	const [newStockSymbol, setNewStockSymbol] = useState('');
	const [isAddingStockInline, setIsAddingStockInline] = useState(false);

	const handleStockClick = (item) => {
		const stockObj = (item && item.stock) ? item.stock : item;
		const symbol = (typeof stockObj === 'string' ? stockObj : (stockObj?.ticker || stockObj?.symbol || stockObj?.stockName || stockObj?.name || '')).toString().trim();
		if (setActiveTab) setActiveTab('Trades');
		if (setActiveMenu) setActiveMenu('Analysis');
		window.dispatchEvent(new CustomEvent('openStockTradeDetails', { detail: { stock: { ...(typeof stockObj === 'object' ? stockObj : {}), ticker: symbol }, openedFromWatchlist: true } }));
	};

	const fetchWatchlistFromDB = () => {
		setLoading(true);
		fetch(`${API_BASE}/watchlist`)
			.then((res) => res.json())
			.then((data) => {
				if (data && Array.isArray(data.groups)) {
					setGroups(data.groups);
					saveStoredWatchlistGroups(data.groups);
				}
			})
			.catch((err) => {
				console.error('Error fetching watchlist from DB:', err);
				setGroups(getStoredWatchlistGroups());
			})
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		fetchWatchlistFromDB();

		const handleUpdate = () => {
			fetch(`${API_BASE}/watchlist`)
				.then((res) => res.json())
				.then((data) => {
					if (data && Array.isArray(data.groups)) {
						setGroups(data.groups);
					}
				})
				.catch(() => setGroups(getStoredWatchlistGroups()));
		};

		window.addEventListener('watchlistUpdated', handleUpdate);
		return () => window.removeEventListener('watchlistUpdated', handleUpdate);
	}, []);

	const allWatchlistItems = useMemo(() => {
		const items = [];
		groups.forEach((g) => {
			if (Array.isArray(g.items)) {
				g.items.forEach((item) => {
					items.push({ ...item, groupName: g.name, groupId: g.id });
				});
			}
		});
		return items;
	}, [groups]);

	const handleCreateGroup = (e) => {
		e.preventDefault();
		if (!newGroupName.trim()) return;
		const gName = newGroupName.trim();

		fetch(`${API_BASE}/watchlist/group`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: gName })
		})
			.then((res) => res.json())
			.then(() => {
				setNewGroupName('');
				setIsCreatingGroup(false);
				fetchWatchlistFromDB();
			})
			.catch((err) => console.error('Error creating group in DB:', err));
	};

	const handleDeleteGroup = (groupId, groupName, e) => {
		e.stopPropagation();
		if (!window.confirm(`Are you sure you want to delete the "${groupName}" watchlist group?`)) return;

		fetch(`${API_BASE}/watchlist/group/delete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: groupName })
		})
			.then((res) => res.json())
			.then(() => {
				if (activeGroupId === groupId) setActiveGroupId('ALL');
				fetchWatchlistFromDB();
			})
			.catch((err) => console.error('Error deleting group from DB:', err));
	};

	const handleRemoveStockFromGroup = (groupName, ticker, e) => {
		e.stopPropagation();

		fetch(`${API_BASE}/watchlist/remove`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ symbol: ticker, groupName })
		})
			.then((res) => res.json())
			.then(() => {
				fetchWatchlistFromDB();
			})
			.catch((err) => console.error('Error removing stock from DB:', err));
	};

	const handleAddStockToActiveGroup = (e) => {
		e.preventDefault();
		if (!newStockSymbol.trim()) return;
		const sym = newStockSymbol.trim().toUpperCase();
		const activeGroupObj = groups.find((g) => g.id === activeGroupId);
		const targetGroupName = activeGroupObj ? activeGroupObj.name : 'General';

		fetch(`${API_BASE}/watchlist`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				ticker: sym,
				stockName: `${sym} Asset`,
				groupName: targetGroupName,
				price: '₹1,500.00',
				marketCap: 'Tracked Asset',
				change: '+0.00%'
			})
		})
			.then((res) => res.json())
			.then(() => {
				setNewStockSymbol('');
				setIsAddingStockInline(false);
				fetchWatchlistFromDB();
			})
			.catch((err) => console.error('Error adding stock to DB:', err));
	};

	const displayedItems = useMemo(() => {
		if (activeGroupId === 'ALL') return allWatchlistItems;
		const activeGroup = groups.find((g) => g.id === activeGroupId);
		if (!activeGroup) return [];
		return (activeGroup.items || []).map((i) => ({ ...i, groupName: activeGroup.name, groupId: activeGroup.id }));
	}, [activeGroupId, groups, allWatchlistItems]);

	return (
		<div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xs border border-slate-100 space-y-6" data-purpose="watchlist">
			{/* Header & Main Actions */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<div className="flex items-center gap-2.5">
						<span className="material-symbols-outlined text-[#9462d2] text-[24px]">bookmark</span>
						<h3 className="text-xl font-bold text-slate-800">Watchlist Stocks</h3>
					</div>
					<p className="text-xs text-slate-400 font-medium mt-0.5">
						Tracked database stocks &amp; custom groups ({allWatchlistItems.length} added)
					</p>
				</div>
			</div>

			{/* Loading state */}
			{loading ? (
				<div className="py-12 text-center text-xs font-semibold text-slate-400">
					Loading watchlist stocks from database...
				</div>
			) : (
				<>
					{/* Watchlist Stock Items List */}
					{displayedItems.length > 0 ? (
						<div className="max-h-[380px] overflow-y-auto slim-scroll space-y-3 pr-1">
							{displayedItems.map((item, index) => (
								<div
									key={`${item.ticker}_${item.groupName}_${index}`}
									onClick={() => handleStockClick(item)}
									className="flex items-center justify-between p-3.5 border border-slate-100 rounded-xl hover:bg-purple-50/50 transition-all group cursor-pointer"
									title={`Click to view ${item.ticker} in Analysis Trades`}
								>
									<div className="flex items-center gap-3.5">
										<div className="w-10 h-10 flex items-center justify-center bg-purple-100 text-[#9462d2] rounded-xl font-bold text-xs shadow-2xs">
											{item.ticker.slice(0, 2)}
										</div>
										<div>
											<div className="flex items-center gap-2">
												<h5 className="font-bold text-sm text-slate-900 leading-tight">{item.ticker}</h5>
											</div>
											{item.groupName && (
												<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-[#9462d2] border border-purple-100/60">
													{item.groupName}
												</span>
											)}
										</div>
									</div>

									<div className="flex items-center gap-4">
										<div className="text-right">
											<p className="font-extrabold text-sm text-slate-900">{item.price}</p>
											{item.change && (
												<span
													className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5 ${item.isPos
															? 'text-emerald-700 bg-emerald-50 border border-emerald-200/60'
															: 'text-rose-700 bg-rose-50 border border-rose-200/60'
														}`}
												>
													{item.change}
												</span>
											)}
										</div>

										<button
											onClick={(e) => handleRemoveStockFromGroup(item.groupName, item.ticker, e)}
											className="w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-all opacity-80 group-hover:opacity-100 cursor-pointer"
											title="Remove stock from database"
										>
											<span className="material-symbols-outlined text-[18px]">bookmark_remove</span>
										</button>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="py-12 text-center text-slate-400 text-xs font-medium bg-slate-50/50 rounded-xl border border-dashed border-slate-200 flex flex-col items-center gap-2.5">
							<span className="material-symbols-outlined text-4xl text-slate-300">bookmark_border</span>
							<span className="text-sm font-bold text-slate-700">No stocks added in database</span>
							<p className="text-xs text-slate-400 max-w-sm">
								Click the bookmark icon next to any stock name in Analysis tables or use "+ Add Stock" above to add stocks to your database watchlist!
							</p>
						</div>
					)}
				</>
			)}
		</div>
	);
}
