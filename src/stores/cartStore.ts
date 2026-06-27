import { create } from 'zustand';
import { db } from '../lib/db';
import { enqueueOutbox } from '../lib/syncEngine';
import { apiPricingPreview, loadApiConfig } from '../lib/api';

interface CartItem {
  id: string;
  variantId: string;
  sku: string;
  barcode: string;
  name: string;
  qty: number;
  mrp: bigint;
  price: bigint;
  lineDiscount: bigint;
  taxRate: number;
  lineTotal: bigint;
  appliedRules: Array<{ ruleId: string; name: string; discount: number }>;
}

export interface Product {
  id: string;
  variant_id: string;
  sku: string;
  barcode: string;
  name: string;
  mrp: number | bigint;
  price: number | bigint;
  tax_rate: number;
  quantity: number;
  reorder_level: number;
  expiry_date?: string | null;
  plu?: string | null;
  image_thumb?: string | null;
}

export interface ScaleBarcodeConfig {
  prefix: string;
  pluLength: number;
  valueLength: number;
  valueDecimals: number;
  includeCheckDigit: boolean;
  valueType: 'weight' | 'price';
}

// Default matches the current scale setup: 21 + 5-digit PLU + 5-digit value + final check digit.
export const DEFAULT_SCALE_BARCODE_CONFIG: ScaleBarcodeConfig = {
  prefix: '21',
  pluLength: 5,
  valueLength: 5,
  valueDecimals: 3,
  includeCheckDigit: true,
  valueType: 'weight',
};

/** Load the scale-barcode config synced from the backend, falling back to defaults. */
export async function getScaleBarcodeConfig(): Promise<ScaleBarcodeConfig> {
  if (!db) return DEFAULT_SCALE_BARCODE_CONFIG;
  try {
    const row = await db.get("SELECT value FROM settings WHERE key = 'weighted_barcode_config'");
    if (row?.value) {
      const parsed = JSON.parse(String(row.value));
      return { ...DEFAULT_SCALE_BARCODE_CONFIG, ...parsed };
    }
  } catch (e: any) {
    console.warn('[scale] Could not load weighted barcode config:', e.message);
  }
  return DEFAULT_SCALE_BARCODE_CONFIG;
}

export interface ScaleBarcodeParseResult {
  plu: string;
  weightKg?: number;
  pricePaise?: number;
}

/** Parse a weighing-scale barcode using the synced config. Returns null if it isn't one.
 *  The prefix may contain non-digits (e.g. "21C"); only the payload after the prefix must be numeric. */
export function parseScaleBarcode(code: string, cfg = DEFAULT_SCALE_BARCODE_CONFIG): ScaleBarcodeParseResult | null {
  const c = String(code || '').trim();
  const total = cfg.prefix.length + cfg.pluLength + cfg.valueLength + (cfg.includeCheckDigit ? 1 : 0);
  if (c.length !== total || !c.startsWith(cfg.prefix)) return null;
  const payload = c.slice(cfg.prefix.length);
  if (!/^\d+$/.test(payload)) return null;
  const pluStr = payload.slice(0, cfg.pluLength);
  const valStr = payload.slice(cfg.pluLength, cfg.pluLength + cfg.valueLength);
  const plu = String(parseInt(pluStr, 10)); // strip leading zeros
  const rawValue = parseInt(valStr, 10);
  if (Number.isNaN(rawValue) || Number.isNaN(parseInt(pluStr, 10))) return null;

  if (cfg.valueType === 'price') {
    // Embedded value is price in fractional units (e.g. 03375 with 2 decimals = ₹33.75 = 3375 paise).
    const pricePaise = Math.round(rawValue * Math.pow(10, 2 - cfg.valueDecimals));
    return { plu, pricePaise };
  }

  const weightKg = rawValue / Math.pow(10, cfg.valueDecimals);
  return { plu, weightKg };
}

export type ExpiryInfo = { status: 'ok' | 'near' | 'expired'; days: number | null };

