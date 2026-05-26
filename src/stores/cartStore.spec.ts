import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from './cartStore';

describe('cartStore', () => {
  beforeEach(() => {
    useCartStore.setState({
      items: [],
      customer: null,
      subtotal: 0n,
      taxTotal: 0n,
      total: 0n,
    });
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
});
