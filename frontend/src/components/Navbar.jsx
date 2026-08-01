import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { API_BASE } from '../apiConfig';

export default function Navbar({ searchTerm = '', setSearchTerm, activeMenu = 'Analysis', setActiveMenu, activeTab = 'Trades', setActiveTab, userRole = 'Super Admin', setUserRole, onLogout }) {
	const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
	const [isRoleSwitcherOpen, setIsRoleSwitcherOpen] = useState(false);
	const [watchlistSearch, setWatchlistSearch] = useState('');
	const [newStockSymbol, setNewStockSymbol] = useState('');
	const [isAddingStock, setIsAddingStock] = useState(false);
	const [watchlistItems, setWatchlistItems] = useState([]);
	const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
	const [dbGroups, setDbGroups] = useState([]);
	const [selectedGroupFilters, setSelectedGroupFilters] = useState([]);
	const [loading, setLoading] = useState(false);

	const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
	const [newGroupNameInput, setNewGroupNameInput] = useState('');

	const [isManageGroupsModalOpen, setIsManageGroupsModalOpen] = useState(false);
	const [editingGroupId, setEditingGroupId] = useState(null);
	const [editingGroupNameInput, setEditingGroupNameInput] = useState('');

	const [isNotificationCardOpen, setIsNotificationCardOpen] = useState(false);
	const [isUserProfileCardOpen, setIsUserProfileCardOpen] = useState(false);
	const [isNotificationBannerOpen, setIsNotificationBannerOpen] = useState(true);

	const handleRenameGroupSubmit = (oldName) => {
		if (!editingGroupNameInput.trim() || editingGroupNameInput.trim() === oldName) {
			setEditingGroupId(null);
			return;
		}
		const newName = editingGroupNameInput.trim();
		fetch(`${API_BASE}/watchlist/group/rename`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ oldName, newName })
		})
			.then((res) => res.json())
			.then(() => {
				setEditingGroupId(null);
				window.dispatchEvent(new Event('watchlistUpdated'));
				fetchWatchlistFromDB();
			})
			.catch((err) => console.error('Error renaming group:', err));
	};

	const [groupToDelete, setGroupToDelete] = useState(null);
	const [isDeleteGroupConfirmOpen, setIsDeleteGroupConfirmOpen] = useState(false);

	const promptDeleteGroup = (groupName) => {
		setGroupToDelete(groupName);
		setIsDeleteGroupConfirmOpen(true);
	};

	const confirmDeleteGroup = () => {
		if (!groupToDelete) return;

		fetch(`${API_BASE}/watchlist/group/delete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: groupToDelete })
		})
			.then((res) => res.json())
			.then(() => {
				setIsDeleteGroupConfirmOpen(false);
				setGroupToDelete(null);
				window.dispatchEvent(new Event('watchlistUpdated'));
				fetchWatchlistFromDB();
			})
			.catch((err) => console.error('Error deleting group:', err));
	};

	const handleStockClick = (item, e) => {
		if (e) e.stopPropagation();
		const symbol = item.ticker || item.symbol || item.stockName || '';
		if (setSearchTerm) setSearchTerm(symbol);
		if (setActiveTab) setActiveTab('Trades');
		if (setActiveMenu) setActiveMenu('Analysis');
		setIsWatchlistOpen(false);
		window.dispatchEvent(new CustomEvent('openStockTradeDetails', { detail: { stock: { ...item, ticker: symbol } } }));
	};

	const toggleGroupFilter = (groupName) => {
		if (groupName === 'ALL') {
			setSelectedGroupFilters([]);
		} else {
			setSelectedGroupFilters((prev) => {
				const exists = prev.some((g) => g.toLowerCase() === groupName.toLowerCase());
				if (exists) {
					return prev.filter((g) => g.toLowerCase() !== groupName.toLowerCase());
				} else {
					return [...prev, groupName];
				}
			});
		}
	};

	const getGroupDropdownLabel = () => {
		if (selectedGroupFilters.length === 0) {
			return `All Groups (${watchlistItems.length})`;
		}
		if (selectedGroupFilters.length === 1) {
			const singleName = selectedGroupFilters[0];
			const count = (dbGroups.find((g) => g.name.toLowerCase() === singleName.toLowerCase())?.items || []).length;
			return `${singleName} (${count})`;
		}
		return `${selectedGroupFilters.length} Groups Selected`;
	};

	const fetchWatchlistFromDB = (showLoading = false) => {
		if (showLoading) setLoading(true);
		fetch(`${API_BASE}/watchlist`)
			.then((res) => res.json())
			.then((data) => {
				if (data) {
					if (Array.isArray(data.items)) setWatchlistItems(data.items);
					if (Array.isArray(data.groups)) setDbGroups(data.groups);
				}
			})
			.catch((err) => console.error('Error fetching watchlist in Navbar:', err))
			.finally(() => {
				if (showLoading) setLoading(false);
			});
	};

	useEffect(() => {
		fetchWatchlistFromDB(true);

		const handleUpdate = () => {
			fetchWatchlistFromDB(false);
		};

		const handleReopenWatchlist = () => {
			fetchWatchlistFromDB(false);
			setIsWatchlistOpen(true);
		};

		window.addEventListener('watchlistUpdated', handleUpdate);
		window.addEventListener('reopenWatchlistModal', handleReopenWatchlist);
		return () => {
			window.removeEventListener('watchlistUpdated', handleUpdate);
			window.removeEventListener('reopenWatchlistModal', handleReopenWatchlist);
		};
	}, []);

	const handleCreateGroupSubmit = (e) => {
		e.preventDefault();
		if (!newGroupNameInput.trim()) return;
		const gName = newGroupNameInput.trim();

		fetch(`${API_BASE}/watchlist/group`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: gName })
		})
			.then((res) => res.json())
			.then(() => {
				setNewGroupNameInput('');
				setIsCreateGroupModalOpen(false);
				window.dispatchEvent(new Event('watchlistUpdated'));
				fetchWatchlistFromDB();
			})
			.catch((err) => console.error('Error creating group in Navbar:', err));
	};

	const handleRemoveWatchlistItem = (item, e) => {
		e.stopPropagation();
		fetch(`${API_BASE}/watchlist/remove`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ symbol: item.ticker, groupName: item.groupName })
		})
			.then((res) => res.json())
			.then(() => {
				window.dispatchEvent(new Event('watchlistUpdated'));
				fetchWatchlistFromDB();
			})
			.catch((err) => console.error('Error removing watchlist item in Navbar:', err));
	};

	const handleAddStock = (e) => {
		e.preventDefault();
		if (!newStockSymbol.trim()) return;
		const sym = newStockSymbol.trim().toUpperCase();

		fetch(`${API_BASE}/watchlist`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				ticker: sym,
				stockName: `${sym} Asset`,
				groupName: selectedGroupFilters.length > 0 ? selectedGroupFilters[0] : 'General',
				price: '₹1,500.00',
				marketCap: 'Tracked Asset',
				change: '+0.00%'
			})
		})
			.then((res) => res.json())
			.then(() => {
				setNewStockSymbol('');
				setIsAddingStock(false);
				window.dispatchEvent(new Event('watchlistUpdated'));
				fetchWatchlistFromDB();
			})
			.catch((err) => console.error('Error adding stock in Navbar:', err));
	};

	const filteredWatchlist = watchlistItems.filter((item) => {
		const matchesSearch =
			!watchlistSearch ||
			(item.ticker && item.ticker.toLowerCase().includes(watchlistSearch.toLowerCase())) ||
			(item.stockName && item.stockName.toLowerCase().includes(watchlistSearch.toLowerCase())) ||
			(item.groupName && item.groupName.toLowerCase().includes(watchlistSearch.toLowerCase()));

		const itemGroup = (item.groupName || item.category || 'General').toLowerCase();
		const matchesGroup =
			selectedGroupFilters.length === 0 ||
			selectedGroupFilters.some((gName) => gName.toLowerCase() === itemGroup);

		return matchesSearch && matchesGroup;
	});

	const exitStocks = watchlistItems.filter((i) => i.exit && i.exit.startsWith('Yes'));
	const strongExitStocks = watchlistItems.filter((i) => i.strongExit && i.strongExit.startsWith('Yes'));
	const alertStockItems = watchlistItems.filter(
		(i) => (i.exit && i.exit.startsWith('Yes')) || (i.strongExit && i.strongExit.startsWith('Yes'))
	);
	const totalAlertCount = alertStockItems.length;

	const getSearchPlaceholder = () => {
		if (activeMenu === 'Analysis') {
			return `Search ${activeTab} table...`;
		}
		return 'Search or type command...';
	};

	return (
		<header
			className="h-20 bg-white border-b border-gray-200 flex items-center justify-between px-6 sm:px-8 z-30 relative"
			data-purpose="top-navbar"
		>
			{/* Left Section: Search Bar */}
			<div className="flex items-center gap-4 w-full max-w-xl">
				<div className="relative flex items-center w-full h-11 border border-gray-200 rounded-lg bg-white px-3.5 py-2 shadow-xs focus-within:border-[#9462d2] focus-within:shadow-[0_0_0_4px_rgba(148,98,210,0.15)] transition-all">
					<svg className="w-5 h-5 text-gray-400 mr-2.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
					</svg>
					<input
						className="w-full bg-transparent text-[15px] text-gray-700 placeholder-gray-400 border-none outline-none focus:outline-none focus:ring-0 p-0"
						placeholder={getSearchPlaceholder()}
						type="text"
						value={searchTerm}
						onChange={(e) => setSearchTerm && setSearchTerm(e.target.value)}
					/>
					{searchTerm && (
						<button
							onClick={() => setSearchTerm && setSearchTerm('')}
							className="text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer transition-colors"
							title="Clear search"
						>
							<span className="material-symbols-outlined text-[18px]">close</span>
						</button>
					)}
				</div>
			</div>

			{/* Right Section: Actions & User Profile */}
			<div className="flex items-center gap-3 sm:gap-4">
				{/* Watchlist Icon Button (Only shown if userRole !== 'User') */}
				{userRole !== 'User' && (
					<button
						onClick={() => {
							fetchWatchlistFromDB();
							setIsWatchlistOpen(true);
						}}
						className={`relative w-11 h-11 flex items-center justify-center rounded-full border transition-all cursor-pointer focus:outline-none ${
							isWatchlistOpen
								? 'bg-purple-50 text-[#9462d2] border-purple-300 shadow-md ring-2 ring-purple-100'
								: 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-purple-600 shadow-xs'
						}`}
						aria-label="Watchlist"
						title="Open Watchlist Details Card"
					>
						<span className="material-symbols-outlined" style={{ fontSize: '22px' }}>bookmark</span>
						{watchlistItems.length > 0 && (
							<span className="absolute -top-1 -right-1 w-5 h-5 bg-[#9462d2] text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-xs">
								{watchlistItems.length}
							</span>
						)}
					</button>
				)}

				{/* Dark Mode Toggle */}
				<button
					className="w-11 h-11 flex items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 shadow-xs transition-colors focus:outline-none"
					aria-label="Toggle Dark Mode"
				>
					<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="1.8"
						/>
					</svg>
				</button>

				{/* Notifications */}
				<div className="relative">
					<button
						onClick={() => setIsNotificationCardOpen((prev) => !prev)}
						className={`relative w-11 h-11 flex items-center justify-center rounded-full border transition-all cursor-pointer focus:outline-none ${
							isNotificationCardOpen
								? 'bg-rose-50 text-rose-600 border-rose-300 shadow-md ring-2 ring-rose-100'
								: totalAlertCount > 0
								? 'border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-100/60 shadow-xs'
								: 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-rose-600 shadow-xs'
						}`}
						aria-label="Notifications"
						title="Watchlist Exit Signals & Alerts"
					>
						<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="1.8"
							/>
						</svg>
						{totalAlertCount > 0 && (
							<span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-xs animate-pulse">
								{totalAlertCount}
							</span>
						)}
					</button>

					{/* Notification Card Dropdown */}
					{isNotificationCardOpen && (
						<>
							<div className="fixed inset-0 z-40" onClick={() => setIsNotificationCardOpen(false)}></div>
							<div className="absolute right-0 mt-3 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-100 p-5 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-4">
								<div className="flex items-center justify-between border-b border-slate-100 pb-3">
									<div className="flex items-center gap-2.5">
										<div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
											<span className="material-symbols-outlined text-[18px]">warning</span>
										</div>
										<div>
											<h4 className="text-sm font-bold text-slate-800">Watchlist Exit Alerts</h4>
											<p className="text-[11px] text-slate-400 font-medium">Stocks below 50 DMA &amp; 100 DMA</p>
										</div>
									</div>
									<span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-rose-100 text-rose-700">
										{totalAlertCount} Alerts
									</span>
								</div>

								{/* Summary Counts Row */}
								<div className="grid grid-cols-2 gap-3 text-center">
									<div className="bg-amber-50/80 border border-amber-100 p-2.5 rounded-xl">
										<span className="text-[11px] font-bold text-amber-800 uppercase block">Exit (50 DMA)</span>
										<span className="text-base font-extrabold text-amber-900">{exitStocks.length} Stocks</span>
									</div>
									<div className="bg-rose-50/80 border border-rose-100 p-2.5 rounded-xl">
										<span className="text-[11px] font-bold text-rose-800 uppercase block">Strong Exit (100 DMA)</span>
										<span className="text-base font-extrabold text-rose-900">{strongExitStocks.length} Stocks</span>
									</div>
								</div>

								{/* Affected Stocks List */}
								<div className="max-h-56 overflow-y-auto slim-scroll space-y-2 pr-1">
									{alertStockItems.length > 0 ? (
										alertStockItems.map((item, idx) => (
											<div
												key={idx}
												onClick={(e) => {
													setIsNotificationCardOpen(false);
													handleStockClick(item, e);
												}}
												className="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-purple-50/60 rounded-xl border border-slate-100 transition-colors cursor-pointer group"
											>
												<div className="flex items-center gap-2.5">
													<div className="w-8 h-8 rounded-lg bg-purple-100 text-[#9462d2] flex items-center justify-center font-bold text-xs">
														{(item.ticker || 'AST').slice(0, 2)}
													</div>
													<div>
														<span className="font-bold text-slate-800 text-xs block group-hover:text-[#9462d2] transition-colors">{item.ticker}</span>
														<span className="text-[10px] text-slate-400 font-medium truncate max-w-[120px] block">{item.stockName}</span>
													</div>
												</div>

												<div className="flex items-center gap-1 text-right">
													{item.exit && item.exit.startsWith('Yes') && (
														<span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
															Exit {item.exit.includes('-') ? item.exit.split('-')[1].trim() : ''}
														</span>
													)}
													{item.strongExit && item.strongExit.startsWith('Yes') && (
														<span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white shadow-xs">
															Strong {item.strongExit.includes('-') ? item.strongExit.split('-')[1].trim() : ''}
														</span>
													)}
												</div>
											</div>
										))
									) : (
										<div className="py-6 text-center text-slate-400 text-xs font-medium">
											No exit or strong exit signals in your watchlist. All clear!
										</div>
									)}
								</div>

								{/* Footer Button */}
								<div className="pt-2 border-t border-slate-100">
									<button
										onClick={() => {
											setIsNotificationCardOpen(false);
											fetchWatchlistFromDB();
											setIsWatchlistOpen(true);
										}}
										className="w-full py-2 bg-[#9462d2] hover:bg-purple-700 text-white text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
									>
										<span className="material-symbols-outlined text-[16px]">bookmark</span>
										<span>View My Watchlist</span>
									</button>
								</div>
							</div>
						</>
					)}
				</div>

				{/* User Profile Icon Button (Right after Notification Icon) */}
				<div className="relative">
					<button
						onClick={() => setIsUserProfileCardOpen((prev) => !prev)}
						className={`relative w-11 h-11 flex items-center justify-center rounded-full border transition-all cursor-pointer focus:outline-none ${
							isUserProfileCardOpen
								? 'bg-purple-50 text-[#9462d2] border-purple-300 shadow-md ring-2 ring-purple-100'
								: 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-purple-600 shadow-xs'
						}`}
						aria-label="User Profile"
						title="User Account Details & Options"
					>
						<span className="material-symbols-outlined" style={{ fontSize: '22px' }}>person</span>
					</button>

					{/* User Profile Dropdown Card */}
					{isUserProfileCardOpen && (
						<>
							<div className="fixed inset-0 z-40" onClick={() => setIsUserProfileCardOpen(false)}></div>
							<div className="absolute right-0 mt-3 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 p-4 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-3">
								<div className="flex items-center gap-3 border-b border-slate-100 pb-3">
									<div className="w-10 h-10 rounded-xl bg-[#9462d2] text-white font-bold flex items-center justify-center text-sm shadow-xs flex-shrink-0">
										GR
									</div>
									<div className="min-w-0 flex-1">
										<h4 className="text-sm font-bold text-slate-800 truncate">Gowtham Raj</h4>
										<p className="text-[11px] text-slate-400 font-medium truncate">gowtham@stockinsight.io</p>
									</div>
								</div>

								<div className="space-y-2 bg-slate-50/80 p-3 rounded-xl border border-slate-100">
									<div className="flex items-center justify-between text-xs">
										<span className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">Role</span>
										<span className="px-2.5 py-0.5 rounded-full bg-purple-100 text-[#9462d2] font-extrabold text-[11px] uppercase tracking-wider">
											{userRole}
										</span>
									</div>
									<div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-200/60">
										<span className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">Emp Code</span>
										<span className="font-mono font-bold text-slate-800 text-[12px]">EMP-1001</span>
									</div>
								</div>

								<div className="pt-3 border-t border-slate-100">
									<button
										onClick={() => {
											setIsUserProfileCardOpen(false);
											if (onLogout) onLogout();
										}}
										className="w-full py-3 bg-rose-50 hover:bg-rose-100 text-rose-600 text-sm font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
									>
										<span className="material-symbols-outlined text-[16px]">logout</span>
										<span>Logout Account</span>
									</button>
								</div>
							</div>
						</>
					)}
				</div>
			</div>

			{/* Floating Auto-Notification Toast Banner Card on Page Load */}
			{isNotificationBannerOpen && totalAlertCount > 0 && ReactDOM.createPortal(
				<div className="fixed top-5 right-5 z-[99999] max-w-sm w-full bg-white rounded-2xl shadow-2xl border border-rose-200 p-4 animate-in slide-in-from-top-5 duration-300 flex items-start gap-3.5">
					<div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0 shadow-xs">
						<span className="material-symbols-outlined text-[22px]">warning</span>
					</div>

					<div className="flex-1 min-w-0">
						<div className="flex items-center justify-between">
							<h4 className="text-xs font-bold text-rose-900 uppercase tracking-wider">Watchlist Exit Alert</h4>
							<button
								onClick={() => setIsNotificationBannerOpen(false)}
								className="w-8 h-8 flex justify-center items-center bg-slate-100 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full cursor-pointer"
							>
								<span className="material-symbols-outlined text-[16px]">close</span>
							</button>
						</div>

						<p className="text-xs text-slate-700 font-semibold mt-1">
							{exitStocks.length > 0 && `${exitStocks.length} stock(s) hit Exit (50 DMA)`}
							{exitStocks.length > 0 && strongExitStocks.length > 0 && ' & '}
							{strongExitStocks.length > 0 && `${strongExitStocks.length} stock(s) hit Strong Exit (100 DMA)`}
						</p>

						<div className="flex items-center gap-2 mt-2.5">
							<button
								onClick={() => {
									setIsNotificationBannerOpen(false);
									fetchWatchlistFromDB();
									setIsWatchlistOpen(true);
								}}
								className="px-3 py-2 bg-rose-600 text-white text-xs font-bold rounded-lg hover:bg-rose-700 transition-colors shadow-xs cursor-pointer"
							>
								Open Watchlist
							</button>
							<button
								onClick={() => setIsNotificationBannerOpen(false)}
								className="px-2.5 py-2 text-xs font-semibold text-slate-500 bg-slate-100 cursor-pointer hover:text-slate-800 hover:bg-slate-200 rounded-lg"
							>
								Dismiss
							</button>
						</div>
					</div>
				</div>,
				document.body
			)}

			{/* Watchlist Details Card Modal Popup Overlay */}
			{isWatchlistOpen && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-[85%] w-full h-[620px] max-h-[90vh] flex flex-col border border-slate-100 overflow-hidden">
						
						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/80">
							<div className="flex items-center gap-3.5">
								<div className="w-10 h-10 rounded-xl bg-purple-100 text-[#9462d2] flex items-center justify-center shadow-xs">
									<span className="material-symbols-outlined text-[24px]">bookmark</span>
								</div>
								<div>
									<h2 className="text-2xl font-bold text-slate-800">
										My Watchlist
									</h2>
								</div>
							</div>

							<div className="flex items-center gap-3">
								<button
									onClick={() => setIsManageGroupsModalOpen(true)}
									className="px-3.5 py-2 rounded-xl bg-purple-50 text-[#9462d2] hover:bg-purple-100 transition-all text-xs font-bold flex items-center gap-1.5 border border-purple-200/60 shadow-xs cursor-pointer"
									title="Manage Watchlist Groups (Edit & Delete)"
								>
									<span className="material-symbols-outlined text-[18px]">folder_managed</span>
									<span>Groups ({dbGroups.length})</span>
								</button>
								<button
									onClick={() => setIsCreateGroupModalOpen(true)}
									className="px-3.5 py-2 rounded-xl bg-[#9462d2] text-white hover:bg-purple-700 transition-all text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
								>
									<span className="material-symbols-outlined text-[18px]">add_circle</span>
									<span>Create Group</span>
								</button>
								<button
									onClick={() => {
										setIsWatchlistOpen(false);
										setIsAddingStock(false);
									}}
									className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition-colors cursor-pointer"
								>
									<span className="material-symbols-outlined text-[22px]">close</span>
								</button>
							</div>
						</div>

						{/* Inline Add Stock Form Banner */}
						{isAddingStock && (
							<form onSubmit={handleAddStock} className="px-6 py-3 bg-purple-50/80 border-b border-purple-100 flex items-center gap-3 animate-in slide-in-from-top duration-150">
								<span className="text-xs font-bold text-purple-900 whitespace-nowrap">Add New Asset to DB Watchlist:</span>
								<input
									type="text"
									placeholder="Enter stock/commodity ticker symbol e.g. TATAMOTORS or GC=F..."
									value={newStockSymbol}
									onChange={(e) => setNewStockSymbol(e.target.value)}
									autoFocus
									className="flex-1 bg-white border border-purple-200 rounded-lg px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-100"
								/>
								<button
									type="submit"
									className="px-4 py-2 bg-[#9462d2] text-white text-xs font-bold rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
								>
									Save Asset
								</button>
								<button
									type="button"
									onClick={() => setIsAddingStock(false)}
									className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
								>
									Cancel
								</button>
							</form>
						)}

						{/* Modal Body View */}
						<div className="flex-1 overflow-y-auto px-6 py-6 slim-scroll space-y-6">
							{/* Watchlist Filter & Table Controls */}
							<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
								{/* Group Filter Sub-Tabs */}
								<div className="flex items-center gap-2 overflow-x-auto pb-1 slim-scroll">
									<button
										onClick={() => toggleGroupFilter('ALL')}
										className={`px-3 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
											selectedGroupFilters.length === 0
												? 'bg-[#9462d2] text-white shadow-xs'
												: 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
										}`}
									>
										<span>All Groups</span>
										<span className={`px-1.5 py-0.2 rounded-full text-[10px] ${selectedGroupFilters.length === 0 ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
											{watchlistItems.length}
										</span>
									</button>
								</div>

								{/* Search & Custom Multi-Select Checkbox Group Filter */}
								<div className="flex items-center gap-3">
									<div className="relative inline-block text-left">
										<div className="flex items-center gap-1.5">
											<button
												type="button"
												onClick={() => setIsGroupDropdownOpen((prev) => !prev)}
												className="bg-[#9462d2]/10 border border-[#9462d2]/40 hover:bg-[#9462d2]/20 text-[#9462d2] text-xs font-bold rounded-xl px-3 py-1.5 outline-none transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
											>
												<span className="max-w-[160px] truncate">
													{getGroupDropdownLabel()}
												</span>
												<span className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${isGroupDropdownOpen ? 'rotate-180' : ''}`}>
													keyboard_arrow_down
												</span>
											</button>
										</div>

										{/* Custom Rounded Multi-Select Dropdown Menu Card */}
										{isGroupDropdownOpen && (
											<>
												<div className="fixed inset-0 z-40" onClick={() => setIsGroupDropdownOpen(false)}></div>
												<div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-purple-100 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-1">
													<div
														onClick={() => toggleGroupFilter('ALL')}
														className={`w-full text-left px-3 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-between cursor-pointer ${
															selectedGroupFilters.length === 0
																? 'bg-purple-50 text-[#9462d2]'
																: 'text-slate-700 hover:bg-purple-50/60 hover:text-[#9462d2]'
														}`}
													>
														<div className="flex items-center gap-2.5">
															<input
																type="checkbox"
																checked={selectedGroupFilters.length === 0}
																onChange={() => {}}
																className="w-4 h-4 rounded border-purple-300 text-[#9462d2] focus:ring-[#9462d2] cursor-pointer"
															/>
															<span>All Groups</span>
														</div>
														<span className={`px-2 py-0.5 rounded-full text-[10px] ${selectedGroupFilters.length === 0 ? 'bg-purple-100 text-[#9462d2]' : 'bg-slate-100 text-slate-600'}`}>
															{watchlistItems.length}
														</span>
													</div>

													<div className="border-t border-slate-100 my-1"></div>

													{dbGroups.map((g) => {
														const isSel = selectedGroupFilters.some((name) => name.toLowerCase() === g.name.toLowerCase());
														return (
															<div
																key={g.id || g.name}
																onClick={() => toggleGroupFilter(g.name)}
																className={`w-full text-left px-3 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-between cursor-pointer ${
																	isSel
																		? 'bg-purple-50 text-[#9462d2]'
																		: 'text-slate-700 hover:bg-purple-50/60 hover:text-[#9462d2]'
																}`}
															>
																<div className="flex items-center gap-2.5 min-w-0">
																	<input
																		type="checkbox"
																		checked={isSel}
																		onChange={() => {}}
																		className="w-4 h-4 rounded border-purple-300 text-[#9462d2] focus:ring-[#9462d2] cursor-pointer"
																	/>
																	<span className="truncate">{g.name}</span>
																</div>
																<span className={`px-2 py-0.5 rounded-full text-[10px] ml-2 ${isSel ? 'bg-purple-100 text-[#9462d2]' : 'bg-slate-100 text-slate-600'}`}>
																	{g.items ? g.items.length : 0}
																</span>
															</div>
														);
													})}
												</div>
											</>
										)}
									</div>

									<div className="relative flex items-center w-56 h-9 bg-slate-100/70 rounded-xl px-3">
										<span className="material-symbols-outlined text-[16px] text-slate-400 mr-2">search</span>
										<input
											type="text"
											placeholder="Search watchlist..."
											value={watchlistSearch}
											onChange={(e) => setWatchlistSearch(e.target.value)}
											className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder-slate-400 p-0"
										/>
										{watchlistSearch && (
											<button onClick={() => setWatchlistSearch('')} className="text-slate-400 hover:text-slate-600">
												<span className="material-symbols-outlined text-[14px]">close</span>
											</button>
										)}
									</div>
								</div>
							</div>

							{/* Watchlist Assets Table */}
							<div className="overflow-x-auto border border-slate-100 rounded-xl shadow-2xs">
								<table className="w-full text-left border-collapse min-w-max">
									<thead>
										<tr className="bg-[#F1F5F9] text-slate-700 text-xs font-semibold">
											<th className="py-3 px-4">Asset Name</th>
											<th className="py-3 px-4">Group</th>
											<th className="py-3 px-4">Price</th>
											<th className="py-3 px-4 text-center">Exit</th>
											<th className="py-3 px-4 text-center">Strong Exit</th>
											<th className="py-3 px-4 text-center">Actions</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 text-sm">
										{loading ? (
											<tr>
												<td colSpan="6" className="py-12 text-center text-slate-400 text-xs font-medium">
													Loading watchlist from database...
												</td>
											</tr>
										) : filteredWatchlist.length > 0 ? (
											filteredWatchlist.map((item, idx) => (
												<tr
													key={item.id || idx}
													onClick={(e) => handleStockClick(item, e)}
													className="hover:bg-purple-50/60 transition-colors cursor-pointer group"
													title={`Click to view ${item.ticker} in Analysis Trades`}
												>
													{/* Asset Name */}
													<td className="py-3 px-4">
														<div className="flex items-center gap-3">
															<div className="w-9 h-9 rounded-xl bg-purple-100 text-[#9462d2] flex items-center justify-center font-bold text-xs">
																{(item.ticker || 'AST').substring(0, 2)}
															</div>
															<div>
																<span className="font-bold text-slate-800 text-sm block group-hover:text-[#9462d2] transition-colors">{item.stockName || item.name || item.ticker}</span>
																<span className="text-xs text-slate-400 font-medium">{item.ticker}</span>
															</div>
														</div>
													</td>

													{/* Category / Group Name */}
													<td className="py-3 px-4 text-xs font-semibold text-slate-600 whitespace-nowrap">
														<span className="px-2.5 py-1 rounded-full bg-purple-50 text-[#9462d2] border border-purple-100/60 font-bold">
															{item.groupName || item.category || 'General'}
														</span>
													</td>

													{/* Price */}
													<td className="py-3 px-4 text-sm font-bold text-slate-800 whitespace-nowrap">
														{item.price || '—'}
													</td>

													{/* Exit */}
													<td className="py-3 px-4 text-center whitespace-nowrap">
														{item.exit && item.exit.startsWith('Yes') ? (
															<div className="inline-flex items-center justify-center gap-1.5">
																<span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100/90 text-amber-800 border border-amber-200/80">
																	Yes
																</span>
																<span className="text-xs font-semibold text-slate-600">
																	{item.exit.includes('-') ? item.exit.split('-')[1].trim() : ''}
																</span>
															</div>
														) : (
															<span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
																No
															</span>
														)}
													</td>

													{/* Strong Exit */}
													<td className="py-3 px-4 text-center whitespace-nowrap">
														{item.strongExit && item.strongExit.startsWith('Yes') ? (
															<div className="inline-flex items-center justify-center gap-1.5">
																<span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-rose-600 text-white shadow-xs">
																	Yes
																</span>
																<span className="text-xs font-semibold text-slate-600">
																	{item.strongExit.includes('-') ? item.strongExit.split('-')[1].trim() : ''}
																</span>
															</div>
														) : (
															<span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
																No
															</span>
														)}
													</td>

													{/* Actions */}
													<td className="py-3 px-4 text-center whitespace-nowrap">
														<button
															onClick={(e) => handleRemoveWatchlistItem(item, e)}
															className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all inline-flex items-center justify-center border border-transparent hover:border-rose-200/60 cursor-pointer"
															title="Remove from DB Watchlist"
														>
															<span className="material-symbols-outlined text-[18px]">bookmark_remove</span>
														</button>
													</td>
												</tr>
											))
										) : (
											<tr>
												<td colSpan="6" className="py-12 text-center text-slate-400 text-xs font-medium">
													{watchlistSearch ? `No watchlist assets matching "${watchlistSearch}"` : 'No stocks saved in database watchlist yet.'}
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						</div>

					</div>
				</div>,
				document.body
			)}

			{/* Create Group Popup Card Modal */}
			{isCreateGroupModalOpen && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[100000] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150 space-y-5">
						<div className="flex items-center justify-between border-b border-slate-100 pb-4">
							<div className="flex items-center gap-3">
								<div className="w-10 h-10 rounded-xl bg-purple-100 text-[#9462d2] flex items-center justify-center font-bold shadow-xs">
									<span className="material-symbols-outlined text-[22px]">create_new_folder</span>
								</div>
								<div>
									<h3 className="text-base font-bold text-slate-800 leading-tight">Create New Group</h3>
									<p className="text-xs text-slate-400 font-medium">Add a custom watchlist category to database</p>
								</div>
							</div>
							<button
								onClick={() => {
									setIsCreateGroupModalOpen(false);
									setNewGroupNameInput('');
								}}
								className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[20px]">close</span>
							</button>
						</div>

						<form onSubmit={handleCreateGroupSubmit} className="space-y-4">
							<div>
								<label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
									Watchlist Group Name:
								</label>
								<input
									type="text"
									placeholder="e.g. Top Gainers, High Conviction, Energy Stocks..."
									value={newGroupNameInput}
									onChange={(e) => setNewGroupNameInput(e.target.value)}
									autoFocus
									className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:border-[#9462d2] focus:ring-2 focus:ring-purple-100 font-medium transition-all"
								/>
							</div>

							<div className="flex items-center justify-end gap-3 pt-2">
								<button
									type="button"
									onClick={() => {
										setIsCreateGroupModalOpen(false);
										setNewGroupNameInput('');
									}}
									className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="submit"
									className="px-5 py-2.5 bg-[#9462d2] hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
								>
									<span className="material-symbols-outlined text-[16px]">check_circle</span>
									<span>Save Group</span>
								</button>
							</div>
						</form>
					</div>
				</div>,
				document.body
			)}

			{/* Manage Watchlist Groups Modal Card Popup */}
			{isManageGroupsModalOpen && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[100000] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150 space-y-5">
						
						{/* Header */}
						<div className="flex items-center justify-between border-b border-slate-100 pb-4">
							<div className="flex items-center gap-3">
								<div className="w-10 h-10 rounded-xl bg-purple-100 text-[#9462d2] flex items-center justify-center font-bold shadow-xs">
									<span className="material-symbols-outlined text-[22px]">folder_managed</span>
								</div>
								<div>
									<h3 className="text-base font-bold text-slate-800 leading-tight">Manage Watchlist Groups</h3>
									<p className="text-xs text-slate-400 font-medium">Edit name or delete watchlist categories ({dbGroups.length} Groups)</p>
								</div>
							</div>
							<button
								onClick={() => {
									setIsManageGroupsModalOpen(false);
									setEditingGroupId(null);
								}}
								className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
							>
								<span className="material-symbols-outlined text-[20px]">close</span>
							</button>
						</div>

						{/* Groups List */}
						<div className="max-h-80 overflow-y-auto slim-scroll space-y-2.5 pr-1">
							{dbGroups.length > 0 ? (
								dbGroups.map((g) => {
									const isEditingThis = editingGroupId === g.id || editingGroupId === g.name;
									const itemCount = g.items ? g.items.length : 0;
									return (
										<div
											key={g.id || g.name}
											className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-3 transition-colors"
										>
											{isEditingThis ? (
												<form
													onSubmit={(e) => {
														e.preventDefault();
														handleRenameGroupSubmit(g.name);
													}}
													className="flex items-center gap-2 w-full"
												>
													<input
														type="text"
														value={editingGroupNameInput}
														onChange={(e) => setEditingGroupNameInput(e.target.value)}
														autoFocus
														className="flex-1 bg-white border border-purple-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-bold outline-none focus:ring-2 focus:ring-purple-100"
													/>
													<button
														type="submit"
														className="px-3 py-1.5 bg-[#9462d2] text-white text-xs font-bold rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
													>
														Save
													</button>
													<button
														type="button"
														onClick={() => setEditingGroupId(null)}
														className="px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800"
													>
														Cancel
													</button>
												</form>
											) : (
												<>
													<div className="flex items-center gap-3 min-w-0">
														<div className="w-8 h-8 rounded-lg bg-purple-100/80 text-[#9462d2] flex items-center justify-center font-bold">
															<span className="material-symbols-outlined text-[18px]">folder</span>
														</div>
														<div className="min-w-0">
															<h4 className="text-xs font-bold text-slate-800 truncate">{g.name}</h4>
															<span className="text-[11px] font-semibold text-slate-400 block">{itemCount} Stocks</span>
														</div>
													</div>

													<div className="flex items-center gap-1.5">
														<button
															onClick={() => {
																setEditingGroupId(g.id || g.name);
																setEditingGroupNameInput(g.name);
															}}
															className="w-8 h-8 rounded-lg text-slate-500 hover:text-[#9462d2] hover:bg-purple-50 flex items-center justify-center transition-all cursor-pointer border border-transparent hover:border-purple-200/60"
															title="Edit / Rename Group"
														>
															<span className="material-symbols-outlined text-[18px]">edit</span>
														</button>
														<button
															onClick={() => promptDeleteGroup(g.name)}
															className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-all cursor-pointer border border-transparent hover:border-rose-200/60"
															title="Delete Group"
														>
															<span className="material-symbols-outlined text-[18px]">delete</span>
														</button>
													</div>
												</>
											)}
										</div>
									);
								})
							) : (
								<div className="py-8 text-center text-slate-400 text-xs font-medium">
									No watchlist groups found in database.
								</div>
							)}
						</div>

						{/* Footer Actions */}
						<div className="flex items-center justify-between border-t border-slate-100 pt-3">
							<button
								onClick={() => {
									setIsManageGroupsModalOpen(false);
									setIsCreateGroupModalOpen(true);
								}}
								className="px-3.5 py-2 text-xs font-bold text-[#9462d2] hover:bg-purple-50 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
							>
								<span className="material-symbols-outlined text-[16px]">add_circle</span>
								<span>Create New Group</span>
							</button>
							<button
								onClick={() => {
									setIsManageGroupsModalOpen(false);
									setEditingGroupId(null);
								}}
								className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
							>
								Done
							</button>
						</div>
					</div>
				</div>,
				document.body
			)}

			{/* Custom Delete Group Confirmation Card Modal Popup */}
			{isDeleteGroupConfirmOpen && groupToDelete && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[110000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 space-y-4">
						<div className="flex items-center gap-3.5">
							<div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0 shadow-xs">
								<span className="material-symbols-outlined text-[24px]">delete_forever</span>
							</div>
							<div>
								<h3 className="text-base font-bold text-slate-900">Delete Watchlist Group?</h3>
								<p className="text-xs text-slate-500 font-medium">This action cannot be undone</p>
							</div>
						</div>

						<div className="bg-rose-50/70 border border-rose-100 p-3.5 rounded-xl text-xs text-rose-900 leading-relaxed font-medium">
							Are you sure you want to delete <span className="font-extrabold text-rose-950">"{groupToDelete}"</span>? This will also remove all watchlist stocks saved under this group from your database.
						</div>

						<div className="flex items-center justify-end gap-2.5 pt-2">
							<button
								onClick={() => {
									setIsDeleteGroupConfirmOpen(false);
									setGroupToDelete(null);
								}}
								className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
							>
								Cancel
							</button>
							<button
								onClick={confirmDeleteGroup}
								className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
							>
								<span className="material-symbols-outlined text-[16px]">delete</span>
								<span>Delete Group</span>
							</button>
						</div>
					</div>
				</div>,
				document.body
			)}
		</header>
	);
}
