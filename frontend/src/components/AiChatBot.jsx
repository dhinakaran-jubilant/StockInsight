import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../apiConfig';

export default function AiChatBot() {
	const [isOpen, setIsOpen] = useState(false);
	const [isMinimized, setIsMinimized] = useState(false);
	const [inputMsg, setInputMsg] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [messages, setMessages] = useState([
		{
			id: 1,
			sender: 'ai',
			text: "👋 Hi! I'm your **StockInsight AI Assistant**.\nI'm connected directly to your PostgreSQL database. Ask me about any stock metrics, analyst consensus, exit alerts, or market trends!",
			timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		}
	]);

	const chatScrollRef = useRef(null);

	const quickPrompts = [
		'Tell me about Suzlon',
		'Top consensus recommendations',
		'Watchlist exit alerts',
		'Latest insider trades',
		'Global markets & commodities'
	];

	// Turns sent back to the backend so the agent can follow up on earlier questions.
	const HISTORY_LIMIT = 16;

	// Auto-scroll to bottom of chat list on new message
	useEffect(() => {
		if (chatScrollRef.current) {
			chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
		}
	}, [messages, isLoading, isOpen]);

	const handleSendMessage = (textToSend) => {
		const queryText = (textToSend || inputMsg).trim();
		if (!queryText || isLoading) return;

		const userMsgObj = {
			id: Date.now(),
			sender: 'user',
			text: queryText,
			timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		};

		// Prior turns only — queryText is sent separately as the current message.
		const history = messages
			.slice(-HISTORY_LIMIT)
			.map((m) => ({ sender: m.sender, text: m.text }));

		setMessages((prev) => [...prev, userMsgObj]);
		setInputMsg('');
		setIsLoading(true);

		fetch(`${API_BASE}/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: queryText, history })
		})
			.then((res) => res.json())
			.then((data) => {
				const aiMsgObj = {
					id: Date.now() + 1,
					sender: 'ai',
					text: data.response || "Sorry, I couldn't retrieve data for that query.",
					timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				};
				setMessages((prev) => [...prev, aiMsgObj]);
			})
			.catch((err) => {
				console.error('Error in AI Chat Bot:', err);
				const errorMsgObj = {
					id: Date.now() + 1,
					sender: 'ai',
					text: "⚠️ Sorry, I'm having trouble connecting to the StockInsight database. Please check backend connection.",
					timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				};
				setMessages((prev) => [...prev, errorMsgObj]);
			})
			.finally(() => {
				setIsLoading(false);
			});
	};

	const renderFormattedText = (rawText) => {
		if (!rawText) return null;

		// Convert markdown headers, bold, inline code, and lists to clean HTML elements
		const lines = rawText.split('\n');
		return (
			<div className="space-y-1.5 text-xs text-slate-800 leading-relaxed">
				{lines.map((line, idx) => {
					let content = line;

					// Header ###
					if (content.startsWith('### ')) {
						const title = content.replace('### ', '');
						return (
							<h4 key={idx} className="font-extrabold text-slate-900 text-sm tracking-tight border-b border-purple-100 pb-1 mt-1 mb-1 flex items-center gap-1.5">
								{parseInlineFormatting(title)}
							</h4>
						);
					}

					// Blockquote — e.g. the AI summary pulled from forum sentiment
					if (content.trimStart().startsWith('> ')) {
						return (
							<blockquote key={idx} className="border-l-2 border-purple-200 bg-purple-50/40 pl-2.5 py-1 my-1 text-slate-600 rounded-r">
								{parseInlineFormatting(content.trimStart().slice(2))}
							</blockquote>
						);
					}

					// Bullet items — including indented sub-bullets and "1." numbered lines,
					// which local models emit regardless of what the prompt asks for.
					const indent = content.length - content.trimStart().length;
					const trimmed = content.trimStart();
					const isBullet = /^([•*\-]|\d+\.)\s+/.test(trimmed);
					if (isBullet) {
						content = trimmed.replace(/^([•*\-]|\d+\.)\s*/, '');
					}

					return (
						<div
							key={idx}
							className={isBullet ? 'flex items-start gap-1.5' : ''}
							style={isBullet ? { paddingLeft: `${4 + Math.min(indent, 6) * 5}px` } : undefined}
						>
							{isBullet && <span className="text-[#9462d2] font-bold text-xs select-none">•</span>}
							<div className="flex-1">{parseInlineFormatting(content)}</div>
						</div>
					);
				})}
			</div>
		);
	};

	const parseInlineFormatting = (textStr) => {
		if (!textStr) return null;

		// Regex for **bold**, `code`, and *italic*
		const parts = textStr.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
		return parts.map((part, i) => {
			if (part.startsWith('**') && part.endsWith('**')) {
				return <strong key={i} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
			}
			if (part.startsWith('`') && part.endsWith('`')) {
				return <code key={i} className="px-1.5 py-0.5 rounded bg-purple-50 text-[#9462d2] border border-purple-100 font-mono text-[11px] font-semibold">{part.slice(1, -1)}</code>;
			}
			if (part.startsWith('*') && part.endsWith('*')) {
				return <em key={i} className="italic text-slate-600">{part.slice(1, -1)}</em>;
			}
			return part;
		});
	};

	return (
		<div className="fixed bottom-5 right-5 z-[9999] font-sans flex flex-col items-end select-none">
			{/* Chat Floating Window */}
			{isOpen && (
				<div
					className={`w-[380px] max-w-[calc(100vw-10px)] bg-white rounded-2xl shadow-2xl border border-purple-100/90 overflow-hidden flex flex-col transition-all duration-200 mb-2 ${
						isMinimized ? 'h-[60px]' : 'h-[520px] max-h-[calc(100vh-80px)]'
					}`}
				>
					{/* Header Bar */}
					<div className="bg-gradient-to-r from-[#9462d2] via-purple-600 to-indigo-600 px-4 py-3.5 flex items-center justify-between text-white shadow-xs">
						<div className="flex items-center gap-2.5">
							<div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-white/20 backdrop-blur-xs border border-white/30 shadow-2xs">
								<span className="material-symbols-outlined text-[20px] text-white">robot_2</span>
								<span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-purple-600 animate-pulse" />
							</div>
							<div>
								<h3 className="font-bold text-sm leading-tight flex items-center gap-1.5">
									<span>Tara AI</span>
									<span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase bg-white/20 text-white tracking-wide border border-white/20">DB Live</span>
								</h3>
								<p className="text-[10px] text-purple-100 font-medium">Real-time Stock Database Assistant</p>
							</div>
						</div>

						<div className="flex items-center gap-1">
							<button
								onClick={() => setIsMinimized((prev) => !prev)}
								className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
								title={isMinimized ? 'Expand Chat' : 'Minimize Chat'}
							>
								<span className="material-symbols-outlined text-[18px]">
									{isMinimized ? 'unfold_more' : 'remove'}
								</span>
							</button>
							<button
								onClick={() => setIsOpen(false)}
								className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
								title="Close AI Chat"
							>
								<span className="material-symbols-outlined text-[18px]">close</span>
							</button>
						</div>
					</div>

					{/* Chat Message Scroll View (When not minimized) */}
					{!isMinimized && (
						<>
							<div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/60 slim-scroll select-text">
								{messages.map((msg) => (
									<div
										key={msg.id}
										className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} space-y-1`}
									>
										<div
											className={`max-w-[85%] p-3 rounded-2xl shadow-2xs ${
												msg.sender === 'user'
													? 'bg-[#9462d2] text-white rounded-br-2xs text-xs font-semibold'
													: 'bg-white border border-purple-100/80 rounded-bl-2xs'
											}`}
										>
											{msg.sender === 'user' ? (
												<p className="whitespace-pre-wrap">{msg.text}</p>
											) : (
												renderFormattedText(msg.text)
											)}
										</div>
										<span className="text-[9px] text-slate-400 px-1 font-medium select-none">
											{msg.timestamp}
										</span>
									</div>
								))}

								{/* Loading Dots Indicator */}
								{isLoading && (
									<div className="flex items-start gap-2">
										<div className="bg-white border border-purple-100 p-3 rounded-2xl rounded-bl-2xs shadow-2xs flex items-center gap-1.5">
											<div className="w-2 h-2 rounded-full bg-[#9462d2] animate-bounce" style={{ animationDelay: '0ms' }} />
											<div className="w-2 h-2 rounded-full bg-[#9462d2] animate-bounce" style={{ animationDelay: '150ms' }} />
											<div className="w-2 h-2 rounded-full bg-[#9462d2] animate-bounce" style={{ animationDelay: '300ms' }} />
										</div>
									</div>
								)}
							</div>

							{/* Quick Suggestion Chips */}
							<div className="px-3 py-2 bg-white border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
								{quickPrompts.map((prompt, idx) => (
									<button
										key={idx}
										onClick={() => handleSendMessage(prompt)}
										className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-50 text-[#9462d2] hover:bg-purple-100 hover:text-purple-800 border border-purple-100 transition-all whitespace-nowrap cursor-pointer shrink-0 shadow-2xs"
									>
										✨ {prompt}
									</button>
								))}
							</div>

							{/* Footer Input Bar */}
							<form
								onSubmit={(e) => {
									e.preventDefault();
									handleSendMessage();
								}}
								className="p-3 bg-white border-t border-slate-100 flex items-center gap-2"
							>
								<input
									type="text"
									placeholder="Ask AI about stocks, metrics, exit alerts..."
									value={inputMsg}
									onChange={(e) => setInputMsg(e.target.value)}
									disabled={isLoading}
									className="flex-1 bg-slate-100/80 hover:bg-slate-100 focus:bg-white border border-slate-200 focus:border-[#9462d2] text-xs font-semibold text-slate-800 rounded-xl px-3.5 py-2 outline-none transition-all placeholder:text-slate-400"
								/>
								<button
									type="submit"
									disabled={!inputMsg.trim() || isLoading}
									className="w-9 h-9 rounded-xl bg-[#9462d2] hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all cursor-pointer shadow-xs shrink-0"
									title="Send Message"
								>
									<span className="material-symbols-outlined text-[18px]">send</span>
								</button>
							</form>
						</>
					)}
				</div>
			)}

			{/* Floating AI Robot Button (5px from bottom and right) */}
			{!isOpen && (
				<button
					onClick={() => {
						setIsOpen(true);
						setIsMinimized(false);
					}}
					className="group relative flex items-center gap-2 bg-gradient-to-r from-[#9462d2] via-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white px-4 py-3 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer border border-white/30"
					title="Open StockInsight AI Assistant"
				>
					<div className="relative flex items-center justify-center">
						<span className="material-symbols-outlined text-[24px]">robot_2</span>
						<span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-purple-600 animate-ping" />
					</div>
					<span className="text-xs font-extrabold tracking-wide pr-0.5">Tara AI</span>
				</button>
			)}
		</div>
	);
}
