import { Page, ElectronApplication, _electron as electron } from '@playwright/test';
import path from 'path';

export interface CashierBotOptions {
  /** Path to Electron main entry file. Defaults to ./dist-electron/main.js */
  electronMainPath?: string;
  /** Slow down each action by N milliseconds (good for demos) */
  slowMo?: number;
  /** Keep the browser window visible (not headless) */
  headless?: boolean;
  /** Override default viewport */
  viewport?: { width: number; height: number };
  /** Allow online requests (e.g. for cross-app sync tests) */
  allowOnline?: boolean;
}

/**
 * CashierBot — A human-like simulator for the POS Terminal.
 *
 * Usage:
 *   const bot = await CashierBot.launch();
 *   await bot.login('admin', '1234');
 *   await bot.scanBarcode('8901001000011');
 *   await bot.clickPay();
 *   await bot.enterAmount('100');
 *   await bot.confirmPrint();
 *   await bot.close();
 */
export class CashierBot {
  public app: ElectronApplication;
  public page: Page;

  private constructor(app: ElectronApplication, page: Page) {
    this.app = app;
    this.page = page;
  }

  static async launch(options: CashierBotOptions = {}): Promise<CashierBot> {
    const electronMainPath = options.electronMainPath
      ? path.resolve(options.electronMainPath)
      : path.join(__dirname, '..', 'dist-electron', 'main.js');

    const app = await electron.launch({
      args: [electronMainPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
      headless: options.headless ?? false,
      slowMo: options.slowMo ?? 0,
    });

    const page = await app.firstWindow();

    page.on('console', (msg) => {
      console.log(`[Electron Console] ${msg.type()}: ${msg.text()}`);
    });

    // Give the app a generous viewport (POS terminal size)
    await page.setViewportSize(options.viewport ?? { width: 1280, height: 900 });

    if (!options.allowOnline) {
      // Force offline mode so auth falls back to local SQLite immediately
      // (avoids hanging on unreachable http://localhost:3000 backend)
      await page.addInitScript(() => {
        const origFetch = window.fetch;
        window.fetch = async (...args) => {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
          if (url.includes('/v1/auth/pin-login')) {
            throw new Error('Network error (test stub)');
          }
          return origFetch(...args);
        };
      });
    }

    // Stub window.print so the native OS print dialog doesn't hang the test
    await page.addInitScript(() => {
      (window as any).print = () => {
        console.log('[CashierBot] window.print() stubbed');
      };
    });

    // Wait for the app to be ready (login screen or checkout screen)
    await page.waitForSelector('text=Atulyam Pos', { timeout: 15000 });

    // Ensure a clean session — clear any cached login so tests always start at login
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByText('Terminal Login').waitFor({ timeout: 15000 });

    return new CashierBot(app, page);
  }

  /* ─────────────── LOGIN ─────────────── */

  async login(username: string, pin: string) {
    await this.page.getByPlaceholder('e.g. admin').fill(username);
    await this.page.locator('#login-pin').fill(pin);
    await this.page.getByRole('button', { name: /Sign In/i }).click();
    // Wait for checkout screen to appear
    await this.page.getByPlaceholder('Scan barcode / SKU / item name').waitFor({ timeout: 10000 });
  }

  async logout() {
    await this.page.getByRole('button', { name: 'Logout' }).click();
    await this.page.waitForSelector('text=Terminal Login', { timeout: 5000 });
  }

  /* ─────────────── SCAN / ADD ITEMS ─────────────── */

  async scanBarcode(barcode: string) {
    const input = this.page.getByPlaceholder('Scan barcode / SKU / item name');
    await input.fill(barcode);
    await input.press('Enter');
    // Brief pause for DB query + UI update
    await this.page.waitForTimeout(300);
  }

  async searchAndSelect(term: string, index = 0) {
    const input = this.page.getByPlaceholder('Scan barcode / SKU / item name');
    await input.fill(term);
    await this.page.waitForTimeout(250); // debounce in app is 120ms
    // Wait for suggestion dropdown
    await this.page.locator('.absolute.z-30 tbody tr').nth(index).waitFor({ timeout: 5000 });
    await this.page.locator('.absolute.z-30 tbody tr').nth(index).click();
    await this.page.waitForTimeout(200);
  }

  async openProductFinder() {
    await this.page.getByRole('button', { name: 'Find Product' }).click();
    await this.page.waitForSelector('text=Find Product', { timeout: 3000 });
  }

  async findProductAndAdd(term: string, index = 0) {
    await this.openProductFinder();
    const search = this.page.getByPlaceholder('Example: 8901001000011, Milk, MILK-001, Fresh Milk');
    await search.fill(term);
    await this.page.waitForTimeout(250);
    const row = this.page.locator('text=Find Product').locator('xpath=../../..//table/tbody/tr').nth(index);
    await row.locator('button:has-text("Add")').click();
  }

  async closeProductFinder() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(200);
  }

  /* ─────────────── CART MANIPULATION ─────────────── */

  async getCartItemCount(): Promise<number> {
    return this.page.locator('input[data-qty-input]').count();
  }

  async setItemQuantity(variantId: string, qty: number) {
    const input = this.page.locator(`input[data-qty-input="${variantId}"]`);
    await input.fill(String(qty));
    await input.press('Escape'); // blur without triggering payment modal
    await this.page.waitForTimeout(150);
  }

  async setLastItemQuantity(qty: number) {
    const inputs = this.page.locator('input[data-qty-input]');
    const count = await inputs.count();
    if (count === 0) throw new Error('No items in cart to update');
    const last = inputs.nth(count - 1);
    await last.fill(String(qty));
    await last.press('Escape'); // blur without triggering payment modal
    await this.page.waitForTimeout(150);
  }

