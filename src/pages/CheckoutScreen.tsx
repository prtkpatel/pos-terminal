import React, { useEffect, useRef, useState } from 'react';
import { 
  Search, 
  Camera,
  Info, 
  PauseCircle, 
  Save, 
  XCircle, 
  Trash2, 
  Printer,
  Banknote,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  UserPlus
} from 'lucide-react';
import { Customer, Product, useCartStore, parseScaleBarcode, getScaleBarcodeConfig, ScaleBarcodeConfig, DEFAULT_SCALE_BARCODE_CONFIG } from '../stores/cartStore';
import { useAuthStore } from '../stores/authStore';
import { useSyncStore } from '../stores/syncStore';
import { cn } from '../lib/utils';
import { db } from '../lib/db';
import { refreshTerminalSettings } from '../lib/syncEngine';
import { apiCustomerLookup, apiGetWeightedBarcodeConfig } from '../lib/api';

interface HeldSale {
  id: string;
  invoiceNo: number;
  items: ReturnType<typeof useCartStore.getState>['items'];
  customer: Customer | null;
  subtotal: bigint;
  total: bigint;
  createdAt: Date;
}

function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  accent,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={shortcut ? `${label}, ${shortcut}` : label}
      className="touch-action-btn group"
    >
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-md text-white shadow-sm", accent)}>
        <Icon className="h-6 w-6" strokeWidth={2.4} />
      </span>
      <span className="text-[10px] font-black uppercase leading-none text-slate-800">{label}</span>
      {shortcut && <span className="text-[9px] font-bold leading-none text-slate-400">{shortcut}</span>}
    </button>
  );
}

async function findLocalCustomerByMobile(mobile: string) {
  if (!db) return null;
  try {
    const digits = mobile.replace(/\D/g, '');
    const row = await db.get(
      `SELECT id, code, name, phone, email, gstin
       FROM customers
       WHERE phone = ? OR phone LIKE ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [digits, `%${digits}`]
    );
    return row ? {
      id: String(row.id || ''),
      code: String(row.code || `C-${digits.slice(-4)}`),
      name: String(row.name || ''),
      phone: String(row.phone || digits),
      email: String(row.email || ''),
      gstin: String(row.gstin || ''),
    } : null;
  } catch {
    return null;
  }
}

async function cacheCustomer(customer: { id?: string; name?: string; phone?: string; email?: string; gstin?: string }) {
  if (!db || !customer.phone) return;
  const phone = customer.phone.replace(/\D/g, '');
  if (!phone) return;
  try {
    await db.execute(
      `INSERT OR REPLACE INTO customers (id, code, name, phone, email, gstin, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        customer.id || `local-${phone}`,
        `C-${phone.slice(-4)}`,
        customer.name || phone,
        phone,
        customer.email || '',
        customer.gstin || '',
      ]
    );
  } catch {
    // Customer autocomplete is best-effort.
  }
}

