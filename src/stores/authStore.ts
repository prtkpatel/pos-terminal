import { create } from 'zustand';
import { db } from '../lib/db';
import { apiPinLogin, setTokens, clearTokens, getToken, loadApiConfig } from '../lib/api';
import { isOnline } from '../lib/syncEngine';

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

export const useAuthStore = create<AuthState>((set) => ({
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
            if (existing) {
              await db.execute('UPDATE cashiers SET id = ?, name = ?, pin = ? WHERE username = ?', [data.user.id, data.user.name, pin.trim(), normalizedUser]);
            } else {
              await db.execute('INSERT INTO cashiers (id, username, name, pin) VALUES (?, ?, ?, ?)', [data.user.id, normalizedUser, data.user.name, pin.trim()]);
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
      'SELECT id, username, name FROM cashiers WHERE username = ? AND pin = ?',
      [normalizedUser, pin.trim()]
    );
    if (!row) {
      return { success: false, message: 'Invalid username or PIN' };
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
        // If we have a stored token, verify it's still valid by loading it
        const token = getToken();
        if (token) {
          set({ cashier });
        } else {
          // Token expired but cashier cached — keep session for offline work
          set({ cashier });
        }
      } catch {
        localStorage.removeItem('pos_cashier');
      }
    }
    set({ isLoading: false });
  },
}));
