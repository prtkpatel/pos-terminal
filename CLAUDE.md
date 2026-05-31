# pos-terminal — CLAUDE.md

> The **offline-first Electron desktop checkout terminal** for cashiers. React + Vite renderer,
> Electron main process with a local **SQLite** database, syncing to pos-backend.
> See `../../CLAUDE.md` (one dir above `POS/`) for the system overview.

## Purpose
The in-store cashier app: PIN login, product search/scan, cart, dynamic pricing, multi-tender
payment (cash / UPI / khata), customer lookup. **Works fully offline** — every sale completes
against local SQLite and syncs to the backend later via an outbox.

## Tech stack
- **Electron 29** + **React 18** + **Vite 5** + TypeScript 5.
- **Zustand** (auth, cart, sync stores), **React Router 6** (MemoryRouter).
- **better-sqlite3 9** — synchronous embedded DB in the Electron main process.
- **Tailwind CSS 3**, **lucide-react** icons.
- Tests: **Vitest** (unit, jsdom) + **Playwright** (Electron e2e).
- API via native `fetch` (Bearer token + refresh on 401).

## Architecture
```
electron/
├── main.ts        # Electron main: opens BrowserWindow, inits SQLite (pos.db in userData),
│                  #   seeds mock products/cashiers, exposes IPC: db:query / db:get / db:execute / sys:get-path
└── preload.ts     # contextBridge → window.api.db / window.api.sys (contextIsolation on, nodeIntegration off)

src/
├── main.tsx, App.tsx       # entry; App restores session + triggers periodic sync (~30s)
├── pages/
│   ├── LoginScreen.tsx      # PIN login (online → backend, offline → local cashiers table)
│   └── CheckoutScreen.tsx   # main POS UI: search, cart, payment (the big one, 600+ lines)
├── components/shell/ShellLayout.tsx   # status bars + outlet
├── stores/                 # authStore, cartStore, syncStore (+ .spec.ts)
└── lib/
    ├── db.ts               # typed bridge over window.api.db (IPC)
    ├── api.ts              # fetch wrapper, auth, backend endpoints
    └── syncEngine.ts       # pushOutbox / pullChanges / refreshTerminalSettings / sendHeartbeat
```

## Offline model (the core idea)
Local SQLite tables: `products`, `customers`, `sales`, `outbox`, `cashiers`, `settings`,
`sync_state`. Every user action that mutates server state writes a row to **`outbox`**
(status `pending`). The sync engine (`src/lib/syncEngine.ts`):
1. **push** queued ops to `/v1/sync/push` (batched, with idempotency keys, retry on failure),
2. **pull** deltas since `sync_state` watermarks (products, customers, inventory, rules),
3. **refresh** terminal/store settings from `/v1/settings/me`,
4. **heartbeat** `/v1/sync/heartbeat` (reports outbox depth).
Online status via `navigator.onLine`; auto-sync on reconnect and on a timer. Auth falls back to
the local `cashiers` table when the backend is unreachable. **Failed outbox rows persist** (no
data loss) — inspect with `node check-terminal-db.js`.

## Backend integration
Base URL stored in SQLite `settings` (default `http://localhost:3000`). Endpoints:
`/v1/auth/pin-login`, `/v1/auth/refresh`, `/v1/auth/logout`, `/v1/sync/{push,pull,heartbeat}`,
`/v1/settings/me`, `/v1/customers/lookup`, `/v1/pricing/preview`.

## How to run
```bash
npm install
npm run dev            # Vite dev server + Electron (DevTools available)
npm run typecheck
npm run build          # renderer → dist/, main+preload → dist-electron/
npm run dist           # electron-builder → portable .exe (release/)
npm run dist:dir       # unpacked build (faster)
# tests
npm test               # Vitest unit
npm run test:watch / test:ui
npm run test:e2e       # Playwright (launches real Electron); also :ui, :headed
```

## Conventions & gotchas
- **Money is BigInt paise** (`100` = ₹1.00); divide by 100 only for display. Cart math uses BigInt.
- **Product search** priority: barcode exact → SKU exact → prefix → fuzzy; dedupes by SKU.
- **IPC only** for DB access — never import better-sqlite3 in the renderer; go through `window.api.db`.
  Pass JSON-serializable payloads across the bridge.
- Console logs are prefixed `[sync]`, `[pricing]`, `[auth]` for debugging.
- `check-terminal-db.js` (root) dumps the local `pos.db` for inspection.
- Default seeded cashiers exist for dev (e.g. admin/1234) — see `electron/main.ts`.
- See `TEST.md` for e2e scenarios; the Playwright `CashierBot` (`e2e/cashier-bot.ts`) drives the app.

## Relation to pos-shared-types
Should consume `@pos/shared-types` for API/DTO shapes; currently uses some loose local types in
the stores. Prefer shared DTOs when adding sync payloads or API calls.
