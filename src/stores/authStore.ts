import { create } from 'zustand';
import bcrypt from 'bcryptjs';
import { db } from '../lib/db';
import { apiPinLogin, setTokens, clearTokens, getToken, getRefreshToken, loadApiConfig, setUnauthorizedHandler, apiFetch } from '../lib/api';
import { isOnline } from '../lib/syncEngine';

// Cashier PINs are stored HASHED in the local cashiers table (offline-login cache).
// Legacy rows may still be plaintext — verifyPin handles both and callers upgrade on match.
function isBcryptHash(value: string): boolean {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}
function hashPin(pin: string): string {
  return bcrypt.hashSync(pin, 10);
}
function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  if (isBcryptHash(stored)) return bcrypt.compareSync(pin, stored);
  return pin === stored; // legacy plaintext row
}

export interface Cashier {
  id: string;
  username: string;
  name: string;
  tenantId?: string;
}

interface AuthState {
  cashier: Cashier | null;
  isLoading: boolean;
  login: (username: string, pin: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => {
  // Register global 401 handler so any apiFetch that can't refresh → forces logout
  setUnauthorizedHandler(() => {
    localStorage.removeItem('pos_cashier');
    set({ cashier: null });
  });

  return {
  cashier: null,
  isLoading: true,

  login: async (username: string, pin: string) => {
    const normalizedUser = username.trim().toLowerCase();

    // Try backend API first if online
    if (isOnline()) {
      try {
        await loadApiConfig();
        const data = await apiPinLogin(pin, normalizedUser);
        const cashier: Cashier = {
          id: data.user.id,
          username: normalizedUser,
          name: data.user.name,
          tenantId: data.user.tenantId,
        };
        setTokens(data.accessToken, data.refreshToken);
        localStorage.setItem('pos_cashier', JSON.stringify(cashier));
        set({ cashier });
        // Cache the real server user id + PIN locally so that a later OFFLINE login
        // produces the same (valid) cashier id — otherwise offline bills can't sync.
        if (db) {
          try {
            const existing = await db.get('SELECT id FROM cashiers WHERE username = ?', [normalizedUser]);
            const pinHash = hashPin(pin.trim());
            if (existing) {
              await db.execute('UPDATE cashiers SET id = ?, name = ?, pin = ? WHERE username = ?', [data.user.id, data.user.name, pinHash, normalizedUser]);
            } else {
              await db.execute('INSERT INTO cashiers (id, username, name, pin) VALUES (?, ?, ?, ?)', [data.user.id, normalizedUser, data.user.name, pinHash]);
            }
          } catch {
            // non-fatal: offline credential cache update failed
          }
        }
        return { success: true };
      } catch (e: any) {
        // If backend rejects, don't fall through to local — respect backend auth
        if (e.message?.includes('Invalid PIN')) {
          return { success: false, message: 'Invalid PIN' };
        }
        // Network or other error — fall through to offline local auth
      }
    }

    // Offline fallback: validate against local SQLite cashiers table
    if (!db) {
      return { success: false, message: 'Database not available' };
    }
    const row = await db.get(
      'SELECT id, username, name, pin FROM cashiers WHERE username = ?',
      [normalizedUser]
    );
    if (!row || !verifyPin(pin.trim(), row.pin)) {
      return { success: false, message: 'Invalid username or PIN' };
    }
    // Upgrade a legacy plaintext PIN to a hash on first successful offline login.
    if (!isBcryptHash(row.pin)) {
      try { await db.execute('UPDATE cashiers SET pin = ? WHERE username = ?', [hashPin(pin.trim()), normalizedUser]); } catch { /* non-fatal */ }
    }
    const cashier = { id: row.id, username: row.username, name: row.name };
    localStorage.setItem('pos_cashier', JSON.stringify(cashier));
    set({ cashier });
    return { success: true };
  },

  logout: () => {
    clearTokens();
    localStorage.removeItem('pos_cashier');
    set({ cashier: null });
  },

  restoreSession: async () => {
    const raw = localStorage.getItem('pos_cashier');
    if (raw) {
      try {
        const cashier = JSON.parse(raw) as Cashier;
        const token = getToken();
        const refresh = getRefreshToken();

        if (token && isOnline()) {
          // Verify token is still accepted by the server
          try {
            const res = await apiFetch('/v1/settings/me');
            if (res.status === 401) {
              // apiFetch already cleared tokens + called _onUnauthorized if refresh failed,
              // but we handle it here too for the startup path (no cashier yet in state)
              clearTokens();
              localStorage.removeItem('pos_cashier');
              set({ isLoading: false });
              return;
            }
            set({ cashier });
          } catch {
            // Network error — trust the cached session for offline work
            set({ cashier });
          }
        } else if (!token && !refresh) {
          // No tokens at all — clear stale cashier cache
          localStorage.removeItem('pos_cashier');
        } else {
          // Offline or has tokens not yet loaded — keep session for offline work
          set({ cashier });
        }
      } catch {
        localStorage.removeItem('pos_cashier');
      }
    }
    set({ isLoading: false });
  },
  };
});
