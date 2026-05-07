import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('should restore session from localStorage', async () => {
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
