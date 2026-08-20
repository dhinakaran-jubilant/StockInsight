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
import AiChatBot from './components/AiChatBot';

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
  const [loggedInUser, setLoggedInUser] = useState(() => {
    try {
      const saved = localStorage.getItem('stockinsight_logged_in_user');
      return saved ? JSON.parse(saved) : { empCode: 'JC0033', name: 'Dhinakaran Sekar', email: 'dhinakaran.s@jubilantenterprises.in', role: 'Super Admin', avatarBg: 'bg-purple-600' };
    } catch (e) {
      return { empCode: 'JC0033', name: 'Dhinakaran Sekar', email: 'dhinakaran.s@jubilantenterprises.in', role: 'Super Admin', avatarBg: 'bg-purple-600' };
    }
  });

  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    try {
      const saved = localStorage.getItem('stockinsight_logged_in_user');
      return Boolean(saved && JSON.parse(saved));
    } catch (e) {
      return false;
    }
  });

  const [activeMenu, setActiveMenu] = useState(() => getRouteFromPath(window.location.pathname).activeMenu);
  const [activeTab, setActiveTab] = useState(() => getRouteFromPath(window.location.pathname).activeTab);
  const [searchTerm, setSearchTerm] = useState('');
  const [userRole, setUserRole] = useState(() => (loggedInUser && loggedInUser.role ? loggedInUser.role : 'Super Admin'));

  const [isSessionExpired, setIsSessionExpired] = useState(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('session_expired') === 'true') {
        return true;
      }
      const savedUser = localStorage.getItem('stockinsight_logged_in_user');
      const lastAct = localStorage.getItem('stockinsight_last_activity');
      if (savedUser && lastAct) {
        const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
        if (Date.now() - parseInt(lastAct, 10) > INACTIVITY_TIMEOUT_MS) {
          localStorage.removeItem('stockinsight_logged_in_user');
          localStorage.removeItem('stockinsight_last_activity');
          return true;
        }
      }
    } catch (e) {}
    return false;
  });

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
      if (!isAuthenticated) return;
      const route = getRouteFromPath(window.location.pathname);
      setActiveMenu(route.activeMenu);
      setActiveTab(route.activeTab);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAuthenticated]);

  // Prevent logged in users from returning to /login
  useEffect(() => {
    if (isAuthenticated) {
      const currentPath = window.location.pathname.toLowerCase();
      if (currentPath === '/login' || currentPath === '/login/') {
        window.history.replaceState(null, '', getPathFromRoute(activeMenu, activeTab));
      }
    }
  }, [isAuthenticated, activeMenu, activeTab]);

  // Redirect away from Users menu if role is not Super Admin
  useEffect(() => {
    if (userRole !== 'Super Admin' && activeMenu === 'Users') {
      setActiveMenu('Analysis');
    }
  }, [userRole, activeMenu]);

  // 1-Hour Inactivity Auto-Logout Mechanism (60 minutes = 3,600,000 ms)
  useEffect(() => {
    if (!isAuthenticated) return;

    const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
    let timerId;

    const handleAutoLogout = () => {
      try {
        localStorage.removeItem('stockinsight_logged_in_user');
        localStorage.removeItem('stockinsight_last_activity');
      } catch (e) {}
      setIsAuthenticated(false);
      setIsSessionExpired(true);
      window.history.replaceState(null, '', '/login');
    };

    const resetTimer = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(handleAutoLogout, INACTIVITY_TIMEOUT_MS);
    };

    resetTimer();

    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    let lastReset = Date.now();

    const onUserActivity = () => {
      const now = Date.now();
      if (now - lastReset > 1000) {
        lastReset = now;
        try {
          localStorage.setItem('stockinsight_last_activity', now.toString());
        } catch (e) {}
        resetTimer();
      }
    };

    activityEvents.forEach((event) => {
      window.addEventListener(event, onUserActivity, { passive: true });
    });

    return () => {
      if (timerId) clearTimeout(timerId);
      activityEvents.forEach((event) => {
        window.removeEventListener(event, onUserActivity);
      });
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <Login
        sessionExpired={isSessionExpired}
        onDismissSessionExpired={() => setIsSessionExpired(false)}
        onLoginSuccess={(user) => {
          setIsSessionExpired(false);
          setIsAuthenticated(true);
          if (user) {
            setLoggedInUser(user);
            try {
              localStorage.setItem('stockinsight_logged_in_user', JSON.stringify(user));
              localStorage.setItem('stockinsight_last_activity', Date.now().toString());
            } catch (e) {}
            if (user.role) {
              setUserRole(user.role);
            }
          }
          setActiveMenu('Dashboard');
          setActiveTab('Trades');
          window.history.replaceState(null, '', '/dashboard');
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
          loggedInUser={loggedInUser}
          setLoggedInUser={setLoggedInUser}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          userRole={userRole}
          setUserRole={(newRole) => {
            setUserRole(newRole);
            setLoggedInUser((prev) => prev ? { ...prev, role: newRole } : prev);
          }}
          onLogout={(reason) => {
            try {
              localStorage.removeItem('stockinsight_logged_in_user');
              localStorage.removeItem('stockinsight_last_activity');
            } catch (e) {}
            setIsAuthenticated(false);
            if (reason === 'session_expired') {
              setIsSessionExpired(true);
            } else {
              setIsSessionExpired(false);
            }
            window.history.replaceState(null, '', '/login');
          }}
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

      {/* Floating AI Chat Bot (positioned 5px from bottom and right) */}
      <AiChatBot />
    </div>
  );
}
