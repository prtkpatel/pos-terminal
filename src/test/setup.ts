// Vitest setup for Electron renderer tests
// Mocks window.api (Electron IPC bridge)
import { vi } from 'vitest';

Object.defineProperty(globalThis, 'window', {
  value: {
    api: {
      db: {
        query: async () => [],
        get: async () => null,
        execute: async () => ({ changes: 0, lastInsertRowid: 0 }),
      },
      sys: {
        getPath: async () => '',
      },
    },
    addEventListener: vi.fn(),
  },
  writable: true,
});

// Mock localStorage
const localStorageMock: Storage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
});

// Mock navigator.onLine
Object.defineProperty(globalThis, 'navigator', {
  value: {
    onLine: true,
  },
  writable: true,
});
