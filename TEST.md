# POS Terminal Test Suite

## Running Tests

```bash
# Run all tests once
npm test

# Watch mode (re-runs on file change)
npm run test:watch

# UI mode (browser-based test runner)
npm run test:ui
```

## Test Structure

| File | Coverage |
|------|----------|
| `src/stores/authStore.spec.ts` | Session restore, logout, localStorage |
| `src/stores/cartStore.spec.ts` | Add product, increment qty, update qty, remove, clear |
| `src/stores/syncStore.spec.ts` | Online status, sync state, outbox tracking |

## Key Test Scenarios

### Auth Store
- ✅ Starts with no cashier
- ✅ Restores session from `localStorage`
- ✅ Clears session and `localStorage` on logout

### Cart Store
- ✅ Starts with empty cart (0 items, 0 total)
- ✅ Adding product creates cart item with qty=1
- ✅ Adding same product increments qty (not duplicate row)
- ✅ `updateQty` recalculates line total
- ✅ `removeItem` deletes the row and resets total
- ✅ `clearCart` wipes everything

### Sync Store
- ✅ Starts in online/synced state
- ✅ `checkOnline` reads `navigator.onLine`

## Mock Setup

The test environment (`src/test/setup.ts`) mocks:
- `window.api.db` — Electron IPC database bridge
- `window.api.sys` — Electron system paths
- `localStorage` — In-memory storage with spies
- `navigator.onLine` — Network connectivity
- `window.addEventListener` — Event system
