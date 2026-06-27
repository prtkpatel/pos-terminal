import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCartStore, parseScaleBarcode, DEFAULT_SCALE_BARCODE_CONFIG } from './cartStore';

const mockDb = vi.hoisted(() => ({
  query: vi.fn(),
  get: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  db: mockDb,
}));

vi.mock('../lib/api', () => ({
  loadApiConfig: vi.fn(),
  apiPricingPreview: vi.fn().mockResolvedValue({ items: [], subtotal: 0, total: 0, orderDiscount: 0 }),
}));

describe('cartStore', () => {
  beforeEach(() => {
    useCartStore.setState({
      items: [],
      customer: null,
      subtotal: 0n,
      taxTotal: 0n,
      total: 0n,
    });
    mockDb.query.mockReset();
    mockDb.get.mockReset();
    mockDb.execute.mockReset();
    mockDb.query.mockResolvedValue([]);
  });

  it('should start with empty cart', () => {
    const state = useCartStore.getState();
    expect(state.items).toHaveLength(0);
    expect(state.total).toBe(0n);
  });

  it('should add product to cart', () => {
    const product = {
      id: 'p1',
      variant_id: 'v1',
      sku: 'TEST-001',
      barcode: '123456',
      name: 'Test Product',
      mrp: 1000,
      price: 900,
      tax_rate: 5,
      quantity: 100,
      reorder_level: 10,
    };

    useCartStore.getState().addProduct(product);

    const state = useCartStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].sku).toBe('TEST-001');
    expect(state.items[0].qty).toBe(1);
    expect(state.items[0].price).toBe(900n);
  });

  it('should increment qty for existing product', () => {
    const product = {
      id: 'p1',
      variant_id: 'v1',
      sku: 'TEST-001',
      barcode: '123456',
      name: 'Test Product',
      mrp: 1000,
      price: 900,
      tax_rate: 5,
      quantity: 100,
      reorder_level: 10,
    };

    useCartStore.getState().addProduct(product);
    useCartStore.getState().addProduct(product);

    const state = useCartStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].qty).toBe(2);
    expect(state.items[0].lineTotal).toBe(1800n);
  });

  it('should update item qty', () => {
    const product = {
      id: 'p1',
      variant_id: 'v1',
      sku: 'TEST-001',
      barcode: '123456',
      name: 'Test Product',
      mrp: 1000,
      price: 900,
      tax_rate: 5,
      quantity: 100,
      reorder_level: 10,
    };

    useCartStore.getState().addProduct(product);
    useCartStore.getState().updateQty('v1', 5);

    const state = useCartStore.getState();
    expect(state.items[0].qty).toBe(5);
    expect(state.items[0].lineTotal).toBe(4500n);
  });

  it('should update item qty to 3 decimal places', () => {
    const product = {
      id: 'p1',
      variant_id: 'v1',
      sku: 'TEST-001',
      barcode: '123456',
      name: 'Test Product',
      mrp: 1000,
      price: 900,
      tax_rate: 5,
      quantity: 100,
      reorder_level: 10,
    };

    useCartStore.getState().addProduct(product);
    useCartStore.getState().updateQty('v1', 0.25);

    const state = useCartStore.getState();
    expect(state.items[0].qty).toBe(0.25);
    expect(state.items[0].lineTotal).toBe(225n);
  });

  it('should remove item from cart', () => {
    const product = {
      id: 'p1',
      variant_id: 'v1',
      sku: 'TEST-001',
      barcode: '123456',
      name: 'Test Product',
      mrp: 1000,
      price: 900,
      tax_rate: 5,
      quantity: 100,
      reorder_level: 10,
    };

    useCartStore.getState().addProduct(product);
    useCartStore.getState().removeItem('v1');

    const state = useCartStore.getState();
    expect(state.items).toHaveLength(0);
    expect(state.total).toBe(0n);
  });

  it('should clear cart', () => {
    const product = {
      id: 'p1',
      variant_id: 'v1',
      sku: 'TEST-001',
      barcode: '123456',
      name: 'Test Product',
      mrp: 1000,
      price: 900,
      tax_rate: 5,
      quantity: 100,
      reorder_level: 10,
    };

    useCartStore.getState().addProduct(product);
    useCartStore.getState().clearCart();

    const state = useCartStore.getState();
    expect(state.items).toHaveLength(0);
    expect(state.subtotal).toBe(0n);
    expect(state.taxTotal).toBe(0n);
    expect(state.total).toBe(0n);
  });

  describe('parseScaleBarcode', () => {
    it('parses 13-digit weight barcode with default config', () => {
      const result = parseScaleBarcode('2100400002502', DEFAULT_SCALE_BARCODE_CONFIG);
      expect(result).toEqual({ plu: '400', weightKg: 0.25 });
    });

    it('returns null for wrong prefix', () => {
      const result = parseScaleBarcode('8900400002502', DEFAULT_SCALE_BARCODE_CONFIG);
      expect(result).toBeNull();
    });

    it('returns null for wrong length', () => {
      const result = parseScaleBarcode('21004000002502', DEFAULT_SCALE_BARCODE_CONFIG);
      expect(result).toBeNull();
    });

    it('parses price-embedded barcode', () => {
      const cfg = { ...DEFAULT_SCALE_BARCODE_CONFIG, valueType: 'price' as const, valueDecimals: 2 };
      const result = parseScaleBarcode('2100400033750', cfg);
      expect(result).toEqual({ plu: '400', pricePaise: 3375 });
    });

    it('parses 12-digit barcode without final check digit', () => {
      const cfg = { ...DEFAULT_SCALE_BARCODE_CONFIG, includeCheckDigit: false };
      const result = parseScaleBarcode('210040000250', cfg);
      expect(result).toEqual({ plu: '400', weightKg: 0.25 });
    });

    it('parses custom single-digit prefix', () => {
      const cfg = { ...DEFAULT_SCALE_BARCODE_CONFIG, prefix: '2', pluLength: 5, valueLength: 5, includeCheckDigit: true };
      const result = parseScaleBarcode('200400002502', cfg);
      expect(result).toEqual({ plu: '400', weightKg: 0.25 });
    });

    it('parses alphanumeric prefix with 3-digit PLU (scale label format)', () => {
      const cfg = { ...DEFAULT_SCALE_BARCODE_CONFIG, prefix: '21C', pluLength: 3, valueLength: 6, includeCheckDigit: true };
      const result = parseScaleBarcode('21C0040002502', cfg);
      expect(result).toEqual({ plu: '4', weightKg: 0.25 });
    });
  });

  it('adds Tuverdal-style scale label by PLU with weight-based total', async () => {
    mockDb.query.mockResolvedValue([
      {
        id: 'tuverdal-id',
        variant_id: 'tuverdal-variant',
        sku: 'TUVERDAL',
        barcode: '',
        name: 'Tuverdal',
        mrp: 13500,
        price: 13500,
        tax_rate: 0,
        plu: '4',
        expiry_date: null,
      },
    ]);

    const cfg = { ...DEFAULT_SCALE_BARCODE_CONFIG, prefix: '21C', pluLength: 3, valueLength: 6, includeCheckDigit: true };
    const scale = parseScaleBarcode('21C0040002502', cfg);
    expect(scale).toEqual({ plu: '4', weightKg: 0.25 });

    const added = await useCartStore.getState().addWeighedByPlu(scale!.plu, scale!.weightKg!, 'weight');
    expect(added).toBe(true);

    const state = useCartStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].name).toBe('Tuverdal');
    expect(state.items[0].qty).toBe(0.25);
    expect(state.items[0].price).toBe(13500n);
    expect(state.items[0].lineTotal).toBe(3375n); // 0.25 kg × ₹135 = ₹33.75 = 3375 paise
  });
});
