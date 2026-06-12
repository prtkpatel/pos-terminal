import { useEffect, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { db } from '../lib/db';

interface StoreInfo {
  name: string;
  gstin: string;
  fssai: string;
  address: string;
  phone: string;
  footer: string;
}

const SAMPLE_ITEMS = [
  { name: 'Sample Item A', sku: 'SAMPLE-01', qty: 2, rate: 5000, amt: 10000 },
  { name: 'Sample Item B', sku: 'SAMPLE-02', qty: 1, rate: 2500, amt: 2500 },
];

function money(paise: number) {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Read-only "this is how the printed slip looks" preview, openable any time from the
 * shell header. The shop header (name/address/GSTIN/FSSAI) and footer are pulled from
 * the synced store settings — editing happens in the admin panel, never here.
 */
export function ReceiptPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<StoreInfo>({ name: '', gstin: '', fssai: '', address: '', phone: '', footer: '' });
  const [gstEnabled, setGstEnabled] = useState(true);

  useEffect(() => {
    if (!open || !db) return;
    let mounted = true;
    (async () => {
      const rows = await db!.query(
        "SELECT key, value FROM settings WHERE key IN ('store_name','store_gstin','store_fssai','store_address','store_phone','store_footer','gst_enabled')",
      );
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value ?? '';
      if (!mounted) return;
      setInfo({
        name: map.store_name || '',
        gstin: map.store_gstin || '',
        fssai: map.store_fssai || '',
        address: map.store_address || '',
        phone: map.store_phone || '',
        footer: map.store_footer || '',
      });
      setGstEnabled(map.gst_enabled !== 'false');
    })().catch(() => undefined);
    return () => { mounted = false; };
  }, [open]);

  if (!open) return null;

  const subtotal = SAMPLE_ITEMS.reduce((s, i) => s + i.amt, 0);
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  async function handlePrint() {
    try {
      const api = (window as any).api;
      if (api?.print?.silent) {
        const printerRow = db ? await db.get("SELECT value FROM settings WHERE key = 'printer_name'") : null;
        const result = (await api.print.silent(printerRow?.value || undefined)) as { success: boolean; error?: string };
        if (!result?.success) window.print();
      } else {
        window.print();
      }
    } catch {
      window.print();
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-black uppercase tracking-wider text-slate-900">Receipt Slip Preview</div>
            <div className="text-[11px] text-slate-500">Sample bill · header &amp; footer come from the admin panel</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900" aria-label="Close preview"><X size={18} /></button>
        </div>

        <div className="overflow-auto bg-slate-100 p-4">
          <div className="printable-receipt mx-auto w-[320px] bg-white px-3 py-4 font-mono text-[11px] leading-tight text-slate-950 shadow-xl">
            <div className="text-center">
              <div className="text-base font-black tracking-wide">{info.name || 'Your Shop Name'}</div>
              <div>Tax Invoice / Bill of Supply</div>
              {info.address ? <div>{info.address}</div> : null}
              {info.phone ? <div>Mob: {info.phone}</div> : null}
              {gstEnabled && info.gstin ? <div>GSTIN: {info.gstin}</div> : null}
              {info.fssai ? <div>FSSAI: {info.fssai}</div> : null}
            </div>

            <div className="my-3 border-t border-dashed border-slate-500" />

            <div className="grid grid-cols-2 gap-y-1">
              <span>Inv No</span><span className="text-right">INV-SAMPLE</span>
              <span>Date</span><span className="text-right">{now}</span>
              <span>Cashier</span><span className="text-right">Sample Cashier</span>
              <span>Customer</span><span className="text-right">Walk-in</span>
            </div>

            <div className="my-3 border-t border-dashed border-slate-500" />

            <div className="grid grid-cols-[1fr_28px_52px_56px] gap-1 font-bold uppercase">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Rate</span>
              <span className="text-right">Amt</span>
            </div>
            <div className="my-1 border-t border-dashed border-slate-400" />

            {SAMPLE_ITEMS.map((item) => (
              <div key={item.sku} className="space-y-0.5 py-1">
                <div className="truncate font-bold">{item.name}</div>
                <div className="grid grid-cols-[1fr_28px_52px_56px] gap-1">
                  <span>{item.sku}</span>
                  <span className="text-right">{item.qty}</span>
                  <span className="text-right">{money(item.rate)}</span>
                  <span className="text-right">{money(item.amt)}</span>
                </div>
              </div>
            ))}

            <div className="my-3 border-t border-dashed border-slate-500" />

            <div className="space-y-1">
              <div className="flex justify-between"><span>Gross Amount</span><span>{money(subtotal)}</span></div>
              <div className="border-t border-dashed border-slate-500 pt-2 text-base font-black">
                <div className="flex justify-between"><span>NET TOTAL</span><span>{money(subtotal)}</span></div>
              </div>
              <div className="flex justify-between"><span>Cash</span><span>{money(subtotal)}</span></div>
            </div>

            <div className="my-3 border-t border-dashed border-slate-500" />

            <div className="text-center">
              <div>Items: {SAMPLE_ITEMS.length} | Qty: {SAMPLE_ITEMS.reduce((s, i) => s + i.qty, 0)}</div>
              <div className="mt-2 whitespace-pre-line font-bold">{info.footer || 'Thank you. Visit again.'}</div>
              <div>POS-SAMPLE</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-white px-4 py-3">
          <span className="text-[11px] text-slate-500">To change shop name, address, GSTIN, FSSAI or footer, use the Admin panel.</span>
          <button
            onClick={handlePrint}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-700"
          >
            <Printer size={14} />
            Print Test Slip
          </button>
        </div>
      </div>
    </div>
  );
}
