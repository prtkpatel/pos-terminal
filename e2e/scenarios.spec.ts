import { test, expect } from '@playwright/test';
import { CashierBot } from './cashier-bot';

test.describe.configure({ mode: 'serial' });

/**
 * Cashier Simulator Scenarios
 *
 * These tests act like a real person using the POS terminal:
 * logging in, scanning barcodes, searching products,
 * changing quantities, applying discounts, and checking out.
 */

test.afterEach(async ({}, testInfo) => {
  // Cleanup screenshot directory prompt (optional)
});

test('Scenario 1: Quick single-item sale', async () => {
  const bot = await CashierBot.launch({ slowMo: 50 });
  await bot.ensureScreenshotDir();

  // Step 1 — Login
  await bot.login('admin', '1234');
  await bot.screenshot('01-logged-in');

  // Step 2 — Scan a barcode (Fresh Milk)
  await bot.scanBarcode('8901001000011');
  expect(await bot.getCartItemCount()).toBe(1);
  await bot.screenshot('02-milk-scanned');

  // Step 3 — Pay
  await bot.clickPay();
  await bot.screenshot('03-pay-modal-open');

  // Step 4 — Enter cash received
  await bot.enterAmount('100');
  await bot.screenshot('04-cash-entered');

  // Step 5 — Confirm / Print
  await bot.confirmPrint();
  await bot.screenshot('05-sale-complete');

  // Cart should be empty again
  expect(await bot.getCartItemCount()).toBe(0);

  await bot.close();
});

test('Scenario 2: Multi-item sale with quantity changes', async () => {
  const bot = await CashierBot.launch({ slowMo: 50 });
  await bot.ensureScreenshotDir();

  await bot.login('admin', '1234');

  // Add 3 different products
  await bot.scanBarcode('8901001000011'); // Milk
  await bot.scanBarcode('8901001000028'); // Bread
  await bot.scanBarcode('8901001000035'); // Eggs
  expect(await bot.getCartItemCount()).toBe(3);
  await bot.screenshot('06-three-items');

  // Change quantity of last item (Eggs) to 2
  await bot.setLastItemQuantity(2);
  await bot.screenshot('07-qty-updated');

  // Delete the middle item (Bread)
  await bot.page.getByRole('cell', { name: 'Whole Wheat Bread' }).click();
  await bot.deleteLastItem();
  expect(await bot.getCartItemCount()).toBe(2);
  await bot.screenshot('08-bread-deleted');

  // Pay with exact-ish amount
  await bot.clickPay();
  await bot.enterAmount('500');
  await bot.confirmPrint();

  expect(await bot.getCartItemCount()).toBe(0);
  await bot.close();
});

test('Scenario 3: Search-by-name and suggestion select', async () => {
  const bot = await CashierBot.launch({ slowMo: 50 });
  await bot.ensureScreenshotDir();

  await bot.login('admin', '1234');

  // Type partial name, wait for suggestions, click first row
  await bot.searchAndSelect('Milk', 0);
  expect(await bot.getCartItemCount()).toBe(1);
  await bot.screenshot('09-search-milk');

  await bot.searchAndSelect('Tea', 0);
  expect(await bot.getCartItemCount()).toBe(2);
  await bot.screenshot('10-search-tea');

  // Checkout
  await bot.clickPay();
  await bot.enterAmount('300');
  await bot.confirmPrint();

  await bot.close();
});

test('Scenario 4: Hold sale + resume + complete', async () => {
  const bot = await CashierBot.launch({ slowMo: 50 });
  await bot.ensureScreenshotDir();

  await bot.login('admin', '1234');

  // Build a cart
  await bot.scanBarcode('8901001000042'); // Sugar
  await bot.scanBarcode('8901001000059'); // Tea
  expect(await bot.getCartItemCount()).toBe(2);

  // Hold it
  await bot.holdSale();
  expect(await bot.getCartItemCount()).toBe(0);
  await bot.screenshot('11-sale-held');

  // Resume from hold list
  await bot.page.getByRole('button', { name: 'Resume' }).first().click();
  await bot.page.waitForTimeout(300);
  expect(await bot.getCartItemCount()).toBe(2);
  await bot.screenshot('12-sale-resumed');

  // Complete checkout
  await bot.clickPay();
  await bot.enterAmount('500');
  await bot.confirmPrint();

  await bot.close();
});

test('Scenario 5: Add customer + pay', async () => {
  const bot = await CashierBot.launch({ slowMo: 50 });
  await bot.ensureScreenshotDir();

  await bot.login('admin', '1234');

  await bot.scanBarcode('8901001000066'); // Oil
  expect(await bot.getCartItemCount()).toBe(1);

  // Add walk-in customer
  await bot.addCustomer('9876543210', 'Ravi Kumar');
  await bot.screenshot('13-customer-added');

  // Pay
  await bot.clickPay();
  await bot.enterAmount('200');
  await bot.confirmPrint();

  await bot.close();
});
