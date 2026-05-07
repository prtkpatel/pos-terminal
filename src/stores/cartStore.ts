import { create } from 'zustand';
import { db } from '../lib/db';
import { enqueueOutbox } from '../lib/syncEngine';

interface CartItem {
  id: string;
  variantId: string;
  sku: string;
  barcode: string;
  name: string;
  qty: number;
  mrp: bigint;
  price: bigint;
  taxRate: number;
  lineTotal: bigint;
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
  total: bigint;
  addItem: (searchTerm: string) => Promise<boolean>;
  addProduct: (product: Product) => void;
  searchProducts: (searchTerm: string, limit?: number) => Promise<Product[]>;
  removeItem: (variantId: string) => void;
  updateQty: (variantId: string, qty: number) => void;
  clearCart: () => void;
  replaceCart: (items: CartItem[], customer: Customer | null) => void;
  setCustomer: (customer: Customer) => void;
  saveBill: (invoiceNo: number, cashierId: string, cashierName: string, amountReceived: string) => Promise<void>;
  loadBill: (invoiceNo: number) => Promise<{ items: CartItem[]; customer: Customer | null; amountReceived: string } | null>;
  getMaxInvoiceNo: () => Promise<number>;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customer: null,
  subtotal: 0n,
  taxTotal: 0n,
  total: 0n,

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

    get().addProduct(product);
    return true;
  },

  addProduct: (product: Product) => {
    const items = [...get().items];
    const existingIndex = items.findIndex(i => i.variantId === product.variant_id);

    if (existingIndex > -1) {
      const item = items[existingIndex]!;
      item.qty += 1;
      item.lineTotal = BigInt(item.qty) * BigInt(item.price);
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
        taxRate: product.tax_rate,
        lineTotal: BigInt(product.price),
      });
    }

    const { subtotal, taxTotal, total } = calculateTotals(items);
    set({ items, subtotal, taxTotal, total });
  },

  searchProducts: async (searchTerm: string, limit = 25) => {
    if (!db) return [];

    const term = searchTerm.trim();
    const allProducts = await db.query('SELECT * FROM products ORDER BY name ASC', []);

    if (!term) {
      return allProducts.slice(0, limit);
    }

    const exactBarcodeMatches = allProducts.filter((product: Product) => String(product.barcode) === term);
    if (exactBarcodeMatches.length > 0) {
      return exactBarcodeMatches.slice(0, limit);
    }

    const tokens = normalizeSearch(term).split(' ').filter(Boolean);

    return allProducts
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
    set({ items, subtotal, taxTotal, total });
  },

  updateQty: (variantId: string, qty: number) => {
    if (qty <= 0) {
      get().removeItem(variantId);
      return;
    }

    const items = get().items.map(i => {
      if (i.variantId === variantId) {
        return { ...i, qty, lineTotal: BigInt(Math.round(qty * 1000)) * BigInt(i.price) / 1000n };
      }
      return i;
    });
    const { subtotal, taxTotal, total } = calculateTotals(items);
    set({ items, subtotal, taxTotal, total });
  },

  clearCart: () => set({ items: [], subtotal: 0n, taxTotal: 0n, total: 0n, customer: null }),

  replaceCart: (items, customer) => {
    const { subtotal, taxTotal, total } = calculateTotals(items);
    set({ items, customer, subtotal, taxTotal, total });
  },
  
  setCustomer: (customer) => set({ customer }),

  saveBill: async (invoiceNo: number, cashierId: string, cashierName: string, amountReceived: string) => {
    if (!db) return;
    const state = get();
    const itemsJson = JSON.stringify(state.items.map(item => ({
      ...item,
      mrp: Number(item.mrp),
      price: Number(item.price),
      lineTotal: Number(item.lineTotal),
    })));
    const customerJson = state.customer ? JSON.stringify(state.customer) : null;
    await db.execute(
      `INSERT OR REPLACE INTO sales (id, invoice_no, items_json, customer_json, subtotal, tax_total, total, amount_received, cashier_id, cashier_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `sale-${invoiceNo}`,
        invoiceNo,
        itemsJson,
        customerJson,
        Number(state.subtotal),
        Number(state.taxTotal),
        Number(state.total),
        Math.round(Number(amountReceived || 0) * 100),
        cashierId,
        cashierName,
      ]
    );

    // Build sync payload for backend
    const settingsRows = await db.query("SELECT key, value FROM settings WHERE key IN ('store_id','terminal_id','shift_id')");
    const settings: Record<string, string> = {};
    for (const r of settingsRows) settings[r.key] = r.value ?? '';

    const payload: Record<string, unknown> = {
      storeId: settings.store_id || '00000000-0000-0000-0000-000000000000',
      terminalId: settings.terminal_id || 'term-pos-01',
      shiftId: settings.shift_id || '00000000-0000-0000-0000-000000000000',
      customerId: undefined,
      items: state.items.map(item => ({
        variantId: item.variantId,
        qty: item.qty,
        unitPrice: Number(item.price),
      })),
      payments: [{
        method: 'cash',
        amount: Number(state.total),
        reference: `INV-${invoiceNo}`,
      }],
      clientOpId: crypto.randomUUID(),
      notes: `Printed by ${cashierName}`,
      cashierId,
    };

    if (state.customer) {
      payload.customerId = state.customer.code; // Using code as proxy; backend may need UUID
    }

    await enqueueOutbox('order', 'create', payload);
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
      taxRate: Number(raw.taxRate),
      lineTotal: BigInt(raw.lineTotal as number),
    }));
    const customer: Customer | null = row.customer_json ? JSON.parse(row.customer_json) : null;
    const amountReceived = row.amount_received ? (Number(row.amount_received) / 100).toFixed(2) : '';
    return { items, customer, amountReceived };
  },

  getMaxInvoiceNo: async () => {
    if (!db) return 100;
    const row = await db.get('SELECT MAX(invoice_no) as max_no FROM sales');
    return (row?.max_no ?? 100) as number;
  },
}));

function calculateTotals(items: CartItem[]) {
  let subtotal = 0n;
  let taxTotal = 0n;

  items.forEach(item => {
    const lineSubtotal = item.lineTotal;
    // Assuming price is tax-inclusive for now, back-calculate tax if needed
    // Or if price is exclusive, add tax. Indian retail is usually inclusive.
    subtotal += lineSubtotal;
    // Simplified tax calc: tax = total - (total / (1 + rate/100))
    const taxAmount = lineSubtotal - (lineSubtotal * 10000n / BigInt(Math.round(100 + item.taxRate) * 100));
    taxTotal += taxAmount;
  });

  return { subtotal, taxTotal, total: subtotal };
}

function normalizeSearch(value: string | number | bigint | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