/** Days until the nearest in-stock batch expires; status block(expired)/warn(near). */
export function getExpiryInfo(expiry?: string | null, warnDays = 30): ExpiryInfo {
  if (!expiry) return { status: 'ok', days: null };
  const date = new Date(expiry);
  if (Number.isNaN(date.getTime())) return { status: 'ok', days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { status: 'expired', days };
  if (days <= warnDays) return { status: 'near', days };
  return { status: 'ok', days };
}

export interface AddNotice {
  type: 'error' | 'warn';
  message: string;
}

export interface Customer {
  code: string;
  name?: string;
  mobile: string;
}

interface CartState {
  items: CartItem[];
  customer: Customer | null;
  subtotal: bigint;
  taxTotal: bigint;
  orderDiscount: bigint;
  total: bigint;
  addNotice: AddNotice | null;
  clearAddNotice: () => void;
  addItem: (searchTerm: string) => Promise<boolean>;
  addProduct: (product: Product) => boolean;
  addWeighedByPlu: (plu: string, weightKg: number, valueType?: 'weight' | 'price') => Promise<boolean>;
  searchProducts: (searchTerm: string, limit?: number) => Promise<Product[]>;
  removeItem: (variantId: string) => void;
  updateQty: (variantId: string, qty: number) => void;
  clearCart: () => void;
  replaceCart: (items: CartItem[], customer: Customer | null) => void;
  setCustomer: (customer: Customer) => void;
  refreshPricing: () => Promise<void>;
  saveBill: (invoiceNo: number, cashierId: string, cashierName: string, amountReceived: string, paymentMode?: 'billing' | 'credit', paymentTender?: 'cash' | 'online', roundOff?: bigint) => Promise<void>;
  loadBill: (invoiceNo: number) => Promise<{ items: CartItem[]; customer: Customer | null; amountReceived: string; paymentTender: 'cash' | 'online'; createdAt: string | null } | null>;
  getMaxInvoiceNo: () => Promise<number>;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customer: null,
  subtotal: 0n,
  taxTotal: 0n,
  orderDiscount: 0n,
  total: 0n,
  addNotice: null,

  clearAddNotice: () => set({ addNotice: null }),

  addItem: async (searchTerm: string) => {
    if (!db) {
      console.warn('DB not available in UI preview mode');
      return false;
    }

    const term = searchTerm.trim();
    const product = (await get().searchProducts(term, 1))[0];
    if (!product) {
      console.warn(`Product not found for "${term}"`);
      return false;
    }

    return get().addProduct(product);
  },

  addProduct: (product: Product) => {
    // Expiry guard: block expired stock at billing, warn when near expiry.
    const expiry = getExpiryInfo(product.expiry_date);
    if (expiry.status === 'expired') {
      set({
        addNotice: {
          type: 'error',
          message: `${product.name} is EXPIRED (${Math.abs(expiry.days ?? 0)} day(s) ago) — cannot be billed. Remove from shelf.`,
        },
      });
      return false;
    }

    const items = [...get().items];
    const existingIndex = items.findIndex(i => i.variantId === product.variant_id);

    if (existingIndex > -1) {
      const item = items[existingIndex]!;
      item.qty += 1;
      item.lineTotal = BigInt(item.qty) * BigInt(item.price);
      item.lineDiscount = BigInt(item.qty) * (BigInt(item.mrp) > BigInt(item.price) ? BigInt(item.mrp) - BigInt(item.price) : 0n);
    } else {
      items.push({
        id: product.id,
        variantId: product.variant_id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        qty: 1,
        mrp: BigInt(product.mrp),
        price: BigInt(product.price),
        lineDiscount: BigInt(product.mrp) > BigInt(product.price) ? BigInt(product.mrp) - BigInt(product.price) : 0n,
        taxRate: product.tax_rate,
        lineTotal: BigInt(product.price),
        appliedRules: [],
      });
    }

    const { subtotal, taxTotal, total } = calculateTotals(items);
    set({
      items,
      subtotal,
      taxTotal,
      orderDiscount: 0n,
      total,
      addNotice: expiry.status === 'near'
        ? { type: 'warn', message: `${product.name} expires in ${expiry.days} day(s) — sell first / check stock.` }
        : null,
    });
    get().refreshPricing();
    return true;
  },

  addWeighedByPlu: async (plu: string, value: number, valueType: 'weight' | 'price' = 'weight') => {
    if (!db) return false;
    const rows = await db.query('SELECT * FROM products WHERE plu = ? LIMIT 1', [plu]);
    const product = rows[0] as Product | undefined;
    if (!product) {
      set({ addNotice: { type: 'error', message: `Scale item PLU ${plu} not found — add it in the admin panel, then sync.` } });
      return true; // handled — don't fall through to a normal (failing) barcode search
    }
    if (!(value > 0)) {
      set({ addNotice: { type: 'error', message: `Could not read a valid ${valueType} for ${product.name}.` } });
      return true;
    }
    const expiry = getExpiryInfo(product.expiry_date);
    if (expiry.status === 'expired') {
      set({ addNotice: { type: 'error', message: `${product.name} is EXPIRED (${Math.abs(expiry.days ?? 0)} day(s) ago) — cannot be billed.` } });
      return true;
    }

    const items = [...get().items];
    const existingIndex = items.findIndex((i) => i.variantId === product.variant_id);

    if (valueType === 'price') {
      // Price-embedded scale label: the value is the total price in paise.
      const embeddedPrice = BigInt(Math.round(value));
      if (existingIndex > -1) {
        const item = items[existingIndex]!;
        item.qty += 1;
        item.price = embeddedPrice;
        item.mrp = embeddedPrice;
        item.lineTotal = embeddedPrice * BigInt(Math.round(item.qty));
        item.lineDiscount = 0n;
      } else {
        items.push({
          id: product.id,
          variantId: product.variant_id,
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          qty: 1,
          mrp: embeddedPrice,
          price: embeddedPrice,
          lineDiscount: 0n,
          taxRate: product.tax_rate,
          lineTotal: embeddedPrice,
          appliedRules: [],
        });
      }
    } else {
      // Weight-embedded scale label: value is weight in kg.
      const weightKg = value;
      const price = BigInt(product.price);
      const mrp = BigInt(product.mrp);
      const unitDiscount = mrp > price ? mrp - price : 0n;

      if (existingIndex > -1) {
        // Same weighed item scanned again — accumulate the weight onto the line.
        const item = items[existingIndex]!;
        const newQty = item.qty + weightKg;
        const qf = BigInt(Math.round(newQty * 1000));
        item.qty = newQty;
        item.lineTotal = (qf * BigInt(item.price)) / 1000n;
        item.lineDiscount = (qf * (BigInt(item.mrp) > BigInt(item.price) ? BigInt(item.mrp) - BigInt(item.price) : 0n)) / 1000n;
      } else {
        const qf = BigInt(Math.round(weightKg * 1000));
        items.push({
          id: product.id,
          variantId: product.variant_id,
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          qty: weightKg,
          mrp,
          price,
          lineDiscount: (qf * unitDiscount) / 1000n,
          taxRate: product.tax_rate,
          lineTotal: (qf * price) / 1000n,
          appliedRules: [],
        });
      }
    }

    const { subtotal, taxTotal, total } = calculateTotals(items);
    set({
      items,
      subtotal,
      taxTotal,
      orderDiscount: 0n,
      total,
      addNotice: expiry.status === 'near'
        ? { type: 'warn', message: `${product.name} expires in ${expiry.days} day(s) — sell first.` }
        : null,
    });
    get().refreshPricing();
    return true;
  },

  searchProducts: async (searchTerm: string, limit = 25) => {
    if (!db) return [];

    const term = searchTerm.trim();
    const allProducts = await db.query('SELECT * FROM products ORDER BY name ASC', []);

    // Deduplicate by SKU to prevent glitches from duplicate DB rows
    const seen = new Set<string>();
    const uniqueProducts = allProducts.filter((p: Product) => {
      if (!p.sku || seen.has(p.sku)) return false;
      seen.add(p.sku);
      return true;
    });

    if (!term) {
      return uniqueProducts.slice(0, limit);
    }

    const exactBarcodeMatches = uniqueProducts.filter((product: Product) => String(product.barcode) === term);
    if (exactBarcodeMatches.length > 0) {
      return exactBarcodeMatches.slice(0, limit);
    }

    // Fallback: if 13-digit EAN, match by first 12 digits.
    // Handles products stored with a wrong check digit — the scanner sends the GS1-correct
    // check digit but the SQLite row has the original wrong one.
    if (/^\d{13}$/.test(term)) {
      const prefix = term.slice(0, 12);
      const prefixMatches = uniqueProducts.filter((product: Product) => String(product.barcode).startsWith(prefix));
      if (prefixMatches.length > 0) {
        return prefixMatches.slice(0, limit);
      }
    }

    const tokens = normalizeSearch(term).split(' ').filter(Boolean);

    return uniqueProducts
      .map((product: Product) => {
        const barcode = normalizeSearch(product.barcode);
        const sku = normalizeSearch(product.sku);
        const name = normalizeSearch(product.name);
        const searchable = `${barcode} ${sku} ${name}`;

        if (!tokens.every((token) => searchable.includes(token))) {
          return null;
        }

        let score = 100;
        const normalizedTerm = normalizeSearch(term);
        if (barcode === normalizedTerm) score = 0;
        else if (sku === normalizedTerm) score = 1;
        else if (barcode.startsWith(normalizedTerm)) score = 2;
        else if (sku.startsWith(normalizedTerm)) score = 3;
        else if (name.startsWith(normalizedTerm)) score = 4;
        else if (name.includes(normalizedTerm)) score = 5;

        return { product, score };
      })
      .filter((entry): entry is { product: Product; score: number } => Boolean(entry))
      .sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name))
      .slice(0, limit)
      .map((entry) => entry.product);
  },

  removeItem: (variantId: string) => {
    const items = get().items.filter(i => i.variantId !== variantId);
    const { subtotal, taxTotal, total } = calculateTotals(items);
    set({ items, subtotal, taxTotal, orderDiscount: 0n, total });
    get().refreshPricing();
  },

  updateQty: (variantId: string, qty: number) => {
    if (qty <= 0) {
      get().removeItem(variantId);
      return;
    }

    const items = get().items.map(i => {
      if (i.variantId === variantId) {
        const qtyFactor = BigInt(Math.round(qty * 1000));
        const unitDiscount = BigInt(i.mrp) > BigInt(i.price) ? BigInt(i.mrp) - BigInt(i.price) : 0n;
        return {
          ...i,
          qty,
          lineTotal: qtyFactor * BigInt(i.price) / 1000n,
          lineDiscount: qtyFactor * unitDiscount / 1000n,
        };
      }
      return i;
    });
    const { subtotal, taxTotal, total } = calculateTotals(items);
    set({ items, subtotal, taxTotal, orderDiscount: 0n, total });
    get().refreshPricing();
  },

  clearCart: () => set({ items: [], subtotal: 0n, taxTotal: 0n, orderDiscount: 0n, total: 0n, customer: null }),

  replaceCart: (items, customer) => {
    const { subtotal, taxTotal, total } = calculateTotals(items);
    set({ items, customer, subtotal, taxTotal, orderDiscount: 0n, total });
  },
  
  setCustomer: (customer) => set({ customer }),

  refreshPricing: async () => {
    const items = get().items;
    if (!items.length) return;
    try {
      await loadApiConfig();
      const previewItems = items.map((item) => ({
        variantId: item.variantId,
        qty: item.qty,
        unitMrp: Number(item.mrp),
        sellingPrice: Number(item.price),
      }));
      const settingsRows = db ? await db.query("SELECT key, value FROM settings WHERE key IN ('store_id')") : [];
      const settings: Record<string, string> = {};
      for (const row of settingsRows) settings[row.key] = row.value ?? '';
      const preview = await apiPricingPreview(previewItems, { storeId: settings.store_id || undefined });
      const gstEnabled = await isGstEnabled();
      const updatedItems = items.map((item) => {
        const p = preview.items.find((pi) => pi.variantId === item.variantId);
        if (!p) return item;
        return {
          ...item,
          lineDiscount: BigInt(p.lineDiscount),
          lineTotal: BigInt(p.lineTotal),
          appliedRules: p.appliedRules,
        };
      });
      const { taxTotal } = calculateTotals(updatedItems, gstEnabled);
      set({
        items: updatedItems,
        subtotal: BigInt(preview.subtotal),
        taxTotal,
        orderDiscount: BigInt(preview.orderDiscount || 0),
        total: BigInt(preview.total),
      });
    } catch (e) {
      console.warn('[pricing] Preview failed, using local calc:', e);
    }
  },

  saveBill: async (invoiceNo: number, cashierId: string, cashierName: string, amountReceived: string, paymentMode = 'billing', paymentTender = 'cash', roundOff = 0n) => {
    if (!db) return;
    const state = get();
    if (paymentMode === 'credit' && !state.customer?.mobile?.trim()) {
      throw new Error('Credit / khata bill requires a customer mobile number.');
    }
    if (paymentMode === 'credit' && state.items.length === 0) {
      throw new Error('Credit / khata bill requires at least one item.');
    }
    const gstEnabled = await isGstEnabled();
    const taxTotal = gstEnabled ? state.taxTotal : 0n;
    const effectiveTotal = state.total + roundOff;
    const itemsJson = JSON.stringify(state.items.map(item => ({
      ...item,
      mrp: Number(item.mrp),
      price: Number(item.price),
      lineDiscount: Number(item.lineDiscount),
      lineTotal: Number(item.lineTotal),
    })));
    const customerJson = state.customer ? JSON.stringify(state.customer) : null;
    
    // START TRANSACTION for atomic update
    await db.execute('BEGIN TRANSACTION', []);
    try {
      await db.execute(
        `INSERT OR REPLACE INTO sales (id, invoice_no, items_json, customer_json, subtotal, tax_total, total, amount_received, payment_mode, credit_due, cashier_id, cashier_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `sale-${invoiceNo}`,
          invoiceNo,
          itemsJson,
          customerJson,
          Number(state.subtotal),
          Number(taxTotal),
          Number(effectiveTotal),
          paymentMode === 'credit'
            ? 0
            : paymentTender === 'online'
              ? Number(effectiveTotal)
              : Math.round(Number(amountReceived || 0) * 100),
          paymentMode === 'credit' ? 'credit' : paymentTender,
          paymentMode === 'credit' ? Number(effectiveTotal) : 0,
          cashierId,
          cashierName,
        ]
      );

      // Local stock deduction
      for (const item of state.items) {
        await db.execute(
          'UPDATE products SET quantity = quantity - ? WHERE variant_id = ?',
          [item.qty, item.variantId]
        );
      }

      await db.execute('COMMIT', []);
    } catch (e) {
      await db.execute('ROLLBACK', []);
      throw e;
    }

    // Build sync payload for backend
    const settingsRows = await db.query("SELECT key, value FROM settings WHERE key IN ('store_id','terminal_id','shift_id')");
    const settings: Record<string, string> = {};
    for (const r of settingsRows) settings[r.key] = r.value ?? '';

    // Stable outbox op_id — one entry per invoice, re-saves replace it rather than add.
    const stableOpId = `sale-${invoiceNo}`;

    // Check if this invoice was already successfully synced to the server.
    // If so, skip re-enqueuing entirely to prevent server-side duplicates.
    const existingOutbox = await db.get(
      "SELECT status, payload FROM outbox WHERE op_id = ?",
      [stableOpId]
    );
    if (existingOutbox?.status === 'synced') return;

    // Stable clientOpId derived from terminal + invoice number so the backend's
    // idempotency check (WHERE clientOpId = ?) fires correctly on re-saves.
    // Format: reuse terminal UUID structure, replace last segment with invoice hex.
    const termId = (settings.terminal_id || '00000000-0000-0000-0000-000000000000');
    const hex = termId.replace(/[^a-f0-9]/gi, '').padStart(20, '0').slice(0, 20);
    const invHex = invoiceNo.toString(16).padStart(12, '0');
    const stableClientOpId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${invHex}`;

    // Remove any old duplicate pending/failed outbox entries for this invoice that
    // were created before this fix (random op_ids, random clientOpIds).
    await db.execute(
      `DELETE FROM outbox WHERE entity = 'order' AND action = 'create' AND status != 'synced' AND op_id != ? AND payload LIKE ?`,
      [stableOpId, `%INV-${invoiceNo}"%`]
    );

    const payload: Record<string, unknown> = {
      storeId: settings.store_id || '00000000-0000-0000-0000-000000000000',
      terminalId: settings.terminal_id || 'term-pos-01',
      shiftId: settings.shift_id || '00000000-0000-0000-0000-000000000000',
      customerId: undefined,
      customer: state.customer ? {
        name: state.customer.name || state.customer.mobile,
        phone: state.customer.mobile,
      } : undefined,
      items: state.items.map(item => ({
        variantId: item.variantId,
        qty: item.qty,
        unitMrp: Number(item.mrp),
        unitPrice: Number(item.price),
      })),
      payments: paymentMode === 'credit'
        ? [{
            method: 'khata',
            amount: 0,
            reference: `Credit bill INV-${invoiceNo}`,
          }]
        : [{
            method: paymentTender === 'online' ? 'upi' : 'cash',
            amount: Number(effectiveTotal),
            reference: `${paymentTender === 'online' ? 'Online' : 'Cash'} INV-${invoiceNo}`,
          }],
      paymentMode,
      clientOpId: stableClientOpId,
      notes: `${paymentMode === 'credit' ? 'Credit bill' : paymentTender === 'online' ? 'Online paid bill' : 'Cash bill'} by ${cashierName}`,
      cashierId,
    };

    // Upsert with stable op_id — re-saves update the existing row, not add a new one.
    await db.execute(
      `INSERT OR REPLACE INTO outbox (op_id, entity, action, payload, status, retry_count, error)
       VALUES (?, 'order', 'create', ?, 'pending', 0, NULL)`,
      [stableOpId, JSON.stringify(payload)]
    );
  },

  loadBill: async (invoiceNo: number) => {
    if (!db) return null;
    const row = await db.get('SELECT * FROM sales WHERE invoice_no = ?', [invoiceNo]);
    if (!row) return null;
    const rawItems = JSON.parse(row.items_json) as Array<Record<string, unknown>>;
    const items: CartItem[] = rawItems.map((raw) => ({
      id: String(raw.id),
      variantId: String(raw.variantId),
      sku: String(raw.sku),
      barcode: String(raw.barcode),
      name: String(raw.name),
      qty: Number(raw.qty),
      mrp: BigInt(raw.mrp as number),
      price: BigInt(raw.price as number),
      lineDiscount: BigInt((raw.lineDiscount as number) ?? 0),
      taxRate: Number(raw.taxRate),
      lineTotal: BigInt(raw.lineTotal as number),
      appliedRules: (raw.appliedRules as Array<{ ruleId: string; name: string; discount: number }>) ?? [],
    }));
    const customer: Customer | null = row.customer_json ? JSON.parse(row.customer_json) : null;
    const amountReceived = row.amount_received ? (Number(row.amount_received) / 100).toFixed(2) : '';
    return { items, customer, amountReceived, paymentTender: row.payment_mode === 'online' ? 'online' : 'cash', createdAt: row.created_at ?? null };
  },

  getMaxInvoiceNo: async () => {
    if (!db) return 100;
    const row = await db.get('SELECT MAX(invoice_no) as max_no FROM sales');
    return (row?.max_no ?? 100) as number;
  },
}));

async function isGstEnabled() {
  if (!db) return true;
  const row = await db.get("SELECT value FROM settings WHERE key = 'gst_enabled'");
  return row?.value !== 'false';
}

function calculateTotals(items: CartItem[], gstEnabled = true) {
  let subtotal = 0n;
  let taxTotal = 0n;

  items.forEach(item => {
    const lineSubtotal = item.lineTotal;
    // Assuming price is tax-inclusive for now, back-calculate tax if needed
    // Or if price is exclusive, add tax. Indian retail is usually inclusive.
    subtotal += BigInt(Math.round(item.qty * 1000)) * BigInt(item.mrp) / 1000n;
    if (gstEnabled) {
      // Simplified tax calc: tax = total - (total / (1 + rate/100))
      const taxAmount = lineSubtotal - (lineSubtotal * 10000n / BigInt(Math.round(100 + item.taxRate) * 100));
      taxTotal += taxAmount;
    }
  });

  const total = items.reduce((acc, item) => acc + item.lineTotal, 0n);
  return { subtotal, taxTotal, total };
}

function normalizeSearch(value: string | number | bigint | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
