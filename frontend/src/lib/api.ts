/**
 * Centralized API configuration for BrainBank.
 * Handles switching between development proxy and production absolute URLs.
 */

const isElectron = typeof window !== 'undefined' && window.process && (window.process as any).type === 'renderer';

// In development, Vite handles the proxy via /query, /api etc.
// In production packaged Electron, we need to point to the backend's port directly.
const getBaseUrl = () => {
    if (import.meta.env.DEV) {
        return '';
    }
    return 'http://127.0.0.1:8000';
};

export const API_BASE_URL = getBaseUrl();

/**
 * Helper to build full API URLs.
 * @param path The endpoint path (e.g., '/query')
 * @returns The full URL
 */
export const getApiUrl = (path: string) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL}${cleanPath}`;
};
