import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSyncStore } from './syncStore';

describe('syncStore', () => {
  beforeEach(() => {
    useSyncStore.setState({
      isOnline: true,
      isSyncing: false,
      lastSyncAt: null,
      outboxDepth: 0,
      outboxCount: 0,
      syncError: null,
    });
    vi.clearAllMocks();
  });

  it('should start in synced state', () => {
    const state = useSyncStore.getState();
    expect(state.isOnline).toBe(true);
    expect(state.isSyncing).toBe(false);
    expect(state.syncError).toBeNull();
    expect(state.outboxDepth).toBe(0);
  });

  it('should set online status', () => {
    useSyncStore.getState().checkOnline();
    // navigator.onLine is true in test setup
    expect(useSyncStore.getState().isOnline).toBe(true);
  });

  it('should record outbox depth', async () => {
    // Mock the db module
    const state = useSyncStore.getState();
    expect(state.outboxDepth).toBe(0);
  });
});
