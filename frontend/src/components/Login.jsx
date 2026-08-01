import React, { useState } from 'react';
import chessImage from '../assets/assortment-pink-chess-pieces.jpg';
import { API_BASE } from '../apiConfig';

export default function Login({ onLoginSuccess }) {
	const [empCode, setEmpCode] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [selectedRole, setSelectedRole] = useState('Super Admin');
	const [error, setError] = useState('');

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
				if (onLoginSuccess) onLoginSuccess(fallbackUser);
			});
	};

	return (
		<div className="min-h-screen w-full bg-[#F4F6FB] flex items-center justify-center p-4 sm:p-6 lg:p-10 font-sans relative overflow-hidden">
			{/* Soft Purple Ambient Background Radial Glows */}
			<div className="absolute -top-32 -right-32 w-96 h-96 bg-purple-300/30 rounded-full blur-3xl pointer-events-none"></div>
			<div className="absolute -bottom-32 -left-32 w-96 h-96 bg-indigo-300/20 rounded-full blur-3xl pointer-events-none"></div>

			{/* Main Split-Screen Login Card */}
			<div className="max-w-5xl w-full bg-white rounded-[36px] shadow-2xl border border-slate-100 p-4 sm:p-6 md:p-8 flex flex-col md:flex-row gap-6 md:gap-10 items-stretch relative z-10 animate-in fade-in zoom-in-95 duration-300">
				
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

				{/* Right Side: Login Form */}
				<div className="w-full md:w-1/2 flex flex-col justify-center px-2 sm:px-4 md:px-8 py-4">
					<div>

						{/* Title */}
						<div className="mb-6 text-center">
							<h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
								Welcome Back
							</h1>
							<p className="text-xs sm:text-sm font-medium text-slate-400 mt-1">
								Please Login to your account
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

			</div>
		</div>
	);
}
