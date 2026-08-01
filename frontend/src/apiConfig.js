/**
 * Dynamic API Configuration for StockInsight
 * Automatically detects whether request originates from localhost or LAN IP (e.g., 192.168.0.7)
 */
export const getApiBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return `http://${window.location.hostname}:2500/api`;
  }
  return 'http://localhost:2500/api';
};

export const API_BASE = getApiBaseUrl();
