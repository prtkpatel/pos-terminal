import { db } from './db';
import { apiGetSettings, apiGetWeightedBarcodeConfig, apiSyncPush, apiSyncPull, apiSyncHeartbeat, loadApiConfig, getBaseUrl } from './api';

function ean13CheckDigit(base: string): string {
  const digits = base.split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

function normalizeBarcode(barcode: string): string {
  if (/^\d{13}$/.test(barcode)) {
    return barcode.slice(0, 12) + ean13CheckDigit(barcode.slice(0, 12));
  }
  return barcode;
}

let cachedTerminalId = '';

async function getTerminalId(): Promise<string> {
  if (cachedTerminalId) return cachedTerminalId;
  if (!db) return 'term-unknown';
  const row = await db.get("SELECT value FROM settings WHERE key = 'terminal_id'");
  cachedTerminalId = (row?.value as string) || 'term-unknown';
  return cachedTerminalId;
}

async function getSetting(key: string): Promise<string | null> {
  if (!db) return null;
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

async function setSetting(key: string, value: string) {
  if (!db) return;
  await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  window.dispatchEvent(new CustomEvent('terminal-setting-updated', { detail: { key, value } }));
}

async function getSyncState(entity: string): Promise<string | null> {
  if (!db) return null;
  const row = await db.get('SELECT last_pulled_at FROM sync_state WHERE entity = ?', [entity]);
  return row?.last_pulled_at ?? null;
}

async function setSyncState(entity: string, pulledAt: string) {
  if (!db) return;
  await db.execute('INSERT OR REPLACE INTO sync_state (entity, last_pulled_at) VALUES (?, ?)', [entity, pulledAt]);
}

export async function pushOutbox(): Promise<{ pushed: number; failed: number }> {
  if (!db) return { pushed: 0, failed: 0 };
  await loadApiConfig();

  const pending = await db.query(
    "SELECT * FROM outbox WHERE status = 'pending' OR (status = 'failed' AND retry_count < 50) ORDER BY created_at ASC LIMIT 50",
    []
  );
  if (!pending.length) return { pushed: 0, failed: 0 };

  const tid = await getTerminalId();

  // Repair offline bills: a bill created while logged in offline captures the LOCAL
  // cashier id (e.g. "admin"), which the server rejects as an unknown cashier. Before
  // pushing, swap any non-UUID cashierId for a real server user id cached in the
  // cashiers table (populated on the last successful online login / seed).
  const isUuid = (v: any) =>
    typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  let serverCashierId: string | null = null;
  try {
    const c = await db.get("SELECT id FROM cashiers WHERE id GLOB '*-*-*-*-*' LIMIT 1");
    if (c && isUuid(c.id)) serverCashierId = c.id;
  } catch {
    // ignore — best-effort repair
  }

  const ops = pending.map((row: any) => {
    const payload = JSON.parse(row.payload);
    if (row.entity === 'order' && !isUuid(payload.cashierId) && serverCashierId) {
      payload.cashierId = serverCashierId;
    }
    return { opId: row.op_id, entity: row.entity, action: row.action, payload };
  });

  try {
    const result = await apiSyncPush(ops, tid);
    let pushed = 0;
    let failed = 0;

    for (const r of result.results || []) {
      if (r.status === 'ok') {
        await db.execute("UPDATE outbox SET status = 'synced' WHERE op_id = ?", [r.opId]);
        pushed++;
      } else {
        await db.execute(
          "UPDATE outbox SET status = 'failed', retry_count = retry_count + 1, error = ? WHERE op_id = ?",
          [r.error || 'unknown', r.opId]
        );
        failed++;
      }
    }
    return { pushed, failed };
  } catch (e: any) {
    // Network error — mark all as failed for now, will retry
    for (const row of pending) {
      await db.execute(
        "UPDATE outbox SET status = 'failed', retry_count = retry_count + 1, error = ? WHERE op_id = ?",
        [e.message || 'network', row.op_id]
      );
    }
    return { pushed: 0, failed: pending.length };
  }
}

export async function pullChanges(): Promise<{ products: number; customers: number }> {
  if (!db) return { products: 0, customers: 0 };
  await loadApiConfig();

  // One-time self-heal: older builds could persist a LOCAL-time sync watermark, which the
  // server parses as a FUTURE instant → every delta comes back empty → updates (new barcodes,
  // edited products) never reach the till. Clear the watermarks once so the next pull is a
  // full re-sync; from then on we only ever store the server's UTC `serverNow`. Gated by a
  // flag so it runs a single time per install. (Does NOT touch the outbox — offline bills
  // are preserved.)
  const healed = await getSetting('sync_tz_heal_v1');
  if (healed !== 'done') {
    try { await db.execute('DELETE FROM sync_state', []); } catch { /* table may be empty */ }
    await setSetting('sync_tz_heal_v1', 'done');
  }

  const since: Record<string, string> = {};
  const entities = ['products', 'categories', 'customers', 'inventory', 'rules'];
  for (const entity of entities) {
    const ts = await getSyncState(entity);
    // Defensive: ignore an unparseable or far-future watermark (treat as a full pull) so a
    // bad value can never permanently hide updates. Date.now() is UTC epoch (tz-independent).
    if (ts) {
      const t = new Date(ts).getTime();
      if (!Number.isNaN(t) && t <= Date.now() + 120000) since[entity] = ts;
    }
  }

  const tid = await getTerminalId();

  // Pull weighted-barcode config first (best-effort) so the terminal parser matches the scale.
  try {
    const weightedConfig = await apiGetWeightedBarcodeConfig();
    await setSetting('weighted_barcode_config', JSON.stringify(weightedConfig));
  } catch (e: any) {
    console.warn('[sync] Could not fetch weighted barcode config:', e.message);
  }

  const result = await apiSyncPull(since, tid);

  let productsCount = 0;
  let customersCount = 0;

  // Upsert products
  if (result.products?.length) {
    for (const p of result.products) {
      const variant = p.variants?.[0];
      // Prefer the PRIMARY barcode — it's the one the admin label printer prints, so it must
      // be the one we match scans against. Fall back to the first barcode if none is flagged.
      const primaryBarcode =
        variant?.barcodes?.find((b: any) => b.isPrimary)?.barcode ?? variant?.barcodes?.[0]?.barcode ?? '';
      const barcode = normalizeBarcode(primaryBarcode);
      try {
        // PLU (scale code) for weighed items — stored in the product's attributes JSON.
        const pluRaw = (p.attributes && (p.attributes.plu ?? p.attributes.PLU)) ?? null;
        const plu = pluRaw == null || pluRaw === '' ? null : String(pluRaw).replace(/^0+/, '') || '0';
        await db.execute(
          `INSERT OR REPLACE INTO products (id, variant_id, sku, barcode, name, hsn, mrp, price, discount, tax_rate, quantity, reorder_level, expiry_date, plu, image_thumb, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT quantity FROM products WHERE variant_id = ?), (SELECT reorder_level FROM products WHERE variant_id = ?), ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            p.id,
            variant?.id ?? p.id,
            variant?.sku ?? p.sku ?? '',
            barcode,
            p.name,
            p.hsnCode ?? '',
            variant?.mrp ?? 0,
            variant?.sellingPrice ?? variant?.mrp ?? 0,
            Math.max(0, Number(variant?.mrp ?? 0) - Number(variant?.sellingPrice ?? variant?.mrp ?? 0)),
            Number(p.taxRate) || 0,
            variant?.id ?? p.id,
            variant?.id ?? p.id,
            p.nearestExpiry ?? null,
            plu,
            variant?.imageThumb ?? null,
          ]
        );
        productsCount++;
      } catch (e: any) {
        console.error('[sync] Failed to upsert product:', p.id, p.name, e.message);
      }
    }
    await setSyncState('products', result.serverNow);
  }

  // Upsert inventory
  if (result.inventory?.length) {
    for (const inv of result.inventory) {
      try {
        await db.execute(
          'UPDATE products SET quantity = ?, reorder_level = ?, updated_at = CURRENT_TIMESTAMP WHERE variant_id = ?',
          [Number(inv.quantity) || 0, Number(inv.reorderLevel) || 0, inv.variantId]
        );
      } catch (e: any) {
        console.error('[sync] Failed to update inventory:', inv.variantId, e.message);
      }
    }
    await setSyncState('inventory', result.serverNow);
  }

  // Upsert customers
  if (result.customers?.length) {
    // Customers are not in terminal schema yet — store minimal info in settings or skip
    // For now we just count them
    for (const customer of result.customers) {
      try {
        const phone = String(customer.phone || '').replace(/\D/g, '');
        await db.execute(
          `INSERT OR REPLACE INTO customers (id, code, name, phone, email, gstin, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            customer.id,
            customer.code || `C-${phone.slice(-4)}`,
            customer.name || phone,
            phone,
            customer.email || '',
            customer.gstin || '',
          ]
        );
        customersCount++;
      } catch (e: any) {
        console.error('[sync] Failed to upsert customer:', customer.id, customer.name, e.message);
      }
    }
    await setSyncState('customers', result.serverNow);
  }

  if (result.settings) {
    await setSetting('gst_enabled', result.settings.gstEnabled === false ? 'false' : 'true');
  }

  // Always advance every watermark to the server clock — even on an empty delta — so a
  // transient empty pull can never leave a stale watermark that deadlocks future syncs.
  if (result.serverNow) {
    for (const entity of ['products', 'categories', 'customers', 'inventory', 'rules', 'settings']) {
      await setSyncState(entity, result.serverNow);
    }
  }

  return { products: productsCount, customers: customersCount };
}

export async function refreshTerminalSettings(): Promise<{ gstEnabled: boolean } | null> {
  if (!db) return null;
  await loadApiConfig();
  try {
    const settings = await apiGetSettings();
    const gstEnabled = settings?.tenant?.settings?.gstEnabled !== false;
    await setSetting('gst_enabled', gstEnabled ? 'true' : 'false');

    // Receipt footer is tenant-level (edited in admin → Settings → Receipt Defaults).
    await setSetting('store_footer', settings?.tenant?.settings?.receiptFooter || '');

    // Cache this terminal's store header (name / GSTIN / FSSAI / address) for the printed bill.
    const stores: any[] = settings?.stores || [];
    const storeIdRow = await db.get("SELECT value FROM settings WHERE key = 'store_id'");
    const store = stores.find((s) => s.id === storeIdRow?.value) || stores[0];
    if (store) {
      const addr = store.address || {};
      const addressLine = [addr.line1, addr.line2, addr.area, addr.city, addr.state, addr.pincode]
        .filter(Boolean).join(', ');
      await setSetting('store_name', store.name || '');
      await setSetting('store_gstin', store.gstin || '');
      await setSetting('store_fssai', store.fssaiNo || '');
      await setSetting('store_phone', store.phone || '');
      await setSetting('store_address', addressLine);
    }

    await setSyncState('settings', new Date().toISOString());
    return { gstEnabled };
  } catch (error) {
    console.warn('[sync] Settings refresh failed:', error);
    return null;
  }
}

export async function sendHeartbeat(): Promise<void> {
  if (!db) return;
  await loadApiConfig();
  const tid = await getTerminalId();
  const depthRow = await db.get(
    "SELECT COUNT(*) as c FROM outbox WHERE status = 'pending' OR (status = 'failed' AND retry_count < 50)"
  );
  await apiSyncHeartbeat(tid, depthRow?.c ?? 0);
}

export async function enqueueOutbox(entity: string, action: string, payload: Record<string, unknown>) {
  if (!db) return;
  const opId = crypto.randomUUID();
  await db.execute(
    'INSERT INTO outbox (op_id, entity, action, payload, status, retry_count) VALUES (?, ?, ?, ?, ?, ?)',
    [opId, entity, action, JSON.stringify(payload), 'pending', 0]
  );
  return opId;
}

export async function getOutboxDepth(): Promise<number> {
  if (!db) return 0;
  // Count unsynced sales: pending plus failed items still within the retry limit.
  const row = await db.get(
    "SELECT COUNT(*) as c FROM outbox WHERE status = 'pending' OR (status = 'failed' AND retry_count < 50)"
  );
  return row?.c ?? 0;
}

export async function getFailedOutboxCount(): Promise<number> {
  if (!db) return 0;
  const row = await db.get(
    "SELECT COUNT(*) as c FROM outbox WHERE status = 'failed' AND retry_count < 50"
  );
  return row?.c ?? 0;
}

export function isOnline(): boolean {
  return navigator.onLine;
}
