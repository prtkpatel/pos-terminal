# POS Terminal

Offline-first Electron POS terminal for store checkout. It uses a local SQLite database for terminal state and syncs sales, cart, authentication, and configuration data with the backend when connectivity is available.

## Stack

- Electron
- React 18
- Vite
- TypeScript
- Tailwind CSS
- better-sqlite3
- Zustand
- Shared contracts from `../pos-shared-types`

## Prerequisites

- Node.js 20 or newer
- npm
- Running `pos-backend` API for online login and sync

## Setup

```bash
npm install
```

The terminal stores its API base URL in local settings and defaults to:

```text
http://localhost:3000
```

For a terminal device on another machine, configure the API base URL to the backend machine IP.

## Development

```bash
npm run dev
```

## Build

Build the renderer and Electron output:

```bash
npm run build
```

Create a Windows portable build:

```bash
npm run dist
```

Create an unpacked Windows build directory:

```bash
npm run dist:dir
```

Build artifacts are written to `release/`.

## Tests

```bash
npm run typecheck
npm test
npm run test:e2e
```

Generated folders such as `release/`, `playwright-report/`, `test-results/`, `e2e/screenshots/`, and local database files such as `pos.db` are runtime artifacts and should not be committed unless intentionally needed.

## Related Projects

- `pos-backend`: NestJS API and sync endpoints
- `pos-shared-types`: shared DTOs and domain contracts
- `pos-admin`: browser admin console
- `pos-mobile`: Expo mobile owner app
