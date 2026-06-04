const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-terminal', 'pos.db');
console.log('Checking terminal DB:', dbPath);

try {
  const db = new Database(dbPath);

  const outbox = db.prepare("SELECT status, COUNT(*) as count FROM outbox GROUP BY status").all();
  console.log('\nOutbox summary:', outbox);

  const pending = db.prepare("SELECT op_id, entity, action, status, retry_count, error, payload FROM outbox WHERE status = 'pending' OR (status = 'failed' AND retry_count < 50) ORDER BY created_at ASC").all();
  console.log('\nPending/failed ops:');
  for (const row of pending) {
    const payload = (() => { try { return JSON.parse(row.payload); } catch { return row.payload; } })();
    console.log({
      op_id: row.op_id,
      entity: row.entity,
      action: row.action,
      status: row.status,
      retry_count: row.retry_count,
      error: row.error,
      cashierId: payload?.cashierId,
      invoiceNo: payload?.invoiceNo || payload?.billNo,
      total: payload?.total,
    });
  }

  // Also show ALL failed regardless of retry count
  const allFailed = db.prepare("SELECT op_id, entity, action, retry_count, error FROM outbox WHERE status = 'failed' AND retry_count >= 50").all();
  if (allFailed.length) {
    console.log('\nGave-up (retry >= 50) ops:');
    for (const row of allFailed) console.log(row);
  }

  const sales = db.prepare("SELECT invoice_no, items_json, created_at FROM sales ORDER BY invoice_no DESC LIMIT 5").all();
  console.log('\nLocal sales:', sales.map(s => ({ invoice_no: s.invoice_no, created_at: s.created_at })));

  db.close();
} catch (e) {
  console.error('Error:', e.message);
}
