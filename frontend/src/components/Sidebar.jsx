import React, { useState } from 'react';

export default function Sidebar({
	activeMenu = 'Dashboard',
	setActiveMenu,
	activeTab = 'Trades',
	setActiveTab,
	userRole = 'Super Admin'
}) {
	const [isHovered, setIsHovered] = useState(false);
	const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(true);

	const mainMenuItems = [
		{
			name: 'Dashboard',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">view_cozy</span>
		},
		{
			name: 'Analysis',
			icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">search_insights</span>,
			hasSubmenu: true
		},
		...(userRole === 'Super Admin'
			? [
					{
						name: 'Users',
						icon: <span className="material-symbols-outlined text-[20px] leading-none select-none">group</span>
					}
			  ]
			: [])
	];

	const analysisSubItems = [
		{
			name: 'Nifty Stocks',
			icon: <span className="material-symbols-outlined text-[16px] leading-none select-none">candlestick_chart</span>,
			targetTab: 'Trades'
		},
		{
			name: 'Global',
			icon: <span className="material-symbols-outlined text-[16px] leading-none select-none">globe_asia</span>,
			targetTab: 'Global'
		},
		{
			name: 'Commodity',
			icon: <span className="material-symbols-outlined text-[16px] leading-none select-none">oil_barrel</span>,
			targetTab: 'Commodity'
		},
		{
			name: 'Sectoral',
			icon: <span className="material-symbols-outlined text-[16px] leading-none select-none">hive</span>,
			targetTab: 'Sectoral'
		},
		{
			name: 'Cashflow',
			icon: <span className="material-symbols-outlined text-[16px] leading-none select-none">compare_arrows</span>,
			targetTab: 'CashFlow'
		}
	];

	const isNiftyTab = ['Trades', 'Ownership', 'Trends', 'Breakout', 'Metrics', 'Consensus', 'Sentiment', 'Tara'].includes(activeTab);

	return (
		<aside
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			className={`fixed top-0 left-0 z-50 flex h-screen flex-col border-r border-gray-200 bg-white text-gray-900 transition-all duration-300 ease-in-out ${
				isHovered ? 'w-[290px] px-5 shadow-2xl' : 'w-[90px] px-3 shadow-sm'
			}`}
			data-purpose="sidebar"
		>
			{/* Logo Section */}
			<div className={`py-8 flex items-center ${isHovered ? 'justify-between px-1' : 'justify-center'}`}>
				<div className="flex items-center gap-3">
					<div className="bg-[#9462d2] p-2 rounded-xl shadow-sm flex items-center justify-center flex-shrink-0 text-white">
						<span className="material-symbols-outlined text-[24px] leading-none select-none text-white">monitoring</span>
					</div>
					{isHovered && (
						<span className="text-[#101828] text-2xl font-bold tracking-tight whitespace-nowrap">StockInsight</span>
					)}
				</div>
			</div>

			{/* Navigation Menu */}
			<nav className="flex-1 overflow-y-auto sidebar-scroll">
				<div className="mb-6">
					{isHovered && (
						<h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 mb-4">MENU</h3>
					)}
					<ul className="space-y-1">
						{mainMenuItems.map((item) => {
							const isActive = activeMenu === item.name;
							return (
								<li key={item.name}>
									<a
										href="#"
										title={!isHovered ? item.name : undefined}
										onClick={(e) => {
											e.preventDefault();
											setActiveMenu(item.name);
											if (item.name === 'Analysis') {
												setIsAnalysisExpanded((prev) => !prev);
												if (activeMenu !== 'Analysis') {
													setActiveTab('Trades');
												}
											}
										}}
										className={`flex items-center rounded-xl transition-all group ${
											isHovered ? 'justify-between px-2.5 py-2' : 'justify-center p-2'
										} ${
											isActive
												? 'bg-[#9462d2]/10 text-[#9462d2] font-semibold'
												: 'bg-white text-slate-700 hover:bg-[#9462d2]/10 hover:text-[#9462d2]'
										}`}
									>
										<div className={`flex items-center ${isHovered ? 'gap-3' : 'justify-center'}`}>
											<div
												className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
													isActive
														? 'bg-[#9462d2] text-white shadow-sm'
														: 'bg-transparent text-slate-600 group-hover:text-[#9462d2]'
												}`}
											>
												{item.icon}
											</div>
											{isHovered && (
												<span className="text-sm font-medium whitespace-nowrap">{item.name}</span>
											)}
										</div>
										{isHovered && item.hasSubmenu && (
											<span className="material-symbols-outlined text-[18px] text-slate-400">
												{isAnalysisExpanded && activeMenu === 'Analysis' ? 'expand_less' : 'expand_more'}
											</span>
										)}
									</a>

									{/* Analysis Submenu */}
									{item.name === 'Analysis' && isAnalysisExpanded && isHovered && (
										<ul className="mt-1.5 ml-7 space-y-1 border-l-2 border-slate-100 pl-3">
											{analysisSubItems.map((sub) => {
												const isSubActive =
													activeMenu === 'Analysis' &&
													((sub.name === 'Nifty Stocks' && isNiftyTab) ||
														(sub.name === 'Global' && activeTab === 'Global') ||
														(sub.name === 'Commodity' && activeTab === 'Commodity') ||
														(sub.name === 'Sectoral' && activeTab === 'Sectoral') ||
														(sub.name === 'Cashflow' && activeTab === 'CashFlow'));

												return (
													<li key={sub.name}>
														<button
															onClick={() => {
																setActiveMenu('Analysis');
																if (sub.name === 'Nifty Stocks') {
																	if (!isNiftyTab) {
																		setActiveTab('Trades');
																	}
																} else {
																	setActiveTab(sub.targetTab);
																}
															}}
															className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer ${
																isSubActive
																	? 'bg-[#9462d2] text-white shadow-xs'
																	: 'text-slate-600 hover:text-[#9462d2] hover:bg-purple-50/60'
															}`}
														>
															<span className="w-5 h-5 flex items-center justify-center">{sub.icon}</span>
															<span>{sub.name}</span>
														</button>
													</li>
												);
											})}
										</ul>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			</nav>
		</aside>
	);
}
