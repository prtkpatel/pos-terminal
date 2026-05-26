import { test, expect } from '@playwright/test';
import { CashierBot } from './cashier-bot';

test.describe.configure({ mode: 'serial' });

test('Scenario 06: Large Bill (22 items)', async () => {
  const bot = await CashierBot.launch({ slowMo: 30 });
  await bot.ensureScreenshotDir();

  await bot.login('admin', '1234');

  // Build a cart with 22 items
  const scannedCount = await bot.buildLargeCart(22, 1);
  expect(scannedCount).toBe(22);
  expect(await bot.getCartItemCount()).toBe(22);
  
  await bot.screenshot('scenario-06-large-bill');

  // Verify net total is calculated
  const totalText = await bot.getTotalText();
  expect(totalText).not.toBe('₹0.00');

  // Pay
  await bot.clickPay();
  await bot.enterAmount('10000'); // Large amount for large bill
  await bot.confirmPrint();

  expect(await bot.getCartItemCount()).toBe(0);

  // Assert local DB has the sale
  const lastSale = await bot.getLastSale();
  expect(lastSale).not.toBeNull();
  expect(lastSale.invoice_no).toBeGreaterThan(100);

  await bot.close();
});

test('Scenario 07: Save Draft (No Print)', async () => {
  const bot = await CashierBot.launch({ slowMo: 50 });
  await bot.ensureScreenshotDir();

  await bot.login('admin', '1234');

  await bot.scanBarcode('8901001000011');
  await bot.scanBarcode('8901001000028');
  
  // Save bill without going through payment modal
  await bot.saveBill();
  
  // Cart should be empty after save
  expect(await bot.getCartItemCount()).toBe(0);
  
  await bot.screenshot('scenario-07-save-draft');

  // Assert local DB has the sale
  const lastSale = await bot.getLastSale();
  expect(lastSale).not.toBeNull();
  
  await bot.close();
});

test('Scenario 08: Rapid Multiple Sales (Sync Stress)', async () => {
  const bot = await CashierBot.launch({ slowMo: 20 });
  await bot.ensureScreenshotDir();

  await bot.login('admin', '1234');

  for (let i = 1; i <= 3; i++) {
    await bot.scanBarcode('8901001000011');
    await bot.saveBill();
    console.log(`Rapid sale ${i} complete`);
  }

  const depth = await bot.getOutboxDepth();
  expect(depth).toBeGreaterThanOrEqual(3);
  await bot.screenshot('scenario-08-rapid-sales');

  await bot.close();
});
