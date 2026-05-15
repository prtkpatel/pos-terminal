const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-terminal', 'pos.db');
console.log('Checking terminal DB:', dbPath);

try {
  const db = new Database(dbPath);

  const outbox = db.prepare("SELECT status, COUNT(*) as count FROM outbox GROUP BY status").all();
  console.log('\nOutbox summary:', outbox);

  const pending = db.prepare("SELECT op_id, entity, action, status, retry_count, error FROM outbox WHERE status = 'pending' OR (status = 'failed' AND retry_count < 5)").all();
  console.log('\nPending/failed ops:', pending);

  const sales = db.prepare("SELECT invoice_no, items_json, created_at FROM sales ORDER BY invoice_no DESC LIMIT 5").all();
  console.log('\nLocal sales:', sales.map(s => ({ invoice_no: s.invoice_no, created_at: s.created_at })));

  db.close();
} catch (e) {
  console.error('Error:', e.message);
}
