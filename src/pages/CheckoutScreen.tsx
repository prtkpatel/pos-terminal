import React, { useEffect, useRef, useState } from 'react';
import { 
  Search, 
  Info, 
  PauseCircle, 
  Save, 
  XCircle, 
  Trash2, 
  Printer,
  ChevronLeft,
  ChevronRight,
  UserPlus
} from 'lucide-react';
import { Customer, Product, useCartStore } from '../stores/cartStore';
import { useAuthStore } from '../stores/authStore';
import { useSyncStore } from '../stores/syncStore';
import { cn } from '../lib/utils';

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

export function CheckoutScreen() {
  const { items, customer, subtotal, taxTotal, orderDiscount, total, addItem, addProduct, searchProducts, updateQty, removeItem, clearCart, replaceCart, setCustomer, saveBill, loadBill, getMaxInvoiceNo } = useCartStore();
  const { cashier, logout } = useAuthStore();
  const { isOnline, isSyncing, lastSyncAt, outboxDepth, syncError, syncNow, refreshOutboxDepth } = useSyncStore();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [productSuggestions, setProductSuggestions] = useState<Product[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showProductFinder, setShowProductFinder] = useState(false);
  const [productFinderSearch, setProductFinderSearch] = useState('');
  const [finderProducts, setFinderProducts] = useState<Product[]>([]);
  const [invoiceNo, setInvoiceNo] = useState(101);
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [showPayModal, setShowPayModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [customerError, setCustomerError] = useState('');
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    let mounted = true;
    getMaxInvoiceNo().then((max) => {
      if (mounted) setInvoiceNo(max + 1);
    });
    return () => { mounted = false; };
  }, []);

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
  }, [showPayModal, amountReceived, items, total]);

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

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = barcodeInput.trim();
    if (!term) return;

    const matches = await searchProducts(term, 10);
    const exactMatch = matches.find((product) =>
      product.barcode.toLowerCase() === term.toLowerCase() ||
      product.sku.toLowerCase() === term.toLowerCase()
    );

    if (exactMatch) {
      addProduct(exactMatch);
      setBarcodeInput('');
      setProductSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (matches.length === 1) {
      addProduct(matches[0]);
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

    await addItem(term);
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
    setShowCustomerModal(true);
    window.setTimeout(() => customerMobileRef.current?.focus(), 0);
  };

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
        await saveBill(invoiceNo, cashier.id, cashier.name, amountReceived);
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
      setInvoiceNo((current) => current + 1);
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
        setShowPayModal(false);
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

  const openPayment = () => {
    if (items.length === 0) {
      openAlert('Add at least one item before printing.', () => focusBarcodeInput());
      return;
    }

    setShowPayModal(true);
  };

  const printBill = async () => {
    if (items.length === 0) {
      openAlert('No items to print.', () => setShowPayModal(false));
      return;
    }

    const received = Number(amountReceived || 0) * 100;
    if (received < Number(total)) {
      openAlert('Amount received is less than the net total.', () => focusAmountInput());
      return;
    }

    // 1. SAVE FIRST — invoice is the source of truth, print is a side effect
    if (cashier) {
      try {
        await saveBill(invoiceNo, cashier.id, cashier.name, amountReceived);
      } catch (e) {
        console.error('Failed to save bill:', e);
        openAlert('Failed to save invoice. Please try again.', () => focusAmountInput());
        return;
      }
    }

    // 2. Then print (best effort — don't block on printer failure)
    try {
      window.print();
    } catch {
      // No printer or print cancelled — invoice is already saved
    }

    // 3. Reset for next sale
    clearCart();
    setSelectedVariantId(null);
    setShowPayModal(false);
    setAmountReceived('');
    setInvoiceNo((current) => current + 1);
    focusBarcodeInput();
  };

  const cashBack = amountReceived ? (Number(amountReceived) * 100 - Number(total)) / 100 : 0;
  const paidAmount = Number(amountReceived || 0) * 100;
  const receiptDate = new Date().toLocaleString();
  const cgst = taxTotal / 2n;
  const sgst = taxTotal - cgst;
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
  }, [showPayModal, showCustomerModal, showProductFinder, items, barcodeInput]);

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 overflow-hidden select-none">
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
                    setInvoiceNo(target);
                    setSelectedVariantId(bill.items[0]?.variantId ?? null);
                  } else {
                    setInvoiceNo(target);
                    clearCart();
                    setAmountReceived('');
                    setSelectedVariantId(null);
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
                    setInvoiceNo(target);
                    setSelectedVariantId(bill.items[0]?.variantId ?? null);
                  } else {
                    const max = await getMaxInvoiceNo();
                    const fresh = max + 1;
                    setInvoiceNo(fresh);
                    clearCart();
                    setAmountReceived('');
                    setSelectedVariantId(null);
                  }
                  focusBarcodeInput();
                }} className="flex h-9 w-9 items-center justify-center text-slate-500 hover:bg-slate-100"><ChevronRight size={16}/></button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-500">Date</span>
              <span className="font-black text-slate-800">{new Date().toLocaleDateString()}</span>
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
                className="h-16 w-full rounded-md border-2 border-blue-200 bg-blue-50 pl-14 pr-4 text-2xl font-black text-slate-950 outline-none focus:border-blue-600 focus:bg-white"
                placeholder="Scan barcode / SKU / item name"
              />
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
                        <th className="border-b px-2 py-1.5 text-center">GST</th>
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
                          <td className="max-w-[250px] truncate border-b px-2 py-2 font-black text-slate-900">{product.name}</td>
                          <td className="whitespace-nowrap border-b px-2 py-2 font-bold text-slate-600">{product.sku}</td>
                          <td className="border-b px-2 py-2 font-bold text-slate-500">{product.barcode}</td>
                          <td className="border-b px-2 py-2 text-right font-bold text-slate-500">{formatAmount(product.mrp)}</td>
                          <td className="border-b px-2 py-2 text-right font-black text-blue-700">{formatAmount(product.price)}</td>
                          <td className="border-b px-2 py-2 text-center font-bold text-slate-600">{product.tax_rate}%</td>
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
                <th className="pos-table-th text-center">VAT %</th>
                <th className="pos-table-th text-right">VAT Amt</th>
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
                      <button type="button" tabIndex={-1} onClick={() => item.qty <= 1 ? removeItem(item.variantId) : updateQty(item.variantId, item.qty - 1)} className="text-slate-400 hover:text-blue-600">-</button>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.qty}
                        data-qty-input={item.variantId}
                        aria-label={`Quantity for ${item.name}`}
                        onChange={(event) => {
                          const nextQty = Number(event.target.value);
                          if (Number.isFinite(nextQty)) {
                            updateQty(item.variantId, Math.max(1, Math.floor(nextQty)));
                          }
                        }}
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
                      <button type="button" tabIndex={-1} onClick={() => updateQty(item.variantId, item.qty + 1)} className="text-slate-400 hover:text-blue-600">+</button>
                    </div>
                  </td>
                  <td className="pos-table-td text-right">{(Number(item.mrp) / 100).toFixed(2)}</td>
                  <td className="pos-table-td text-right">{(Number(item.mrp) * item.qty / 100).toFixed(2)}</td>
                  <td className="pos-table-td text-center">{Number(item.mrp) > 0 ? ((Number(item.lineDiscount) / (Number(item.mrp) * item.qty)) * 100).toFixed(1) : '0'}</td>
                  <td className="pos-table-td text-right">{(Number(item.lineDiscount) / 100).toFixed(2)}</td>
                  <td className="pos-table-td text-right">{(Number(item.lineTotal) / 100).toFixed(2)}</td>
                  <td className="pos-table-td text-center">{item.taxRate}</td>
                  <td className="pos-table-td text-right">0.00</td>
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
                  <td className="px-2 py-0.5"></td>
                  <td className="px-2 py-0.5 text-right text-[11px]">{(Number(taxTotal) / 100).toFixed(2)}</td>
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
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Gross Total</span>
          <div className="text-2xl font-bold text-emerald-400 leading-none mt-1">Rs {(Number(subtotal) / 100).toFixed(2)}</div>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Tax Aggregate</span>
          <div className="text-2xl font-bold text-blue-400 leading-none mt-1">Rs {(Number(taxTotal) / 100).toFixed(2)}</div>
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
              }
              void syncNow();
              void refreshOutboxDepth();
            }}
            title={syncError || undefined}
            className={cn(
              "flex items-center gap-1.5 rounded border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors",
              syncError
                ? "border-rose-700 bg-rose-900 text-rose-200 hover:bg-rose-800"
                : "border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600"
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", isOnline ? "bg-emerald-500" : "bg-rose-500")} />
            {isSyncing ? 'Syncing...' : syncError ? 'Sync Error' : outboxDepth > 0 ? `${outboxDepth} Pending` : 'Synced'}
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
                <div className="receipt-preview printable-receipt w-[320px] bg-white px-4 py-5 font-mono text-[11px] leading-tight text-slate-950 shadow-xl">
                  <div className="text-center">
                    <div className="text-base font-black tracking-wide">KRUTIK POS MART</div>
                    <div>Tax Invoice / Bill of Supply</div>
                    <div>Shop No. 12, Main Market, India</div>
                    <div>GSTIN: 27ABCDE1234F1Z5</div>
                    <div>FSSAI: 10000000000000</div>
                  </div>

                  <div className="my-3 border-t border-dashed border-slate-500" />

                  <div className="grid grid-cols-2 gap-y-1">
                    <span>Inv No</span><span className="text-right">POS-{invoiceNo}</span>
                    <span>Date</span><span className="text-right">{receiptDate}</span>
                    <span>Terminal</span><span className="text-right">POS-01</span>
                    <span>Cashier</span><span className="text-right">Admin</span>
                    <span>Customer</span><span className="text-right">{customer?.name || customer?.mobile || 'Walk-in'}</span>
                  </div>

                  <div className="my-3 border-t border-dashed border-slate-500" />

                  <div className="grid grid-cols-[1fr_34px_58px_64px] gap-1 font-bold uppercase">
                    <span>Item</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Rate</span>
                    <span className="text-right">Amt</span>
                  </div>
                  <div className="my-1 border-t border-dashed border-slate-400" />

                  {items.map((item) => (
                    <div key={item.variantId} className="space-y-0.5 py-1">
                      <div className="truncate font-bold">{item.name}</div>
                      <div className="grid grid-cols-[1fr_34px_58px_64px] gap-1">
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
                    <div className="flex justify-between"><span>CGST</span><span>{formatMoney(cgst)}</span></div>
                    <div className="flex justify-between"><span>SGST</span><span>{formatMoney(sgst)}</span></div>
                    <div className="border-t border-dashed border-slate-500 pt-2 text-base font-black">
                      <div className="flex justify-between"><span>NET TOTAL</span><span>{formatMoney(total)}</span></div>
                    </div>
                    <div className="flex justify-between"><span>Cash Paid</span><span>{formatMoney(paidAmount)}</span></div>
                    <div className="flex justify-between"><span>Change</span><span>Rs {Math.max(0, cashBack).toFixed(2)}</span></div>
                  </div>

                  <div className="my-3 border-t border-dashed border-slate-500" />

                  <div className="text-center">
                    <div>Items: {items.length} | Qty: {items.reduce((sum, item) => sum + item.qty, 0)}</div>
                    <div className="mt-2 font-bold">Thank you. Visit again.</div>
                    <div className="mt-2 tracking-[0.35em]">|||| ||| |||| ||</div>
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
                      <div className="text-[10px] font-bold uppercase text-slate-400">GST</div>
                      <div className="text-xl font-black text-blue-700">{formatMoney(taxTotal)}</div>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">Net</div>
                      <div className="text-xl font-black text-emerald-700">{formatMoney(total)}</div>
                    </div>
                  </div>

                  <div className="mt-5 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
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
                  </div>

                  <div className={cn(
                    "mt-5 flex items-center justify-between rounded-lg border px-4 py-3",
                    cashBack < 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"
                  )}>
                    <span className={cn("text-sm font-black uppercase", cashBack < 0 ? "text-rose-700" : "text-emerald-700")}>Cash Back</span>
                    <span className={cn("text-3xl font-black", cashBack < 0 ? "text-rose-700" : "text-emerald-700")}>
                      {cashBack < 0 ? `(${Math.abs(cashBack).toFixed(2)})` : cashBack.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setShowPayModal(false); focusBarcodeInput(); }}
                    className="h-14 flex-1 rounded border border-slate-300 bg-white text-sm font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50"
                  >
                    Close
                  </button>
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
                    <th className="border-b px-3 py-2 text-center">GST</th>
                    <th className="border-b px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {finderProducts.map((product) => (
                    <tr key={product.variant_id} className="hover:bg-blue-50">
                      <td className="border-b px-3 py-2 font-bold text-slate-900">{product.name}</td>
                      <td className="border-b px-3 py-2 font-medium text-slate-600">{product.sku}</td>
                      <td className="border-b px-3 py-2 font-medium text-slate-600">{product.barcode}</td>
                      <td className="border-b px-3 py-2 text-right font-medium text-slate-500">{formatMoney(product.mrp)}</td>
                      <td className="border-b px-3 py-2 text-right font-black text-blue-700">{formatMoney(product.price)}</td>
                      <td className="border-b px-3 py-2 text-center font-bold text-slate-600">{product.tax_rate}%</td>
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
                      <td colSpan={7} className="px-4 py-10 text-center text-sm font-bold text-slate-400">
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
                  onChange={(event) => setCustomerName(event.target.value)}
                  className="h-11 w-full rounded border border-slate-300 px-3 text-sm font-medium text-slate-900 outline-none focus:border-blue-500"
                  placeholder="Optional"
                />
              </div>

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
