import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let db: any = null;

async function initDb() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(app.getPath('userData'), 'pos.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    console.log('Database initialized successfully');
  } catch (e) {
    console.warn('Failed to load better-sqlite3, using mock DB for UI preview');
    const mockProducts: any = {
      '8901001000011': { id: 'a0000001-0001-0001-0001-000000000001', variant_id: 'b0000001-0001-0001-0001-000000000001', sku: 'MILK-001', barcode: '8901001000011', name: 'Fresh Milk 1L', mrp: 6000, price: 5800, tax_rate: 5 },
      '8901001000028': { id: 'a0000001-0001-0001-0001-000000000002', variant_id: 'b0000001-0001-0001-0001-000000000002', sku: 'BRD-001', barcode: '8901001000028', name: 'Whole Wheat Bread', mrp: 4500, price: 4000, tax_rate: 0 },
      '8901001000035': { id: 'a0000001-0001-0001-0001-000000000003', variant_id: 'b0000001-0001-0001-0001-000000000003', sku: 'EGG-012', barcode: '8901001000035', name: 'Organic Eggs (12pk)', mrp: 12000, price: 11000, tax_rate: 0 },
      '8901001000042': { id: 'a0000001-0001-0001-0001-000000000004', variant_id: 'b0000001-0001-0001-0001-000000000004', sku: 'SGR-001', barcode: '8901001000042', name: 'Refined Sugar 1kg', mrp: 5000, price: 4800, tax_rate: 12 },
      '8901001000059': { id: 'a0000001-0001-0001-0001-000000000005', variant_id: 'b0000001-0001-0001-0001-000000000005', sku: 'TEA-001', barcode: '8901001000059', name: 'Assam Tea 250g', mrp: 25000, price: 22000, tax_rate: 18 },
      '8901001000066': { id: 'a0000001-0001-0001-0001-000000000006', variant_id: 'b0000001-0001-0001-0001-000000000006', sku: 'OIL-001', barcode: '8901001000066', name: 'Sunflower Oil 1L', mrp: 18000, price: 16500, tax_rate: 12 },
    };

    db = {
      prepare: (sql: string) => {
        const isCount = sql.toLowerCase().includes('count(*)');
        return {
          all: (...args: any[]) => Object.values(mockProducts),
          get: (...args: any[]) => {
            if (isCount) return { count: Object.keys(mockProducts).length };
            const first = args[0];
            if (!first) return null;
            return Object.values(mockProducts).find((product: any) => (
              product.barcode === first || product.sku === first || product.name === first
            )) || null;
          },
          run: () => ({ changes: 1, lastInsertRowid: 1 })
        };
      },
      exec: () => {}
    };
  }

  // Initialize schema (safe with mock)
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      variant_id TEXT,
      sku TEXT,
      barcode TEXT,
      name TEXT,
      hsn TEXT,
      mrp BIGINT,
      price BIGINT,
      tax_rate DECIMAL(5,2),
      is_weighable BOOLEAN DEFAULT 0,
      updated_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS outbox (
      op_id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cashiers (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_no INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      customer_json TEXT,
      subtotal INTEGER,
      tax_total INTEGER,
      total INTEGER,
      amount_received INTEGER,
      cashier_id TEXT,
      cashier_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      entity TEXT PRIMARY KEY,
      last_pulled_at DATETIME
    );
  `);

  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (productCount === 0) {
    const insert = db.prepare(`
      INSERT INTO products (id, variant_id, sku, barcode, name, mrp, price, tax_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    [
      ['a0000001-0001-0001-0001-000000000001', 'b0000001-0001-0001-0001-000000000001', 'MILK-001', '8901001000011', 'Fresh Milk 1L', 6000, 5800, 5],
      ['a0000001-0001-0001-0001-000000000002', 'b0000001-0001-0001-0001-000000000002', 'BRD-001', '8901001000028', 'Whole Wheat Bread', 4500, 4000, 0],
      ['a0000001-0001-0001-0001-000000000003', 'b0000001-0001-0001-0001-000000000003', 'EGG-012', '8901001000035', 'Organic Eggs (12pk)', 12000, 11000, 0],
      ['a0000001-0001-0001-0001-000000000004', 'b0000001-0001-0001-0001-000000000004', 'SGR-001', '8901001000042', 'Refined Sugar 1kg', 5000, 4800, 12],
      ['a0000001-0001-0001-0001-000000000005', 'b0000001-0001-0001-0001-000000000005', 'TEA-001', '8901001000059', 'Assam Tea 250g', 25000, 22000, 18],
      ['a0000001-0001-0001-0001-000000000006', 'b0000001-0001-0001-0001-000000000006', 'OIL-001', '8901001000066', 'Sunflower Oil 1L', 18000, 16500, 12],
    ].forEach((product) => insert.run(...product));
  }

  const cashierCount = db.prepare('SELECT COUNT(*) as count FROM cashiers').get().count;
  if (cashierCount === 0) {
    const insertCashier = db.prepare(`
      INSERT INTO cashiers (id, username, name, pin)
      VALUES (?, ?, ?, ?)
    `);
    [
      ['admin', 'admin', 'Admin User', '1234'],
      ['c1', 'ravi', 'Ravi Kumar', '1111'],
      ['c2', 'priya', 'Priya Sharma', '2222'],
    ].forEach((c) => insertCashier.run(...c));
  }

  // Always ensure critical settings are correct (upsert)
  const upsertSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  [
    ['api_base_url', 'http://localhost:3000'],
    ['terminal_id', '11111111-1111-1111-1111-111111111111'],
    ['store_id', '01733d49-696a-4f20-9aa3-6e0224319fb3'],
    ['shift_id', '22222222-2222-2222-2222-222222222222'],
    ['tenant_id', ''],
  ].forEach((s) => upsertSetting.run(...s));

  [
    ['8901001000011', 'a0000001-0001-0001-0001-000000000001', 'MILK-001', 'Fresh Milk 1L'],
    ['8901001000028', 'a0000001-0001-0001-0001-000000000002', 'BRD-001', 'Whole Wheat Bread'],
    ['8901001000035', 'a0000001-0001-0001-0001-000000000003', 'EGG-012', 'Organic Eggs (12pk)'],
    ['8901001000042', 'a0000001-0001-0001-0001-000000000004', 'SGR-001', 'Refined Sugar 1kg'],
    ['8901001000059', 'a0000001-0001-0001-0001-000000000005', 'TEA-001', 'Assam Tea 250g'],
    ['8901001000066', 'a0000001-0001-0001-0001-000000000006', 'OIL-001', 'Sunflower Oil 1L'],
  ].forEach(([barcode, id, sku, name]) => {
    db.prepare('UPDATE products SET barcode = ? WHERE id = ? OR sku = ? OR name = ?').run(barcode, id, sku, name);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Atulyam Pos - Desktop Terminal",
    backgroundColor: '#0f172a', // Slate 900
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  await initDb();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
// better-sqlite3 bind parameters as individual arguments, not as an array
ipcMain.handle('db:query', (event, sql, params) => {
  const stmt = db.prepare(sql);
  return params ? stmt.all(...params) : stmt.all();
});

ipcMain.handle('db:get', (event, sql, params) => {
  const stmt = db.prepare(sql);
  return params ? stmt.get(...params) : stmt.get();
});

ipcMain.handle('db:execute', (event, sql, params) => {
  const stmt = db.prepare(sql);
  return params ? stmt.run(...params) : stmt.run();
});

ipcMain.handle('sys:get-path', (event, name) => {
  return app.getPath(name as any);
});
