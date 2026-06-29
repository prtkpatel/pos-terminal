/**
 * repair-sync.js
 *
 * Standalone recovery script — reads pos.db directly, resets unsynced / wrongly-synced
 * bills back to pending, then pushes them all to the backend.
 *
 * IMPORTANT: Close the POS terminal app before running this script.
 *
 * Usage:
 *   node repair-sync.js --pin 1234
 *   node repair-sync.js --username admin --pin 1234
 */

'use strict';

const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const http     = require('http');
const https    = require('https');
const crypto   = require('crypto');
const { execFileSync } = require('child_process');

// ─── Config ──────────────────────────────────────────────────────────────────

// --data-dir overrides the userData folder (useful when the app ran in dev mode
// and stored data under 'pos-terminal' instead of the productName).
const _argv        = process.argv.slice(2);
const _dataDirIdx  = _argv.indexOf('--data-dir');
const _dataDir     = _dataDirIdx >= 0 ? _argv[_dataDirIdx + 1] : null;

const APP_NAME        = 'Shubhraj Mini Mart POS';
const USER_DATA       = _dataDir || path.join(os.homedir(), 'AppData', 'Roaming', APP_NAME);
const DB_PATH         = path.join(USER_DATA, 'pos.db');
const SECURE_STORE    = path.join(USER_DATA, 'secure-store.json');

// ─── Logging ─────────────────────────────────────────────────────────────────

const log  = (msg) => console.log(`  ${msg}`);
const ok   = (msg) => console.log(`  ✓  ${msg}`);
const fail = (msg) => console.error(`  ✗  ${msg}`);
const line = ()    => console.log('─'.repeat(72));

// ─── Windows DPAPI decrypt (raw bytes → raw bytes) ───────────────────────────

function dpapiDecryptBytes(encryptedBase64) {
  // Uses PowerShell -EncodedCommand to bypass execution policy (no .ps1 file).
  // Returns the decrypted bytes as a hex string so we can round-trip through text.
  const ps = [
    'Add-Type -AssemblyName System.Security',
    `$enc = [System.Convert]::FromBase64String('${encryptedBase64}')`,
    '$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '($dec | ForEach-Object { $_.ToString("x2") }) -join ""',
  ].join('\n');

  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  const out = execFileSync('powershell.exe', [
    '-NonInteractive', '-NoProfile', '-EncodedCommand', encoded,
  ], { encoding: 'utf8' });
  return Buffer.from(out.trim(), 'hex');
}

// ─── Electron v10 (OSCrypt / Chrome App-Bound Encryption) ────────────────────
// Electron 29+ on Windows stores secrets with AES-256-GCM.
// The AES key lives in Local State encrypted_key (DPAPI-protected).
// Ciphertext format: "v10" (3 bytes) | nonce (12 bytes) | encrypted + 16-byte auth tag

function loadOsCryptKey(userDataDir) {
  const localStatePath = path.join(userDataDir, 'Local State');
  if (!fs.existsSync(localStatePath)) return null;
  try {
    const ls = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const encKeyB64 = ls?.os_crypt?.encrypted_key;
    if (!encKeyB64) return null;
    // The stored key has a "DPAPI" prefix (5 bytes) prepended before the actual DPAPI blob.
    const encKeyBuf = Buffer.from(encKeyB64, 'base64');
    if (encKeyBuf.slice(0, 5).toString() !== 'DPAPI') return null;
    const dpapiBuf = encKeyBuf.slice(5); // strip the "DPAPI" prefix
    return dpapiDecryptBytes(dpapiBuf.toString('base64')); // returns 32-byte AES key
  } catch { return null; }
}

function decryptOsCryptValue(aesKey, base64Ciphertext) {
  // base64Ciphertext starts with "v10" prefix (3 bytes) when decoded.
  const buf = Buffer.from(base64Ciphertext, 'base64');
  if (buf.slice(0, 3).toString() !== 'v10') return null; // unexpected format
  const nonce   = buf.slice(3, 15);                      // 12-byte nonce
  const payload = buf.slice(15);                         // ciphertext + 16-byte auth tag
  const authTag = payload.slice(-16);
  const encrypted = payload.slice(0, -16);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch { return null; }
}