  async deleteLastItem() {
    await this.page.getByRole('button', { name: 'Delete' }).click();
    // Confirm modal appears
    await this.page.getByRole('button', { name: 'Confirm' }).click();
    await this.page.waitForTimeout(200);
  }

  async clearCart() {
    await this.page.getByRole('button', { name: 'Cancel' }).click();
    const confirm = this.page.getByRole('button', { name: 'Confirm' });
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
    }
    await this.page.waitForTimeout(200);
  }

  async holdSale() {
    await this.page.getByRole('button', { name: 'Hold' }).click();
    await this.page.waitForTimeout(200);
  }

  async saveBill() {
    await this.page.getByRole('button', { name: 'Save' }).click();
    // Alert modal appears: "Invoice X saved."
    const okBtn = this.page.locator('button:has-text("OK")');
    if (await okBtn.isVisible().catch(() => false)) {
      await okBtn.click();
    }
    await this.page.waitForTimeout(300);
  }

  /* ─────────────── PAYMENT ─────────────── */

  async clickPay() {
    await this.page.getByRole('button', { name: 'Print' }).click();
    await this.page.waitForSelector('.print-preview-modal', { timeout: 5000 });
  }

  async enterAmount(amount: string) {
    const input = this.page.locator('.print-preview-modal input[placeholder="0.00"]');
    await input.fill(amount);
    await this.page.waitForTimeout(200);
  }

  async confirmPrint() {
    // Click the big Print button inside the modal
    const modal = this.page.locator('.print-preview-modal');
    await modal.getByRole('button', { name: 'Print' }).click();
    // Wait for modal to close
    await this.page.waitForSelector('.print-preview-modal', { state: 'detached', timeout: 5000 });
    await this.page.waitForTimeout(300);
  }

  async closePayModal() {
    await this.page.locator('.print-preview-modal').getByRole('button', { name: 'Close' }).click();
    await this.page.waitForSelector('.print-preview-modal', { state: 'detached', timeout: 5000 });
  }

  /* ─────────────── CUSTOMER ─────────────── */

  async addCustomer(mobile: string, name?: string) {
    await this.page.locator('button:has-text("Add Customer")').click();
    await this.page.waitForSelector('text=Add Customer', { timeout: 3000 });
    await this.page.locator('input[placeholder="10 digit mobile"]').fill(mobile);
    if (name) {
      await this.page.locator('input[placeholder="Optional"]').fill(name);
    }
    await this.page.getByRole('button', { name: 'Save Customer' }).click();
    await this.page.waitForSelector('text=Add Customer', { state: 'detached', timeout: 5000 });
  }

  /* ─────────────── UTILITIES ─────────────── */

  async screenshot(name: string) {
    await this.page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: false });
  }

  async getTotalText(): Promise<string> {
    const el = this.page.locator('text=Net Total').locator('xpath=../div');
    return el.innerText();
  }

  async getInvoiceNo(): Promise<number> {
    const text = await this.page.locator('.text-sm.font-black.text-blue-700').innerText();
    return Number(text);
  }

  /* ─────────────── LOCAL DB ASSERTIONS ─────────────── */

  async getLastSale() {
    return this.page.evaluate(async () => {
      const row = await (window as any).api.db.get(
        'SELECT invoice_no, items_json, total, amount_received, cashier_name, created_at FROM sales ORDER BY created_at DESC LIMIT 1'
      );
      return row ?? null;
    });
  }

  async getOutboxDepth(): Promise<number> {
    return this.page.evaluate(async () => {
      const row = await (window as any).api.db.get(
        "SELECT COUNT(*) as count FROM outbox WHERE status = 'pending'"
      );
      return row?.count ?? 0;
    });
  }

  async getLocalProductCount(): Promise<number> {
    return this.page.evaluate(async () => {
      const row = await (window as any).api.db.get('SELECT COUNT(*) as count FROM products');
      return row?.count ?? 0;
    });
  }

  async getAllBarcodes(): Promise<string[]> {
    return this.page.evaluate(async () => {
      const rows = await (window as any).api.db.query('SELECT barcode FROM products WHERE barcode IS NOT NULL');
      return rows.map((r: any) => r.barcode);
    });
  }

  async ensureScreenshotDir() {
    const fs = await import('fs');
    if (!fs.existsSync('e2e/screenshots')) {
      fs.mkdirSync('e2e/screenshots', { recursive: true });
    }
  }

  async triggerSync() {
    // Look for the sync button which shows "Pending" or "Synced"
    const syncBtn = this.page.locator('button:has-text("Pending"), button:has-text("Synced"), button:has-text("Sync Error")');
    await syncBtn.click();
    // Wait for it to return to "Synced" state or a reasonable timeout
    try {
      await this.page.locator('button:has-text("Synced")').waitFor({ timeout: 10000 });
    } catch (e) {
      console.warn('Sync did not complete within 10s');
    }
  }

  async close() {
    await this.app.close();
  }

  /* ─────────────── LARGE BILL HELPERS ─────────────── */

  /**
   * Build a large cart by scanning N unique barcodes.
   * Uses the first N barcodes from the local DB.
   */
  async buildLargeCart(itemCount: number, qty = 1) {
    const barcodes = await this.getAllBarcodes();
    const toScan = barcodes.slice(0, Math.min(itemCount, barcodes.length));
    for (const barcode of toScan) {
      await this.scanBarcode(barcode);
      if (qty > 1) {
        await this.setLastItemQuantity(qty);
      }
    }
    return toScan.length;
  }
}
