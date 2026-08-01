import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { API_BASE } from '../apiConfig';

export default function Users() {
	const [users, setUsers] = useState([]);
	const [loading, setLoading] = useState(true);

	const [searchTerm, setSearchTerm] = useState('');
	const [selectedRoles, setSelectedRoles] = useState([]);
	const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);

	const [selectedStatuses, setSelectedStatuses] = useState([]);
	const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);

	const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
	const [isAddUserRoleDropdownOpen, setIsAddUserRoleDropdownOpen] = useState(false);

	const [editingUser, setEditingUser] = useState(null);
	const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
	const [editEmpCode, setEditEmpCode] = useState('');
	const [editName, setEditName] = useState('');
	const [editEmail, setEditEmail] = useState('');
	const [editRole, setEditRole] = useState('User');
	const [editStatus, setEditStatus] = useState('Active');
	const [isEditUserRoleDropdownOpen, setIsEditUserRoleDropdownOpen] = useState(false);
	const [isEditUserStatusDropdownOpen, setIsEditUserStatusDropdownOpen] = useState(false);

	const [userToDelete, setUserToDelete] = useState(null);
	const [isDeleteUserModalOpen, setIsDeleteUserModalOpen] = useState(false);

	const [currentPage, setCurrentPage] = useState(1);
	const itemsPerPage = 10;

	const [newEmpCode, setNewEmpCode] = useState('');
	const [newUserName, setNewUserName] = useState('');
	const [newUserEmail, setNewUserEmail] = useState('');
	const [newUserPassword, setNewUserPassword] = useState('');
	const [showNewUserPassword, setShowNewUserPassword] = useState(false);
	const [newUserRole, setNewUserRole] = useState('User');

	const [editPassword, setEditPassword] = useState('');
	const [showEditPassword, setShowEditPassword] = useState(false);

	const fetchUsersFromDB = () => {
		setLoading(true);
		fetch(`${API_BASE}/users`)
			.then((res) => res.json())
			.then((data) => {
				if (data && Array.isArray(data.users)) {
					setUsers(data.users);
				}
			})
			.catch((err) => console.error('Error fetching users from DB:', err))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		fetchUsersFromDB();
	}, []);

	const handleAddUser = (e) => {
		e.preventDefault();
		if (!newUserName.trim() || !newUserEmail.trim()) return;

		const bgOptions = ['bg-[#9462d2]', 'bg-blue-600', 'bg-emerald-600', 'bg-indigo-600', 'bg-[#101828]'];
		const randomBg = bgOptions[Math.floor(Math.random() * bgOptions.length)];

		fetch(`${API_BASE}/users`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				empCode: newEmpCode.trim(),
				name: newUserName.trim(),
				email: newUserEmail.trim(),
				password: newUserPassword.trim() || '123456',
				role: newUserRole,
				status: 'Active',
				avatarBg: randomBg,
				lastActive: 'Just now'
			})
		})
			.then((res) => res.json())
			.then(() => {
				setNewEmpCode('');
				setNewUserName('');
				setNewUserEmail('');
				setNewUserPassword('');
				setShowNewUserPassword(false);
				setNewUserRole('User');
				setIsAddUserModalOpen(false);
				window.dispatchEvent(new Event('usersUpdated'));
				fetchUsersFromDB();
			})
			.catch((err) => console.error('Error adding user to DB:', err));
	};

	const handleOpenEditUserModal = (user) => {
		setEditingUser(user);
		setEditEmpCode(user.empCode || '');
		setEditName(user.name);
		setEditEmail(user.email);
		setEditPassword(user.password || '');
		setShowEditPassword(false);
		setEditRole(user.role);
		setEditStatus(user.status);
		setIsEditUserRoleDropdownOpen(false);
		setIsEditUserStatusDropdownOpen(false);
		setIsEditUserModalOpen(true);
	};

	const handleSaveEditUser = (e) => {
		e.preventDefault();
		if (!editName.trim() || !editEmail.trim() || !editingUser) return;

		fetch(`${API_BASE}/users/edit`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: editingUser.id,
				empCode: editEmpCode.trim(),
				name: editName.trim(),
				email: editEmail.trim(),
				password: editPassword.trim(),
				role: editRole,
				status: editStatus
			})
		})
			.then((res) => res.json())
			.then(() => {
				setIsEditUserModalOpen(false);
				setEditingUser(null);
				setEditPassword('');
				setShowEditPassword(false);
				window.dispatchEvent(new Event('usersUpdated'));
				fetchUsersFromDB();
			})
			.catch((err) => console.error('Error updating user in DB:', err));
	};

	const handleOpenDeleteUserModal = (user) => {
		setUserToDelete(user);
		setIsDeleteUserModalOpen(true);
	};

	const handleConfirmDeleteUser = () => {
		if (!userToDelete) return;

		fetch(`${API_BASE}/users/delete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: userToDelete.id })
		})
			.then((res) => res.json())
			.then(() => {
				setIsDeleteUserModalOpen(false);
				setUserToDelete(null);
				window.dispatchEvent(new Event('usersUpdated'));
				fetchUsersFromDB();
			})
			.catch((err) => console.error('Error deleting user from DB:', err));
	};

	const toggleRoleFilter = (role) => {
		setCurrentPage(1);
		if (selectedRoles.includes(role)) {
			setSelectedRoles(selectedRoles.filter((r) => r !== role));
		} else {
			setSelectedRoles([...selectedRoles, role]);
		}
	};

	const toggleStatusFilter = (status) => {
		setCurrentPage(1);
		if (selectedStatuses.includes(status)) {
			setSelectedStatuses(selectedStatuses.filter((s) => s !== status));
		} else {
			setSelectedStatuses([...selectedStatuses, status]);
		}
	};

	const filteredUsers = users.filter((u) => {
		const matchesSearch =
			!searchTerm ||
			u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
			u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
			(u.empCode && u.empCode.toLowerCase().includes(searchTerm.toLowerCase()));
		const matchesRole = selectedRoles.length === 0 || selectedRoles.includes(u.role);
		const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(u.status);
		return matchesSearch && matchesRole && matchesStatus;
	});

	const totalItems = filteredUsers.length;
	const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
	const startIndex = (currentPage - 1) * itemsPerPage;
	const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
	const currentUsersPage = filteredUsers.slice(startIndex, endIndex);

	const handleSearchChange = (e) => {
		setSearchTerm(e.target.value);
		setCurrentPage(1);
	};

	const activeCount = users.filter((u) => u.status === 'Active').length;
	const superAdminCount = users.filter((u) => u.role === 'Super Admin').length;
	const adminCount = users.filter((u) => u.role === 'Admin').length;
	const userCount = users.filter((u) => u.role === 'User').length;

	return (
		<div className="space-y-6" data-purpose="users-management-view">
			{/* Page Header */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-slate-800 tracking-tight">User Management</h1>
					<p className="text-xs text-slate-500 font-medium mt-0.5">Manage team access, permissions, and roles for StockInsight platform</p>
				</div>
				<button
					onClick={() => setIsAddUserModalOpen(true)}
					className="px-4 py-2.5 bg-[#9462d2] hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer self-start sm:self-auto"
				>
					<span className="material-symbols-outlined text-[18px]">person_add</span>
					<span>Add New User</span>
				</button>
			</div>

			{/* Metrics Summary Cards */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
				<div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-2xs flex items-center justify-between">
					<div>
						<span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Total Platform Users</span>
						<span className="text-2xl font-extrabold text-slate-800 mt-1 block">{users.length}</span>
					</div>
					<div className="w-11 h-11 rounded-2xl bg-purple-50 text-[#9462d2] flex items-center justify-center font-bold">
						<span className="material-symbols-outlined text-[22px]">group</span>
					</div>
				</div>

				<div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-2xs flex items-center justify-between">
					<div>
						<span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Active Users</span>
						<span className="text-2xl font-extrabold text-emerald-600 mt-1 block">{activeCount}</span>
					</div>
					<div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
						<span className="material-symbols-outlined text-[22px]">check_circle</span>
					</div>
				</div>

				<div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-2xs flex items-center justify-between">
					<div>
						<span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Super Admins &amp; Admins</span>
						<span className="text-2xl font-extrabold text-slate-800 mt-1 block">{superAdminCount + adminCount}</span>
					</div>
					<div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
						<span className="material-symbols-outlined text-[22px]">admin_panel_settings</span>
					</div>
				</div>

				<div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-2xs flex items-center justify-between">
					<div>
						<span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Standard Users</span>
						<span className="text-2xl font-extrabold text-blue-600 mt-1 block">{userCount}</span>
					</div>
					<div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
						<span className="material-symbols-outlined text-[22px]">insights</span>
					</div>
				</div>
			</div>

			{/* Search & Filter Bar */}
			<div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-4">
				<div className="relative flex items-center w-full md:max-w-md h-10 border border-slate-200 rounded-xl bg-slate-50/50 px-3.5 focus-within:bg-white focus-within:border-[#9462d2] transition-all">
					<span className="material-symbols-outlined text-[18px] text-slate-400 mr-2.5">search</span>
					<input
						type="text"
						placeholder="Search by name or email address..."
						value={searchTerm}
						onChange={handleSearchChange}
						className="w-full bg-transparent text-sm font-medium text-slate-800 placeholder-slate-400 outline-none"
					/>
					{searchTerm && (
						<button onClick={() => { setSearchTerm(''); setCurrentPage(1); }} className="text-slate-400 hover:text-slate-600">
							<span className="material-symbols-outlined text-[16px]">close</span>
						</button>
					)}
				</div>

				<div className="flex items-center gap-3 w-full md:w-auto justify-end">
					{/* Multi-Select Role Filter Dropdown */}
					<div className="relative inline-block text-left">
						<button
							type="button"
							onClick={() => setIsRoleDropdownOpen((prev) => !prev)}
							className={`px-4 py-2 bg-white border rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 shadow-2xs ${
								selectedRoles.length > 0
									? 'border-purple-300 text-[#9462d2] bg-purple-50/50 ring-2 ring-purple-100'
									: 'border-slate-200 text-slate-700 hover:bg-slate-50'
							}`}
						>
							<span>
								{selectedRoles.length === 0
									? 'All Roles'
									: `Roles (${selectedRoles.length})`}
							</span>
							<span className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${isRoleDropdownOpen ? 'rotate-180' : ''}`}>
								keyboard_arrow_down
							</span>
						</button>

						{/* Dropdown Options Menu Card with Rounded Border Radius & Checkboxes */}
						{isRoleDropdownOpen && (
							<>
								<div className="fixed inset-0 z-40" onClick={() => setIsRoleDropdownOpen(false)}></div>
								<div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-1">
									<div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
										<span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Filter by Role</span>
										{selectedRoles.length > 0 && (
											<button
												onClick={() => {
													setSelectedRoles([]);
													setCurrentPage(1);
												}}
												className="text-[11px] font-bold text-[#9462d2] hover:underline cursor-pointer"
											>
												Clear All
											</button>
										)}
									</div>

									<div className="space-y-1 pt-1">
										{['Super Admin', 'Admin', 'User'].map((role) => {
											const isChecked = selectedRoles.includes(role);
											return (
												<div
													key={role}
													onClick={(e) => {
														e.preventDefault();
														e.stopPropagation();
														toggleRoleFilter(role);
													}}
													className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
														isChecked
															? 'bg-purple-50 text-[#9462d2]'
															: 'text-slate-700 hover:bg-slate-50'
													}`}
												>
													<div className="flex items-center gap-2.5 pointer-events-none">
														<span>{role}</span>
													</div>
													{isChecked && (
														<span className="material-symbols-outlined text-[16px] text-[#9462d2] pointer-events-none">check</span>
													)}
												</div>
											);
										})}
									</div>
								</div>
							</>
						)}
					</div>

					{/* Multi-Select Status Filter Dropdown */}
					<div className="relative inline-block text-left">
						<button
							type="button"
							onClick={() => setIsStatusDropdownOpen((prev) => !prev)}
							className={`px-4 py-2 bg-white border rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 shadow-2xs ${
								selectedStatuses.length > 0
									? 'border-purple-300 text-[#9462d2] bg-purple-50/50 ring-2 ring-purple-100'
									: 'border-slate-200 text-slate-700 hover:bg-slate-50'
							}`}
						>
							<span>
								{selectedStatuses.length === 0
									? 'All Statuses'
									: `Status (${selectedStatuses.length})`}
							</span>
							<span className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${isStatusDropdownOpen ? 'rotate-180' : ''}`}>
								keyboard_arrow_down
							</span>
						</button>

						{/* Dropdown Options Menu Card with Rounded Border Radius & Checkboxes */}
						{isStatusDropdownOpen && (
							<>
								<div className="fixed inset-0 z-40" onClick={() => setIsStatusDropdownOpen(false)}></div>
								<div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-1">
									<div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
										<span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Filter by Status</span>
										{selectedStatuses.length > 0 && (
											<button
												onClick={() => {
													setSelectedStatuses([]);
													setCurrentPage(1);
												}}
												className="text-[11px] font-bold text-[#9462d2] hover:underline cursor-pointer"
											>
												Clear All
											</button>
										)}
									</div>

									<div className="space-y-1 pt-1">
										{['Active', 'Inactive'].map((status) => {
											const isChecked = selectedStatuses.includes(status);
											return (
												<div
													key={status}
													onClick={(e) => {
														e.preventDefault();
														e.stopPropagation();
														toggleStatusFilter(status);
													}}
													className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
														isChecked
															? 'bg-purple-50 text-[#9462d2]'
															: 'text-slate-700 hover:bg-slate-50'
													}`}
												>
													<div className="flex items-center gap-2.5 pointer-events-none">
														<span className="flex items-center gap-1.5">
															{status}
														</span>
													</div>
													{isChecked && (
														<span className="material-symbols-outlined text-[16px] text-[#9462d2] pointer-events-none">check</span>
													)}
												</div>
											);
										})}
									</div>
								</div>
							</>
						)}
					</div>
				</div>
			</div>

			{/* Users Table Container */}
			<div className="bg-white rounded-2xl border border-slate-100 shadow-2xs overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-left border-collapse min-w-max">
						<thead>
							<tr className="bg-slate-50 text-slate-600 text-sm font-bold border-b border-slate-100">
								<th className="py-3.5 px-5">User</th>
								<th className="py-3.5 px-5">Emp Code</th>
								<th className="py-3.5 px-5">Role</th>
								<th className="py-3.5 px-5 text-center">Status</th>
								<th className="py-3.5 px-5">Last Active</th>
								<th className="py-3.5 px-5 text-center">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100 text-xs">
							{loading ? (
								<tr>
									<td colSpan="6" className="py-12 text-center text-slate-400 text-sm font-medium">
										Loading platform users from database...
									</td>
								</tr>
							) : currentUsersPage.length > 0 ? (
								currentUsersPage.map((u) => (
									<tr key={u.id} className="hover:bg-purple-50/40 transition-colors group">
										<td className="py-3.5 px-5">
											<div className="flex items-center gap-3">
												<div className={`w-9 h-9 rounded-xl ${u.avatarBg} text-white flex items-center justify-center font-bold text-xs shadow-xs`}>
													{u.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
												</div>
												<div>
													<span className="font-bold text-slate-800 text-[14px] block group-hover:text-[#9462d2] transition-colors">{u.name}</span>
													<span className="text-[11px] text-slate-400 font-medium">{u.email}</span>
												</div>
											</div>
										</td>
										
										<td className="py-3.5 px-5 font-mono font-bold text-slate-700">
											<span className="inline-block px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200/80 shadow-2xs">
												{u.empCode || `EMP-${1000 + u.id}`}
											</span>
										</td>

										<td className="py-3.5 px-5">
											<span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-bold ${
												u.role === 'Super Admin'
													? 'bg-purple-100 text-purple-800 border border-purple-200'
													: u.role === 'Admin'
													? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
													: 'bg-emerald-100 text-emerald-800 border border-emerald-200'
											}`}>
												{u.role}
											</span>
										</td>

										<td className="py-3.5 px-5 text-center">
											<span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-bold ${
												u.status === 'Active'
													? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
													: 'bg-slate-100 text-slate-500'
											}`}>
												<span className={`w-1.5 h-1.5 rounded-full ${u.status === 'Active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
												<span>{u.status}</span>
											</span>
										</td>

										<td className="py-3.5 px-5 font-medium text-slate-500 text-[13px]">
											{u.lastActive}
										</td>

										<td className="py-3.5 px-5 text-center">
											<div className="inline-flex items-center gap-1">
												<button
													onClick={() => handleOpenEditUserModal(u)}
													className="w-8 h-8 rounded-lg text-slate-400 hover:text-[#9462d2] hover:bg-purple-100 flex items-center justify-center transition-colors cursor-pointer"
													title="Edit User Details"
												>
													<span className="material-symbols-outlined text-[20px]">edit</span>
												</button>
												<button
													onClick={() => handleOpenDeleteUserModal(u)}
													className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-colors cursor-pointer"
													title="Remove User"
												>
													<span className="material-symbols-outlined text-[20px]">delete</span>
												</button>
											</div>
										</td>
									</tr>
								))
							) : (
								<tr>
									<td colSpan="6" className="py-12 text-center text-slate-400 text-xs font-medium">
										No users found
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>

				{/* Trades-Style Pagination Controls */}
				<div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-slate-100 text-sm text-slate-500">
					<div>
						Showing <span className="font-semibold text-slate-900">{totalItems > 0 ? startIndex + 1 : 0}</span> to <span className="font-semibold text-slate-900">{endIndex}</span> of <span className="font-semibold text-slate-900">{totalItems}</span> results
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
							disabled={currentPage === 1}
							className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-slate-400 cursor-pointer"
							aria-label="Previous Page"
						>
							<span className="material-symbols-outlined text-[20px] select-none">chevron_left</span>
						</button>
						<button
							onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
							disabled={currentPage === totalPages || totalPages === 0}
							className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-slate-400 cursor-pointer"
							aria-label="Next Page"
						>
							<span className="material-symbols-outlined text-[20px] select-none">chevron_right</span>
						</button>
					</div>
				</div>
			</div>

			{/* Add User Modal Popup Portal */}
			{isAddUserModalOpen && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[99999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 space-y-4">
						<div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
							<div className="flex items-center gap-3">
								<div className="w-10 h-10 rounded-xl bg-purple-100 text-[#9462d2] flex items-center justify-center font-bold shadow-xs">
									<span className="material-symbols-outlined text-[22px]">person_add</span>
								</div>
								<div>
									<h3 className="text-base font-bold text-slate-800">Add New User</h3>
									<p className="text-xs text-slate-400 font-medium">Invite a new user to StockInsight workspace</p>
								</div>
							</div>
							<button onClick={() => setIsAddUserModalOpen(false)} className="w-9 h-9 flex justify-center items-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-all duration-150 cursor-pointer">
								<span className="material-symbols-outlined text-[20px]">close</span>
							</button>
						</div>

						<form onSubmit={handleAddUser} className="space-y-4">
							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">Employee Code</label>
								<input
									type="text"
									placeholder="e.g. EMP-1013"
									value={newEmpCode}
									onChange={(e) => setNewEmpCode(e.target.value)}
									className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-mono text-slate-800 outline-none focus:bg-white focus:border-[#9462d2]"
								/>
							</div>

							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">Full Name <span className="text-red-500">*</span></label>
								<input
									type="text"
									placeholder="e.g. John Doe"
									value={newUserName}
									onChange={(e) => setNewUserName(e.target.value)}
									required
									className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-800 outline-none focus:bg-white focus:border-[#9462d2]"
								/>
							</div>

							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">Email Address <span className="text-red-500">*</span></label>
								<input
									type="email"
									placeholder="e.g. john.doe@company.com"
									value={newUserEmail}
									onChange={(e) => setNewUserEmail(e.target.value)}
									required
									className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-800 outline-none focus:bg-white focus:border-[#9462d2]"
								/>
							</div>

							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">Password <span className="text-red-500">*</span></label>
								<div className="relative flex items-center">
									<input
										type={showNewUserPassword ? 'text' : 'password'}
										placeholder="Enter account password..."
										value={newUserPassword}
										onChange={(e) => setNewUserPassword(e.target.value)}
										required
										className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 pr-10 text-sm text-slate-800 outline-none focus:bg-white focus:border-[#9462d2]"
									/>
									<button
										type="button"
										onClick={() => setShowNewUserPassword((prev) => !prev)}
										className="absolute right-3 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
										title={showNewUserPassword ? 'Hide password' : 'Show password'}
									>
										<span className="material-symbols-outlined text-[18px]">
											{showNewUserPassword ? 'visibility_off' : 'visibility'}
										</span>
									</button>
								</div>
							</div>

							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">Role <span className="text-red-500">*</span></label>
								<div className="relative inline-block w-full text-left">
									<button
										type="button"
										onClick={() => setIsAddUserRoleDropdownOpen((prev) => !prev)}
										className="w-full bg-slate-50 border border-slate-200 hover:border-purple-300 rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-800 outline-none transition-all cursor-pointer flex items-center justify-between shadow-2xs"
									>
										<span>
											{newUserRole === 'Super Admin' && 'Super Admin (Full Access)'}
											{newUserRole === 'Admin' && 'Admin (Full Access - No Users Menu)'}
											{newUserRole === 'User' && 'User (Analysis Access - No Watchlist)'}
										</span>
										<span className={`material-symbols-outlined text-[18px] text-purple-600 transition-transform duration-200 ${isAddUserRoleDropdownOpen ? 'rotate-180' : ''}`}>
											keyboard_arrow_down
										</span>
									</button>

									{/* Custom Rounded Dropdown Options Menu Card */}
									{isAddUserRoleDropdownOpen && (
										<>
											<div className="fixed inset-0 z-40" onClick={() => setIsAddUserRoleDropdownOpen(false)}></div>
											<div className="absolute left-0 right-0 bottom-full mb-2 bg-white rounded-2xl shadow-xl border border-purple-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-1">
												{[
													{ value: 'Super Admin', label: 'Super Admin (Full Access)' },
													{ value: 'Admin', label: 'Admin (Full Access - No Users Menu)' },
													{ value: 'User', label: 'User (Analysis Access - No Watchlist)' }
												].map((opt) => {
													const isSelected = newUserRole === opt.value;
													return (
														<div
															key={opt.value}
															onClick={(e) => {
																e.stopPropagation();
																setNewUserRole(opt.value);
																setIsAddUserRoleDropdownOpen(false);
															}}
															className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
																isSelected
																	? 'bg-purple-50 text-[#9462d2]'
																	: 'text-slate-700 hover:bg-purple-50/50 hover:text-[#9462d2]'
															}`}
														>
															<span>{opt.label}</span>
															{isSelected && (
																<span className="material-symbols-outlined text-[16px] text-[#9462d2]">check</span>
															)}
														</div>
													);
												})}
											</div>
										</>
									)}
								</div>
							</div>

							<div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
								<button
									type="button"
									onClick={() => setIsAddUserModalOpen(false)}
									className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="submit"
									className="px-4 py-2 bg-[#9462d2] hover:bg-purple-700 text-white font-bold text-sm rounded-xl shadow-xs transition-all"
								>
									Add User
								</button>
							</div>
						</form>
					</div>
				</div>,
				document.body
			)}

			{/* Edit User Details Modal Popup Portal */}
			{isEditUserModalOpen && editingUser && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[99999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 space-y-4">
						<div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
							<div className="flex items-center gap-3">
								<div className="w-10 h-10 rounded-xl bg-purple-100 text-[#9462d2] flex items-center justify-center font-bold shadow-xs">
									<span className="material-symbols-outlined text-[22px]">manage_accounts</span>
								</div>
								<div>
									<h3 className="text-base font-bold text-slate-800">Edit User Details</h3>
									<p className="text-xs text-slate-400 font-medium">Update account details, role, or active status</p>
								</div>
							</div>
							<button onClick={() => { setIsEditUserModalOpen(false); setEditingUser(null); }} className="w-9 h-9 flex justify-center items-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-all duration-150 cursor-pointer">
								<span className="material-symbols-outlined text-[20px]">close</span>
							</button>
						</div>

						<form onSubmit={handleSaveEditUser} className="space-y-4">
							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">Employee Code</label>
								<input
									type="text"
									placeholder="e.g. EMP-1001"
									value={editEmpCode}
									onChange={(e) => setEditEmpCode(e.target.value)}
									className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-mono text-slate-800 outline-none focus:bg-white focus:border-[#9462d2]"
								/>
							</div>

							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">Full Name <span className="text-red-500">*</span></label>
								<input
									type="text"
									placeholder="e.g. John Doe"
									value={editName}
									onChange={(e) => setEditName(e.target.value)}
									required
									className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-800 outline-none focus:bg-white focus:border-[#9462d2]"
								/>
							</div>

							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">Email Address <span className="text-red-500">*</span></label>
								<input
									type="email"
									placeholder="e.g. john.doe@company.com"
									value={editEmail}
									onChange={(e) => setEditEmail(e.target.value)}
									required
									className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-800 outline-none focus:bg-white focus:border-[#9462d2]"
								/>
							</div>

							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">
									Password <span className="text-slate-400 font-normal text-xs">(Leave blank to keep unchanged)</span>
								</label>
								<div className="relative flex items-center">
									<input
										type={showEditPassword ? 'text' : 'password'}
										placeholder="Enter new password..."
										value={editPassword}
										onChange={(e) => setEditPassword(e.target.value)}
										className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 pr-10 text-sm text-slate-800 outline-none focus:bg-white focus:border-[#9462d2]"
									/>
									<button
										type="button"
										onClick={() => setShowEditPassword((prev) => !prev)}
										className="absolute right-3 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
										title={showEditPassword ? 'Hide password' : 'Show password'}
									>
										<span className="material-symbols-outlined text-[18px]">
											{showEditPassword ? 'visibility_off' : 'visibility'}
										</span>
									</button>
								</div>
							</div>

							{/* Role Selector */}
							<div>
								<label className="text-sm font-bold text-slate-700 block mb-1.5">Role <span className="text-red-500">*</span></label>
								<div className="relative inline-block w-full text-left">
									<button
										type="button"
										onClick={() => setIsEditUserRoleDropdownOpen((prev) => !prev)}
										className="w-full bg-slate-50 border border-slate-200 hover:border-purple-300 rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-800 outline-none transition-all cursor-pointer flex items-center justify-between shadow-2xs"
									>
										<span>
											{editRole === 'Super Admin' && 'Super Admin (Full Access)'}
											{editRole === 'Admin' && 'Admin (Full Access - No Users Menu)'}
											{editRole === 'User' && 'User (Analysis Access - No Watchlist)'}
										</span>
										<span className={`material-symbols-outlined text-[18px] text-purple-600 transition-transform duration-200 ${isEditUserRoleDropdownOpen ? 'rotate-180' : ''}`}>
											keyboard_arrow_down
										</span>
									</button>

									{/* Custom Rounded Dropdown Options Menu Card */}
									{isEditUserRoleDropdownOpen && (
										<>
											<div className="fixed inset-0 z-40" onClick={() => setIsEditUserRoleDropdownOpen(false)}></div>
											<div className="absolute left-0 right-0 bottom-full mb-2 bg-white rounded-2xl shadow-xl border border-purple-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-1">
												{[
													{ value: 'Super Admin', label: 'Super Admin (Full Access)' },
													{ value: 'Admin', label: 'Admin (Full Access - No Users Menu)' },
													{ value: 'User', label: 'User (Analysis Access - No Watchlist)' }
												].map((opt) => {
													const isSelected = editRole === opt.value;
													return (
														<div
															key={opt.value}
															onClick={(e) => {
																e.stopPropagation();
																setEditRole(opt.value);
																setIsEditUserRoleDropdownOpen(false);
															}}
															className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
																isSelected
																	? 'bg-purple-50 text-[#9462d2]'
																	: 'text-slate-700 hover:bg-purple-50/50 hover:text-[#9462d2]'
															}`}
														>
															<span>{opt.label}</span>
															{isSelected && (
																<span className="material-symbols-outlined text-[16px] text-[#9462d2]">check</span>
															)}
														</div>
													);
												})}
											</div>
										</>
									)}
								</div>
							</div>

							<div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
								<button
									type="button"
									onClick={() => { setIsEditUserModalOpen(false); setEditingUser(null); }}
									className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="submit"
									className="px-4 py-2 bg-[#9462d2] hover:bg-purple-700 text-white font-bold text-sm rounded-xl shadow-xs transition-all cursor-pointer"
								>
									Save Changes
								</button>
							</div>
						</form>
					</div>
				</div>,
				document.body
			)}

			{/* Delete User Confirmation Modal Popup Portal */}
			{isDeleteUserModalOpen && userToDelete && ReactDOM.createPortal(
				<div className="fixed inset-0 top-0 bottom-0 left-0 right-0 w-screen h-screen z-[99999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
					<div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150 text-center space-y-4">
						<div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto font-bold shadow-xs">
							<span className="material-symbols-outlined text-[26px]">delete</span>
						</div>
						<div>
							<h3 className="text-lg font-bold text-slate-800">Delete User</h3>
							<p className="text-sm text-slate-500 font-medium mt-5">
								Are you sure you want to remove user <span className="font-bold text-slate-800">"{userToDelete.name}"</span>? This action cannot be undone.
							</p>
						</div>

						<div className="flex items-center justify-center gap-3 pt-5">
							<button
								onClick={() => { setIsDeleteUserModalOpen(false); setUserToDelete(null); }}
								className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer w-full"
							>
								Cancel
							</button>
							<button
								onClick={handleConfirmDeleteUser}
								className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm rounded-xl shadow-xs transition-all cursor-pointer w-full"
							>
								Delete User
							</button>
						</div>
					</div>
				</div>,
				document.body
			)}
		</div>
	);
}