// ─── Secure store helpers ─────────────────────────────────────────────────────

let _osCryptKey = null; // cached once loaded

function readSecureValue(store, key, userDataDir) {
  const val = store[key];
  if (!val) return null;
  // Legacy plain-text fallback (Linux / no keyring)
  if (val.startsWith('plain:')) {
    return Buffer.from(val.slice(6), 'base64').toString('utf8');
  }
  // Electron 29+ OSCrypt (v10 prefix = AES-256-GCM with key from Local State)
  if (Buffer.from(val, 'base64').slice(0, 3).toString() === 'v10') {
    if (!_osCryptKey) _osCryptKey = loadOsCryptKey(userDataDir);
    if (!_osCryptKey) return null;
    return decryptOsCryptValue(_osCryptKey, val);
  }
  // Older Electron: raw DPAPI blob
  try { return dpapiDecryptBytes(val).toString('utf8'); } catch { return null; }
}

function loadSecureStore() {
  if (!fs.existsSync(SECURE_STORE)) return {};
  try { return JSON.parse(fs.readFileSync(SECURE_STORE, 'utf8')); }
  catch { return {}; }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const mod     = parsed.protocol === 'https:' ? https : http;
    const body    = options.body ? Buffer.from(options.body, 'utf8') : null;

    const req = mod.request({
      hostname : parsed.hostname,
      port     : parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path     : parsed.pathname + (parsed.search || ''),
      method   : options.method || 'GET',
      headers  : {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(body ? { 'Content-Length': String(body.length) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // --- Parse CLI args ---
  const argv     = process.argv.slice(2);
  const getArg   = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
  const username = getArg('username') || 'admin';
  const pin      = getArg('pin');

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  POS Terminal — Offline Bill Recovery Script');
  console.log('══════════════════════════════════════════════════════════════════════');

  // --- Preflight checks ---
  if (!fs.existsSync(DB_PATH)) {
    fail(`pos.db not found at:\n     ${DB_PATH}`);
    fail('Make sure the POS app was installed and run at least once.');
    process.exit(1);
  }
  if (!fs.existsSync(SECURE_STORE)) {
    fail(`Secure store not found at:\n     ${SECURE_STORE}`);
    process.exit(1);
  }

  log(`Database : ${DB_PATH}`);

  // --- Decrypt SQLite key ---
  log('Decrypting database key (Electron OSCrypt / DPAPI)...');
  const store  = loadSecureStore();
  const dbKey  = readSecureValue(store, 'db_key', USER_DATA);
  if (!dbKey) {
    fail('Could not decrypt the database key. Make sure you are running as the same Windows user who installed the POS app.');
    process.exit(1);
  }
  ok('Database key decrypted.');

  // --- Open SQLite ---
  let Database;
  try {
    Database = require('better-sqlite3-multiple-ciphers');
  } catch {
    fail('better-sqlite3-multiple-ciphers not found. Run:  npm install  inside pos-terminal/');
    process.exit(1);
  }

  let db;
  try {
    db = new Database(DB_PATH);
    db.pragma(`cipher='sqlcipher'`);
    db.pragma(`key='${dbKey}'`);
    db.exec('SELECT count(*) FROM sqlite_master');
  } catch (e) {
    fail(`Cannot open database: ${e.message}`);
    fail('Is the POS terminal app still open? Close it first, then re-run this script.');
    process.exit(1);
  }
  ok('Database opened.');

  // --- Read settings ---
  const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;

  const baseUrl    = getSetting('api_base_url') || 'https://api.subhrajsupermarket.in';
  const terminalId = getSetting('terminal_id')  || 'unknown';
  const shiftId    = getSetting('shift_id')      || null;
  const storeId    = getSetting('store_id')      || null;

  log(`API      : ${baseUrl}`);
  log(`Terminal : ${terminalId}`);
  log(`Store    : ${storeId || '(not set)'}`);
  log(`Shift    : ${shiftId || '(not set)'}`);

  // --- Show outbox summary ---
  line();
  console.log('\n  OUTBOX CONTENTS\n');

  const allOrders = db.prepare(
    "SELECT op_id, status, retry_count, error, payload, created_at FROM outbox WHERE entity='order' ORDER BY created_at ASC"
  ).all();

  if (allOrders.length === 0) {
    log('Outbox is empty — no bills to recover.');
    db.close();
    return;
  }

  const counts = { synced: 0, pending: 0, failed: 0 };
  for (const row of allOrders) {
    counts[row.status] = (counts[row.status] || 0) + 1;
    try {
      const p     = JSON.parse(row.payload);
      const total = ((p.payments?.[0]?.amount || 0) / 100).toFixed(2);
      const items = p.items?.length || 0;
      const note  = row.error ? `  ← ${row.error}` : '';
      console.log(
        `  ${row.op_id.padEnd(12)} │ ${row.status.padEnd(8)} │ retries: ${String(row.retry_count).padStart(2)} │ ₹${total.padStart(8)} │ ${items} item(s) │ ${row.created_at}${note}`
      );
    } catch {
      console.log(`  ${row.op_id} │ (payload parse error)`);
    }
  }

  line();
  log(`Total: ${allOrders.length}  │  Synced: ${counts.synced || 0}  │  Pending: ${counts.pending || 0}  │  Failed: ${counts.failed || 0}`);

  // --- Reset synced + failed → pending ---
  const toReset = allOrders.filter(r => r.status === 'synced' || r.status === 'failed');
  if (toReset.length > 0) {
    console.log(`\n  Resetting ${toReset.length} bill(s) (synced + failed) back to pending...`);
    db.prepare(
      "UPDATE outbox SET status='pending', retry_count=0, error=NULL WHERE entity='order' AND status IN ('synced','failed')"
    ).run();
    ok(`${toReset.length} bill(s) reset to pending.`);
  }

  // --- Authenticate ---
  console.log('\n  AUTHENTICATION\n');
  let token = null;

  // --no-refresh: skip stored token and go straight to PIN login
  const noRefresh = argv.includes('--no-refresh');

  // Try stored refresh token first (no PIN needed)
  const refreshToken = !noRefresh && readSecureValue(store, 'pos_refresh_token', USER_DATA);
  if (refreshToken) {
    log('Trying stored refresh token...');
    try {
      const res = await request(`${baseUrl}/v1/auth/refresh`, {
        method : 'POST',
        body   : JSON.stringify({ refreshToken }),
      });
      if ((res.status === 200 || res.status === 201) && res.body?.accessToken) {
        token = res.body.accessToken;
        ok('Got fresh access token from stored refresh token.');
      } else {
        log(`Refresh returned ${res.status} — will try PIN login.`);
      }
    } catch (e) {
      log(`Refresh request failed: ${e.message} — will try PIN login.`);
    }
  }

  // Fall back to PIN login
  if (!token) {
    if (!pin) {
      fail('No stored session found. Provide your PIN:');
      fail('  node repair-sync.js --pin 1234');
      fail('  node repair-sync.js --username admin --pin 1234');
      db.close();
      process.exit(1);
    }
    log(`Logging in as "${username}" with PIN...`);
    try {
      const res = await request(`${baseUrl}/v1/auth/pin-login`, {
        method : 'POST',
        body   : JSON.stringify({ username, pin }),
      });
      if ((res.status === 200 || res.status === 201) && res.body?.accessToken) {
        token = res.body.accessToken;
        ok('Login successful.');
      } else {
        fail(`Login failed (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
        db.close();
        process.exit(1);
      }
    } catch (e) {
      fail(`Login request failed: ${e.message}`);
      db.close();
      process.exit(1);
    }
  }

  // --- Push all pending bills ---
  const pending = db.prepare(
    "SELECT * FROM outbox WHERE entity='order' AND status='pending' ORDER BY created_at ASC"
  ).all();

  if (pending.length === 0) {
    log('No pending bills to push.');
    db.close();
    return;
  }

  // --force-new-ids: assign brand-new UUIDs to both opId and clientOpId in the payload.
  // Use this when the server already has orders with the same clientOpId (invoice counter was
  // reset and the old bills are still in PostgreSQL with a UNIQUE constraint).
  const forceNewIds = argv.includes('--force-new-ids');
  if (forceNewIds) {
    console.log('\n  NOTE: --force-new-ids active — each bill will get a fresh UUID so it');
    console.log('        bypasses both the Redis idempotency cache and the DB unique constraint.');
    console.log('        Bills will land as new invoice numbers on the server (e.g. 000026+).\n');
  }

  console.log(`\n  PUSHING ${pending.length} BILL(S) TO BACKEND\n`);

  // id remapping: old op_id → new op_id (so we can update outbox after push)
  const idMap = new Map(); // newOpId → oldOpId

  const ops = pending.map((row) => {
    const payload = JSON.parse(row.payload);
    let opId = row.op_id;
    if (forceNewIds) {
      const newId = crypto.randomUUID();
      idMap.set(newId, row.op_id);
      opId = newId;
      payload.clientOpId = newId; // replace clientOpId in the order payload too
    } else {
      idMap.set(opId, opId);
    }
    return { opId, entity: row.entity, action: row.action, payload };
  });

  let res;
  try {
    res = await request(`${baseUrl}/v1/sync/push`, {
      method  : 'POST',
      headers : { Authorization: `Bearer ${token}` },
      body    : JSON.stringify({ ops, terminalId }),
    });
  } catch (e) {
    fail(`Network error during sync push: ${e.message}`);
    db.close();
    process.exit(1);
  }

  if (res.status !== 200 && res.status !== 201) {
    fail(`Sync push failed (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
    db.close();
    process.exit(1);
  }

  // --- Process results ---
  line();
  console.log('\n  RESULTS\n');
  const results    = res.body?.results || [];
  let pushedCount  = 0;
  let failedCount  = 0;

  for (const r of results) {
    const originalOpId = idMap.get(r.opId) || r.opId;
    if (r.status === 'ok') {
      db.prepare("UPDATE outbox SET status='synced' WHERE op_id=?").run(originalOpId);
      pushedCount++;
      ok(`${originalOpId.padEnd(12)} → saved as ${r.canonical?.billNo || r.serverId || 'ok'}`);
    } else {
      db.prepare("UPDATE outbox SET status='failed', retry_count=1, error=? WHERE op_id=?")
        .run(r.error || 'unknown', originalOpId);
      failedCount++;
      fail(`${originalOpId.padEnd(12)} → ${r.error}`);
    }
  }

  line();
  console.log(`\n  SUMMARY: Pushed ${pushedCount} ✓   Failed ${failedCount} ✗\n`);

  if (failedCount > 0) {
    console.log('  Failed bills — common causes and fixes:\n');
    console.log('    "clientOpId already exists" → The server already has an order with this ID.');
    console.log('                            Re-run with: node repair-sync.js --pin 1234 --force-new-ids');
    console.log('                            This assigns fresh UUIDs and pushes as new orders.');
    console.log('    "Shift is not open"   → Open a shift from the admin panel (Shifts page),');
    console.log('                            then re-run this script.');
    console.log('    "Store not found"     → Terminal store_id is not configured.');
    console.log('                            Pair the terminal in Admin → Terminals.');
    console.log('    "Variant not found"   → Product was deleted from backend after the bill.');
    console.log('                            These bills cannot be auto-recovered.');
    console.log('    "Cashier not found"   → Pass correct credentials: --username X --pin Y\n');
  }

  db.close();
}

main().catch((e) => {
  console.error('\n  FATAL:', e.message);
  process.exit(1);
});
