import { create } from 'zustand';
import { pushOutbox, pullChanges, sendHeartbeat, getOutboxDepth, isOnline } from '../lib/syncEngine';

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt: string | null;
  outboxDepth: number;
  outboxCount: number;
  syncError: string | null;
  checkOnline: () => void;
  syncNow: () => Promise<void>;
  refreshOutboxDepth: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  isOnline: navigator.onLine,
  isSyncing: false,
  lastSyncAt: localStorage.getItem('pos_last_sync'),
  outboxDepth: 0,
  outboxCount: 0,
  syncError: null,

  checkOnline: () => {
    set({ isOnline: navigator.onLine });
  },

  syncNow: async () => {
    if (get().isSyncing || !navigator.onLine) return;
    set({ isSyncing: true, syncError: null });

    const errors: string[] = [];

    // 1. Push outbox first — most important
    try {
      const result = await pushOutbox();
      console.log('[sync] pushOutbox:', result);
    } catch (e: any) {
      console.error('[sync] pushOutbox failed:', e);
      errors.push(`Push: ${e.message || 'failed'}`);
    }

    // 2. Pull server changes
    try {
      const result = await pullChanges();
      console.log('[sync] pullChanges:', result);
    } catch (e: any) {
      console.error('[sync] pullChanges failed:', e);
      errors.push(`Pull: ${e.message || 'failed'}`);
    }

    // 3. Heartbeat — least important, don't fail sync if this alone fails
    try {
      await sendHeartbeat();
      console.log('[sync] heartbeat ok');
    } catch (e: any) {
      console.warn('[sync] heartbeat failed:', e.message);
    }

    if (errors.length === 0) {
      const now = new Date().toISOString();
      localStorage.setItem('pos_last_sync', now);
      set({ lastSyncAt: now, syncError: null });
    } else {
      console.error('[sync] errors:', errors);
      set({ syncError: errors.join(' · ') });
    }

    const depth = await getOutboxDepth();
    set({ isSyncing: false, outboxDepth: depth, outboxCount: depth });
  },

  refreshOutboxDepth: async () => {
    const depth = await getOutboxDepth();
    set({ outboxDepth: depth, outboxCount: depth });
  },
}));

// Auto-sync on online event
window.addEventListener('online', () => {
  useSyncStore.getState().checkOnline();
  void useSyncStore.getState().syncNow();
});
window.addEventListener('offline', () => {
  useSyncStore.getState().checkOnline();
});
