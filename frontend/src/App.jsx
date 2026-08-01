import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import StockMetrics from './components/StockMetrics';
import PortfolioChart from './components/PortfolioChart';
import DividendChart from './components/DividendChart';
import Watchlist from './components/Watchlist';
import Analysis from './components/Analysis';
import Users from './components/Users';
import Login from './components/Login';

const getRouteFromPath = (path) => {
  const cleanPath = (path || '').toLowerCase().replace(/\/$/, '');
  
  if (cleanPath === '/dashboard' || cleanPath === '' || cleanPath === '/') {
    return { activeMenu: 'Dashboard', activeTab: 'Trades' };
  }
  if (cleanPath === '/users') {
    return { activeMenu: 'Users', activeTab: 'Trades' };
  }
  if (cleanPath.startsWith('/analysis/nifty-stocks/') && cleanPath.endsWith('/details')) {
    return { activeMenu: 'Analysis', activeTab: 'Trades' };
  }
  if (cleanPath === '/analysis/nifty-stocks' || cleanPath === '/analysis/nifty' || cleanPath === '/analysis') {
    return { activeMenu: 'Analysis', activeTab: 'Trades' };
  }
  if (cleanPath === '/analysis/global') {
    return { activeMenu: 'Analysis', activeTab: 'Global' };
  }
  if (cleanPath === '/analysis/commodity') {
    return { activeMenu: 'Analysis', activeTab: 'Commodity' };
  }
  if (cleanPath === '/analysis/sectoral') {
    return { activeMenu: 'Analysis', activeTab: 'Sectoral' };
  }
  if (cleanPath === '/analysis/cashflow') {
    return { activeMenu: 'Analysis', activeTab: 'CashFlow' };
  }
  
  return { activeMenu: 'Dashboard', activeTab: 'Trades' };
};

const getPathFromRoute = (menu, tab) => {
  if (menu === 'Dashboard') {
    return '/dashboard';
  }
  if (menu === 'Users') {
    return '/users';
  }
  if (menu === 'Analysis') {
    if (tab === 'Global') return '/analysis/global';
    if (tab === 'Commodity') return '/analysis/commodity';
    if (tab === 'Sectoral') return '/analysis/sectoral';
    if (tab === 'CashFlow') return '/analysis/cashflow';
    return '/analysis/nifty-stocks';
  }
  return '/dashboard';
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [activeMenu, setActiveMenu] = useState(() => getRouteFromPath(window.location.pathname).activeMenu);
  const [activeTab, setActiveTab] = useState(() => getRouteFromPath(window.location.pathname).activeTab);
  const [searchTerm, setSearchTerm] = useState('');
  const [userRole, setUserRole] = useState('Super Admin');

  // Sync URL when state changes
  useEffect(() => {
    const targetPath = getPathFromRoute(activeMenu, activeTab);
    const currentPath = window.location.pathname.toLowerCase();

    // Do not override if user is currently on a stock details sub-route in Analysis
    if (activeMenu === 'Analysis' && currentPath.startsWith('/analysis/nifty-stocks/') && currentPath.endsWith('/details')) {
      return;
    }

    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  }, [activeMenu, activeTab]);

  // Sync state on browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const route = getRouteFromPath(window.location.pathname);
      setActiveMenu(route.activeMenu);
      setActiveTab(route.activeTab);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Redirect away from Users menu if role is not Super Admin
  useEffect(() => {
    if (userRole !== 'Super Admin' && activeMenu === 'Users') {
      setActiveMenu('Analysis');
    }
  }, [userRole, activeMenu]);

  if (!isAuthenticated) {
    return (
      <Login
        onLoginSuccess={(user) => {
          setIsAuthenticated(true);
          if (user.role) {
            setUserRole(user.role);
          }
          setActiveMenu('Dashboard');
          setActiveTab('Trades');
        }}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-body-gray font-sans text-[#1C2434]">
      {/* Sidebar */}
      <Sidebar
        activeMenu={activeMenu}
        setActiveMenu={setActiveMenu}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userRole={userRole}
      />

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col overflow-hidden transition-all duration-300 ml-[90px]">
        {/* Top Navbar */}
        <Navbar
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          userRole={userRole}
          setUserRole={setUserRole}
          onLogout={() => setIsAuthenticated(false)}
        />

        {/* Main Page Content */}
        <main className="flex-1 overflow-y-auto p-8 sidebar-scroll bg-[#F1F5F9]">
          {activeMenu === 'Users' && userRole === 'Super Admin' ? (
            <Users />
          ) : activeMenu === 'Analysis' ? (
            <Analysis
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          ) : (
            <>
              {/* Stock Metric Cards */}
              <StockMetrics />

              {/* Charts Section */}
              <div className="grid grid-cols-12 gap-8" data-purpose="dashboard-grid-layout">
                {/* Portfolio Performance Chart */}
                <PortfolioChart />

                {/* Right Column Charts */}
                <div className="col-span-12 lg:col-span-4 flex flex-col gap-8">
                  <DividendChart />
                  <Watchlist
                    setActiveMenu={setActiveMenu}
                    setActiveTab={setActiveTab}
                    setSearchTerm={setSearchTerm}
                  />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
