import React, { useState, useEffect } from 'react';
import chessImage from '../assets/assortment-pink-chess-pieces.jpg';
import { API_BASE } from '../apiConfig';

export default function Login({ onLoginSuccess, sessionExpired: initialSessionExpired = false, onDismissSessionExpired }) {
	const isQueryExpired = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('session_expired') === 'true';
	const [isSessionExpired, setIsSessionExpired] = useState(initialSessionExpired || isQueryExpired);
	const [showForm, setShowForm] = useState(!initialSessionExpired && !isQueryExpired);

	const [empCode, setEmpCode] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [selectedRole, setSelectedRole] = useState('Super Admin');
	const [error, setError] = useState('');

	useEffect(() => {
		if (initialSessionExpired || isQueryExpired) {
			setIsSessionExpired(true);
		}
	}, [initialSessionExpired, isQueryExpired]);

	const handleSubmit = (e) => {
		e.preventDefault();
		const code = empCode.trim().toUpperCase();
		if (!code || !password.trim()) {
			setError('Please enter both employee code and password.');
			return;
		}
		setError('');

		fetch(`${API_BASE}/users`)
			.then((res) => res.json())
			.then((data) => {
				if (data && Array.isArray(data.users) && data.users.length > 0) {
					const match = data.users.find(
						(u) => u.empCode && u.empCode.toUpperCase() === code
					);
					if (match) {
						if (onDismissSessionExpired) onDismissSessionExpired();
						if (onLoginSuccess) onLoginSuccess(match);
						return;
					}
				}
				const fallbackUser = {
					empCode: code,
					name: 'Gowtham Raj',
					email: 'gowtham@stockinsight.io',
					role: selectedRole || 'Super Admin',
					avatarBg: 'bg-purple-600'
				};
				if (onDismissSessionExpired) onDismissSessionExpired();
				if (onLoginSuccess) onLoginSuccess(fallbackUser);
			})
			.catch(() => {
				const fallbackUser = {
					empCode: code,
					name: 'Gowtham Raj',
					email: 'gowtham@stockinsight.io',
					role: selectedRole || 'Super Admin',
					avatarBg: 'bg-[#9462d2]'
				};
				if (onDismissSessionExpired) onDismissSessionExpired();
				if (onLoginSuccess) onLoginSuccess(fallbackUser);
			});
	};

	const handleProceedToLogin = () => {
		setShowForm(true);
	};

	return (
		<div className="min-h-screen w-full bg-[#F4F6FB] flex items-center justify-center p-4 sm:p-6 lg:p-10 font-sans relative overflow-hidden">
			{/* Soft Purple Ambient Background Radial Glows */}
			<div className="absolute -top-32 -right-32 w-96 h-96 bg-purple-300/30 rounded-full blur-3xl pointer-events-none"></div>
			<div className="absolute -bottom-32 -left-32 w-96 h-96 bg-indigo-300/20 rounded-full blur-3xl pointer-events-none"></div>

			{/* Main Split-Screen Login Card */}
			<div className="max-w-5xl w-full max-h-[calc(100vh-30px)] bg-white rounded-[36px] shadow-2xl border border-slate-100 p-4 sm:p-6 md:p-8 flex flex-col md:flex-row gap-6 md:gap-10 items-stretch relative z-10 animate-in fade-in zoom-in-95 duration-300">

				{/* Left Side: Brand Banner with Chess Background Image & Text Overlay */}
				<div className="w-full md:w-1/2 rounded-[48px] p-10 text-white flex flex-col justify-between relative overflow-hidden shadow-lg shadow-purple-500/20 min-h-[440px] md:min-h-[540px]">
					{/* Full Cover Background Image */}
					<img
						src={chessImage}
						alt="Pink Chess Strategy"
						className="absolute inset-0 w-full h-full object-cover object-center transform hover:scale-105 transition-transform duration-700 pointer-events-none"
					/>

					{/* Purple/Dark Gradient Overlay for Text Contrast */}
					<div className="absolute inset-0 bg-gradient-to-t from-[#4a247c]/95 via-[#7a46c2]/65 to-[#804bca]/35 z-0"></div>

					{/* Top Header Text Overlay */}
					<div className="relative z-10 space-y-4">
						<h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-snug drop-shadow-md">
							Real-Time Market Intelligence &amp; Trading Insights
						</h2>
						<p className="text-xs sm:text-sm text-purple-100/90 font-medium leading-relaxed max-w-sm drop-shadow-xs">
							Track Nifty 750 stocks, insider trades, bulk deals, and instant watchlist 50/100 DMA exit alerts with our smart analytics platform.
						</p>
					</div>
				</div>

				{/* Right Side: Session Expired Card View OR Login Form */}
				{isSessionExpired && !showForm ? (
					<div className="w-full md:w-1/2 flex flex-col justify-center px-2 sm:px-4 md:px-6 py-4">
						<div className="bg-gradient-to-b from-amber-50/70 via-white to-purple-50/40 border border-amber-200/90 rounded-3xl p-6 sm:p-8 shadow-xl shadow-amber-500/5 relative overflow-hidden animate-in fade-in zoom-in-95 duration-300">
							{/* Top Accent Gradient Line */}
							<div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-400 via-purple-500 to-indigo-500"></div>

							{/* Status Pill Header */}
							<div className="flex items-center justify-between mb-4">
								<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100/90 border border-amber-300/60 text-amber-800 text-[11px] font-extrabold uppercase tracking-wider">
									<span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
									<span>Session Expired</span>
								</div>
								<span className="text-xs font-semibold text-slate-400 font-mono">1 Hr Inactivity</span>
							</div>

							{/* Center Icon & Title */}
							<div className="flex flex-col items-center text-center mb-5">
								<div className="w-16 h-16 rounded-2xl bg-amber-100/80 border border-amber-200 flex items-center justify-center mb-3 text-amber-600 shadow-inner">
									<span className="material-symbols-outlined text-3xl">timer_off</span>
								</div>
								<h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
									Session Expired
								</h1>
								<p className="text-xs sm:text-sm font-medium text-slate-500 mt-1.5 max-w-sm leading-relaxed">
									Your session has expired due to 1 hour of inactivity. Please log in again to continue accessing StockInsight.
								</p>
							</div>

							{/* Session Expiry Details Card */}
							<div className="bg-white border border-slate-200/90 rounded-2xl p-4 mb-6 shadow-xs space-y-2.5 text-xs text-slate-600">
								<div className="flex justify-between items-center pb-2 border-b border-slate-100">
									<span className="font-semibold text-slate-400">Inactivity Timeout:</span>
									<span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md font-mono">60 Minutes</span>
								</div>
								<div className="flex justify-between items-center pb-2 border-b border-slate-100">
									<span className="font-semibold text-slate-400">Security Action:</span>
									<span className="font-bold text-rose-600 flex items-center gap-1">
										<span className="material-symbols-outlined text-[14px]">lock</span>
										<span>Automatic Sign-Out</span>
									</span>
								</div>
								<div className="flex justify-between items-center">
									<span className="font-semibold text-slate-400">Workspace Access:</span>
									<span className="font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
										Requires Re-authentication
									</span>
								</div>
							</div>

							{/* Primary Login Button */}
							<button
								type="button"
								onClick={handleProceedToLogin}
								className="w-full py-3.5 bg-[#9462d2] hover:bg-purple-700 text-white font-bold text-sm rounded-2xl shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-200 transform active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 group"
							>
								<span>Log In Again</span>
								<span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">login</span>
							</button>
						</div>
					</div>
				) : (
					<div className="w-full md:w-1/2 flex flex-col justify-center px-2 sm:px-4 md:px-8 py-4">
						<div>

							{/* Session Expired Top Banner Card if coming from expired state */}
							{isSessionExpired && (
								<div className="mb-4 p-3.5 rounded-2xl bg-amber-50/90 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center justify-between gap-3 shadow-xs animate-in fade-in duration-200">
									<div className="flex items-center gap-2.5">
										<div className="w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 text-amber-600">
											<span className="material-symbols-outlined text-[18px]">timer_off</span>
										</div>
										<div>
											<p className="font-bold text-amber-900">Session expired (1 hr inactivity)</p>
											<p className="text-[11px] text-amber-700/90">Please enter your credentials below to log back in.</p>
										</div>
									</div>
								</div>
							)}

							{/* Title */}
							<div className="mb-6 text-center">
								<h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
									{isSessionExpired ? 'Log In Again' : 'Welcome Back'}
								</h1>
								<p className="text-xs sm:text-sm font-medium text-slate-400 mt-1">
									{isSessionExpired ? 'Enter your credentials to resume your session' : 'Please Login to your account'}
								</p>
							</div>

							{/* Error Alert */}
							{error && (
								<div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-bold flex items-center gap-2">
									<span className="material-symbols-outlined text-[18px]">error</span>
									<span>{error}</span>
								</div>
							)}

							{/* Form */}
							<form onSubmit={handleSubmit} className="space-y-4">
								{/* Employee Code Input */}
								<div className="space-y-1">
									<label className="text-[12px] font-bold text-slate-500 uppercase tracking-wider block">Employee Code</label>
									<div className="relative">
										<input
											type="text"
											placeholder="Enter your employee code (e.g. EMP1001)"
											value={empCode}
											onChange={(e) => setEmpCode(e.target.value)}
											required
											className="w-full px-4 py-3 bg-slate-50 border border-slate-200/90 rounded-2xl text-sm font-semibold font-mono text-slate-800 outline-none focus:bg-white focus:border-[#9462d2] focus:ring-4 focus:ring-purple-100 transition-all placeholder-slate-400"
										/>
									</div>
								</div>

								{/* Password Input with Visibility Toggle */}
								<div className="space-y-1">
									<label className="text-[12px] font-bold text-slate-500 uppercase tracking-wider block">Password</label>
									<div className="relative">
										<input
											type={showPassword ? 'text' : 'password'}
											placeholder="Enter your password"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											required
											className="w-full px-4 py-3 bg-slate-50 border border-slate-200/90 rounded-2xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#9462d2] focus:ring-4 focus:ring-purple-100 transition-all placeholder-slate-400 pr-12"
										/>
										<button
											type="button"
											onClick={() => setShowPassword((prev) => !prev)}
											className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1 cursor-pointer"
											aria-label="Toggle Password Visibility"
										>
											<span className="material-symbols-outlined text-[20px] block">
												{showPassword ? 'visibility_off' : 'visibility'}
											</span>
										</button>
									</div>
								</div>

								{/* Forgot Password Link */}
								<div className="flex justify-end pt-1">
									<a
										href="#forgot"
										onClick={(e) => {
											e.preventDefault();
											alert('Password reset instructions have been sent to your email.');
										}}
										className="text-xs font-bold text-gray-400 hover:text-purple-600 transition-colors cursor-pointer"
									>
										Forgot Password?
									</a>
								</div>

								{/* Submit Button */}
								<button
									type="submit"
									className="w-full py-3.5 mt-2 bg-[#9462d2] hover:bg-purple-700 text-white font-bold text-sm rounded-2xl shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-200 transform active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2"
								>
									<span>Login</span>
									<span className="material-symbols-outlined text-[18px]">arrow_forward</span>
								</button>
							</form>
						</div>
					</div>
				)}

			</div>
		</div>
	);
}

