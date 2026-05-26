import { db } from './db';
import { apiSyncPush, apiSyncPull, apiSyncHeartbeat, loadApiConfig, getBaseUrl } from './api';

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
  const ops = pending.map((row: any) => ({
    opId: row.op_id,
    entity: row.entity,
    action: row.action,
    payload: JSON.parse(row.payload),
  }));

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

  const since: Record<string, string> = {};
  const entities = ['products', 'categories', 'customers', 'inventory', 'rules'];
  for (const entity of entities) {
    const ts = await getSyncState(entity);
    if (ts) since[entity] = ts;
  }

  const tid = await getTerminalId();
  const result = await apiSyncPull(since, tid);

  let productsCount = 0;
  let customersCount = 0;

  // Upsert products
  if (result.products?.length) {
    for (const p of result.products) {
      const variant = p.variants?.[0];
      const barcode = variant?.barcodes?.[0]?.barcode ?? '';
      try {
        await db.execute(
          `INSERT OR REPLACE INTO products (id, variant_id, sku, barcode, name, hsn, mrp, price, discount, tax_rate, quantity, reorder_level, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT quantity FROM products WHERE variant_id = ?), (SELECT reorder_level FROM products WHERE variant_id = ?), CURRENT_TIMESTAMP)`,
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
    customersCount = result.customers.length;
    await setSyncState('customers', result.serverNow);
  }

  if (result.categories?.length) await setSyncState('categories', result.serverNow);
  if (result.rules?.length) await setSyncState('rules', result.serverNow);

  return { products: productsCount, customers: customersCount };
}

export async function sendHeartbeat(): Promise<void> {
  if (!db) return;
  await loadApiConfig();
  const tid = await getTerminalId();
  const depthRow = await db.get("SELECT COUNT(*) as c FROM outbox WHERE status = 'pending'");
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
  const row = await db.get("SELECT COUNT(*) as c FROM outbox WHERE status = 'pending'");
  return row?.c ?? 0;
}

export function isOnline(): boolean {
  return navigator.onLine;
}
