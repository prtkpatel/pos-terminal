import React, { useEffect } from 'react';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { ShellLayout } from './components/shell/ShellLayout';
import { CheckoutScreen } from './pages/CheckoutScreen';
import { LoginScreen } from './pages/LoginScreen';
import { useAuthStore } from './stores/authStore';
import { useSyncStore } from './stores/syncStore';
import { loadApiConfig } from './lib/api';

// Chromium's :focus CSS pseudo-class stops updating after window.confirm() /
// window.alert() in Electron until the OS gives the window focus back.
// Fix: use focusin/focusout DOM events (always reliable) to apply inline styles
// directly — inline styles override everything and don't depend on :focus at all.
function useGlobalFocusStyles() {
  useEffect(() => {
    const applyFocus = (el: HTMLElement) => {
      if (el.classList.contains('touch-action-btn')) {
        // ring-2 ring-blue-500 ring-offset-1 (white offset + blue ring)
        el.style.boxShadow = '0 0 0 2px #ffffff, 0 0 0 4px #3b82f6';
        el.style.outline = 'none';
      }
    };
    const removeFocus = (el: HTMLElement) => {
      if (el.classList.contains('touch-action-btn')) {
        el.style.removeProperty('box-shadow');
        el.style.removeProperty('outline');
      }
    };
    const onFocusIn = (e: FocusEvent) => applyFocus(e.target as HTMLElement);
    const onFocusOut = (e: FocusEvent) => removeFocus(e.target as HTMLElement);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
    };
  }, []);
}

export default function App() {
  useGlobalFocusStyles();
  const { cashier, isLoading, restoreSession } = useAuthStore();
  const { syncNow, refreshOutboxDepth } = useSyncStore();

  useEffect(() => {
    void restoreSession();
    void loadApiConfig();
  }, [restoreSession]);

  // Periodic sync every 30 seconds when logged in
  useEffect(() => {
    if (!cashier) return;
    const timer = window.setInterval(() => {
      void syncNow();
      void refreshOutboxDepth();
    }, 30000);
    // Sync immediately on login
    void syncNow();
    void refreshOutboxDepth();
    return () => window.clearInterval(timer);
  }, [cashier, syncNow, refreshOutboxDepth]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-900">
        <div className="text-sm font-black text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!cashier) {
    return <LoginScreen />;
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<ShellLayout />}>
          <Route index element={<CheckoutScreen />} />
          <Route path="customers" element={<div className="p-8">Customers</div>} />
        </Route>
      </Routes>
    </Router>
  );
}
