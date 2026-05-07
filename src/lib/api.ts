import { db } from './db';

const API_CACHE: { baseUrl: string | null; token: string | null; refreshToken: string | null } = {
  baseUrl: null,
  token: null,
  refreshToken: null,
};

export async function loadApiConfig() {
  if (!db) return;
  const row = await db.get("SELECT value FROM settings WHERE key = 'api_base_url'");
  API_CACHE.baseUrl = row?.value ?? 'http://localhost:3000';
}

export function getBaseUrl() {
  return API_CACHE.baseUrl ?? 'http://localhost:3000';
}

export function setTokens(access: string, refresh: string) {
  API_CACHE.token = access;
  API_CACHE.refreshToken = refresh;
  localStorage.setItem('pos_access_token', access);
  localStorage.setItem('pos_refresh_token', refresh);
}

export function getToken() {
  if (!API_CACHE.token) {
    API_CACHE.token = localStorage.getItem('pos_access_token');
  }
  return API_CACHE.token;
}

export function getRefreshToken() {
  if (!API_CACHE.refreshToken) {
    API_CACHE.refreshToken = localStorage.getItem('pos_refresh_token');
  }
  return API_CACHE.refreshToken;
}

export function clearTokens() {
  API_CACHE.token = null;
  API_CACHE.refreshToken = null;
  localStorage.removeItem('pos_access_token');
  localStorage.removeItem('pos_refresh_token');
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const base = getBaseUrl();
  const url = `${base}${path}`;
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getToken()}`;
      return fetch(url, { ...options, headers });
    }
  }

  return res;
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${getBaseUrl()}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// Auth
export async function apiPinLogin(pin: string, username?: string, tenantId?: string) {
  const res = await fetch(`${getBaseUrl()}/v1/auth/pin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, username, tenantId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'PIN login failed');
  }
  return res.json();
}

export async function apiLogout() {
  const token = getToken();
  if (!token) return;
  try {
    await apiFetch('/v1/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
  clearTokens();
}

// Sync
export async function apiSyncPush(ops: any[], terminalId: string) {
  const res = await apiFetch('/v1/sync/push', {
    method: 'POST',
    body: JSON.stringify({ ops, terminalId }),
  });
  if (!res.ok) throw new Error(`Sync push failed: ${res.status}`);
  return res.json();
}

export async function apiSyncPull(since: Record<string, string>, terminalId: string) {
  const res = await apiFetch('/v1/sync/pull', {
    method: 'POST',
    body: JSON.stringify({ since, terminalId }),
  });
  if (!res.ok) throw new Error(`Sync pull failed: ${res.status}`);
  return res.json();
}

export async function apiSyncHeartbeat(terminalId: string, outboxDepth: number) {
  const res = await apiFetch('/v1/sync/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ terminalId, outboxDepth }),
  });
  if (!res.ok) throw new Error(`Heartbeat failed: ${res.status}`);
  return res.json();
}
