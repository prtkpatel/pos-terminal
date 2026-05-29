import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('enable-features', 'BarcodeDetector');

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
      '8901001000073': { id: 'a0000001-0001-0001-0001-000000000007', variant_id: 'b0000001-0001-0001-0001-000000000007', sku: 'RICE-001', barcode: '8901001000073', name: 'Basmati Rice 1kg', mrp: 15000, price: 14500, tax_rate: 5 },
      '8901001000080': { id: 'a0000001-0001-0001-0001-000000000008', variant_id: 'b0000001-0001-0001-0001-000000000008', sku: 'TRM-001', barcode: '8901001000080', name: 'Turmeric Powder 100g', mrp: 3500, price: 3200, tax_rate: 5 },
      '8901001000097': { id: 'a0000001-0001-0001-0001-000000000009', variant_id: 'b0000001-0001-0001-0001-000000000009', sku: 'CHL-001', barcode: '8901001000097', name: 'Red Chilli Powder 100g', mrp: 4000, price: 3800, tax_rate: 5 },
      '8901001000103': { id: 'a0000001-0001-0001-0001-000000000010', variant_id: 'b0000001-0001-0001-0001-000000000010', sku: 'SLT-001', barcode: '8901001000103', name: 'Iodized Salt 1kg', mrp: 2800, price: 2500, tax_rate: 5 },
      '8901001000110': { id: 'a0000001-0001-0001-0001-000000000011', variant_id: 'b0000001-0001-0001-0001-000000000011', sku: 'KET-001', barcode: '8901001000110', name: 'Tomato Ketchup 500g', mrp: 8500, price: 8200, tax_rate: 12 },
      '8901001000127': { id: 'a0000001-0001-0001-0001-000000000012', variant_id: 'b0000001-0001-0001-0001-000000000012', sku: 'BSC-001', barcode: '8901001000127', name: 'Marie Biscuits 150g', mrp: 3000, price: 2800, tax_rate: 5 },
      '8901001000134': { id: 'a0000001-0001-0001-0001-000000000013', variant_id: 'b0000001-0001-0001-0001-000000000013', sku: 'DET-001', barcode: '8901001000134', name: 'Detergent Powder 1kg', mrp: 12000, price: 11500, tax_rate: 18 },
      '8901001000141': { id: 'a0000001-0001-0001-0001-000000000014', variant_id: 'b0000001-0001-0001-0001-000000000014', sku: 'PAS-001', barcode: '8901001000141', name: 'Toothpaste 150g', mrp: 9500, price: 9000, tax_rate: 18 },
      '8901001000158': { id: 'a0000001-0001-0001-0001-000000000015', variant_id: 'b0000001-0001-0001-0001-000000000015', sku: 'SHP-001', barcode: '8901001000158', name: 'Herbal Shampoo 200ml', mrp: 18000, price: 17500, tax_rate: 18 },
      '8901001000165': { id: 'a0000001-0001-0001-0001-000000000016', variant_id: 'b0000001-0001-0001-0001-000000000016', sku: 'SOP-001', barcode: '8901001000165', name: 'Bathing Soap 100g', mrp: 4500, price: 4200, tax_rate: 18 },
      '8901001000172': { id: 'a0000001-0001-0001-0001-000000000017', variant_id: 'b0000001-0001-0001-0001-000000000017', sku: 'DSH-001', barcode: '8901001000172', name: 'Dishwash Liquid 500ml', mrp: 7500, price: 7200, tax_rate: 18 },
      '8901001000189': { id: 'a0000001-0001-0001-0001-000000000018', variant_id: 'b0000001-0001-0001-0001-000000000018', sku: 'MAI-001', barcode: '8901001000189', name: 'Maida 1kg', mrp: 5500, price: 5200, tax_rate: 5 },
      '8901001000196': { id: 'a0000001-0001-0001-0001-000000000019', variant_id: 'b0000001-0001-0001-0001-000000000019', sku: 'BSN-001', barcode: '8901001000196', name: 'Besan 500g', mrp: 6500, price: 6200, tax_rate: 5 },
      '8901001000202': { id: 'a0000001-0001-0001-0001-000000000020', variant_id: 'b0000001-0001-0001-0001-000000000020', sku: 'MOG-001', barcode: '8901001000202', name: 'Moong Dal 1kg', mrp: 14000, price: 13500, tax_rate: 5 },
      '8901001000219': { id: 'a0000001-0001-0001-0001-000000000021', variant_id: 'b0000001-0001-0001-0001-000000000021', sku: 'TOR-001', barcode: '8901001000219', name: 'Toor Dal 1kg', mrp: 16000, price: 15500, tax_rate: 5 },
      '8901001000226': { id: 'a0000001-0001-0001-0001-000000000022', variant_id: 'b0000001-0001-0001-0001-000000000022', sku: 'CHN-001', barcode: '8901001000226', name: 'Chana Dal 1kg', mrp: 13000, price: 12500, tax_rate: 5 },
      '8901001000233': { id: 'a0000001-0001-0001-0001-000000000023', variant_id: 'b0000001-0001-0001-0001-000000000023', sku: 'GHE-001', barcode: '8901001000233', name: 'Pure Ghee 500ml', mrp: 35000, price: 34000, tax_rate: 12 },
      '8901001000240': { id: 'a0000001-0001-0001-0001-000000000024', variant_id: 'b0000001-0001-0001-0001-000000000024', sku: 'PNR-001', barcode: '8901001000240', name: 'Fresh Paneer 200g', mrp: 9000, price: 8800, tax_rate: 12 },
      '8901001000257': { id: 'a0000001-0001-0001-0001-000000000025', variant_id: 'b0000001-0001-0001-0001-000000000025', sku: 'BTR-001', barcode: '8901001000257', name: 'Butter 500g', mrp: 22000, price: 21500, tax_rate: 12 },
      '8901001000264': { id: 'a0000001-0001-0001-0001-000000000026', variant_id: 'b0000001-0001-0001-0001-000000000026', sku: 'CHS-001', barcode: '8901001000264', name: 'Cheese Slices 200g', mrp: 18000, price: 17500, tax_rate: 12 },
      '8901001000271': { id: 'a0000001-0001-0001-0001-000000000027', variant_id: 'b0000001-0001-0001-0001-000000000027', sku: 'CLD-001', barcode: '8901001000271', name: 'Cold Drink 2L', mrp: 9500, price: 9000, tax_rate: 28 },
      '8901001000288': { id: 'a0000001-0001-0001-0001-000000000028', variant_id: 'b0000001-0001-0001-0001-000000000028', sku: 'CHP-001', barcode: '8901001000288', name: 'Potato Chips 100g', mrp: 5000, price: 4800, tax_rate: 12 },
      '8901001000295': { id: 'a0000001-0001-0001-0001-000000000029', variant_id: 'b0000001-0001-0001-0001-000000000029', sku: 'CHO-001', barcode: '8901001000295', name: 'Chocolate Bar 50g', mrp: 4500, price: 4300, tax_rate: 18 },
      '8901001000301': { id: 'a0000001-0001-0001-0001-000000000030', variant_id: 'b0000001-0001-0001-0001-000000000030', sku: 'NOD-001', barcode: '8901001000301', name: 'Instant Noodles 70g', mrp: 2500, price: 2400, tax_rate: 18 },
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
      discount BIGINT DEFAULT 0,
      tax_rate DECIMAL(5,2),
      is_weighable BOOLEAN DEFAULT 0,
      quantity BIGINT DEFAULT 0,
      reorder_level BIGINT DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE,
      email TEXT,
      gstin TEXT,
      updated_at DATETIME
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
      payment_mode TEXT DEFAULT 'billing',
      credit_due INTEGER DEFAULT 0,
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

  try { db.exec(`ALTER TABLE sales ADD COLUMN payment_mode TEXT DEFAULT 'billing'`); } catch {}
  try { db.exec(`ALTER TABLE sales ADD COLUMN credit_due INTEGER DEFAULT 0`); } catch {}

  // FIX: Wipe and recreate products table to eliminate all duplicate/broken rows
  // caused by previous sync bugs (price=0, tax_rate=0). Sync will repopulate.
  db.exec(`DROP TABLE IF EXISTS products`);
  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      variant_id TEXT,
      sku TEXT UNIQUE,
      barcode TEXT,
      name TEXT,
      hsn TEXT,
      mrp BIGINT,
      price BIGINT,
      discount BIGINT DEFAULT 0,
      tax_rate DECIMAL(5,2),
      is_weighable BOOLEAN DEFAULT 0,
      quantity BIGINT DEFAULT 0,
      reorder_level BIGINT DEFAULT 0,
      updated_at DATETIME
    )
  `);

  const insert = db.prepare(`
    INSERT INTO products (id, variant_id, sku, barcode, name, hsn, mrp, price, discount, tax_rate, quantity, reorder_level, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  [
    ['a0000001-0001-0001-0001-000000000001', 'b0000001-0001-0001-0001-000000000001', 'MILK-001', '8901001000011', 'Fresh Milk 1L', '0401', 6000, 5800, 200, 5, 50, 10],
    ['a0000001-0001-0001-0001-000000000002', 'b0000001-0001-0001-0001-000000000002', 'BRD-001', '8901001000028', 'Whole Wheat Bread', '1905', 4500, 4000, 500, 0, 40, 5],
    ['a0000001-0001-0001-0001-000000000003', 'b0000001-0001-0001-0001-000000000003', 'EGG-012', '8901001000035', 'Organic Eggs (12pk)', '0407', 12000, 11000, 1000, 0, 30, 5],
    ['a0000001-0001-0001-0001-000000000004', 'b0000001-0001-0001-0001-000000000004', 'SGR-001', '8901001000042', 'Refined Sugar 1kg', '1701', 5000, 4800, 200, 12, 100, 20],
    ['a0000001-0001-0001-0001-000000000005', 'b0000001-0001-0001-0001-000000000005', 'TEA-001', '8901001000059', 'Assam Tea 250g', '0902', 25000, 22000, 3000, 18, 60, 10],
    ['a0000001-0001-0001-0001-000000000006', 'b0000001-0001-0001-0001-000000000006', 'OIL-001', '8901001000066', 'Sunflower Oil 1L', '1512', 18000, 16500, 1500, 12, 80, 15],
    ['a0000001-0001-0001-0001-000000000007', 'b0000001-0001-0001-0001-000000000007', 'RICE-001', '8901001000073', 'Basmati Rice 1kg', '1006', 15000, 14500, 500, 5, 200, 50],
    ['a0000001-0001-0001-0001-000000000008', 'b0000001-0001-0001-0001-000000000008', 'TRM-001', '8901001000080', 'Turmeric Powder 100g', '0910', 3500, 3200, 300, 5, 45, 10],
    ['a0000001-0001-0001-0001-000000000009', 'b0000001-0001-0001-0001-000000000009', 'CHL-001', '8901001000097', 'Red Chilli Powder 100g', '0904', 4000, 3800, 200, 5, 40, 10],
    ['a0000001-0001-0001-0001-000000000010', 'b0000001-0001-0001-0001-000000000010', 'SLT-001', '8901001000103', 'Iodized Salt 1kg', '2501', 2800, 2500, 300, 5, 150, 30],
    ['a0000001-0001-0001-0001-000000000011', 'b0000001-0001-0001-0001-000000000011', 'KET-001', '8901001000110', 'Tomato Ketchup 500g', '2103', 8500, 8200, 300, 12, 35, 8],
    ['a0000001-0001-0001-0001-000000000012', 'b0000001-0001-0001-0001-000000000012', 'BSC-001', '8901001000127', 'Marie Biscuits 150g', '1905', 3000, 2800, 200, 5, 120, 25],
    ['a0000001-0001-0001-0001-000000000013', 'b0000001-0001-0001-0001-000000000013', 'DET-001', '8901001000134', 'Detergent Powder 1kg', '3402', 12000, 11500, 500, 18, 55, 12],
    ['a0000001-0001-0001-0001-000000000014', 'b0000001-0001-0001-0001-000000000014', 'PAS-001', '8901001000141', 'Toothpaste 150g', '3306', 9500, 9000, 500, 18, 70, 15],
    ['a0000001-0001-0001-0001-000000000015', 'b0000001-0001-0001-0001-000000000015', 'SHP-001', '8901001000158', 'Herbal Shampoo 200ml', '3305', 18000, 17500, 500, 18, 45, 10],
    ['a0000001-0001-0001-0001-000000000016', 'b0000001-0001-0001-0001-000000000016', 'SOP-001', '8901001000165', 'Bathing Soap 100g', '3401', 4500, 4200, 300, 18, 100, 20],
    ['a0000001-0001-0001-0001-000000000017', 'b0000001-0001-0001-0001-000000000017', 'DSH-001', '8901001000172', 'Dishwash Liquid 500ml', '3402', 7500, 7200, 300, 18, 40, 10],
    ['a0000001-0001-0001-0001-000000000018', 'b0000001-0001-0001-0001-000000000018', 'MAI-001', '8901001000189', 'Maida 1kg', '1101', 5500, 5200, 300, 5, 65, 15],
    ['a0000001-0001-0001-0001-000000000019', 'b0000001-0001-0001-0001-000000000019', 'BSN-001', '8901001000196', 'Besan 500g', '1106', 6500, 6200, 300, 5, 55, 12],
    ['a0000001-0001-0001-0001-000000000020', 'b0000001-0001-0001-0001-000000000020', 'MOG-001', '8901001000202', 'Moong Dal 1kg', '0713', 14000, 13500, 500, 5, 85, 20],
    ['a0000001-0001-0001-0001-000000000021', 'b0000001-0001-0001-0001-000000000021', 'TOR-001', '8901001000219', 'Toor Dal 1kg', '0713', 16000, 15500, 500, 5, 75, 18],
    ['a0000001-0001-0001-0001-000000000022', 'b0000001-0001-0001-0001-000000000022', 'CHN-001', '8901001000226', 'Chana Dal 1kg', '0713', 13000, 12500, 500, 5, 90, 20],
    ['a0000001-0001-0001-0001-000000000023', 'b0000001-0001-0001-0001-000000000023', 'GHE-001', '8901001000233', 'Pure Ghee 500ml', '0405', 35000, 34000, 1000, 12, 30, 8],
    ['a0000001-0001-0001-0001-000000000024', 'b0000001-0001-0001-0001-000000000024', 'PNR-001', '8901001000240', 'Fresh Paneer 200g', '0406', 9000, 8800, 200, 12, 25, 5],
    ['a0000001-0001-0001-0001-000000000025', 'b0000001-0001-0001-0001-000000000025', 'BTR-001', '8901001000257', 'Butter 500g', '0405', 22000, 21500, 500, 12, 40, 10],
    ['a0000001-0001-0001-0001-000000000026', 'b0000001-0001-0001-0001-000000000026', 'CHS-001', '8901001000264', 'Cheese Slices 200g', '0406', 18000, 17500, 500, 12, 35, 8],
    ['a0000001-0001-0001-0001-000000000027', 'b0000001-0001-0001-0001-000000000027', 'CLD-001', '8901001000271', 'Cold Drink 2L', '2202', 9500, 9000, 500, 28, 120, 30],
    ['a0000001-0001-0001-0001-000000000028', 'b0000001-0001-0001-0001-000000000028', 'CHP-001', '8901001000288', 'Potato Chips 100g', '2005', 5000, 4800, 200, 12, 150, 40],
    ['a0000001-0001-0001-0001-000000000029', 'b0000001-0001-0001-0001-000000000029', 'CHO-001', '8901001000295', 'Chocolate Bar 50g', '1806', 4500, 4300, 200, 18, 100, 25],
    ['a0000001-0001-0001-0001-000000000030', 'b0000001-0001-0001-0001-000000000030', 'NOD-001', '8901001000301', 'Instant Noodles 70g', '1902', 2500, 2400, 100, 18, 200, 50],
  ].forEach((product) => insert.run(...product));

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
    ['8901001000073', 'a0000001-0001-0001-0001-000000000007', 'RICE-001', 'Basmati Rice 1kg'],
    ['8901001000080', 'a0000001-0001-0001-0001-000000000008', 'TRM-001', 'Turmeric Powder 100g'],
    ['8901001000097', 'a0000001-0001-0001-0001-000000000009', 'CHL-001', 'Red Chilli Powder 100g'],
    ['8901001000103', 'a0000001-0001-0001-0001-000000000010', 'SLT-001', 'Iodized Salt 1kg'],
    ['8901001000110', 'a0000001-0001-0001-0001-000000000011', 'KET-001', 'Tomato Ketchup 500g'],
    ['8901001000127', 'a0000001-0001-0001-0001-000000000012', 'BSC-001', 'Marie Biscuits 150g'],
    ['8901001000134', 'a0000001-0001-0001-0001-000000000013', 'DET-001', 'Detergent Powder 1kg'],
    ['8901001000141', 'a0000001-0001-0001-0001-000000000014', 'PAS-001', 'Toothpaste 150g'],
    ['8901001000158', 'a0000001-0001-0001-0001-000000000015', 'SHP-001', 'Herbal Shampoo 200ml'],
    ['8901001000165', 'a0000001-0001-0001-0001-000000000016', 'SOP-001', 'Bathing Soap 100g'],
    ['8901001000172', 'a0000001-0001-0001-0001-000000000017', 'DSH-001', 'Dishwash Liquid 500ml'],
    ['8901001000189', 'a0000001-0001-0001-0001-000000000018', 'MAI-001', 'Maida 1kg'],
    ['8901001000196', 'a0000001-0001-0001-0001-000000000019', 'BSN-001', 'Besan 500g'],
    ['8901001000202', 'a0000001-0001-0001-0001-000000000020', 'MOG-001', 'Moong Dal 1kg'],
    ['8901001000219', 'a0000001-0001-0001-0001-000000000021', 'TOR-001', 'Toor Dal 1kg'],
    ['8901001000226', 'a0000001-0001-0001-0001-000000000022', 'CHN-001', 'Chana Dal 1kg'],
    ['8901001000233', 'a0000001-0001-0001-0001-000000000023', 'GHE-001', 'Pure Ghee 500ml'],
    ['8901001000240', 'a0000001-0001-0001-0001-000000000024', 'PNR-001', 'Fresh Paneer 200g'],
    ['8901001000257', 'a0000001-0001-0001-0001-000000000025', 'BTR-001', 'Butter 500g'],
    ['8901001000264', 'a0000001-0001-0001-0001-000000000026', 'CHS-001', 'Cheese Slices 200g'],
    ['8901001000271', 'a0000001-0001-0001-0001-000000000027', 'CLD-001', 'Cold Drink 2L'],
    ['8901001000288', 'a0000001-0001-0001-0001-000000000028', 'CHP-001', 'Potato Chips 100g'],
    ['8901001000295', 'a0000001-0001-0001-0001-000000000029', 'CHO-001', 'Chocolate Bar 50g'],
    ['8901001000301', 'a0000001-0001-0001-0001-000000000030', 'NOD-001', 'Instant Noodles 70g'],
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

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => permission === 'media');

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
