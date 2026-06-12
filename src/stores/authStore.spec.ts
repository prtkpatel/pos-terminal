import { describe, it, expect, beforeEach, vi } from 'vitest';

// Auth tokens now live in an in-memory cache hydrated from OS-encrypted storage
// (safeStorage) — no longer in localStorage. Simulate "a valid session exists" by
// mocking the token getters and forcing offline, so restoreSession trusts the cached
// cashier without calling the backend.
vi.mock('../lib/syncEngine', () => ({ isOnline: () => false }));
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    getToken: () => 'access-token',
    getRefreshToken: () => 'refresh-token',
  };
});

import { useAuthStore } from './authStore';

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ cashier: null, isLoading: false });
    vi.clearAllMocks();
  });

  it('should start with no cashier', () => {
    const state = useAuthStore.getState();
    expect(state.cashier).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it('should restore a cached session when a token is present', async () => {
    const mockCashier = { id: 'c1', username: 'admin', name: 'Admin' };
    (localStorage.getItem as any).mockReturnValue(JSON.stringify(mockCashier));

    await useAuthStore.getState().restoreSession();

    const state = useAuthStore.getState();
    expect(state.cashier).toEqual(mockCashier);
  });

  it('should clear session on logout', () => {
    useAuthStore.setState({
      cashier: { id: 'c1', username: 'admin', name: 'Admin' },
      isLoading: false,
    });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.cashier).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith('pos_cashier');
  });
});