export function CheckoutScreen() {
  const { items, customer, subtotal, taxTotal, orderDiscount, total, addNotice, clearAddNotice, addItem, addProduct, addWeighedByPlu, searchProducts, updateQty, removeItem, clearCart, replaceCart, setCustomer, saveBill, loadBill, getMaxInvoiceNo } = useCartStore();
  const { cashier, logout } = useAuthStore();
  const { isOnline, isSyncing, lastSyncAt, outboxDepth, failedCount, syncError, syncNow, refreshOutboxDepth } = useSyncStore();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [productSuggestions, setProductSuggestions] = useState<Product[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showProductFinder, setShowProductFinder] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [cameraStatus, setCameraStatus] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [productFinderSearch, setProductFinderSearch] = useState('');
  const [finderProducts, setFinderProducts] = useState<Product[]>([]);
  const [invoiceNo, setInvoiceNo] = useState(101);
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<'billing' | 'credit'>('billing');
  const [paymentTender, setPaymentTender] = useState<'cash' | 'online'>('cash');
  const [gstEnabled, setGstEnabled] = useState(true);
  const [storeInfo, setStoreInfo] = useState({ name: '', gstin: '', fssai: '', address: '', phone: '', footer: '' });
  const [billDate, setBillDate] = useState<string | null>(null);
  const [roundOff, setRoundOff] = useState<bigint>(0n);
  const [quickItems, setQuickItems] = useState<Product[]>([]);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [customerError, setCustomerError] = useState('');
  const [customerLookupStatus, setCustomerLookupStatus] = useState('');
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const lastDetectedBarcodeRef = useRef('');
  const cameraScanCountRef = useRef(0);
  const productFinderInputRef = useRef<HTMLInputElement>(null);
  const customerMobileRef = useRef<HTMLInputElement>(null);
  const skipBlurFocusRef = useRef(false);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; message: string; isAlert?: boolean }>({ open: false, message: '' });
  const confirmCallbacksRef = useRef<{ onConfirm: () => void; onCancel?: () => void }>({ onConfirm: () => {} });
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const confirmModalOpenRef = useRef(false);
  const [highlightedSuggestionIdx, setHighlightedSuggestionIdx] = useState(-1);
  const highlightedSuggestionRef = useRef(-1);
  const payModalJustOpenedRef = useRef(false);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const customerNameEditedRef = useRef(false);
  const scaleConfigRef = useRef<ScaleBarcodeConfig>(DEFAULT_SCALE_BARCODE_CONFIG);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  const setQtyDraft = (variantId: string, raw: string) => setQtyDrafts(prev => ({ ...prev, [variantId]: raw }));
  const clearQtyDraft = (variantId: string) => setQtyDrafts(prev => { const next = { ...prev }; delete next[variantId]; return next; });
  const commitQtyDraft = (variantId: string, rawOverride?: string) => {
    const raw = rawOverride ?? qtyDrafts[variantId];
    if (raw === undefined) return;
    const num = Number(raw);
    if (!String(raw).trim() || !Number.isFinite(num) || num <= 0) {
      updateQty(variantId, 0);
    } else {
      updateQty(variantId, Math.round(num * 1000) / 1000);
    }
    clearQtyDraft(variantId);
  };

  useEffect(() => {
    let mounted = true;
    getMaxInvoiceNo().then((max) => {
      if (mounted) setInvoiceNo(max + 1);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadGstEnabled = async () => {
      await refreshTerminalSettings();
      if (!db) return;
      const row = await db.get("SELECT value FROM settings WHERE key = 'gst_enabled'");
      if (mounted) setGstEnabled(row?.value !== 'false');
      const rows = await db.query("SELECT key, value FROM settings WHERE key IN ('store_name','store_gstin','store_fssai','store_address','store_phone','store_footer')");
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value ?? '';
      if (mounted) setStoreInfo({ name: map.store_name || '', gstin: map.store_gstin || '', fssai: map.store_fssai || '', address: map.store_address || '', phone: map.store_phone || '', footer: map.store_footer || '' });
    };
    void loadGstEnabled().catch(() => undefined);

    const onSettingUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: string }>).detail;
      if (detail?.key === 'gst_enabled') setGstEnabled(detail.value !== 'false');
    };
    window.addEventListener('terminal-setting-updated', onSettingUpdated);
    return () => { mounted = false; };
  }, []);

  // Load weighted-barcode config from local SQLite (synced from backend).
  useEffect(() => {
    let mounted = true;
    const loadConfig = async () => {
      const cfg = await getScaleBarcodeConfig();
      if (mounted) scaleConfigRef.current = cfg;
      // Also refresh directly from backend when online so admin setting changes
      // are picked up immediately instead of waiting for the next periodic sync.
      if (isOnline) {
        try {
          const remote = await apiGetWeightedBarcodeConfig();
          if (mounted) scaleConfigRef.current = { ...DEFAULT_SCALE_BARCODE_CONFIG, ...remote };
        } catch {
          // ignore — keep locally cached config
        }
      }
    };
    void loadConfig();
    const onSettingUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: string }>).detail;
      if (detail?.key === 'weighted_barcode_config') {
        try {
          scaleConfigRef.current = { ...DEFAULT_SCALE_BARCODE_CONFIG, ...JSON.parse(detail.value) };
        } catch {
          scaleConfigRef.current = DEFAULT_SCALE_BARCODE_CONFIG;
        }
      }
    };
    window.addEventListener('terminal-setting-updated', onSettingUpdated);
    return () => { mounted = false; };
  }, [isOnline]);

  // Reset round-off whenever cart total changes (e.g. item added/removed)
  useEffect(() => { setRoundOff(0n); }, [total]);

  // Load cheap products (≤ ₹10) as quick-add chips when pay modal opens
  useEffect(() => {
    if (!showPayModal || !db) return;
    void db.query(
      "SELECT variant_id, name, sku, mrp, price, tax_rate FROM products WHERE mrp > 0 AND mrp <= 1000 ORDER BY mrp ASC LIMIT 12"
    ).then(rows => setQuickItems(rows.map(r => ({
      id: String(r.variant_id),
      variant_id: String(r.variant_id),
      sku: String(r.sku || ''),
      barcode: '',
      name: String(r.name),
      mrp: Number(r.mrp),
      price: Number(r.price || r.mrp),
      tax_rate: Number(r.tax_rate || 0),
      quantity: 999,
      reorder_level: 0,
    })))).catch(() => {});
  }, [showPayModal]);

  useEffect(() => {
    if (!showPayModal) {
      payModalJustOpenedRef.current = false;
      return;
    }
    payModalJustOpenedRef.current = true;
    const timer = window.setTimeout(() => { payModalJustOpenedRef.current = false; }, 100);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        if (payModalJustOpenedRef.current) return;
        if (confirmModalOpenRef.current) return;
        event.preventDefault();
        void printBill();
      }

      if (event.ctrlKey && event.key === 's') {
        if (confirmModalOpenRef.current) return;
        event.preventDefault();
        // Previous bill → save only; new/current bill → print (save + print)
        void (billDate ? saveOnly() : printBill());
      }

      if (event.key === 'F2') {
        if (confirmModalOpenRef.current) return;
        event.preventDefault();
        if (paymentMode === 'billing') selectPaymentTender('cash');
      }

      if (event.key === 'F3') {
        if (confirmModalOpenRef.current) return;
        event.preventDefault();
        if (paymentMode === 'billing') selectPaymentTender('online');
      }

      if (event.key === 'F4') {
        if (confirmModalOpenRef.current) return;
        event.preventDefault();
        if (paymentMode === 'credit') {
          selectBillingMode();
        } else {
          selectCreditMode();
        }
      }

      if (event.key === 'Escape') {
        if (confirmModalOpenRef.current) return;
        setShowPayModal(false);
        focusBarcodeInput();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showPayModal, amountReceived, paymentMode, paymentTender, items, total, customer, billDate]);

  useEffect(() => {
    let isCurrent = true;
    const term = barcodeInput.trim();

    if (!term) {
      setProductSuggestions([]);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      const products = await searchProducts(term, 8);
      if (isCurrent) {
        setProductSuggestions(products);
        setShowSuggestions(products.length > 0);
      }
    }, 120);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [barcodeInput, searchProducts]);

  useEffect(() => {
    if (!showProductFinder) return;

    let isCurrent = true;
    const timeoutId = window.setTimeout(async () => {
      const products = await searchProducts(productFinderSearch, 50);
      if (isCurrent) {
        setFinderProducts(products);
      }
    }, 120);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [showProductFinder, productFinderSearch, searchProducts]);

  useEffect(() => {
    if (showProductFinder) {
      window.setTimeout(() => productFinderInputRef.current?.focus(), 0);
    }
  }, [showProductFinder]);

  useEffect(() => {
    confirmModalOpenRef.current = confirmModal.open;
  }, [confirmModal.open]);

  useEffect(() => {
    if (!confirmModal.open) return;
    const timeoutId = window.setTimeout(() => confirmBtnRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        setConfirmModal({ open: false, message: '' });
        confirmCallbacksRef.current.onConfirm();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmModal({ open: false, message: '' });
        if (confirmModal.isAlert) {
          confirmCallbacksRef.current.onConfirm?.();
        } else {
          confirmCallbacksRef.current.onCancel?.();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [confirmModal.open, confirmModal.isAlert]);

  useEffect(() => {
    highlightedSuggestionRef.current = -1;
    setHighlightedSuggestionIdx(-1);
  }, [barcodeInput]);

  useEffect(() => {
    if (!showSuggestions) {
      highlightedSuggestionRef.current = -1;
      setHighlightedSuggestionIdx(-1);
    }
  }, [showSuggestions]);

  const scanTerm = async (rawTerm: string) => {
    const term = rawTerm.trim();
    if (!term) return;

    // Weighing-scale barcode? Resolve PLU → product and add the embedded weight/price,
    // before the normal barcode search.
    const cfg = scaleConfigRef.current;
    const scale = parseScaleBarcode(term, cfg);
    if (scale) {
      if (cfg.valueType === 'price' && scale.pricePaise != null) {
        await addWeighedByPlu(scale.plu, scale.pricePaise, 'price');
      } else if (scale.weightKg != null) {
        await addWeighedByPlu(scale.plu, scale.weightKg, 'weight');
      }
      setSelectedVariantId('');
      setBarcodeInput('');
      setProductSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Guard: a code that starts with the weighted prefix but could not be parsed is
    // almost certainly a scale label. Do NOT fall through to normal product search.
    if (cfg.prefix && term.startsWith(cfg.prefix)) {
      setBarcodeInput(term);
      openAlert(`Scale barcode not recognized for prefix "${cfg.prefix}". Check Barcode/Scale settings.`, () => focusBarcodeInput());
      return;
    }

    const matches = await searchProducts(term, 10);
    const exactMatch = matches.find((product) =>
      product.barcode.toLowerCase() === term.toLowerCase() ||
      product.sku.toLowerCase() === term.toLowerCase()
    );

    if (exactMatch) {
      addProduct(exactMatch);
      setSelectedVariantId(exactMatch.variant_id);
      setBarcodeInput('');
      setProductSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (matches.length === 1) {
      addProduct(matches[0]);
      setSelectedVariantId(matches[0].variant_id);
      setBarcodeInput('');
      setProductSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (matches.length > 1) {
      setFinderProducts(matches);
      setProductFinderSearch(term);
      setShowProductFinder(true);
      setShowSuggestions(false);
      return;
    }

    const added = await addItem(term);
    if (added) {
      setBarcodeInput('');
      setProductSuggestions([]);
      setShowSuggestions(false);
    } else {
      setBarcodeInput(term);
      openAlert(`No product found for "${term}".`, () => focusBarcodeInput());
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    await scanTerm(barcodeInput);
  };

  const focusBarcodeInput = () => {
    // 50ms gives Electron enough time to return OS focus to the BrowserWindow
    // after a native confirm()/alert() dialog closes.
    // Do NOT call window.focus() — it corrupts Chromium's tab-navigation chain.
    window.setTimeout(() => {
      // Reset any stale focus navigation state left behind by native dialogs
      // or removed DOM nodes before focusing the barcode input.
      (document.activeElement as HTMLElement | null)?.blur();
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select();
    }, 50);
  };

  const focusAmountInput = () => {
    window.setTimeout(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      amountInputRef.current?.focus();
      amountInputRef.current?.select();
    }, 50);
  };

  const openConfirm = (message: string, onConfirm: () => void, onCancel?: () => void) => {
    confirmCallbacksRef.current = { onConfirm, onCancel };
    setConfirmModal({ open: true, message, isAlert: false });
  };

  const openAlert = (message: string, onOk?: () => void) => {
    confirmCallbacksRef.current = { onConfirm: onOk ?? (() => {}), onCancel: undefined };
    setConfirmModal({ open: true, message, isAlert: true });
  };

  const stopCameraStream = () => {
    if (cameraFrameRef.current !== null) {
      window.cancelAnimationFrame(cameraFrameRef.current);
      cameraFrameRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  };

  const closeCameraScanner = () => {
    stopCameraStream();
    setShowCameraScanner(false);
    setCameraStatus('');
    setCameraError('');
    lastDetectedBarcodeRef.current = '';
    cameraScanCountRef.current = 0;
    focusBarcodeInput();
  };

  const openCameraScanner = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      openAlert('Camera scanning is not available in this terminal. Use USB scanner or manual barcode entry.', () => focusBarcodeInput());
      return;
    }

    setCameraError('');
    setCameraStatus('Checking cameras...');
    setShowCameraScanner(true);

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((device) => device.kind === 'videoinput');
      setCameraDevices(videoDevices);
      setSelectedCameraId((current) => current || videoDevices[0]?.deviceId || '');
      setCameraStatus(videoDevices.length ? 'Point the camera at the barcode.' : 'Allow camera access to see available cameras.');
    } catch (error) {
      console.error('Failed to list cameras:', error);
      setCameraError('Could not read camera list. Check camera permission and connection.');
    }
  };

  const startCameraScanner = async (deviceId: string) => {
    stopCameraStream();
    setCameraError('');
    setCameraStatus('Opening camera...');
    lastDetectedBarcodeRef.current = '';
    cameraScanCountRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }

      const BarcodeDetectorCtor = (window as typeof window & {
        BarcodeDetector?: new (options?: { formats?: string[] }) => {
          detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
        };
      }).BarcodeDetector;

      if (!BarcodeDetectorCtor) {
        setCameraStatus('');
        setCameraError('Camera opened, but barcode detection is not enabled in this terminal runtime. Restart the terminal after update, or use USB scanner/manual entry.');
        return;
      }

      let detector: { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> };
      try {
        detector = new BarcodeDetectorCtor({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
        });
      } catch {
        detector = new BarcodeDetectorCtor();
      }

      setCameraStatus('Scanning... keep the barcode flat, bright, and inside the cyan box.');
      const scanFrame = async () => {
        const video = cameraVideoRef.current;
        if (video && video.readyState >= 2) {
          cameraScanCountRef.current += 1;
          if (cameraScanCountRef.current % 45 === 0) {
            setCameraStatus(`Scanning ${video.videoWidth || 0}x${video.videoHeight || 0} video... move closer if the barcode is small.`);
          }
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue?.trim();
            if (value && value !== lastDetectedBarcodeRef.current) {
              lastDetectedBarcodeRef.current = value;
              stopCameraStream();
              setShowCameraScanner(false);
              await scanTerm(value);
              focusBarcodeInput();
              return;
            }
          } catch (error) {
            console.error('Camera barcode detection failed:', error);
          }
        }
        cameraFrameRef.current = window.requestAnimationFrame(scanFrame);
      };

      cameraFrameRef.current = window.requestAnimationFrame(scanFrame);
    } catch (error) {
      console.error('Failed to open camera:', error);
      setCameraStatus('');
      setCameraError('Could not open camera. Check permission, cable, and whether another app is using it.');
    }
  };

  useEffect(() => {
    if (!showCameraScanner) return;
    void startCameraScanner(selectedCameraId);
    return () => stopCameraStream();
  }, [showCameraScanner, selectedCameraId]);

  useEffect(() => () => stopCameraStream(), []);

  const handleConfirm = () => {
    setConfirmModal({ open: false, message: '' });
    confirmCallbacksRef.current.onConfirm();
  };

  const handleConfirmCancel = () => {
    setConfirmModal({ open: false, message: '' });
    confirmCallbacksRef.current.onCancel?.();
  };

  const focusNextItem = (deletedIdx: number) => {
    // We need to wait for the DOM to update after state changes
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        const allInputs = document.querySelectorAll('input[data-qty-input]');
        if (allInputs.length === 0) {
          setSelectedVariantId(null);
          focusBarcodeInput();
          return;
        }
        
        // Focus the item at the same index, or the last one if we deleted the last
        const targetIdx = Math.min(deletedIdx, allInputs.length - 1);
        const targetInput = allInputs[targetIdx] as HTMLInputElement;
        if (targetInput) {
          const variantId = targetInput.getAttribute('data-qty-input');
          if (variantId) setSelectedVariantId(variantId);
          // Native dialogs can leave Chromium's :focus CSS rendering state corrupted.
          // Blurring the current active element first forces Chromium to re-sync its
          // focus state, so :focus pseudo-class works correctly on this input AND on
          // any element (buttons, inputs) that receives focus afterwards.
          (document.activeElement as HTMLElement | null)?.blur();
          targetInput.focus();
          targetInput.select();
        } else {
          setSelectedVariantId(null);
          focusBarcodeInput();
        }
      });
    }, 100);
  };

  const selectProduct = (product: Product, closeFinder = true) => {
    addProduct(product);
    setSelectedVariantId(product.variant_id);
    setBarcodeInput('');
    setProductSuggestions([]);
    setShowSuggestions(false);
    if (closeFinder) {
      setShowProductFinder(false);
      focusBarcodeInput();
    } else {
      window.setTimeout(() => productFinderInputRef.current?.focus(), 0);
    }
  };

  const openProductFinder = async () => {
    const term = barcodeInput.trim();
    const products = await searchProducts(term, 50);
    setFinderProducts(products);
    setProductFinderSearch(term);
    setShowProductFinder(true);
    window.setTimeout(() => productFinderInputRef.current?.focus(), 0);
  };

  const openCustomerForm = () => {
    setCustomerName(customer?.name ?? '');
    setCustomerMobile(customer?.mobile ?? '');
    setCustomerError('');
    setCustomerLookupStatus('');
    customerNameEditedRef.current = Boolean(customer?.name);
    setShowCustomerModal(true);
    window.setTimeout(() => customerMobileRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!showCustomerModal) return;
    const mobile = customerMobile.replace(/\D/g, '');
    if (mobile.length < 4) {
      setCustomerLookupStatus('');
      return;
    }

    let cancelled = false;
    const lookup = async () => {
      const localCustomer = await findLocalCustomerByMobile(mobile);
      if (cancelled) return;
      if (localCustomer) {
        if (!customerNameEditedRef.current || !customerName.trim()) setCustomerName(localCustomer.name);
        setCustomerLookupStatus(`Existing customer: ${localCustomer.name}`);
        return;
      }

      if (mobile.length !== 10) {
        setCustomerLookupStatus('');
        return;
      }

      try {
        const remoteCustomer = await apiCustomerLookup(mobile);
        if (cancelled) return;
        if (remoteCustomer?.name) {
          if (!customerNameEditedRef.current || !customerName.trim()) setCustomerName(remoteCustomer.name);
          setCustomerLookupStatus(`Existing customer: ${remoteCustomer.name}`);
          await cacheCustomer(remoteCustomer);
        } else {
          setCustomerLookupStatus('');
        }
      } catch {
        if (!cancelled) setCustomerLookupStatus('');
      }
    };

    const timer = window.setTimeout(() => void lookup(), 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showCustomerModal, customerMobile]);

  const saveCustomer = (event: React.FormEvent) => {
    event.preventDefault();
    const mobile = customerMobile.replace(/\D/g, '');
    const name = customerName.trim();

    if (!mobile) {
      setCustomerError('Mobile number is required.');
      return;
    }

    if (mobile.length < 10) {
      setCustomerError('Enter a valid 10 digit mobile number.');
      return;
    }

    setCustomer({
      code: `C-${mobile.slice(-4)}`,
      name,
      mobile,
    });
    setShowCustomerModal(false);
    focusBarcodeInput();
  };

  const showItemInfo = () => {
    const item = items.at(-1);
    if (!item) {
      openAlert('No item selected. Scan or add an item first.', () => focusBarcodeInput());
      return;
    }

    openAlert([
      `Item: ${item.name}`,
      `SKU: ${item.sku}`,
      `Qty: ${item.qty}`,
      `Rate: Rs ${(Number(item.price) / 100).toFixed(2)}`,
      `Tax: ${item.taxRate}%`,
    ].join('\n'), () => focusBarcodeInput());
  };

  const holdSale = () => {
    if (items.length === 0) {
      openAlert('No active sale to hold.', () => focusBarcodeInput());
      return;
    }

    setHeldSales((current) => [
      {
        id: `${Date.now()}`,
        invoiceNo,
        items: items.map((item) => ({ ...item })),
        customer,
        subtotal,
        total,
        createdAt: new Date(),
      },
      ...current,
    ]);
    clearCart();
    setSelectedVariantId(null);
    setAmountReceived('');
    setShowPayModal(false);
    setInvoiceNo((current) => current + 1);
    focusBarcodeInput();
  };

  const resumeHeldSale = (sale: HeldSale) => {
    if (items.length === 0) {
      replaceCart(sale.items.map((item) => ({ ...item })), sale.customer);
      setSelectedVariantId(sale.items[0]?.variantId ?? null);
      setInvoiceNo(sale.invoiceNo);
      setHeldSales((current) => current.filter((heldSale) => heldSale.id !== sale.id));
      setAmountReceived('');
      setShowPayModal(false);
      focusBarcodeInput();
      return;
    }

    openConfirm(
      'Replace current sale with this held sale?',
      () => {
        replaceCart(sale.items.map((item) => ({ ...item })), sale.customer);
        setSelectedVariantId(sale.items[0]?.variantId ?? null);
        setInvoiceNo(sale.invoiceNo);
        setHeldSales((current) => current.filter((heldSale) => heldSale.id !== sale.id));
        setAmountReceived('');
        setShowPayModal(false);
        focusBarcodeInput();
      },
      () => focusBarcodeInput()
    );
  };

  const deleteHeldSale = (saleId: string) => {
    openConfirm(
      'Delete this held bill?',
      () => {
        setHeldSales((current) => current.filter((sale) => sale.id !== saleId));
        focusBarcodeInput();
      },
      () => focusBarcodeInput()
    );
  };

  const saveSale = async () => {
    if (items.length === 0) {
      openAlert('Nothing to save. Add at least one item.', () => focusBarcodeInput());
      return;
    }

    if (cashier) {
      try {
        await saveBill(invoiceNo, cashier.id, cashier.name, amountReceived, 'billing', paymentTender);
      } catch (e) {
        console.error('Failed to save draft:', e);
        openAlert('Failed to save draft. Please try again.', () => focusBarcodeInput());
        return;
      }
    }
    openAlert(`Invoice ${invoiceNo} saved.`, () => {
      clearCart();
      setSelectedVariantId(null);
      setAmountReceived('');
      setPaymentMode('billing');
      setPaymentTender('cash');
      setInvoiceNo((current) => current + 1);
      setBillDate(null);
      focusBarcodeInput();
    });
  };

  const cancelSale = () => {
    if (items.length === 0 && !amountReceived && !showPayModal) {
      focusBarcodeInput();
      return;
    }

    openConfirm(
      'Cancel the current sale?',
      () => {
        clearCart();
        setSelectedVariantId(null);
        setAmountReceived('');
        setPaymentMode('billing');
        setPaymentTender('cash');
        setShowPayModal(false);
        setBillDate(null);
        focusBarcodeInput();
      },
      () => focusBarcodeInput()
    );
  };

  const deleteSale = () => {
    if (items.length === 0) {
      openAlert('Cart is already empty.', () => focusBarcodeInput());
      return;
    }

    const selectedIdx = items.findIndex((item) => item.variantId === selectedVariantId);
    const itemToDelete = selectedIdx !== -1 ? items[selectedIdx] : items.at(-1);
    
    if (!itemToDelete) {
      focusBarcodeInput();
      return;
    }

    openConfirm(
      `Delete ${itemToDelete.name} from this bill?`,
      () => {
        const deletedIdx = items.findIndex(i => i.variantId === itemToDelete.variantId);
        skipBlurFocusRef.current = true;
        removeItem(itemToDelete.variantId);
        
        setBarcodeInput('');
        setProductSuggestions([]);
        setShowSuggestions(false);
        
        const remainingItems = items.filter((item) => item.variantId !== itemToDelete.variantId);
        if (remainingItems.length > 0) {
          focusNextItem(deletedIdx);
        } else {
          setSelectedVariantId(null);
          focusBarcodeInput();
        }
        window.setTimeout(() => { skipBlurFocusRef.current = false; }, 200);
      },
      () => focusBarcodeInput()
    );
  };

  const clearSale = () => {
    if (items.length === 0) {
      openAlert('Cart is already empty.', () => focusBarcodeInput());
      return;
    }

    openConfirm(
      'Delete all items from this sale?',
      () => {
        clearCart();
        setSelectedVariantId(null);
        focusBarcodeInput();
      },
      () => focusBarcodeInput()
    );
  };

  const refreshGstEnabled = async () => {
    await refreshTerminalSettings();
    if (!db) return gstEnabled;
    const row = await db.get("SELECT value FROM settings WHERE key = 'gst_enabled'");
    const next = row?.value !== 'false';
    setGstEnabled(next);
    return next;
  };

  const openPayment = async () => {
    if (items.length === 0) {
      openAlert('Add at least one item before printing.', () => focusBarcodeInput());
      return;
    }

    await refreshGstEnabled();
    setShowPayModal(true);
  };

  const selectCreditMode = () => {
    if (!customer?.mobile) {
      openAlert('Add customer mobile before adding items to credit / khata.', () => {
        setShowCustomerModal(true);
      });
      return;
    }
    setPaymentMode('credit');
    setAmountReceived('');
  };

  const selectBillingMode = () => {
    setPaymentMode('billing');
    if (paymentTender === 'online') {
      setAmountReceived('');
    }
  };

  const selectPaymentTender = (tender: 'cash' | 'online') => {
    setPaymentTender(tender);
    if (tender === 'online') {
      setAmountReceived('');
    } else {
      focusAmountInput();
    }
  };

  const printBill = async () => {
    if (items.length === 0) {
      openAlert('No items to print.', () => setShowPayModal(false));
      return;
    }

    await refreshGstEnabled();
    const received = Number(amountReceived || 0) * 100;
    if (paymentMode === 'credit' && !customer?.mobile) {
      openAlert('Add customer mobile before saving a credit / khata bill.', () => setShowCustomerModal(true));
      return;
    }
    if (paymentMode === 'billing' && paymentTender === 'cash' && received < Number(effectiveTotal)) {
      openAlert('Amount received is less than the net total.', () => focusAmountInput());
      return;
    }

    // 1. SAVE FIRST — invoice is the source of truth, print is a side effect
    if (cashier) {
      try {
        const receivedAmount = paymentMode === 'credit' || paymentTender === 'online'
          ? '0'
          : amountReceived;
        await saveBill(invoiceNo, cashier.id, cashier.name, receivedAmount, paymentMode, paymentTender, roundOff);
      } catch (e) {
        console.error('Failed to save bill:', e);
        openAlert('Failed to save invoice. Please try again.', () => focusAmountInput());
        return;
      }
    }

    // 2. Then print — silent (no dialog) if running in Electron, fallback to window.print()
    try {
      const api = (window as any).api;
      if (api?.print?.silent) {
        // Read printer name from settings (set via Settings page)
        const printerRow = db ? await db.get("SELECT value FROM settings WHERE key = 'printer_name'") : null;
        const printerName: string | undefined = printerRow?.value || undefined;
        const result = await api.print.silent(printerName) as { success: boolean; error?: string };
        if (!result.success) {
          console.warn('[print] Silent print failed:', result.error, '— falling back to window.print()');
          window.print();
        }
      } else {
        window.print();
      }
    } catch {
      // No printer or print failed — invoice is already saved
    }

    // 3. Reset for next sale
    clearCart();
    setSelectedVariantId(null);
    setShowPayModal(false);
    setAmountReceived('');
    setPaymentMode('billing');
    setPaymentTender('cash');
    setRoundOff(0n);
    setInvoiceNo((current) => current + 1);
    setBillDate(null);
    focusBarcodeInput();
  };

  const saveOnly = async () => {
    if (items.length === 0) {
      openAlert('No items to save.', () => setShowPayModal(false));
      return;
    }

    await refreshGstEnabled();
    const received = Number(amountReceived || 0) * 100;
    if (paymentMode === 'credit' && !customer?.mobile) {
      openAlert('Add customer mobile before saving a credit / khata bill.', () => setShowCustomerModal(true));
      return;
    }
    if (paymentMode === 'billing' && paymentTender === 'cash' && received < Number(effectiveTotal)) {
      openAlert('Amount received is less than the net total.', () => focusAmountInput());
      return;
    }

    if (cashier) {
      try {
        const receivedAmount = paymentMode === 'credit' || paymentTender === 'online'
          ? '0'
          : amountReceived;
        await saveBill(invoiceNo, cashier.id, cashier.name, receivedAmount, paymentMode, paymentTender, roundOff);
      } catch (e) {
        console.error('Failed to save bill:', e);
        openAlert('Failed to save invoice. Please try again.', () => focusAmountInput());
        return;
      }
    }

    clearCart();
    setSelectedVariantId(null);
    setShowPayModal(false);
    setAmountReceived('');
    setPaymentMode('billing');
    setPaymentTender('cash');
    setRoundOff(0n);
    setInvoiceNo((current) => current + 1);
    setBillDate(null);
    focusBarcodeInput();
  };

  const effectiveTotal = total + roundOff;
  const cashBack = paymentMode === 'credit' || paymentTender === 'online' ? 0 : amountReceived ? (Number(amountReceived) * 100 - Number(effectiveTotal)) / 100 : 0;
  const paidAmount = paymentMode === 'credit' ? 0 : paymentTender === 'online' ? Number(effectiveTotal) : Number(amountReceived || 0) * 100;
  const paymentLabel = paymentMode === 'credit' ? 'Credit Due' : paymentTender === 'online' ? 'Online Paid' : 'Cash Paid';
  const receiptDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const cgst = taxTotal / 2n;
  const sgst = taxTotal - cgst;
  const visibleTaxTotal = gstEnabled ? taxTotal : 0n;
  const visibleCgst = gstEnabled ? cgst : 0n;
  const visibleSgst = gstEnabled ? sgst : 0n;
  const discountTotal = items.reduce((sum, item) => sum + item.lineDiscount, 0n) + orderDiscount;
  const formatMoney = (value: bigint | number) => `Rs ${(Number(value) / 100).toFixed(2)}`;
  const formatAmount = (value: bigint | number) => (Number(value) / 100).toFixed(2);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      if (showPayModal) {
        return;
      }

      if (showProductFinder) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowProductFinder(false);
          focusBarcodeInput();
        }
        return;
      }

      if (showCustomerModal) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowCustomerModal(false);
          focusBarcodeInput();
        }
        return;
      }

      if (showCameraScanner) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeCameraScanner();
        }
        return;
      }

      if (event.key === 'F2') {
        event.preventDefault();
        void openProductFinder();
      }

      if (event.key === 'F3') {
        event.preventDefault();
        focusBarcodeInput();
      }

      if (event.key === 'F4') {
        event.preventDefault();
        holdSale();
      }

      if (event.key === 'F8') {
        event.preventDefault();
        openPayment();
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        deleteSale();
      }

      if (event.altKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        showItemInfo();
      }

      if (event.key === 'Escape') {
        setShowSuggestions(false);
        if (!isTyping) {
          cancelSale();
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveSale();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void openProductFinder();
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [showPayModal, showCustomerModal, showProductFinder, showCameraScanner, items, barcodeInput]);

  // Auto-dismiss the add-to-cart expiry notice after a few seconds.
  useEffect(() => {
    if (!addNotice) return;
    const timer = window.setTimeout(() => clearAddNotice(), addNotice.type === 'error' ? 6000 : 4000);
    return () => window.clearTimeout(timer);
  }, [addNotice, clearAddNotice]);

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 overflow-hidden select-none">
      {addNotice ? (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
          <div className={`pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 shadow-xl ring-1 ${addNotice.type === 'error' ? 'bg-rose-600 text-white ring-rose-700' : 'bg-amber-500 text-white ring-amber-600'}`}>
            <span className="text-sm font-bold">{addNotice.type === 'error' ? '⛔' : '⚠'} {addNotice.message}</span>
            <button onClick={clearAddNotice} className="rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide hover:bg-black/10">Dismiss</button>
          </div>
        </div>
      ) : null}
      {/* 1. TOUCH-FIRST COMMAND + SEARCH AREA */}
      <div className="border-b bg-white shadow-sm">
        <div className="grid min-h-[112px] grid-cols-[270px_minmax(360px,1fr)_500px] gap-4 px-4 py-3">
          <div className="flex flex-col justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Counter Sale</div>
                <div className="text-lg font-black text-blue-800">POS-01</div>
              </div>
              <div className="flex items-center overflow-hidden rounded border border-slate-300 bg-white">
                <button type="button" aria-label="Previous invoice" onClick={async () => {
                  const target = Math.max(1, invoiceNo - 1);
                  const bill = await loadBill(target);
                  if (bill) {
                    replaceCart(bill.items, bill.customer);
                    setAmountReceived(bill.amountReceived);
                    setPaymentTender(bill.paymentTender);
                    setInvoiceNo(target);
                    setSelectedVariantId(bill.items[0]?.variantId ?? null);
                    setBillDate(bill.createdAt);
                  } else {
                    setInvoiceNo(target);
                    clearCart();
                    setAmountReceived('');
                    setPaymentTender('cash');
                    setSelectedVariantId(null);
                    setBillDate(null);
                  }
                  focusBarcodeInput();
                }} className="flex h-9 w-9 items-center justify-center text-slate-500 hover:bg-slate-100"><ChevronLeft size={16}/></button>
                <div className="min-w-16 border-x px-2 text-center">
                  <div className="text-[9px] font-bold uppercase text-slate-400">Invoice</div>
                  <div className="text-sm font-black text-blue-700">{invoiceNo}</div>
                </div>
                <button type="button" aria-label="Next invoice" onClick={async () => {
                  const target = invoiceNo + 1;
                  const bill = await loadBill(target);
                  if (bill) {
                    replaceCart(bill.items, bill.customer);
                    setAmountReceived(bill.amountReceived);
                    setPaymentTender(bill.paymentTender);
                    setInvoiceNo(target);
                    setSelectedVariantId(bill.items[0]?.variantId ?? null);
                    setBillDate(bill.createdAt);
                  } else {
                    const max = await getMaxInvoiceNo();
                    const fresh = max + 1;
                    setInvoiceNo(fresh);
                    clearCart();
                    setAmountReceived('');
                    setPaymentTender('cash');
                    setSelectedVariantId(null);
                    setBillDate(null);
                  }
                  focusBarcodeInput();
                }} className="flex h-9 w-9 items-center justify-center text-slate-500 hover:bg-slate-100"><ChevronRight size={16}/></button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-500">Date</span>
              <span className="font-black text-slate-800">
                {billDate ? new Date(billDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-500">Customer</span>
              <button type="button" onClick={openCustomerForm} className="flex max-w-[170px] items-center gap-1 truncate rounded border border-blue-200 bg-blue-50 px-2 py-1 font-black text-blue-700 hover:bg-blue-100">
                <UserPlus size={14} />
                <span className="truncate">{customer?.name || customer?.mobile || 'Add Customer'}</span>
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-500">Cashier</span>
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-800">{cashier?.name || '—'}</span>
                <button type="button" onClick={logout} className="rounded border border-slate-300 px-2 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-100">
                  Logout
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <form onSubmit={handleScan} className="relative">
              <Search className="absolute left-4 top-4 h-6 w-6 text-blue-500" />
              <input
                type="text"
                autoFocus
                ref={barcodeInputRef}
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onFocus={() => setShowSuggestions(productSuggestions.length > 0)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    if (productSuggestions.length > 0) {
                      event.preventDefault();
                      const next = Math.min(highlightedSuggestionRef.current + 1, productSuggestions.length - 1);
                      highlightedSuggestionRef.current = next;
                      setHighlightedSuggestionIdx(next);
                    } else {
                      const firstInput = document.querySelector('input[data-qty-input]') as HTMLInputElement | null;
                      if (firstInput) {
                        event.preventDefault();
                        const variantId = firstInput.getAttribute('data-qty-input');
                        if (variantId) setSelectedVariantId(variantId);
                        firstInput.focus();
                        firstInput.select();
                      }
                    }
                  }
                  if (event.key === 'ArrowUp') {
                    if (productSuggestions.length > 0) {
                      event.preventDefault();
                      const next = Math.max(highlightedSuggestionRef.current - 1, -1);
                      highlightedSuggestionRef.current = next;
                      setHighlightedSuggestionIdx(next);
                    }
                  }
                  if (event.key === 'Enter') {
                    if (highlightedSuggestionRef.current >= 0 && productSuggestions[highlightedSuggestionRef.current]) {
                      event.preventDefault();
                      selectProduct(productSuggestions[highlightedSuggestionRef.current]);
                      highlightedSuggestionRef.current = -1;
                      setHighlightedSuggestionIdx(-1);
                    }
                  }
                }}
                className="h-16 w-full rounded-md border-2 border-blue-200 bg-blue-50 pl-14 pr-16 text-2xl font-black text-slate-950 outline-none focus:border-blue-600 focus:bg-white"
                placeholder="Scan barcode / SKU / item name"
              />
              <button
                type="button"
                onClick={openCameraScanner}
                title="Scan with camera"
                aria-label="Scan barcode with camera"
                className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded border border-blue-200 bg-white text-blue-700 shadow-sm hover:border-blue-500 hover:bg-blue-50"
              >
                <Camera className="h-5 w-5" />
              </button>
              {showSuggestions && productSuggestions.length > 0 && (
                <div className="absolute left-0 top-[70px] z-30 max-h-72 w-[760px] overflow-auto rounded-md border border-slate-300 bg-white shadow-xl">
                  <table className="w-full border-collapse text-[11px]">
                    <thead className="sticky top-0 bg-slate-100 text-[9px] font-black uppercase text-slate-500">
                      <tr>
                        <th className="border-b px-2 py-1.5 text-left">Item</th>
                        <th className="border-b px-2 py-1.5 text-left">SKU</th>
                        <th className="border-b px-2 py-1.5 text-left">Barcode</th>
                        <th className="border-b px-2 py-1.5 text-right">MRP</th>
                        <th className="border-b px-2 py-1.5 text-right">Price</th>
                        {gstEnabled && <th className="border-b px-2 py-1.5 text-center">GST</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {productSuggestions.map((product, index) => (
                        <tr
                          key={product.variant_id}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => {
                            highlightedSuggestionRef.current = index;
                            setHighlightedSuggestionIdx(index);
                          }}
                          onClick={() => {
                            highlightedSuggestionRef.current = -1;
                            setHighlightedSuggestionIdx(-1);
                            selectProduct(product);
                          }}
                          className={cn(
                            "cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none",
                            highlightedSuggestionIdx === index && "bg-blue-100"
                          )}
                        >
                          <td className="max-w-[250px] border-b px-2 py-2 font-black text-slate-900">
                            <div className="flex items-center gap-2">
                              {product.image_thumb ? (
                                <img src={product.image_thumb} alt="" className="h-8 w-8 shrink-0 rounded border border-slate-200 object-contain" />
                              ) : null}
                              <span className="truncate">{product.name}</span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap border-b px-2 py-2 font-bold text-slate-600">{product.sku}</td>
                          <td className="border-b px-2 py-2 font-bold text-slate-500">{product.barcode}</td>
                          <td className="border-b px-2 py-2 text-right font-bold text-slate-500">{formatAmount(product.mrp)}</td>
                          <td className="border-b px-2 py-2 text-right font-black text-blue-700">{formatAmount(product.price)}</td>
                          {gstEnabled && <td className="border-b px-2 py-2 text-center font-bold text-slate-600">{product.tax_rate}%</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-400">
                    Click a row to add. Press F2 for full product finder.
                  </div>
                </div>
              )}
            </form>
            <div className="mt-2 flex items-center justify-between text-[11px] font-bold uppercase text-slate-400">
              <span>F2 Full Finder</span>
              <span>F3 Focus Search</span>
              <span>↑↓ Navigate · Enter Add</span>
              <span>Try 8901001000011</span>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <ToolbarButton icon={Info} label="Info" shortcut="Alt+I" accent="bg-slate-600" onClick={showItemInfo} />
            <ToolbarButton icon={PauseCircle} label="Hold" shortcut="F4" accent="bg-orange-500" onClick={holdSale} />
            <ToolbarButton icon={Save} label="Save" shortcut="Ctrl+S" accent="bg-emerald-600" onClick={saveSale} />
            <ToolbarButton icon={XCircle} label="Cancel" shortcut="Esc" accent="bg-rose-600" onClick={cancelSale} />
            <ToolbarButton icon={Trash2} label="Delete" shortcut="Del" accent="bg-red-600" onClick={deleteSale} />
            <ToolbarButton icon={Search} label="Find" shortcut="F2" accent="bg-indigo-600" onClick={openProductFinder} />
            <ToolbarButton icon={Printer} label="Print" shortcut="F8" accent="bg-cyan-600" onClick={openPayment} />
          </div>
        </div>
      </div>

      {/* 3. MAIN PRODUCT GRID + HELD SALES */}
      <div className="flex min-h-0 flex-1 border-b bg-white">
        <div className="min-w-0 flex-1 overflow-auto shadow-inner">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="pos-table-th w-8">#</th>
                <th className="pos-table-th text-left">Item Code</th>
                <th className="pos-table-th text-left">Description</th>
                <th className="pos-table-th text-center">Qty</th>
                <th className="pos-table-th text-right">Rate</th>
                <th className="pos-table-th text-right">Gross Amount</th>
                <th className="pos-table-th text-center">Disc %</th>
                <th className="pos-table-th text-right">Discount</th>
                <th className="pos-table-th text-right">Net Amount</th>
                {gstEnabled && <th className="pos-table-th text-center">GST %</th>}
                {gstEnabled && <th className="pos-table-th text-right">GST Amt</th>}
                <th className="pos-table-th text-right bg-slate-200">Totals</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={item.variantId}
                  onClick={() => {
                    setSelectedVariantId(item.variantId);
                    focusBarcodeInput();
                  }}
                  className={cn(
                    "cursor-pointer pos-item-row",
                    selectedVariantId === item.variantId && "pos-item-row--selected"
                  )}
                >
                  <td className="pos-table-td text-center text-slate-400">{idx + 1}</td>
                  <td className="pos-table-td">{item.sku}</td>
                  <td className="pos-table-td font-bold">{item.name}</td>
                  <td className="pos-table-td text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button type="button" tabIndex={-1} onClick={() => { clearQtyDraft(item.variantId); item.qty <= 0.001 ? removeItem(item.variantId) : updateQty(item.variantId, item.qty - 1); }} className="text-slate-400 hover:text-blue-600">-</button>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={qtyDrafts[item.variantId] ?? item.qty}
                        data-qty-input={item.variantId}
                        aria-label={`Quantity for ${item.name}`}
                        onChange={(event) => setQtyDraft(item.variantId, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Backspace' && item.qty === 0) {
                            const idx = items.findIndex(i => i.variantId === item.variantId);
                            skipBlurFocusRef.current = true;
                            removeItem(item.variantId);
                            focusNextItem(idx);
                            window.setTimeout(() => { skipBlurFocusRef.current = false; }, 200);
                            return;
                          }
                          // Manual Tab / Arrow / Enter navigation between qty inputs.
                          // Chromium's sequential focus navigation breaks after a focused
                          // input is removed from the DOM (e.g. after item deletion), so we
                          // ALWAYS prevent default and handle navigation entirely ourselves.
                          const isTab = event.key === 'Tab';
                          const isArrowVertical = event.key === 'ArrowDown' || event.key === 'ArrowUp';
                          const isEnter = event.key === 'Enter';
                          if (isTab || isArrowVertical || isEnter) {
                            event.preventDefault();
                            commitQtyDraft(item.variantId);
                            const allInputs = Array.from(document.querySelectorAll('input[data-qty-input]')) as HTMLInputElement[];
                            const currentIdx = allInputs.findIndex(input => input === event.currentTarget);
                            // Fallback to document.activeElement when event target is out of sync
                            // (can happen in Electron after native dialogs or DOM mutations).
                            const effectiveIdx = currentIdx !== -1 ? currentIdx : allInputs.findIndex(input => input === document.activeElement);
                            const goPrev = event.shiftKey || event.key === 'ArrowUp';
                            if (goPrev) {
                              const prevInput = allInputs[effectiveIdx - 1];
                              if (prevInput) {
                                const prevVariantId = prevInput.getAttribute('data-qty-input');
                                if (prevVariantId) setSelectedVariantId(prevVariantId);
                                prevInput.focus();
                                prevInput.select();
                              } else {
                                // At the first item — Shift+Tab / ArrowUp wraps back to the search bar.
                                focusBarcodeInput();
                              }
                            } else {
                              const nextInput = allInputs[effectiveIdx + 1];
                              if (nextInput) {
                                const nextVariantId = nextInput.getAttribute('data-qty-input');
                                if (nextVariantId) setSelectedVariantId(nextVariantId);
                                nextInput.focus();
                                nextInput.select();
                              } else {
                                // At the last item — Tab / ArrowDown / Enter opens payment modal.
                                if (event.key === 'Enter') {
                                  payModalJustOpenedRef.current = true;
                                  window.setTimeout(() => { payModalJustOpenedRef.current = false; }, 100);
                                }
                                openPayment();
                              }
                            }
                          }
                        }}
                        onBlur={(event) => {
                          commitQtyDraft(item.variantId);
                          // If this element is being removed from DOM while focused,
                          // browser focus might get stuck. We help it out.
                          if (skipBlurFocusRef.current) return;
                          if (!document.body.contains(event.target)) {
                            // Only fallback to search if we aren't explicitly focusing another item
                            const activeElement = document.activeElement;
                            if (!activeElement || activeElement === document.body) {
                              focusBarcodeInput();
                            }
                          }
                        }}
                        onFocus={(event) => {
                          setSelectedVariantId(item.variantId);
                          event.currentTarget.select();
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="h-7 w-14 rounded border border-slate-300 bg-white text-center text-xs font-black text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/50 focus:bg-white transition-all"
                      />
                      <button type="button" tabIndex={-1} onClick={() => { clearQtyDraft(item.variantId); updateQty(item.variantId, item.qty + 1); }} className="text-slate-400 hover:text-blue-600">+</button>
                    </div>
                  </td>
                  <td className="pos-table-td text-right">{(Number(item.mrp) / 100).toFixed(2)}</td>
                  <td className="pos-table-td text-right">{(Number(item.mrp) * item.qty / 100).toFixed(2)}</td>
                  <td className="pos-table-td text-center">{Number(item.mrp) > 0 ? ((Number(item.lineDiscount) / (Number(item.mrp) * item.qty)) * 100).toFixed(1) : '0'}</td>
                  <td className="pos-table-td text-right">{(Number(item.lineDiscount) / 100).toFixed(2)}</td>
                  <td className="pos-table-td text-right">{(Number(item.lineTotal) / 100).toFixed(2)}</td>
                  {gstEnabled && <td className="pos-table-td text-center">{item.taxRate}</td>}
                  {gstEnabled && <td className="pos-table-td text-right">0.00</td>}
                  <td className="pos-table-td text-right font-bold bg-slate-50/50">{(Number(item.lineTotal) / 100).toFixed(2)}</td>
                </tr>
              ))}
              {Array.from({ length: Math.max(0, 12 - items.length) }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td className="pos-table-td h-7" colSpan={11}></td>
                  <td className="pos-table-td h-7 bg-slate-50/50"></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-slate-100 font-bold border-t-2 border-slate-300">
               <tr>
                  <td colSpan={5} className="px-4 py-0.5 text-right text-slate-500 uppercase text-[9px]">Summary</td>
                  <td className="px-2 py-0.5 text-right text-[11px]">{(Number(subtotal) / 100).toFixed(2)}</td>
                  <td className="px-2 py-0.5"></td>
                  <td className="px-2 py-0.5 text-right text-[11px]">{(Number(discountTotal) / 100).toFixed(2)}</td>
                  <td className="px-2 py-0.5 text-right text-[11px]">{(Number(total) / 100).toFixed(2)}</td>
                  {gstEnabled && <td className="px-2 py-0.5"></td>}
                  {gstEnabled && <td className="px-2 py-0.5 text-right text-[11px]">{(Number(visibleTaxTotal) / 100).toFixed(2)}</td>}
                  <td className="px-2 py-0.5 text-right text-[11px] bg-slate-200">{(Number(total) / 100).toFixed(2)}</td>
               </tr>
            </tfoot>
          </table>
        </div>

        {heldSales.length > 0 && (
          <aside className="flex w-72 shrink-0 flex-col border-l bg-slate-50">
            <div className="flex h-10 items-center justify-between border-b bg-white px-3">
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">Hold List</span>
              <span className="rounded bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-700">{heldSales.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {heldSales.map((sale) => (
                <div key={sale.id} className="mb-2 rounded border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-black text-slate-900">Invoice POS-{sale.invoiceNo}</div>
                      <div className="text-[10px] font-bold text-slate-400">{sale.createdAt.toLocaleTimeString()}</div>
                    </div>
                    <div className="text-right text-sm font-black text-blue-700">{formatMoney(sale.total)}</div>
                  </div>
                  <div className="mt-2 text-[11px] font-medium text-slate-600">
                    <div>{sale.customer?.name || sale.customer?.mobile || 'Walk-in Customer'}</div>
                    <div>{sale.items.length} items | Qty {sale.items.reduce((sum, item) => sum + item.qty, 0)}</div>
                  </div>
                  <div className="mt-2 truncate text-[10px] text-slate-400">
                    {sale.items.map((item) => item.name).join(', ')}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => resumeHeldSale(sale)} className="h-8 flex-1 rounded bg-orange-500 text-[10px] font-black uppercase text-white hover:bg-orange-600">
                      Resume
                    </button>
                    <button type="button" onClick={() => deleteHeldSale(sale.id)} className="h-8 rounded border border-slate-300 px-2 text-slate-500 hover:bg-slate-100">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* 4. FOOTER TOTALS AREA */}
      <div className="h-24 bg-slate-800 flex items-center px-8 gap-12 text-white">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Items</span>
          <div className="text-2xl font-bold text-slate-200 leading-none mt-1">{items.length}</div>
          <span className="text-[10px] font-bold text-slate-500">Qty: {items.reduce((sum, item) => sum + item.qty, 0)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Gross Total</span>
          <div className="text-2xl font-bold text-emerald-400 leading-none mt-1">Rs {(Number(subtotal) / 100).toFixed(2)}</div>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{gstEnabled ? 'GST Aggregate' : 'GST Off'}</span>
          <div className="text-2xl font-bold text-blue-400 leading-none mt-1">Rs {(Number(visibleTaxTotal) / 100).toFixed(2)}</div>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Discount</span>
          <div className="text-2xl font-bold text-amber-300 leading-none mt-1">Rs {(Number(discountTotal) / 100).toFixed(2)}</div>
        </div>
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => {
              if (syncError) {
                openAlert(syncError, () => focusBarcodeInput());
              } else if (failedCount > 0) {
                openAlert(`${failedCount} sale(s) failed to sync. They will retry automatically on the next sync.`, () => focusBarcodeInput());
              }
              void syncNow();
              void refreshOutboxDepth();
            }}
            title={syncError || (failedCount > 0 ? `${failedCount} sale(s) failed to sync` : undefined)}
            className={cn(
              "flex items-center gap-1.5 rounded border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors",
              syncError || failedCount > 0
                ? "border-rose-700 bg-rose-900 text-rose-200 hover:bg-rose-800"
                : "border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600"
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", isOnline ? "bg-emerald-500" : "bg-rose-500")} />
            {isSyncing ? 'Syncing...' : syncError ? 'Sync Error' : failedCount > 0 ? `${failedCount} Failed` : outboxDepth > 0 ? `${outboxDepth} Pending` : 'Synced'}
          </button>
          {lastSyncAt && (
            <span className="mt-1 text-[9px] font-bold text-slate-500">
              Last: {new Date(lastSyncAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="ml-auto flex flex-col items-end">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Net Total</span>
          <div className="text-5xl font-black text-white leading-none mt-1">Rs {(Number(total) / 100).toFixed(2)}</div>
        </div>
      </div>

      {/* 5. PRINT BILL / PAYMENT MODAL */}
      {showPayModal && (
        <div className="print-preview-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-5xl overflow-hidden rounded-lg border border-slate-700 bg-slate-100 shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b border-slate-300 bg-white px-5">
              <div>
                <div className="text-sm font-black uppercase tracking-wider text-slate-900">Print Preview</div>
                <div className="text-[10px] font-bold uppercase text-slate-400">Press Enter to print, Esc to close</div>
              </div>
              <button type="button" onClick={() => { setShowPayModal(false); focusBarcodeInput(); }} className="text-slate-400 hover:text-slate-900 transition-colors"><XCircle size={20}/></button>
            </div>

            <div className="grid max-h-[calc(100vh-8rem)] grid-cols-[minmax(320px,420px)_1fr] gap-6 overflow-auto p-6">
              <div className="flex justify-center">
                <div className="receipt-preview printable-receipt w-[320px] bg-white px-3 py-4 font-mono text-[11px] leading-tight text-slate-950 shadow-xl">
                  <div className="text-center">
                    <div className="text-base font-black tracking-wide">{storeInfo.name || 'Shubhraj Mini Mart'}</div>
                    <div>Tax Invoice / Bill of Supply</div>
                    {storeInfo.address ? <div>{storeInfo.address}</div> : null}
                    {storeInfo.phone ? <div>Mob: {storeInfo.phone}</div> : null}
                    {gstEnabled && storeInfo.gstin ? <div>GSTIN: {storeInfo.gstin}</div> : null}
                    {storeInfo.fssai ? <div>FSSAI: {storeInfo.fssai}</div> : null}
                  </div>

                  <div className="my-3 border-t border-dashed border-slate-500" />

                  <div className="grid grid-cols-2 gap-y-1">
                    <span>Inv No</span><span className="text-right">INV-{invoiceNo}</span>
                    <span>Date</span><span className="text-right">{receiptDate}</span>
                    <span>Cashier</span><span className="text-right">{cashier?.name || 'Cashier'}</span>
                    <span>Customer</span><span className="text-right">{customer?.name || customer?.mobile || 'Walk-in'}</span>
                  </div>

                  <div className="my-3 border-t border-dashed border-slate-500" />

                  <div className="grid grid-cols-[1fr_28px_52px_56px] gap-1 font-bold uppercase">
                    <span>Item</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Rate</span>
                    <span className="text-right">Amt</span>
                  </div>
                  <div className="my-1 border-t border-dashed border-slate-400" />

                  {items.map((item) => (
                    <div key={item.variantId} className="space-y-0.5 py-1">
                      <div className="truncate font-bold">{item.name}</div>
                      <div className="grid grid-cols-[1fr_28px_52px_56px] gap-1">
                        <span>{item.sku}</span>
                        <span className="text-right">{item.qty}</span>
                        <span className="text-right">{formatMoney(item.mrp)}</span>
                        <span className="text-right">{formatMoney(item.lineTotal)}</span>
                      </div>
                      {item.lineDiscount > 0n && (
                        <div className="flex justify-between text-[10px]">
                          <span>Discount</span>
                          <span>-{formatMoney(item.lineDiscount)}</span>
                        </div>
                      )}
                    </div>
                  ))}

                  <div className="my-3 border-t border-dashed border-slate-500" />

                  <div className="space-y-1">
                    <div className="flex justify-between"><span>Gross Amount</span><span>{formatMoney(subtotal)}</span></div>
                    <div className="flex justify-between"><span>Discount</span><span>{formatMoney(discountTotal)}</span></div>
                    {roundOff !== 0n && (
                      <div className="flex justify-between">
                        <span>Round Off</span>
                        <span>{roundOff > 0n ? '+' : ''}{formatMoney(roundOff)}</span>
                      </div>
                    )}
                    <div className="border-t border-dashed border-slate-500 pt-2 text-base font-black">
                      <div className="flex justify-between"><span>NET TOTAL</span><span>{formatMoney(effectiveTotal)}</span></div>
                    </div>
                    <div className="flex justify-between"><span>{paymentLabel}</span><span>{paymentMode === 'credit' ? formatMoney(effectiveTotal) : formatMoney(paidAmount)}</span></div>
                    {paymentMode !== 'credit' && paymentTender === 'cash' && (
                      <div className="flex justify-between"><span>Change</span><span>Rs {Math.max(0, cashBack).toFixed(2)}</span></div>
                    )}
                  </div>

                  <div className="my-3 border-t border-dashed border-slate-500" />

                  <div className="text-center">
                    <div>Items: {items.length} | Qty: {items.reduce((sum, item) => sum + item.qty, 0)}</div>
                    <div className="mt-2 whitespace-pre-line font-bold">{storeInfo.footer || 'Thank you. Visit again.'}</div>
                    <div>POS-{invoiceNo}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
                  <div className="mb-4 text-xs font-black uppercase tracking-widest text-slate-500">Payment</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded border border-slate-200 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Gross</div>
                      <div className="text-xl font-black text-slate-900">{formatMoney(subtotal)}</div>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">{gstEnabled ? 'GST' : 'GST Off'}</div>
                      <div className="text-xl font-black text-blue-700">{formatMoney(visibleTaxTotal)}</div>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Net</div>
                      <div className="text-xl font-black text-emerald-700">{formatMoney(effectiveTotal)}</div>
                    </div>
                  </div>

                  <div className="mt-5 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="grid grid-cols-2 gap-2 rounded border border-amber-200 bg-white p-1">
                      <button
                        type="button"
                        onClick={selectBillingMode}
                        className={cn("h-10 rounded text-xs font-black uppercase tracking-wider", paymentMode === 'billing' ? "bg-amber-500 text-white" : "text-slate-600 hover:bg-slate-50")}
                      >
                        Billing
                      </button>
                      <button
                        type="button"
                        onClick={selectCreditMode}
                        className={cn("h-10 rounded text-xs font-black uppercase tracking-wider", paymentMode === 'credit' ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50")}
                      >
                        Credit / Khata <span className={cn("ml-1 text-[10px] font-bold", paymentMode === 'credit' ? "opacity-60" : "opacity-40")}>F4</span>
                      </button>
                    </div>
                    {paymentMode === 'credit' ? (
                      <div className="rounded border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700">
                        This bill will be saved under customer credit. Customer mobile is required so the owner can track monthly dues and send the receipt link.
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => selectPaymentTender('cash')}
                            className={cn("flex h-12 items-center justify-center gap-2 rounded border text-xs font-black uppercase tracking-wider", paymentTender === 'cash' ? "border-amber-500 bg-amber-500 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}
                          >
                            <Banknote size={16} /> Cash
                            <span className={cn("ml-1 text-[10px] font-bold", paymentTender === 'cash' ? "opacity-60" : "opacity-40")}>F2</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => selectPaymentTender('online')}
                            className={cn("flex h-12 items-center justify-center gap-2 rounded border text-xs font-black uppercase tracking-wider", paymentTender === 'online' ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}
                          >
                            <CreditCard size={16} /> Online
                            <span className={cn("ml-1 text-[10px] font-bold", paymentTender === 'online' ? "opacity-60" : "opacity-40")}>F3</span>
                          </button>
                        </div>
                        {paymentTender === 'online' ? (
                          <div className="rounded border border-blue-200 bg-white px-3 py-3 text-xs font-bold text-blue-800">
                            Online payment is treated as exact paid amount. No cash received or change calculation is needed.
                          </div>
                        ) : (
                          <>
                            <label className="block text-xs font-black uppercase tracking-wider text-amber-700">Amount Received</label>
                            <input
                              ref={amountInputRef}
                              type="number"
                              min="0"
                              step="0.01"
                              value={amountReceived}
                              onInput={(e: any) => setAmountReceived(e.target.value)}
                              className="h-16 w-full rounded border-2 border-amber-300 bg-white px-4 text-right text-4xl font-black text-amber-700 shadow-inner outline-none focus:border-amber-500"
                              placeholder="0.00"
                              autoFocus
                            />
                          </>
                        )}
                      </>
                    )}
                  </div>

                  <div className={cn(
                    "mt-5 flex items-center justify-between rounded-lg border px-4 py-3",
                    paymentMode === 'credit' ? "border-slate-200 bg-slate-50" : paymentTender === 'online' ? "border-blue-200 bg-blue-50" : cashBack < 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"
                  )}>
                    <span className={cn("text-sm font-black uppercase", paymentMode === 'credit' ? "text-slate-700" : paymentTender === 'online' ? "text-blue-700" : cashBack < 0 ? "text-rose-700" : "text-emerald-700")}>{paymentMode === 'credit' ? 'Credit Due' : paymentTender === 'online' ? 'Online Paid' : 'Cash Back'}</span>
                    <span className={cn("text-3xl font-black", paymentMode === 'credit' ? "text-slate-900" : paymentTender === 'online' ? "text-blue-800" : cashBack < 0 ? "text-rose-700" : "text-emerald-700")}>
                      {paymentMode === 'credit' || paymentTender === 'online' ? formatAmount(effectiveTotal) : cashBack < 0 ? `(${Math.abs(cashBack).toFixed(2)})` : cashBack.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Quick Items — add chocolates/toffees as change */}
                {quickItems.length > 0 && paymentMode === 'billing' && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-violet-500">No Change? Add as Item</div>
                    <div className="flex flex-wrap gap-1.5">
                      {quickItems.map(item => (
                        <button
                          key={item.variant_id}
                          type="button"
                          onClick={() => addProduct(item)}
                          className="rounded border border-violet-300 bg-white px-2 py-1 text-xs font-bold text-violet-800 hover:bg-violet-100 active:scale-95"
                        >
                          {item.name} <span className="opacity-60">₹{(Number(item.mrp) / 100).toFixed(0)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Round Off — removes decimal paise */}
                {paymentMode === 'billing' && Number(total) % 100 !== 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-amber-600">Round Off</div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setRoundOff(roundOff === -BigInt(Number(total) % 100) ? 0n : -BigInt(Number(total) % 100))}
                        className={cn("flex-1 rounded border py-2 text-sm font-black", roundOff < 0n ? "border-amber-500 bg-amber-500 text-white" : "border-amber-300 bg-white text-amber-800 hover:bg-amber-100")}
                      >
                        ₹{Math.floor(Number(total) / 100)} ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => setRoundOff(roundOff === BigInt(100 - Number(total) % 100) ? 0n : BigInt(100 - Number(total) % 100))}
                        className={cn("flex-1 rounded border py-2 text-sm font-black", roundOff > 0n ? "border-amber-500 bg-amber-500 text-white" : "border-amber-300 bg-white text-amber-800 hover:bg-amber-100")}
                      >
                        ₹{Math.ceil(Number(total) / 100)} ↑
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setShowPayModal(false); focusBarcodeInput(); }}
                    className="h-14 flex-1 rounded border border-slate-300 bg-white text-sm font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50"
                  >
                    Close
                  </button>
                  {billDate !== null && (
                    <button
                      type="button"
                      onClick={saveOnly}
                      className="h-14 flex-[2] rounded bg-emerald-500 text-lg font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 active:scale-[0.99]"
                    >
                      <span className="block leading-none">Save</span>
                      <span className="block text-[10px] font-bold tracking-widest opacity-70">Ctrl+S</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={printBill}
                    className="h-14 flex-[2] rounded bg-cyan-400 text-lg font-black uppercase tracking-[0.18em] text-slate-950 shadow-lg shadow-cyan-500/20 hover:bg-cyan-500 active:scale-[0.99]"
                  >
                    Print
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCameraScanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b px-5">
              <div>
                <div className="text-sm font-black uppercase tracking-wider text-slate-800">Camera Barcode Scanner</div>
                <div className="text-[10px] font-bold uppercase text-slate-400">Select the laptop camera or external webcam</div>
              </div>
              <button type="button" onClick={closeCameraScanner} className="text-slate-400 hover:text-slate-900">
                <XCircle size={20} />
              </button>
            </div>

            <div className="grid gap-4 bg-slate-50 p-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Camera</label>
                  <select
                    value={selectedCameraId}
                    onChange={(event) => setSelectedCameraId(event.target.value)}
                    className="h-10 w-full rounded border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                  >
                    {cameraDevices.length === 0 && <option value="">Default camera</option>}
                    {cameraDevices.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {device.label || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs font-bold leading-5 text-blue-900">
                  Hold the barcode steady inside the frame. External USB webcams appear in this list after Windows detects them.
                </div>

                {cameraStatus && (
                  <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                    {cameraStatus}
                  </div>
                )}

                {cameraError && (
                  <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs font-bold leading-5 text-rose-700">
                    {cameraError}
                  </div>
                )}
              </div>

              <div className="relative min-h-[360px] overflow-hidden rounded-md border border-slate-300 bg-slate-950">
                <video
                  ref={cameraVideoRef}
                  muted
                  playsInline
                  className="h-full min-h-[360px] w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-32 w-[72%] rounded border-2 border-cyan-300 shadow-[0_0_0_999px_rgba(15,23,42,0.28)]" />
                </div>
                <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-slate-950/80 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white">
                  Align barcode inside box
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t px-5 py-3">
              <button
                type="button"
                onClick={closeCameraScanner}
                className="h-10 rounded border border-slate-300 bg-white px-4 text-xs font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showProductFinder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b px-5">
              <div>
                <div className="text-sm font-black uppercase tracking-wider text-slate-800">Find Product</div>
                <div className="text-[10px] font-bold uppercase text-slate-400">Search by barcode number, name, SKU, or variation</div>
              </div>
              <button type="button" onClick={() => { setShowProductFinder(false); focusBarcodeInput(); }} className="text-slate-400 hover:text-slate-900">
                <XCircle size={20} />
              </button>
            </div>

            <div className="border-b bg-slate-50 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  ref={productFinderInputRef}
                  type="text"
                  value={productFinderSearch}
                  onChange={(event) => setProductFinderSearch(event.target.value)}
                  className="h-10 w-full rounded border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium outline-none focus:border-blue-500"
                  placeholder="Example: 8901001000011, Milk, MILK-001, Fresh Milk"
                  autoFocus
                />
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="border-b px-3 py-2 text-left">Product Name</th>
                    <th className="border-b px-3 py-2 text-left">SKU</th>
                    <th className="border-b px-3 py-2 text-left">Barcode</th>
                    <th className="border-b px-3 py-2 text-right">MRP</th>
                    <th className="border-b px-3 py-2 text-right">Price</th>
                    {gstEnabled && <th className="border-b px-3 py-2 text-center">GST</th>}
                    <th className="border-b px-3 py-2 text-center">Stock</th>
                    <th className="border-b px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {finderProducts.map((product) => (
                    <tr key={product.variant_id} className="hover:bg-blue-50">
                      <td className="border-b px-3 py-2 font-bold text-slate-900">
                        <div className="flex items-center gap-2">
                          {product.image_thumb ? (
                            <img src={product.image_thumb} alt="" className="h-9 w-9 shrink-0 rounded border border-slate-200 object-contain" />
                          ) : null}
                          <span>{product.name}</span>
                        </div>
                      </td>
                      <td className="border-b px-3 py-2 font-medium text-slate-600">{product.sku}</td>
                      <td className="border-b px-3 py-2 font-medium text-slate-600">{product.barcode}</td>
                      <td className="border-b px-3 py-2 text-right font-medium text-slate-500">{formatMoney(product.mrp)}</td>
                      <td className="border-b px-3 py-2 text-right font-black text-blue-700">{formatMoney(product.price)}</td>
                      {gstEnabled && <td className="border-b px-3 py-2 text-center font-bold text-slate-600">{product.tax_rate}%</td>}
                      <td className={cn(
                        "border-b px-3 py-2 text-center font-bold",
                        product.quantity <= product.reorder_level ? "text-red-600" : "text-green-600"
                      )}>
                        {product.quantity}
                      </td>
                      <td className="border-b px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => selectProduct(product, false)}
                          className="rounded bg-blue-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-blue-700"
                        >
                          Add
                        </button>
                      </td>
                    </tr>
                  ))}
                  {finderProducts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                        No products found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <form onSubmit={saveCustomer} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b px-4">
              <div className="text-sm font-black uppercase tracking-wider text-slate-800">Add Customer</div>
              <button type="button" onClick={() => { setShowCustomerModal(false); focusBarcodeInput(); }} className="text-slate-400 hover:text-slate-900">
                <XCircle size={20} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase text-slate-500">Mobile Number *</label>
                <input
                  ref={customerMobileRef}
                  type="tel"
                  inputMode="numeric"
                  value={customerMobile}
                  onChange={(event) => {
                    setCustomerMobile(event.target.value.replace(/\D/g, '').slice(0, 10));
                    setCustomerError('');
                    setCustomerLookupStatus('');
                  }}
                  className="h-11 w-full rounded border border-slate-300 px-3 text-lg font-bold text-slate-900 outline-none focus:border-blue-500"
                  placeholder="10 digit mobile"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase text-slate-500">Name</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(event) => {
                    customerNameEditedRef.current = true;
                    setCustomerName(event.target.value);
                  }}
                  className="h-11 w-full rounded border border-slate-300 px-3 text-sm font-medium text-slate-900 outline-none focus:border-blue-500"
                  placeholder="Optional"
                />
              </div>

              {customerLookupStatus && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{customerLookupStatus}</div>}
              {customerError && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{customerError}</div>}

              <button type="submit" className="h-11 w-full rounded bg-blue-600 text-sm font-black uppercase tracking-wider text-white hover:bg-blue-700">
                Save Customer
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmModal.open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-2xl p-6">
            <div className="text-sm font-black text-slate-900 mb-6 whitespace-pre-line">{confirmModal.message}</div>
            <div className="flex gap-3">
              {!confirmModal.isAlert && (
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  className="h-11 flex-1 rounded border border-slate-300 bg-white text-sm font-black uppercase text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                ref={confirmBtnRef}
                onClick={handleConfirm}
                className={cn(
                  "h-11 rounded bg-blue-600 text-sm font-black uppercase text-white hover:bg-blue-700",
                  confirmModal.isAlert ? "w-full" : "flex-1"
                )}
              >
                {confirmModal.isAlert ? 'OK' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
