import { test, expect } from '@playwright/test';
import { CashierBot } from './cashier-bot';
import { BackendClient } from './backend-client';

test.describe('Cross-App Integration: Terminal -> Backend', () => {
  let backend: BackendClient;
  const storeId = '01733d49-696a-4f20-9aa3-6e0224319fb3'; // From main.ts seed

  test.beforeAll(async () => {
    backend = new BackendClient();
    try {
      await backend.login();
    } catch (e) {
      console.warn('Backend not available, skipping cross-app validation');
      test.skip();
    }
  });

  test('The Big Sale Day: Flow validation', async () => {
    const bot = await CashierBot.launch({ slowMo: 50, allowOnline: true });
    await bot.login('cashier@atulyam.com', '1111');

    // 1. Operator: Build a large cart (22 items)
    await bot.buildLargeCart(22);
    
    // 2. Operator: Complete sale
    const invoiceNo = await bot.getInvoiceNo();
    await bot.clickPay();
    await bot.enterAmount('10000');
    await bot.confirmPrint();

    // 3. Trigger sync
    await bot.triggerSync();
    const depth = await bot.getOutboxDepth();
    console.log(`Sync outbox depth: ${depth}`);

    // 4. Backend Validation
    const sales = await backend.getSales(storeId);
    console.log(`Backend sales count: ${sales.total}`);
    
    // In backend, 'total' in response is the count of orders.
    // The items are in 'items' array.
    expect(sales.total).toBeGreaterThan(0);

    const sale = sales.items.find((s: any) => s.notes?.includes(invoiceNo.toString()));
    if (sale) {
      console.log(`Found synced sale: ${sale.billNo}`);
    }

    // 5. Inventory Validation
    const inventory = await backend.getInventory(storeId);
    const lowStock = inventory.data.filter((i: any) => i.quantity <= i.reorderLevel);
    console.log(`Backend low stock items: ${lowStock.length}`);
    
    // 6. Notification Validation
    const notifications = await backend.getNotifications();
    const alerts = notifications.items.filter((n: any) => n.bodyRendered.includes('LOW STOCK'));
    expect(alerts.length).toBeGreaterThan(0);

    await bot.close();
  });
});
